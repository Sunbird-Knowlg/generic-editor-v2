import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TranscriptsDrawer from './TranscriptsDrawer';
import { makeEd } from '../test/mockEd';
import type { RawTranscript } from '../types';

const TRANSCRIPTS: RawTranscript[] = [
  { identifier: 't_en', code: 'c_en', language: 'English', languageCode: 'en', status: 'Live', sourceLanguage: true, captionsUrl: 'https://x/en.vtt', artifactUrl: 'https://x/en.json', generatedOn: '2026-08-03T05:00:00Z' },
  { identifier: 't_hi', code: 'c_hi', language: 'Hindi', languageCode: 'hi', status: 'Review', sourceLanguage: false, artifactUrl: 'https://x/hi.json' },
  { identifier: 't_ta', code: 'c_ta', language: 'Tamil', languageCode: 'ta', status: 'Processing', sourceLanguage: false },
  { identifier: 't_te', code: 'c_te', language: 'Telugu', languageCode: 'te', status: 'Failed', sourceLanguage: false },
];

const open = (transcripts: RawTranscript[]) =>
  makeEd({ drawer: 'transcripts', transcripts, hasTranscripts: transcripts.length > 0 });

describe('<TranscriptsDrawer />', () => {
  it('renders each language from ed.transcripts with its status when open', () => {
    render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Hindi')).toBeInTheDocument();
    expect(screen.getByText('Tamil')).toBeInTheDocument();
    expect(screen.getByText('Telugu')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
  });

  it('shows a placeholder icon and "Detecting language…" instead of blank/"??" when a Processing transcript has no language info yet', () => {
    const noLanguageYet = [{ identifier: 't_x', code: 'c_x', language: '', status: 'Processing', sourceLanguage: true }];
    render(<TranscriptsDrawer ed={open(noLanguageYet)} />);
    expect(screen.getByText('Detecting language…')).toBeInTheDocument();
    expect(screen.queryByText('??')).not.toBeInTheDocument();
  });

  it('always lists the source language card first, regardless of its position in the list', () => {
    const reordered = [...TRANSCRIPTS].reverse();
    const { container } = render(<TranscriptsDrawer ed={open(reordered)} />);
    const names = Array.from(container.querySelectorAll('.ce-transcript-name')).map((el) => el.textContent);
    // Reversed input is [Telugu, Tamil, Hindi, English] - source moves to front,
    // the rest keep their relative order: [English, Telugu, Tamil, Hindi].
    expect(names[0]).toContain('English');
    expect(names[names.length - 1]).toContain('Hindi');
  });

  it('shows a note that other languages will appear once the source transcript is ready, when only the source exists so far', () => {
    const sourceOnly = [{ identifier: 't_en', code: 'c_en', language: 'English', status: 'Review', sourceLanguage: true }];
    render(<TranscriptsDrawer ed={open(sourceOnly)} />);
    expect(screen.getByText(/Translations for other languages will appear/)).toBeInTheDocument();
  });

  it('does not show the translations-pending note once other languages already exist (negative)', () => {
    render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
    expect(screen.queryByText(/Translations for other languages will appear/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no transcripts yet (negative)', () => {
    render(<TranscriptsDrawer ed={open([])} />);
    expect(screen.getByText('No transcripts yet')).toBeInTheDocument();
    expect(screen.getByText('Transcripts appear here after this video is published.')).toBeInTheDocument();
  });

  it('links a Live transcript\'s "Download captions" to its real captionsUrl', () => {
    render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
    const link = screen.getByRole('link', { name: 'Download captions' });
    expect(link).toHaveAttribute('href', 'https://x/en.vtt');
    expect(link).toHaveAttribute('download');
  });

  it('shows only one download action for a Live transcript, not a duplicate (negative)', () => {
    render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
    expect(screen.getAllByRole('link', { name: 'Download captions' })).toHaveLength(1);
  });

  it('offers no approve, reject, modify or placeholder actions for any status (negative)', () => {
    render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
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
      render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      expect(await screen.findByText('Hello there.')).toBeInTheDocument();
      expect(screen.getByText('Welcome.')).toBeInTheDocument();
      expect(screen.getByText('0:00–0:02')).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith('https://x/en.json');
    });

    it('renders segments read-only, with no textarea or edit/save controls (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hi.' }] }) }));
      render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      await screen.findByText('Hi.');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });

    it('shows a load-error state when the JSON shape is unrecognized (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ unexpected: true }) }));
      render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      expect(await screen.findByText("Couldn't load segments for this language.")).toBeInTheDocument();
    });

    it('shows a load-error state when the fetch itself fails (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      expect(await screen.findByText("Couldn't load segments for this language.")).toBeInTheDocument();
    });

    it('returns to the language list via "Back to languages"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hi.' }] }) }));
      render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
      fireEvent.click(screen.getAllByRole('button', { name: 'View segments' })[0]);
      await screen.findByText('Hi.');
      fireEvent.click(screen.getByRole('button', { name: /Back to languages/ }));
      expect(await screen.findByText('English')).toBeInTheDocument();
      expect(screen.queryByText('Hi.')).not.toBeInTheDocument();
    });

    it('offers "View segments" only for languages that have an artifactUrl (negative)', () => {
      render(<TranscriptsDrawer ed={open(TRANSCRIPTS)} />);
      // English and Hindi have artifactUrl in the fixture; Tamil and Telugu do not.
      expect(screen.getAllByRole('button', { name: 'View segments' })).toHaveLength(2);
    });
  });
});
