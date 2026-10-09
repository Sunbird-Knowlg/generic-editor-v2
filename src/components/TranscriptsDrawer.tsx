import React, { useEffect, useRef, useState } from 'react';
import Drawer from './Drawer';
import type { EditorController } from '../useEditor';
import type { RawTranscript, TranscriptSegment } from '../types';
import { t, tf } from '../i18n/i18n';
import { CaptionsIcon } from '../icons';

/** Parses the artifactUrl transcript.json (Whisper-style `{segments:[...]}` or a bare array), returning null on any other shape. */
function parseSegments(raw: unknown): TranscriptSegment[] | null {
  const obj = raw as Record<string, unknown> | null;
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.segments) ? (obj!.segments as unknown[]) : null;
  if (!list) return null;
  const segments: TranscriptSegment[] = [];
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
  });
  return segments.length ? segments : null;
}

function formatTimestamp(seconds?: number): string {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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

/** TranscriptsDrawer — read-only view of the transcripts held by the editor controller (`ed.transcripts`). */
const TranscriptsDrawer: React.FC<{ ed: EditorController }> = ({ ed }) => {
  const { lang, drawer, setDrawer, transcripts } = ed;
  const open = drawer === 'transcripts';

  /* Segments sub-view for one language. */
  const [activeLang, setActiveLang] = useState<RawTranscript | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentsError, setSegmentsError] = useState(false);
  /** Bumped by openSegments/closeSegments so a slow fetch for a language the user has
   *  already navigated away from can't land its result onto the wrong (now-active) one. */
  const segmentsRequestRef = useRef(0);

  const closeSegments = () => {
    segmentsRequestRef.current += 1; // discard any in-flight fetch for the language we're leaving
    setActiveLang(null);
    setSegments(null);
    setSegmentsError(false);
  };

  useEffect(() => {
    if (!open) closeSegments();
  }, [open, ed.content?.identifier]);

  const openSegments = (tr: RawTranscript) => {
    if (!tr.artifactUrl) return;
    const requestToken = ++segmentsRequestRef.current;
    setActiveLang(tr);
    setSegments(null);
    setSegmentsError(false);
    setSegmentsLoading(true);
    fetch(tr.artifactUrl)
      .then((r) => r.json())
      .then((json) => {
        // A slower fetch for a language the user has since navigated away from (Back,
        // or straight to another language) must not clobber whatever's active now.
        if (segmentsRequestRef.current !== requestToken) return;
        const parsed = parseSegments(json);
        if (!parsed) { setSegmentsError(true); return; }
        setSegments(parsed);
      })
      .catch(() => { if (segmentsRequestRef.current === requestToken) setSegmentsError(true); })
      .finally(() => { if (segmentsRequestRef.current === requestToken) setSegmentsLoading(false); });
  };

  const renderSegmentsView = () => {
    const tone = statusTone(activeLang!.status);
    return (
    <div className="ce-transcript-segments-view">
      <button type="button" className="ce-link-btn ce-transcript-back" onClick={closeSegments}>
        ← {t(lang, 'BACK_TO_LANGUAGES')}
      </button>
      <div className="ce-transcript-segments-head">
        <div className="ce-transcript-segments-title">{activeLang!.language}</div>
        <span className={`ce-transcript-status ce-transcript-status--${tone}`}>
          <span className="ce-transcript-status-dot" /> {statusLabel(lang, activeLang!.status)}
        </span>
      </div>
      {segmentsLoading ? (
        <div className="ce-center" style={{ padding: 40 }}>
          <div className="ce-spinner ce-spinner--sm" />
        </div>
      ) : segmentsError || !segments ? (
        <p className="ce-transcripts-empty-sub">{t(lang, 'SEGMENTS_LOAD_ERROR')}</p>
      ) : (
        <div className="ce-transcript-segment-list">
          {segments.map((seg, i) => (
            <div key={i} className="ce-transcript-segment">
              {(seg.start != null || seg.end != null) && (
                <span className="ce-transcript-segment-time">
                  {formatTimestamp(seg.start)}{seg.end != null ? `–${formatTimestamp(seg.end)}` : ''}
                </span>
              )}
              <span className="ce-transcript-segment-text">{seg.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
    );
  };

  const renderLanguagesView = () => (
    <>
      {transcripts.length === 0 ? (
        <div className="ce-transcripts-empty">
          <CaptionsIcon size={28} />
          <p className="ce-transcripts-empty-title">{t(lang, 'NO_TRANSCRIPTS_TITLE')}</p>
          <p className="ce-transcripts-empty-sub">{t(lang, 'NO_TRANSCRIPTS_SUB')}</p>
        </div>
      ) : (
        <>
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
                        {t(lang, 'VIEW_SEGMENTS')}
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
