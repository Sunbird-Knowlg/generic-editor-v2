import React, { useEffect, useRef, useState } from 'react';
import Drawer from './Drawer';
import type { EditorController } from '../useEditor';
import type { RawTranscript, TranscriptSegment } from '../types';
import { t, tf } from '../i18n/i18n';
import { CaptionsIcon } from '../icons';

interface ParsedSegments {
  /** Display/editing view - only the fields the UI needs. */
  segments: TranscriptSegment[];
  /** The original segment objects, index-aligned with `segments`, kept around so a save
   *  can merge just the edited text back in rather than reconstructing (and thereby losing
   *  any field the parser doesn't know about, e.g. Whisper's seek/tokens/avg_logprob/...). */
  rawSegments: Record<string, unknown>[];
}

/** Parses the artifactUrl transcript.json (Whisper-style `{segments:[...]}` or a bare array), returning null on any other shape. `rawSegments[i]` corresponds to `segments[i]` (a segment dropped for a non-string `text` is dropped from both, in lockstep). */
function parseSegments(raw: unknown): ParsedSegments | null {
  const obj = raw as Record<string, unknown> | null;
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.segments) ? (obj!.segments as unknown[]) : null;
  if (!list) return null;
  const segments: TranscriptSegment[] = [];
  const rawSegments: Record<string, unknown>[] = [];
  list.forEach((item, index) => {
    const o = item as Record<string, unknown>;
    const text = o.text ?? o.transcript ?? o.content;
    if (typeof text !== 'string') return;
    const start = o.start ?? o.startTime ?? o.start_time;
    const end = o.end ?? o.endTime ?? o.end_time;
    segments.push({
      id: typeof o.id === 'number' ? o.id : index,
      text,
      start: typeof start === 'number' ? start : undefined,
      end: typeof end === 'number' ? end : undefined,
    });
    rawSegments.push(o);
  });
  return segments.length ? { segments, rawSegments } : null;
}

function formatTimestamp(seconds?: number): string {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The five backend-confirmed transcript statuses: Draft, Processing, Review, Live, Failed. */
const KNOWN_STATUSES = ['Draft', 'Processing', 'Review', 'Live', 'Failed'];

/** Extracts the real status from the approve/reject error text (e.g. "currently Live"), which is more reliable than a follow-up re-read that can come back stale. */
function parseCurrentStatusFromError(message: string): string | null {
  const found = /currently\s+(\w+)/i.exec(message)?.[1];
  return found ? KNOWN_STATUSES.find((s) => s.toLowerCase() === found.toLowerCase()) ?? null : null;
}

type StatusTone = 'draft' | 'review' | 'processing' | 'live' | 'failed';

function statusTone(status?: string): StatusTone {
  switch (status) {
    case 'Draft': return 'draft';
    case 'Review': return 'review';
    case 'Processing': return 'processing';
    case 'Live': return 'live';
    case 'Failed': return 'failed';
    default: return 'draft'; // unrecognized - safest neutral treatment
  }
}

function statusLabel(lang: string, status?: string): string {
  // Switches on the raw status (not statusTone, which already collapses anything
  // unrecognized to 'draft') so a genuinely unexpected status still reaches the
  // fallback instead of always being silently mislabeled "Draft".
  switch (status) {
    case 'Draft': return t(lang, 'STATUS_DRAFT');
    case 'Review': return t(lang, 'STATUS_NEEDS_REVIEW');
    case 'Processing': return t(lang, 'STATUS_PROCESSING');
    case 'Live': return t(lang, 'STATUS_LIVE');
    case 'Failed': return t(lang, 'STATUS_FAILED');
    default: return status || t(lang, 'STATUS_NEEDS_REVIEW');
  }
}

/** Coarse "x min/hr/day ago", falling back to '' for a missing/invalid timestamp. */
function relativeTime(lang: string, iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return t(lang, 'TIME_JUST_NOW');
  if (mins < 60) return tf(lang, 'TIME_MINUTES_AGO', { n: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return tf(lang, 'TIME_HOURS_AGO', { n: hrs });
  const days = Math.round(hrs / 24);
  return tf(lang, days === 1 ? 'TIME_DAY_AGO' : 'TIME_DAYS_AGO', { n: days });
}

/** TranscriptsDrawer — views/approves/rejects/edits content.enrichment.transcripts, fetched on open via a dedicated ?enrich=all read to avoid that cost elsewhere. */
const TranscriptsDrawer: React.FC<{ ed: EditorController }> = ({ ed }) => {
  const { lang, drawer, setDrawer, content, service, showToast } = ed;
  const open = drawer === 'transcripts';

  const [transcripts, setTranscripts] = useState<RawTranscript[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* Segments sub-view for one language. */
  const [activeLang, setActiveLang] = useState<RawTranscript | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [rawSegments, setRawSegments] = useState<Record<string, unknown>[] | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentsError, setSegmentsError] = useState(false);
  /** Bumped by openSegments/closeSegments so a slow fetch for a language the user has
   *  already navigated away from can't land its result onto the wrong (now-active) one. */
  const segmentsRequestRef = useRef(0);

  /* Source-language segments can be edited (text only). */
  const [isEditingSegments, setIsEditingSegments] = useState(false);
  const [draftSegments, setDraftSegments] = useState<TranscriptSegment[] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* Approve/reject applies asynchronously server-side, so we re-read and only show the new status once confirmed. */
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingExpectedStatus, setPendingExpectedStatus] = useState<string | null>(null);

  const load = () => {
    if (!content?.identifier) return;
    setLoading(true);
    setLoadError(null);
    service
      .readTranscripts(content.identifier)
      .then(setTranscripts)
      .catch((err) => {
        setTranscripts([]);
        // Distinct from a genuinely-empty result - don't let a failed read masquerade as "no transcripts yet".
        setLoadError(String((err as Error)?.message ?? t(lang, 'ERROR_GENERIC')));
      })
      .finally(() => setLoading(false));
  };

  const closeSegments = () => {
    segmentsRequestRef.current += 1; // discard any in-flight fetch for the language we're leaving
    setActiveLang(null);
    setSegments(null);
    setRawSegments(null);
    setSegmentsError(false);
    setIsEditingSegments(false);
    setDraftSegments(null);
    setSaveError(null);
    setActionError(null);
    setPendingExpectedStatus(null);
  };

  /** "Back to languages" click handler - unlike closeSegments() alone (also used right after
   *  an already-fresh confirmed approve/reject), this re-fetches so manually navigating back
   *  without a confirmed action doesn't leave the list showing a stale, out-of-date status. */
  const backToLanguages = () => {
    closeSegments();
    load();
  };

  /** Single re-read to check whether an approve/reject has actually landed -
   *  updates the loaded list only when it truly matches, never assumes it. */
  const confirmTranscriptStatus = (transcriptId: string, expectedStatus: string): Promise<boolean> => {
    if (!content?.identifier) return Promise.resolve(false);
    return service.readTranscripts(content.identifier).then((list) => {
      const match = list.find((tr) => (tr.identifier ?? tr.code) === transcriptId);
      if (match?.status === expectedStatus) {
        setTranscripts(list);
        return true;
      }
      return false;
    });
  };

  /** Re-syncs activeLang from the server when approve/reject itself fails, so the badge reflects the real status instead of contradicting the error below it. */
  const refreshActiveLangFromServer = (transcriptId: string): Promise<void> => {
    if (!content?.identifier) return Promise.resolve();
    return service.readTranscripts(content.identifier).then((list) => {
      setTranscripts(list);
      const fresh = list.find((tr) => (tr.identifier ?? tr.code) === transcriptId);
      if (fresh) setActiveLang(fresh);
    });
  };

  /** Apply a status we already know for certain (parsed from an error, not a re-read)
   *  to both the list and the open segments view, without waiting on the network. */
  const applyKnownStatus = (transcriptId: string, status: string) => {
    setTranscripts((list) => list.map((tr) => ((tr.identifier ?? tr.code) === transcriptId ? { ...tr, status } : tr)));
    setActiveLang((prev) => (prev && (prev.identifier ?? prev.code) === transcriptId ? { ...prev, status } : prev));
  };

  const startEditingSegments = () => {
    if (!segments || !activeLang) return;
    // Editing is only allowed while a transcript is genuinely in Review - a Live
    // transcript is the published caption, so surface why instead of silently no-oping.
    if (activeLang.status === 'Live') {
      showToast(t(lang, 'ERROR_TRANSCRIPT_LIVE'), 'error');
      return;
    }
    if (activeLang.status !== 'Review') return;
    setDraftSegments(segments.map((s) => ({ ...s })));
    setIsEditingSegments(true);
    setSaveError(null);
  };

  const cancelEditingSegments = () => {
    setIsEditingSegments(false);
    setDraftSegments(null);
    setSaveError(null);
  };

  const updateDraftSegmentText = (index: number, text: string) => {
    setDraftSegments((prev) => (prev ? prev.map((s, i) => (i === index ? { ...s, text } : s)) : prev));
  };

  const saveSegments = () => {
    const transcriptId = activeLang?.identifier ?? activeLang?.code;
    if (!draftSegments || !rawSegments || !content?.identifier || !transcriptId) return;
    setIsSaving(true);
    setSaveError(null);
    // Merge only the edited text back into the original segment objects (index-aligned
    // with draftSegments) instead of sending the reconstructed {id,text,start,end} view -
    // any field the parser doesn't surface (Whisper's seek/tokens/avg_logprob/...) survives.
    const merged = rawSegments.map((raw, i) => ({ ...raw, text: draftSegments[i]?.text ?? raw.text }));
    service
      .updateTranscript(content.identifier, transcriptId, merged)
      .then(() => {
        setSegments(draftSegments);
        setRawSegments(merged);
        setIsEditingSegments(false);
        setDraftSegments(null);
      })
      .catch((err) => {
        setSaveError(String((err as Error)?.message ?? t(lang, 'ERROR_GENERIC')));
      })
      .finally(() => setIsSaving(false));
  };

  const handleApprove = () => {
    const transcriptId = activeLang?.identifier ?? activeLang?.code;
    if (!activeLang || !content?.identifier || !transcriptId) return;
    setIsApproving(true);
    setActionError(null);
    setPendingExpectedStatus(null);
    service
      .approveTranscript(content.identifier, transcriptId)
      // A failed confirm re-read must not be reported as an approve failure - the
      // approve itself already landed, so treat it the same as "not confirmed yet".
      .then(() => confirmTranscriptStatus(transcriptId, 'Live').catch(() => false))
      .then((confirmed) => {
        if (confirmed) closeSegments();
        else {
          setActionError(t(lang, 'STATUS_UPDATE_PENDING'));
          setPendingExpectedStatus('Live');
        }
      })
      .catch((err) => {
        const realStatus = parseCurrentStatusFromError(String((err as Error)?.message ?? ''));
        if (realStatus) {
          // Trust the error's own status over a re-read that may come back stale.
          applyKnownStatus(transcriptId, realStatus);
          if (realStatus === 'Live') { closeSegments(); return; }
          setActionError(t(lang, 'ERROR_TRANSCRIPT_ACTION_FAILED'));
          return;
        }
        // Unparseable error - re-sync from the server instead of surfacing a raw errmsg that could contradict the badge.
        setActionError(t(lang, 'ERROR_TRANSCRIPT_ACTION_FAILED'));
        return refreshActiveLangFromServer(transcriptId).catch(() => {});
      })
      .finally(() => setIsApproving(false));
  };

  const handleReject = () => {
    const transcriptId = activeLang?.identifier ?? activeLang?.code;
    if (!activeLang || !content?.identifier || !transcriptId) return;
    setIsRejecting(true);
    setActionError(null);
    setPendingExpectedStatus(null);
    service
      .rejectTranscript(content.identifier, transcriptId)
      // Same reasoning as handleApprove: a failed confirm re-read isn't a reject failure.
      .then(() => confirmTranscriptStatus(transcriptId, 'Draft').catch(() => false))
      .then((confirmed) => {
        if (confirmed) closeSegments();
        else {
          setActionError(t(lang, 'STATUS_UPDATE_PENDING'));
          setPendingExpectedStatus('Draft');
        }
      })
      .catch((err) => {
        const realStatus = parseCurrentStatusFromError(String((err as Error)?.message ?? ''));
        if (realStatus) {
          applyKnownStatus(transcriptId, realStatus);
          if (realStatus === 'Draft') { closeSegments(); return; }
          setActionError(t(lang, 'ERROR_TRANSCRIPT_ACTION_FAILED'));
          return;
        }
        setActionError(t(lang, 'ERROR_TRANSCRIPT_ACTION_FAILED'));
        return refreshActiveLangFromServer(transcriptId).catch(() => {});
      })
      .finally(() => setIsRejecting(false));
  };

  const handleRecheckStatus = () => {
    const transcriptId = activeLang?.identifier ?? activeLang?.code;
    if (!activeLang || !transcriptId || !pendingExpectedStatus) return;
    setIsCheckingStatus(true);
    confirmTranscriptStatus(transcriptId, pendingExpectedStatus)
      .then((confirmed) => {
        if (confirmed) closeSegments();
        else setActionError(t(lang, 'STATUS_UPDATE_PENDING'));
      })
      .catch(() => setActionError(t(lang, 'ERROR_TRANSCRIPT_ACTION_FAILED')))
      .finally(() => setIsCheckingStatus(false));
  };

  useEffect(() => {
    if (!open) { closeSegments(); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, content?.identifier]);

  const openSegments = (tr: RawTranscript, startInEditMode = false) => {
    if (!tr.artifactUrl) return;
    const requestToken = ++segmentsRequestRef.current;
    setActiveLang(tr);
    setSegments(null);
    setRawSegments(null);
    setSegmentsError(false);
    setIsEditingSegments(false);
    setDraftSegments(null);
    setSaveError(null);
    setSegmentsLoading(true);
    fetch(tr.artifactUrl)
      .then((r) => r.json())
      .then((json) => {
        // A slower fetch for a language the user has since navigated away from (Back,
        // or straight to another language) must not clobber whatever's active now.
        if (segmentsRequestRef.current !== requestToken) return;
        const parsed = parseSegments(json);
        if (!parsed) { setSegmentsError(true); return; }
        setSegments(parsed.segments);
        setRawSegments(parsed.rawSegments);
        if (startInEditMode) {
          setDraftSegments(parsed.segments.map((s) => ({ ...s })));
          setIsEditingSegments(true);
        }
      })
      .catch(() => { if (segmentsRequestRef.current === requestToken) setSegmentsError(true); })
      .finally(() => { if (segmentsRequestRef.current === requestToken) setSegmentsLoading(false); });
  };

  const handleModifyClick = (tr: RawTranscript) => {
    // Editing is only allowed while a transcript is genuinely in Review - a Live
    // transcript is the published caption, so surface why instead of silently no-oping.
    if (tr.status === 'Live') {
      showToast(t(lang, 'ERROR_TRANSCRIPT_LIVE'), 'error');
      return;
    }
    if (tr.status !== 'Review') return;
    openSegments(tr, true);
  };

  const renderSegmentsView = () => {
    const tone = statusTone(activeLang!.status);
    // Editable only for a source-language transcript still in Review, and not while
    // pendingExpectedStatus is set (activeLang.status is stale until the confirm re-read lands).
    const canShowEditControls =
      activeLang!.sourceLanguage && activeLang!.status === 'Review' && !pendingExpectedStatus &&
      !segmentsLoading && !segmentsError && !!segments;
    const displaySegments = isEditingSegments ? draftSegments : segments;
    return (
    <div className="ce-transcript-segments-view">
      <button type="button" className="ce-link-btn ce-transcript-back" onClick={backToLanguages}>
        ← {t(lang, 'BACK_TO_LANGUAGES')}
      </button>
      <div className="ce-transcript-segments-head">
        <div className="ce-transcript-segments-title">{activeLang!.language}</div>
        {pendingExpectedStatus ? (
          // Once the user has acted, don't keep showing "Needs review" (as if nothing
          // happened) while we wait for the server to catch up - show a neutral pending state instead.
          <span className="ce-transcript-status ce-transcript-status--review">
            <span className="ce-transcript-status-dot" /> {t(lang, 'STATUS_UPDATING')}
          </span>
        ) : (
          <span className={`ce-transcript-status ce-transcript-status--${tone}`}>
            <span className="ce-transcript-status-dot" /> {statusLabel(lang, activeLang!.status)}
          </span>
        )}
      </div>
      {tone === 'review' && !isEditingSegments && !pendingExpectedStatus && (
        <div className="ce-transcript-review-actions">
          <button type="button" className="ce-btn ce-btn--ghost" onClick={handleReject} disabled={isApproving || isRejecting || isCheckingStatus}>
            {isRejecting ? t(lang, 'REJECTING_TRANSCRIPT') : t(lang, 'REJECT_TRANSCRIPT')}
          </button>
          <button type="button" className="ce-btn ce-btn--primary" onClick={handleApprove} disabled={isApproving || isRejecting || isCheckingStatus}>
            {isApproving ? t(lang, 'APPROVING_TRANSCRIPT') : t(lang, 'APPROVE_TRANSCRIPT')}
          </button>
        </div>
      )}
      {actionError && (
        <div className="ce-transcript-action-error">
          <p className="ce-transcripts-empty-sub">{actionError}</p>
          {pendingExpectedStatus && (
            <button type="button" className="ce-btn ce-btn--ghost" onClick={handleRecheckStatus} disabled={isCheckingStatus}>
              {isCheckingStatus ? t(lang, 'CHECKING_STATUS') : t(lang, 'CHECK_AGAIN')}
            </button>
          )}
        </div>
      )}
      {canShowEditControls && (
        <div className="ce-transcript-segment-edit-actions">
          {isEditingSegments ? (
            <>
              <button type="button" className="ce-btn ce-btn--ghost" onClick={cancelEditingSegments} disabled={isSaving}>
                {t(lang, 'CANCEL')}
              </button>
              <button type="button" className="ce-btn ce-btn--primary" onClick={saveSegments} disabled={isSaving}>
                {isSaving ? t(lang, 'SAVING') : t(lang, 'SAVE_SEGMENTS')}
              </button>
            </>
          ) : (
            <button type="button" className="ce-btn ce-btn--ghost" onClick={startEditingSegments}>
              {t(lang, 'EDIT_SEGMENTS')}
            </button>
          )}
        </div>
      )}
      {saveError && <p className="ce-transcripts-empty-sub">{saveError}</p>}
      {segmentsLoading ? (
        <div className="ce-center" style={{ padding: 40 }}>
          <div className="ce-spinner ce-spinner--sm" />
        </div>
      ) : segmentsError || !displaySegments ? (
        <p className="ce-transcripts-empty-sub">{t(lang, 'SEGMENTS_LOAD_ERROR')}</p>
      ) : (
        <div className="ce-transcript-segment-list">
          {displaySegments.map((seg, i) => (
            <div key={i} className="ce-transcript-segment">
              {(seg.start != null || seg.end != null) && (
                <span className="ce-transcript-segment-time">
                  {formatTimestamp(seg.start)}{seg.end != null ? `–${formatTimestamp(seg.end)}` : ''}
                </span>
              )}
              {isEditingSegments ? (
                <textarea
                  className="ce-transcript-segment-input"
                  value={seg.text}
                  onChange={(e) => updateDraftSegmentText(i, e.target.value)}
                  disabled={isSaving}
                />
              ) : (
                <span className="ce-transcript-segment-text">{seg.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    );
  };

  const renderLanguagesView = () => (
    <>
      {loading ? (
        <div className="ce-center" style={{ padding: 40 }}>
          <div className="ce-spinner ce-spinner--sm" />
        </div>
      ) : loadError ? (
        <div className="ce-transcripts-empty">
          <CaptionsIcon size={28} />
          <p className="ce-transcripts-empty-title">{t(lang, 'TRANSCRIPTS_LOAD_ERROR_TITLE')}</p>
          <p className="ce-transcripts-empty-sub">{loadError}</p>
          <button type="button" className="ce-btn ce-btn--ghost" onClick={load} style={{ marginTop: 12 }}>
            {t(lang, 'RETRY')}
          </button>
        </div>
      ) : transcripts.length === 0 ? (
        <div className="ce-transcripts-empty">
          <CaptionsIcon size={28} />
          <p className="ce-transcripts-empty-title">{t(lang, 'NO_TRANSCRIPTS_TITLE')}</p>
          <p className="ce-transcripts-empty-sub">{t(lang, 'NO_TRANSCRIPTS_SUB')}</p>
        </div>
      ) : (
        <>
          {!transcripts.every((tr) => tr.status === 'Live') && (
            // Nothing left that could still be approved/rejected once everything is Live.
            <p className="ce-transcripts-note">{t(lang, 'STATUS_SYNC_NOTE')}</p>
          )}
          {transcripts.every((tr) => tr.sourceLanguage) && (
            // No translated languages exist yet - set the expectation up front instead
            // of leaving the source-only list looking like translation was skipped.
            <p className="ce-transcripts-note">{t(lang, 'TRANSLATIONS_PENDING_NOTE')}</p>
          )}
          <div className="ce-label-sm" style={{ marginBottom: 10 }}>{t(lang, 'LANGUAGES_LABEL')}</div>
          <div className="ce-transcript-list">
            {/* Source language always leads the list - a stable sort keeps every other
                language in whatever order the backend returned them. */}
            {[...transcripts].sort((a, b) => Number(!!b.sourceLanguage) - Number(!!a.sourceLanguage)).map((tr, i) => {
              const tone = statusTone(tr.status);
              // Processing transcripts don't have language/languageCode populated yet -
              // a caption glyph reads as "still figuring this out", unlike a literal "??".
              const code = (tr.languageCode || tr.language || '').slice(0, 2).toUpperCase();
              const generatedLabel = tr.sourceLanguage ? t(lang, 'TRANSCRIPT_AUTO_GENERATED') : t(lang, 'TRANSCRIPT_TRANSLATED');
              const when = relativeTime(lang, tr.generatedOn);
              // Processing entries can have none of identifier/code/languageCode yet - the
              // positional fallback avoids an undefined (and possibly duplicated) React key.
              return (
                <div key={tr.identifier ?? tr.code ?? tr.languageCode ?? `idx-${i}`} className={`ce-transcript-card ce-transcript-card--${tone}`}>
                  <div className="ce-transcript-card-head">
                    <span className="ce-transcript-avatar">{code || <CaptionsIcon size={15} />}</span>
                    <div className="ce-transcript-meta">
                      <div className="ce-transcript-name">
                        {tr.language || t(lang, 'DETECTING_LANGUAGE')}
                        {tr.sourceLanguage && <span className="ce-transcript-source-badge">{t(lang, 'TRANSCRIPT_SOURCE')}</span>}
                      </div>
                      <div className="ce-transcript-sub">
                        {generatedLabel}{when ? ` • ${when}` : ''}
                      </div>
                    </div>
                    <span className={`ce-transcript-status ce-transcript-status--${tone}`}>
                      <span className="ce-transcript-status-dot" /> {statusLabel(lang, tr.status)}
                    </span>
                  </div>
                  <div className="ce-transcript-card-actions">
                    {tr.artifactUrl && (
                      <button type="button" className="ce-btn ce-btn--ghost" onClick={() => openSegments(tr)}>
                        {tone === 'review' ? t(lang, 'REVIEW_TRANSCRIPT') : t(lang, 'VIEW_SEGMENTS')}
                      </button>
                    )}
                    {tr.sourceLanguage && tr.status === 'Review' && tr.artifactUrl && (
                      <button type="button" className="ce-btn ce-btn--ghost" onClick={() => handleModifyClick(tr)}>
                        {t(lang, 'MODIFY_TRANSCRIPT')}
                      </button>
                    )}
                    {/* captionsUrl is cross-origin (blob/CDN), so `download` is ignored by the
                        browser there - target=_blank at least keeps a click from navigating
                        the editor itself away to the raw file. */}
                    {tone === 'live' && tr.captionsUrl && (
                      <a
                        className="ce-btn ce-btn--ghost"
                        href={tr.captionsUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t(lang, 'DOWNLOAD_CAPTIONS')}
                      >
                        {t(lang, 'DOWNLOAD_CAPTIONS')}
                      </a>
                    )}
                    {(tone === 'processing' || tone === 'failed') && (
                      <button type="button" className="ce-btn ce-btn--ghost" disabled title={t(lang, 'COMING_SOON')}>
                        {t(lang, 'COMING_SOON')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  return (
    <Drawer
      open={open}
      onClose={() => setDrawer(null)}
      titleIcon={<CaptionsIcon size={18} />}
      title={t(lang, 'TRANSCRIPTS_TITLE')}
      closeLabel={t(lang, 'CLOSE')}
      className="ce-drawer--transcripts"
    >
      {activeLang ? renderSegmentsView() : renderLanguagesView()}
    </Drawer>
  );
};

export default TranscriptsDrawer;
