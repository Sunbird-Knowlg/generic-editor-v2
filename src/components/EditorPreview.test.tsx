import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EditorPreview from './EditorPreview';
import { makeEd, mockContext, mockContent } from '../test/mockEd';

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

  it('renders the iframe immediately for non-video content regardless of transcriptsChecked', () => {
    const ed = makeEd({ content: mockContent, transcriptsChecked: false }); // mockContent is application/pdf
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });

  it('shows a loading state instead of the iframe for video content until transcripts have been checked at least once (negative)', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed = makeEd({ content: videoContent, transcriptsChecked: false, transcripts: [] });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).not.toBeInTheDocument();
    expect(container.querySelector('.ce-spinner')).toBeInTheDocument();
  });

  it('renders the iframe for video content once transcriptsChecked is true, even with zero transcripts', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed = makeEd({ content: videoContent, transcriptsChecked: true, transcripts: [] });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });

  it('does not treat a transcript with no status as Live (negative)', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed1 = makeEd({
      content: videoContent,
      transcriptsChecked: true,
      transcripts: [{ code: 'c_en', language: 'English', languageCode: 'en', captionsUrl: 'https://x/en.vtt' }], // no status
    });
    const { container, rerender } = render(<EditorPreview ed={ed1} context={mockContext} />);
    const withoutStatusIframe = container.querySelector('iframe');

    const ed2 = makeEd({
      content: videoContent,
      transcriptsChecked: true,
      transcripts: [],
    });
    rerender(<EditorPreview ed={ed2} context={mockContext} />);
    const emptyIframe = container.querySelector('iframe');
    // Same remount key either way, since a status-less entry must be excluded just like an empty list.
    expect(emptyIframe).toBe(withoutStatusIframe);
  });

  it('remounts the iframe (new DOM node) when the live-caption set changes at equal length', () => {
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed1 = makeEd({
      content: videoContent,
      transcriptsChecked: true,
      transcripts: [{ code: 'c_en', language: 'English', languageCode: 'en', captionsUrl: 'https://x/en.vtt', status: 'Live' }],
    });
    const { container, rerender } = render(<EditorPreview ed={ed1} context={mockContext} />);
    const firstIframe = container.querySelector('iframe');

    const ed2 = makeEd({
      content: videoContent,
      transcriptsChecked: true,
      transcripts: [{ code: 'c_fr', language: 'French', languageCode: 'fr', captionsUrl: 'https://x/fr.vtt', status: 'Live' }],
    });
    rerender(<EditorPreview ed={ed2} context={mockContext} />);
    const secondIframe = container.querySelector('iframe');
    expect(secondIframe).not.toBe(firstIframe);
  });
});
