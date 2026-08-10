import React, { useRef, useEffect, useState } from 'react';
import type { EditorController } from '../useEditor';
import type { ContentData, EditorContext, RawTranscript } from '../types';
import { getMimeTypeLabel, t } from '../i18n/i18n';
import { FileIcon } from '../icons';
import { isVideoMimeType } from '../constants';

interface PlayerTranscript {
  language: string;
  identifier: string;
  languageCode: string;
  artifactUrl: string;
  wordByWordUrl?: string;
  sourceLanguage?: boolean;
}

/** Maps raw enrichment.transcripts into the shape sunbird-video-player expects, mirroring the portal's ContentService mapping (artifactUrl here is the VTT, not transcript.json). */
function mapRawTranscripts(raw: RawTranscript[]): PlayerTranscript[] {
  return raw
    .filter((e): e is RawTranscript & { captionsUrl: string } =>
      !!e.captionsUrl && (e.status ?? 'Live').toLowerCase() === 'live')
    .map((e) => ({
      language: e.language || (e.languageCode || 'Unknown').toUpperCase(),
      identifier: e.code ?? e.identifier ?? '',
      languageCode: e.languageCode || '',
      artifactUrl: e.captionsUrl,
      wordByWordUrl: e.captionsUrl,
      sourceLanguage: !!e.sourceLanguage,
    }));
}

/** Preview via the legacy ekstep content renderer (all mimeTypes through its coreplugins), loaded in an iframe and driven via its global `initializePreview()`. */
const RendererPreview: React.FC<{
  content: ContentData; context: EditorContext; previewUrl: string; previewConfig: Record<string, unknown>;
}> = ({ content, context, previewUrl, previewConfig }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}webview=true`;

  const onLoad = () => {
    const win = iframeRef.current?.contentWindow as
      | (Window & { initializePreview?: (cfg: unknown) => void })
      | null;
    if (!win || typeof win.initializePreview !== 'function') return;
    win.initializePreview({
      context: {
        mode: 'edit',
        contentId: content.identifier,
        sid: context.sid,
        uid: context.uid,
        channel: context.channel,
        pdata: context.pdata,
        app: [],
        dims: [],
        partner: [],
      },
      config: previewConfig,
      metadata: content,
      data: {},
    });
  };

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={content.name}
      onLoad={onLoad}
      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
      allow="autoplay; fullscreen; encrypted-media"
    />
  );
};

const EditorPreview: React.FC<{ ed: EditorController; context: EditorContext }> = ({ ed, context }) => {
  const { content, lang, previewUrl, previewConfig, service } = ed;
  const [transcripts, setTranscripts] = useState<PlayerTranscript[]>([]);

  useEffect(() => {
    setTranscripts([]);
    if (!content?.identifier || !isVideoMimeType(content.mimeType)) return;
    service
      .readTranscripts(content.identifier)
      .then((raw) => setTranscripts(mapRawTranscripts(raw)))
      .catch(() => setTranscripts([]));
  }, [content?.identifier, content?.mimeType, service]);

  if (!content) return null;

  // The iframe key below folds in transcripts.length to force one remount once they arrive, since merging them doesn't change identifier/artifactUrl.
  const previewMetadata = transcripts.length ? { ...content, transcripts } : content;

  return (
    <div className="ce-preview-card">
      <div className="ce-preview-bar">
        <div className="ce-icon-sq"><FileIcon size={12} /></div>
        <span className="ce-preview-name">{content.name}</span>
        <span className="ce-preview-type">{getMimeTypeLabel(lang, content.mimeType)}</span>
        <span className="ce-preview-chip">{t(lang, 'PREVIEW_MODE')}</span>
      </div>
      <div className="ce-preview-frame">
        <RendererPreview
          key={`${content.identifier}-${content.artifactUrl ?? ''}-${transcripts.length}`}
          content={previewMetadata}
          context={context}
          previewUrl={previewUrl}
          previewConfig={previewConfig}
        />
      </div>
    </div>
  );
};

export default EditorPreview;
