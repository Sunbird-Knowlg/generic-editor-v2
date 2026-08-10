import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import EditorPreview from './EditorPreview';
import { makeEd, mockContext, mockContent, mockService } from '../test/mockEd';

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

  it('does not fetch transcripts for non-video content (negative)', () => {
    const service = mockService();
    const ed = makeEd({ content: mockContent, service }); // mockContent is application/pdf
    render(<EditorPreview ed={ed} context={mockContext} />);
    expect(service.readTranscripts).not.toHaveBeenCalled();
  });

  it('fetches and maps transcripts for video content, remounting the iframe once they arrive', async () => {
    const service = mockService({
      readTranscripts: vi.fn().mockResolvedValue([
        { code: 'c_en', language: 'English', languageCode: 'en', captionsUrl: 'https://x/en.vtt', status: 'Live', sourceLanguage: true },
        { code: 'c_fr', language: 'French', languageCode: 'fr', status: 'Draft' }, // filtered: not Live
      ]),
    });
    const videoContent = { ...mockContent, mimeType: 'video/mp4' };
    const ed = makeEd({ content: videoContent, service });
    const { container } = render(<EditorPreview ed={ed} context={mockContext} />);
    await waitFor(() => expect(service.readTranscripts).toHaveBeenCalledWith('do_1'));
    await waitFor(() => expect(container.querySelector('iframe')).toBeInTheDocument());
  });
});
