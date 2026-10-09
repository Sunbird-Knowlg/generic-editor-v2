import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TranscriptPanel from './TranscriptPanel';
import { makeEd } from '../../test/mockEd';
import type { TranscriptObject } from '../../types';

const tr = (over: Partial<TranscriptObject>): TranscriptObject => ({
  identifier: 'do_x', enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Live', ...over,
});

const TRANSCRIPTS: TranscriptObject[] = [
  tr({ identifier: 't_en', language: 'English', languageCode: 'en', status: 'Live', sourceLanguage: true, captionsUrl: 'https://x/en.vtt', artifactUrl: 'https://x/en.json', lastUpdatedOn: '2026-08-03T05:00:00Z' }),
  tr({ identifier: 't_hi', language: 'Hindi', languageCode: 'hi', status: 'Review', sourceLanguage: false, artifactUrl: 'https://x/hi.json' }),
  tr({ identifier: 't_ta', language: 'Tamil', languageCode: 'ta', status: 'Processing', sourceLanguage: false }),
  tr({ identifier: 't_te', language: 'Telugu', languageCode: 'te', status: 'Failed', sourceLanguage: false, errorMessage: 'Whisper timed out' }),
];

const panel = (objects: TranscriptObject[], over = {}) =>
  <TranscriptPanel ed={makeEd({ drawer: 'enrichments', ...over })} objects={objects} />;

describe('<TranscriptPanel />', () => {
  it('renders each language with its status', () => {
    render(panel(TRANSCRIPTS));
    for (const name of ['English', 'Hindi', 'Tamil', 'Telugu']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
  });

  it('shows a placeholder icon and "Detecting language…" when a Processing transcript has no language info yet', () => {
    render(panel([tr({ identifier: 't_x', status: 'Processing', sourceLanguage: true })]));
    expect(screen.getByText('Detecting language…')).toBeInTheDocument();
    expect(screen.queryByText('??')).not.toBeInTheDocument();
  });

  it('always lists the source language card first, regardless of its position in the list', () => {
    const { container } = render(panel([...TRANSCRIPTS].reverse()));
    const names = Array.from(container.querySelectorAll('.ce-transcript-name')).map((el) => el.textContent);
    // Reversed input is [Telugu, Tamil, Hindi, English] - source moves to front, the rest keep their order.
    expect(names[0]).toContain('English');
    expect(names[names.length - 1]).toContain('Hindi');
  });

  it('labels a transcript with the time since lastUpdatedOn, falling back to createdOn', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    render(panel([
      tr({ identifier: 'a', language: 'English', sourceLanguage: true, lastUpdatedOn: ago(3 * 3600_000), createdOn: ago(5 * 86400_000) }),
      tr({ identifier: 'b', language: 'Hindi', createdOn: ago(2 * 86400_000) }),
    ]));
    expect(screen.getByText(/3 hr ago/)).toBeInTheDocument();
    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
  });

  it('shows the errorMessage on a Failed transcript, and not on others (negative)', () => {
    render(panel([...TRANSCRIPTS, tr({ identifier: 't_ok', language: 'Odia', errorMessage: 'stale error' })]));
    expect(screen.getByText('Whisper timed out')).toBeInTheDocument();
    expect(screen.queryByText('stale error')).not.toBeInTheDocument();
  });

  it('shows a note that other languages will appear once the source transcript is ready, when only the source exists', () => {
    render(panel([tr({ identifier: 't_en', language: 'English', status: 'Review', sourceLanguage: true })]));
    expect(screen.getByText(/Translations for other languages will appear/)).toBeInTheDocument();
  });

  it('does not show the translations-pending note once other languages exist (negative)', () => {
    render(panel(TRANSCRIPTS));
    expect(screen.queryByText(/Translations for other languages will appear/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no transcripts yet (negative)', () => {
    render(panel([]));
    expect(screen.getByText('No transcripts yet')).toBeInTheDocument();
    expect(screen.getByText('Transcripts appear here after this video is published.')).toBeInTheDocument();
  });

  it('links a Live transcript\'s "Download captions" to its captionsUrl, once', () => {
    render(panel(TRANSCRIPTS));
    const links = screen.getAllByRole('link', { name: 'Download captions' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://x/en.vtt');
    expect(links[0]).toHaveAttribute('download');
  });

  it('offers no approve, reject, modify or placeholder actions for any status (negative)', () => {
    render(panel(TRANSCRIPTS));
    for (const name of ['Approve Transcript', 'Reject', 'Modify', 'Coming soon', 'Review', 'Edit']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  describe('segments view', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('fetches artifactUrl and renders timestamped segments on "View segments"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: async () => ({ segments: [{ start: 0, end: 2.5, text: 'Hello there.' }, { start: 2.5, end: 5, text: 'Welcome.' }] }),
      }));
      render(panel(TRANSCRIPTS));
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      expect(await screen.findByText('Hello there.')).toBeInTheDocument();
      expect(screen.getByText('Welcome.')).toBeInTheDocument();
      expect(screen.getByText('0:00–0:02')).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith('https://x/en.json');
    });

    it('renders segments read-only, with no textarea or edit/save controls (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hi.' }] }) }));
      render(panel(TRANSCRIPTS));
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      await screen.findByText('Hi.');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });

    it('shows a load-error state when the JSON shape is unrecognized (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ unexpected: true }) }));
      render(panel(TRANSCRIPTS));
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      expect(await screen.findByText("Couldn't load segments for this language.")).toBeInTheDocument();
    });

    it('shows a load-error state when the fetch itself fails (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      render(panel(TRANSCRIPTS));
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      expect(await screen.findByText("Couldn't load segments for this language.")).toBeInTheDocument();
    });

    it('returns to the language list via "Back to languages"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hi.' }] }) }));
      render(panel(TRANSCRIPTS));
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      await screen.findByText('Hi.');
      fireEvent.click(screen.getByRole('button', { name: /Back to languages/ }));
      expect(await screen.findByText('English')).toBeInTheDocument();
      expect(screen.queryByText('Hi.')).not.toBeInTheDocument();
    });

    it('ignores a slow segments response for a language the user has already left (negative)', async () => {
      let resolveFetch: (v: unknown) => void = () => {};
      vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => { resolveFetch = r; })));
      render(panel(TRANSCRIPTS));
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      fireEvent.click(screen.getByRole('button', { name: /Back to languages/ }));
      await act(async () => { resolveFetch({ json: async () => ({ segments: [{ text: 'Late.' }] }) }); });
      expect(screen.queryByText('Late.')).not.toBeInTheDocument();
      expect(screen.getByText('English')).toBeInTheDocument();
    });

    it('offers "View segments" only for languages that have an artifactUrl (negative)', () => {
      render(panel(TRANSCRIPTS));
      // English and Hindi have artifactUrl in the fixture; Tamil and Telugu do not.
      expect(screen.getAllByRole('button', { name: 'View segments' })).toHaveLength(2);
    });

    it('leaves the segments view when the drawer closes', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hi.' }] }) }));
      const ed = makeEd({ drawer: 'enrichments' });
      const { rerender } = render(<TranscriptPanel ed={ed} objects={TRANSCRIPTS} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      await screen.findByText('Hi.');
      rerender(<TranscriptPanel ed={{ ...ed, drawer: null }} objects={TRANSCRIPTS} />);
      expect(await screen.findByText('English')).toBeInTheDocument();
    });
  });
});
