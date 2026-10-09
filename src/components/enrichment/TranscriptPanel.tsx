import React, { useEffect, useState } from 'react';
import type { TranscriptObject } from '../../types';
import { t } from '../../i18n/i18n';
import { CaptionsIcon } from '../../icons';
import type { EnrichmentPanelProps } from './types';
import EnrichmentStatusBadge from './EnrichmentStatusBadge';
import TranscriptSegmentsView from './TranscriptSegmentsView';
import { relativeTime, statusTone } from './statusUtils';

/** Read-only transcripts: one card per language (source first) with its status, and a segments view per language. */
const TranscriptPanel: React.FC<EnrichmentPanelProps> = ({ objects, ed }) => {
  const { lang, drawer } = ed;
  const transcripts = objects as TranscriptObject[];
  const [active, setActive] = useState<TranscriptObject | null>(null);

  // Leave the segments view when the drawer closes or another content opens.
  useEffect(() => {
    if (drawer !== 'enrichments') setActive(null);
  }, [drawer, ed.content?.identifier]);

  if (active) return <TranscriptSegmentsView lang={lang} transcript={active} onBack={() => setActive(null)} />;

  if (transcripts.length === 0) {
    return (
      <div className="ce-enrichments-empty">
        <CaptionsIcon size={28} />
        <p className="ce-enrichments-empty-title">{t(lang, 'NO_TRANSCRIPTS_TITLE')}</p>
        <p className="ce-enrichments-empty-sub">{t(lang, 'NO_TRANSCRIPTS_SUB')}</p>
      </div>
    );
  }

  // Source language always leads the list - a stable sort keeps every other language in the order the backend returned.
  const sorted = [...transcripts].sort((a, b) => Number(!!b.sourceLanguage) - Number(!!a.sourceLanguage));

  return (
    <>
      {transcripts.every((tr) => tr.sourceLanguage) && (
        // No translated languages exist yet - set the expectation up front instead
        // of leaving the source-only list looking like translation was skipped.
        <p className="ce-transcripts-note">{t(lang, 'TRANSLATIONS_PENDING_NOTE')}</p>
      )}
      <div className="ce-label-sm" style={{ marginBottom: 10 }}>{t(lang, 'LANGUAGES_LABEL')}</div>
      <div className="ce-transcript-list">
        {sorted.map((tr) => {
          const tone = statusTone(tr.status);
          // Processing transcripts don't have language/languageCode populated yet -
          // a caption glyph reads as "still figuring this out", unlike a literal "??".
          const code = (tr.languageCode || tr.language || '').slice(0, 2).toUpperCase();
          const generatedLabel = tr.sourceLanguage ? t(lang, 'TRANSCRIPT_AUTO_GENERATED') : t(lang, 'TRANSCRIPT_TRANSLATED');
          const when = relativeTime(lang, tr.lastUpdatedOn ?? tr.createdOn);
          return (
            <div key={tr.identifier} className={`ce-transcript-card ce-transcript-card--${tone}`}>
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
                <EnrichmentStatusBadge lang={lang} status={tr.status} />
              </div>
              {tr.status === 'Failed' && tr.errorMessage && (
                <p className="ce-transcript-sub">{tr.errorMessage}</p>
              )}
              <div className="ce-transcript-card-actions">
                {tr.artifactUrl && (
                  <button type="button" className="ce-btn ce-btn--ghost" onClick={() => setActive(tr)}>
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
  );
};

export default TranscriptPanel;
