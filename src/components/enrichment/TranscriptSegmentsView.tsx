import React, { useEffect, useRef, useState } from 'react';
import type { TranscriptObject, TranscriptSegment } from '../../types';
import { t } from '../../i18n/i18n';
import EnrichmentStatusBadge from './EnrichmentStatusBadge';

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

/** Read-only segments of one transcript: fetches its artifactUrl JSON and lists the timestamped cues. */
const TranscriptSegmentsView: React.FC<{ lang: string; transcript: TranscriptObject; onBack: () => void }> = ({ lang, transcript, onBack }) => {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** Bumped per fetch so a slow response for a transcript the user already left can't land on the wrong one. */
  const requestRef = useRef(0);

  useEffect(() => {
    const token = ++requestRef.current;
    setSegments(null);
    setError(false);
    setLoading(true);
    fetch(transcript.artifactUrl as string)
      .then((r) => r.json())
      .then((json) => {
        if (requestRef.current !== token) return;
        const parsed = parseSegments(json);
        if (!parsed) { setError(true); return; }
        setSegments(parsed);
      })
      .catch(() => { if (requestRef.current === token) setError(true); })
      .finally(() => { if (requestRef.current === token) setLoading(false); });
    return () => { requestRef.current += 1; };
  }, [transcript.artifactUrl]);

  return (
    <div className="ce-transcript-segments-view">
      <button type="button" className="ce-link-btn ce-transcript-back" onClick={onBack}>
        ← {t(lang, 'BACK_TO_LANGUAGES')}
      </button>
      <div className="ce-transcript-segments-head">
        <div className="ce-transcript-segments-title">{transcript.language || t(lang, 'DETECTING_LANGUAGE')}</div>
        <EnrichmentStatusBadge lang={lang} status={transcript.status} />
      </div>
      {loading ? (
        <div className="ce-center" style={{ padding: 40 }}>
          <div className="ce-spinner ce-spinner--sm" />
        </div>
      ) : error || !segments ? (
        <p className="ce-enrichments-empty-sub">{t(lang, 'SEGMENTS_LOAD_ERROR')}</p>
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

export default TranscriptSegmentsView;
