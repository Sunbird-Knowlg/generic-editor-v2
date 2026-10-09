import React, { useRef } from 'react';
import type { EditorController } from '../useEditor';
import type { ContentData, EditorContext } from '../types';
import { getMimeTypeLabel, t } from '../i18n/i18n';
import { FileIcon } from '../icons';
import { applyEnrichments, enrichmentTypesForMime } from '../services/enrichment/registry';

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
  const { content, lang, previewUrl, previewConfig, enrichmentObjects, enrichmentsChecked } = ed;

  if (!content) return null;

  const hasEnrichments = enrichmentTypesForMime(content.mimeType).length > 0;
  const previewMetadata = applyEnrichments(content, enrichmentObjects);
  // The iframe key changes only when the actual Live set changes (not just its count), so a
  // same-count swap (one object leaves Live as another joins) still remounts.
  const enrichmentsKey = enrichmentObjects.filter((o) => o.status === 'Live').map((o) => o.identifier).sort().join(',');

  return (
    <div className="ce-preview-card">
      <div className="ce-preview-bar">
        <div className="ce-icon-sq"><FileIcon size={12} /></div>
        <span className="ce-preview-name">{content.name}</span>
        <span className="ce-preview-type">{getMimeTypeLabel(lang, content.mimeType)}</span>
        <span className="ce-preview-chip">{t(lang, 'PREVIEW_MODE')}</span>
      </div>
      <div className="ce-preview-frame">
        {hasEnrichments && !enrichmentsChecked ? (
          // Wait for the first enrichments check before ever mounting the renderer, so a
          // slow initial read can't yank the iframe out (and restart playback) right after
          // the user presses play - by the time it first mounts, this is already settled.
          <div className="ce-center" style={{ height: '100%' }}>
            <div className="ce-spinner ce-spinner--sm" />
          </div>
        ) : (
          <RendererPreview
            key={`${content.identifier}-${content.artifactUrl ?? ''}-${enrichmentsKey}`}
            content={previewMetadata}
            context={context}
            previewUrl={previewUrl}
            previewConfig={previewConfig}
          />
        )}
      </div>
    </div>
  );
};

export default EditorPreview;
