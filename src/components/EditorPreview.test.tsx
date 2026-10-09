import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EditorPreview from './EditorPreview';
import { makeEd, mockContext, mockContent } from '../test/mockEd';
import type { EnrichmentObject } from '../types';

describe('<EditorPreview />', () => {
  it('renders nothing when there is no content (negative)', () => {
    const ed = makeEd({ content: null });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the content name and a localized mimeType label', () => {
    const ed = makeEd({ content: mockContent });
    render(<EditorPreview ed={ed} context={mockContext} />);
    expect(screen.getByText('Sample content')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();     // application/pdf → PDF
    expect(screen.getByText('Preview mode')).toBeInTheDocument();
  });

  it('builds the renderer iframe src with webview=true', () => {
    const ed = makeEd({ content: mockContent, previewUrl: '/content/preview/preview.html' });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe).toHaveAttribute('src', '/content/preview/preview.html?webview=true');
    expect(iframe).toHaveAttribute('title', 'Sample content');
  });

  it('appends webview with & when previewUrl already has a query', () => {
    const ed = makeEd({ content: mockContent, previewUrl: '/preview.html?foo=1' });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).toHaveAttribute('src', '/preview.html?foo=1&webview=true');
  });

  it('renders the iframe immediately for non-video content regardless of enrichmentsChecked', () => {
    const ed = makeEd({ content: mockContent, enrichmentsChecked: false }); // mockContent is application/pdf
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });

  it('shows a loading state instead of the iframe for video content until enrichments have been checked at least once (negative)', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed = makeEd({ content: videoContent, enrichmentsChecked: false, enrichmentObjects: [] });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).not.toBeInTheDocument();
    expect(container.querySelector('.ce-spinner')).toBeInTheDocument();
  });

  it('renders the iframe for video content once enrichmentsChecked is true, even with zero objects', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed = makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [] });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });

  it('does not treat a transcript with no status as Live (negative)', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const noStatus = { identifier: 't_en', enrichmentObjectType: 'Transcript', parentId: 'do_1', language: 'English', languageCode: 'en', captionsUrl: 'https://x/en.vtt' } as unknown as EnrichmentObject;
    const ed1 = makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [noStatus] });
    const { container, rerender } = render(<EditorPreview ed={ed1} context={mockContext} />);
    const withoutStatusIframe = container.querySelector('iframe');

    const ed2 = makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [] });
    rerender(<EditorPreview ed={ed2} context={mockContext} />);
    // Same remount key either way, since a status-less object must be excluded just like an empty list.
    expect(container.querySelector('iframe')).toBe(withoutStatusIframe);
  });

  it('remounts the iframe (new DOM node) when the Live set changes at equal length', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const live = (identifier: string, languageCode: string): EnrichmentObject => ({
      identifier, enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Live',
      language: languageCode, languageCode, captionsUrl: `https://x/${languageCode}.vtt`,
    });
    const ed1 = makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [live('c_en', 'en')] });
    const { container, rerender } = render(<EditorPreview ed={ed1} context={mockContext} />);
    const firstIframe = container.querySelector('iframe');

    const ed2 = makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [live('c_fr', 'fr')] });
    rerender(<EditorPreview ed={ed2} context={mockContext} />);
    expect(container.querySelector('iframe')).not.toBe(firstIframe);
  });

  it('does not remount the iframe when a non-Live object changes (negative)', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const obj = (status: EnrichmentObject['status']): EnrichmentObject => ({
      identifier: 'c_hi', enrichmentObjectType: 'Transcript', parentId: 'do_1', status,
    });
    const ed1 = makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [obj('Processing')] });
    const { container, rerender } = render(<EditorPreview ed={ed1} context={mockContext} />);
    const firstIframe = container.querySelector('iframe');
    rerender(<EditorPreview ed={makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: [obj('Failed')] })} context={mockContext} />);
    expect(container.querySelector('iframe')).toBe(firstIframe);
  });

  it('hands only the Live transcripts to the renderer as metadata.transcripts (VTT as artifactUrl)', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const objects: EnrichmentObject[] = [
      { identifier: 't_en', enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Live', language: 'English', languageCode: 'en', sourceLanguage: true, captionsUrl: 'https://x/en.vtt', artifactUrl: 'https://x/en.json' },
      { identifier: 't_hi', enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Processing', language: 'Hindi', languageCode: 'hi' },
    ];
    const { container } = render(<EditorPreview ed={makeEd({ content: videoContent, enrichmentsChecked: true, enrichmentObjects: objects })} context={mockContext} />);
    const iframe = container.querySelector('iframe')!;
    const initializePreview = vi.fn();
    (iframe.contentWindow as unknown as { initializePreview: typeof initializePreview }).initializePreview = initializePreview;
    fireEvent.load(iframe);
    expect(initializePreview).toHaveBeenCalledTimes(1);
    expect(initializePreview.mock.calls[0][0].metadata.transcripts).toEqual([
      { language: 'English', identifier: 't_en', languageCode: 'en', artifactUrl: 'https://x/en.vtt', wordByWordUrl: 'https://x/en.vtt', sourceLanguage: true },
    ]);
  });
});
