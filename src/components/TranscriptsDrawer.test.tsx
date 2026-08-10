import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TranscriptsDrawer from './TranscriptsDrawer';
import { makeEd, mockService, mockContent } from '../test/mockEd';

const TRANSCRIPTS = [
  { identifier: 't_en', code: 'c_en', language: 'English', languageCode: 'en', status: 'Live', sourceLanguage: true, captionsUrl: 'https://x/en.vtt', artifactUrl: 'https://x/en.json', generatedOn: '2026-08-03T05:00:00Z' },
  { identifier: 't_hi', code: 'c_hi', language: 'Hindi', languageCode: 'hi', status: 'Review', sourceLanguage: false, artifactUrl: 'https://x/hi.json' },
  { identifier: 't_ta', code: 'c_ta', language: 'Tamil', languageCode: 'ta', status: 'Processing', sourceLanguage: false },
  { identifier: 't_te', code: 'c_te', language: 'Telugu', languageCode: 'te', status: 'Failed', sourceLanguage: false },
];

describe('<TranscriptsDrawer />', () => {
  it('loads and renders each language with its status when open', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service, content: { ...mockContent, mimeType: 'video/mp4' } });
    render(<TranscriptsDrawer ed={ed} />);
    await waitFor(() => expect(service.readTranscripts).toHaveBeenCalledWith('do_1'));
    expect(await screen.findByText('English')).toBeInTheDocument();
    expect(screen.getByText('Hindi')).toBeInTheDocument();
    expect(screen.getByText('Tamil')).toBeInTheDocument();
    expect(screen.getByText('Telugu')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('SOURCE')).toBeInTheDocument();
  });

  it('shows a placeholder icon and "Detecting language…" instead of blank/"??" when a Processing transcript has no language info yet', async () => {
    const noLanguageYet = [{ identifier: 't_x', code: 'c_x', language: '', status: 'Processing', sourceLanguage: true }];
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(noLanguageYet) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    expect(await screen.findByText('Detecting language…')).toBeInTheDocument();
    expect(screen.queryByText('??')).not.toBeInTheDocument();
  });

  it('always lists the source language card first, regardless of its position in the backend response', async () => {
    // TRANSCRIPTS has English (source) listed first already - reorder so it's last,
    // to prove the UI is doing the sorting, not just reflecting response order.
    const reordered = [...TRANSCRIPTS].reverse();
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(reordered) });
    const ed = makeEd({ drawer: 'transcripts', service });
    const { container } = render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('English');
    const names = Array.from(container.querySelectorAll('.ce-transcript-name')).map((el) => el.textContent);
    // Reversed input is [Telugu, Tamil, Hindi, English] - source moves to front,
    // the rest keep their relative order: [English, Telugu, Tamil, Hindi].
    expect(names[0]).toContain('English');
    expect(names[names.length - 1]).toContain('Hindi');
  });

  it('shows a note that other languages will appear once the source transcript is ready, when only the source exists so far', async () => {
    const sourceOnly = [{ identifier: 't_en', code: 'c_en', language: 'English', status: 'Review', sourceLanguage: true }];
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(sourceOnly) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    expect(await screen.findByText(/Translations for other languages will appear/)).toBeInTheDocument();
  });

  it('does not show the translations-pending note once other languages already exist (negative)', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('English');
    expect(screen.queryByText(/Translations for other languages will appear/)).not.toBeInTheDocument();
  });

  it('shows a note that status changes can take a few minutes to fully sync', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    expect(await screen.findByText(/take a few minutes to fully sync/)).toBeInTheDocument();
  });

  it('does not show the sync note once every language is Live - nothing left to approve/reject (negative)', async () => {
    const allLive = TRANSCRIPTS.map((tr) => ({ ...tr, status: 'Live' }));
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(allLive) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('English');
    expect(screen.queryByText(/take a few minutes to fully sync/)).not.toBeInTheDocument();
  });

  it('does not show the sync note in the empty state - nothing has happened yet to sync (negative)', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue([]) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('No transcripts yet');
    expect(screen.queryByText(/take a few minutes to fully sync/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no transcripts yet (negative)', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue([]) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    expect(await screen.findByText('No transcripts yet')).toBeInTheDocument();
  });

  it('does not fetch when the drawer is closed (negative)', () => {
    const service = mockService();
    const ed = makeEd({ drawer: null, service });
    render(<TranscriptsDrawer ed={ed} />);
    expect(service.readTranscripts).not.toHaveBeenCalled();
  });

  it('shows a distinct load-error state (not "no transcripts yet") when the read fails (negative)', async () => {
    const readTranscripts = vi.fn().mockRejectedValue(new Error('Unauthorized'));
    const service = mockService({ readTranscripts });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    expect(await screen.findByText("Couldn't load transcripts")).toBeInTheDocument();
    expect(screen.getByText('Unauthorized')).toBeInTheDocument();
    expect(screen.queryByText('No transcripts yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(readTranscripts).toHaveBeenCalledTimes(2));
  });

  it('links a Live transcript\'s "Download captions" to its real captionsUrl', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    const link = await screen.findByRole('link', { name: 'Download captions' });
    expect(link).toHaveAttribute('href', 'https://x/en.vtt');
    expect(link).toHaveAttribute('download');
  });

  it('shows only one download action for a Live transcript, not a duplicate (negative)', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('English');
    expect(screen.getAllByRole('link', { name: 'Download captions' })).toHaveLength(1);
  });

  it('disables the processing/failed action buttons as not-yet-implemented (negative)', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('Tamil');
    const comingSoonButtons = screen.getAllByRole('button', { name: 'Coming soon' });
    expect(comingSoonButtons).toHaveLength(2); // Tamil (Processing) + Telugu (Failed)
    comingSoonButtons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('offers a "Review" action (not disabled) for a review-status language with a transcript file', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('Hindi');
    const reviewBtn = screen.getByRole('button', { name: 'Review' });
    expect(reviewBtn).not.toBeDisabled();
  });

  describe('segments view — status, approve and reject', () => {
    it('shows the status and enabled Approve/Reject buttons for a review-status language', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      expect(screen.getByText('Needs review')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Approve Transcript' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Reject' })).not.toBeDisabled();
      vi.unstubAllGlobals();
    });

    it('does not show Approve/Reject buttons for a Live language (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello.' }] }) }));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('English');
      fireEvent.click(screen.getByRole('button', { name: 'View segments' }));
      await screen.findByText('Hello.');
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve Transcript' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it('approves a Review transcript and only shows Live once the re-read confirms it', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockResolvedValue({});
      const readTranscripts = vi.fn()
        .mockResolvedValueOnce(TRANSCRIPTS)
        .mockResolvedValueOnce(TRANSCRIPTS.map((tr) => (tr.language === 'Hindi' ? { ...tr, status: 'Live' } : tr)));
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      await waitFor(() => expect(approveTranscript).toHaveBeenCalledWith('do_1', 't_hi'));
      await waitFor(() => expect(readTranscripts).toHaveBeenCalledTimes(2));
      await screen.findByText('Hindi');
      // Both English (already Live) and Hindi (just confirmed) now show Live.
      await waitFor(() => expect(screen.getAllByText('Live')).toHaveLength(2));
      vi.unstubAllGlobals();
    });

    it('rejects a Review transcript and only shows Draft once the re-read confirms it', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const rejectTranscript = vi.fn().mockResolvedValue({});
      const readTranscripts = vi.fn()
        .mockResolvedValueOnce(TRANSCRIPTS)
        .mockResolvedValueOnce(TRANSCRIPTS.map((tr) => (tr.language === 'Hindi' ? { ...tr, status: 'Draft' } : tr)));
      const service = mockService({ readTranscripts, rejectTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(rejectTranscript).toHaveBeenCalledWith('do_1', 't_hi'));
      await screen.findByText('Hindi');
      expect(await screen.findByText('Draft')).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it('shows a "still processing" message (not Live) when approve succeeds but the re-read has not caught up yet (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockResolvedValue({});
      // Confirm re-read still reports Review - the approve hasn't landed server-side yet.
      const readTranscripts = vi.fn().mockResolvedValue(TRANSCRIPTS);
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      expect(await screen.findByText(/Almost there/)).toBeInTheDocument();
      expect(screen.getByText('Updating…')).toBeInTheDocument(); // not falsely shown as Live...
      expect(screen.queryByText('Needs review')).not.toBeInTheDocument(); // ...nor left showing "Needs review" as if nothing happened
      expect(screen.getByText('Namaste.')).toBeInTheDocument(); // stayed on the language, didn't close
      vi.unstubAllGlobals();
    });

    it('hides Approve/Reject while a just-submitted approve awaits confirmation - prevents a second, guaranteed-to-fail submit (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockResolvedValue({});
      // The approve itself succeeded server-side, but the confirm re-read hasn't caught up yet.
      const readTranscripts = vi.fn().mockResolvedValue(TRANSCRIPTS);
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      await screen.findByText(/Almost there/);
      // Re-clicking Approve now would fail with ERR_TRANSCRIPT_NOT_IN_REVIEW, so it must be gone.
      expect(screen.queryByRole('button', { name: 'Approve Transcript' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
      expect(approveTranscript).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('confirms and closes once the user clicks "Check again" after a pending approve', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockResolvedValue({});
      const readTranscripts = vi.fn()
        .mockResolvedValueOnce(TRANSCRIPTS)
        .mockResolvedValueOnce(TRANSCRIPTS) // confirm right after approve: still Review
        .mockResolvedValueOnce(TRANSCRIPTS.map((tr) => (tr.language === 'Hindi' ? { ...tr, status: 'Live' } : tr))); // Check again: now Live
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      await screen.findByText(/Almost there/);
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      await waitFor(() => expect(readTranscripts).toHaveBeenCalledTimes(3));
      await screen.findByText('Hindi');
      await waitFor(() => expect(screen.getAllByText('Live')).toHaveLength(2));
      vi.unstubAllGlobals();
    });

    it('shows a plain retry message (not the raw backend errmsg) and stays on the language when approve fails (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockRejectedValue(new Error('ERR_TRANSCRIPT_NOT_IN_REVIEW'));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS), approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      expect(await screen.findByText(/Couldn't complete this action/)).toBeInTheDocument();
      expect(screen.queryByText('ERR_TRANSCRIPT_NOT_IN_REVIEW')).not.toBeInTheDocument();
      expect(screen.getByText('Namaste.')).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it('treats "currently Live" as success (not failure) when approve fails because it already landed - closes without an error, straight from the error text', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockRejectedValue(new Error('Transcript must be in Review status to approve (currently Live).'));
      const readTranscripts = vi.fn().mockResolvedValue(TRANSCRIPTS);
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      // Closes back to the language list instead of showing an error - the error text
      // itself already proved the approve's goal (Live) was reached by something else.
      await waitFor(() => expect(screen.queryByText('Namaste.')).not.toBeInTheDocument());
      await screen.findByText('Hindi');
      expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't complete this action/)).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getAllByText('Live')).toHaveLength(2)); // English (already) + Hindi (just synced)
      // No extra network round-trip needed - the true status came straight from the error text.
      expect(readTranscripts).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('treats "currently Draft" as success (not failure) when reject fails because it already landed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const rejectTranscript = vi.fn().mockRejectedValue(new Error('Transcript must be in Review status to reject (currently Draft).'));
      const readTranscripts = vi.fn().mockResolvedValue(TRANSCRIPTS);
      const service = mockService({ readTranscripts, rejectTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
      await waitFor(() => expect(screen.queryByText('Namaste.')).not.toBeInTheDocument());
      await screen.findByText('Hindi');
      expect(screen.queryByText(/Couldn't complete this action/)).not.toBeInTheDocument();
      expect(await screen.findByText('Draft')).toBeInTheDocument();
      expect(readTranscripts).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('still shows the retry error but syncs the badge from the error text when the real status is neither Live nor Draft (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockRejectedValue(new Error('Transcript must be in Review status to approve (currently Failed).'));
      const readTranscripts = vi.fn().mockResolvedValue(TRANSCRIPTS);
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      expect(await screen.findByText(/Couldn't complete this action/)).toBeInTheDocument();
      expect(screen.queryByText(/currently Failed/)).not.toBeInTheDocument();
      // Badge/buttons reflect the parsed status without any extra network call.
      await waitFor(() => expect(screen.getByText('Failed')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Approve Transcript' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
      expect(readTranscripts).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('falls back to a fresh re-read when the error text has no parseable status (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
      const approveTranscript = vi.fn().mockRejectedValue(new Error('ERR_TRANSCRIPT_NOT_IN_REVIEW'));
      const readTranscripts = vi.fn()
        .mockResolvedValueOnce(TRANSCRIPTS)
        .mockResolvedValueOnce(TRANSCRIPTS.map((tr) => (tr.language === 'Hindi' ? { ...tr, status: 'Live' } : tr)));
      const service = mockService({ readTranscripts, approveTranscript });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      fireEvent.click(screen.getByRole('button', { name: 'Review' }));
      await screen.findByText('Namaste.');
      fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
      expect(await screen.findByText(/Couldn't complete this action/)).toBeInTheDocument();
      await waitFor(() => expect(readTranscripts).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
      expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
      vi.unstubAllGlobals();
    });

  });

  it('does not offer a "Generate transcript" action - only the checkbox-driven flow triggers it (negative)', async () => {
    const service = mockService({ readTranscripts: vi.fn().mockResolvedValue([]) });
    const ed = makeEd({ drawer: 'transcripts', service });
    render(<TranscriptsDrawer ed={ed} />);
    await screen.findByText('No transcripts yet');
    expect(screen.queryByRole('button', { name: 'Generate transcript' })).not.toBeInTheDocument();
    expect(service.createTranscript).not.toHaveBeenCalled();
  });

  describe('segments view', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('fetches artifactUrl and renders timestamped segments on "View segments"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: async () => ({ segments: [{ start: 0, end: 2.5, text: 'Hello there.' }, { start: 2.5, end: 5, text: 'Welcome.' }] }),
      }));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('English');
      fireEvent.click(screen.getByRole('button', { name: 'View segments' }));
      expect(await screen.findByText('Hello there.')).toBeInTheDocument();
      expect(screen.getByText('Welcome.')).toBeInTheDocument();
      expect(screen.getByText('0:00–0:02')).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith('https://x/en.json');
    });

    it('shows a load-error state when the JSON shape is unrecognized (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ unexpected: true }) }));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('English');
      fireEvent.click(screen.getByRole('button', { name: 'View segments' }));
      expect(await screen.findByText("Couldn't load segments for this language.")).toBeInTheDocument();
    });

    it('shows a load-error state when the fetch itself fails (negative)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('English');
      fireEvent.click(screen.getByRole('button', { name: 'View segments' }));
      expect(await screen.findByText("Couldn't load segments for this language.")).toBeInTheDocument();
    });

    it('returns to the language list via "Back to languages"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hi.' }] }) }));
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('English');
      fireEvent.click(screen.getByRole('button', { name: 'View segments' }));
      await screen.findByText('Hi.');
      fireEvent.click(screen.getByRole('button', { name: /Back to languages/ }));
      expect(await screen.findByText('English')).toBeInTheDocument();
      expect(screen.queryByText('Hi.')).not.toBeInTheDocument();
    });

    it('does not offer "View segments" for a language with no artifactUrl (negative)', async () => {
      const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
      const ed = makeEd({ drawer: 'transcripts', service });
      render(<TranscriptsDrawer ed={ed} />);
      await screen.findByText('Hindi');
      // Only English has artifactUrl in the fixture - exactly one "View segments" button.
      expect(screen.getAllByRole('button', { name: 'View segments' })).toHaveLength(1);
    });

    describe('editing (source language, review status only)', () => {
      // English is Live in the base fixture, so use a copy with its status set to Review.
      const SOURCE_IN_REVIEW = TRANSCRIPTS.map((tr) => (tr.language === 'English' ? { ...tr, status: 'Review' } : tr));

      it('shows a Modify button on the source-language card when it is in review, that opens segments straight into edit mode', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        expect(screen.queryByRole('button', { name: 'Modify' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
        await screen.findByText('Hello there.');
        expect(screen.getByRole('textbox')).toHaveValue('Hello there.');
      });

      it('does not show a Modify button for a non-source-language card (negative)', async () => {
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('Hindi');
        expect(screen.getAllByRole('button', { name: 'Modify' })).toHaveLength(1);
      });

      it('does not show a Modify button for a Live source-language card (negative)', async () => {
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        expect(screen.queryByRole('button', { name: 'Modify' })).not.toBeInTheDocument();
      });

      it('shows an Edit button for a source-language transcript in review', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
      });

      it('does not show an Edit button for a non-source-language transcript (negative)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Namaste.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('Hindi');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[1]);
        await screen.findByText('Namaste.');
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      });

      it('does not show an Edit button for a Live source-language transcript (negative)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(TRANSCRIPTS) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getByRole('button', { name: 'View segments' }));
        await screen.findByText('Hello there.');
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      });

      it('hides Edit while an approve is pending confirmation, even though activeLang.status is still stale "Review" (negative)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const SOURCE_IN_REVIEW = TRANSCRIPTS.map((tr) => (tr.language === 'English' ? { ...tr, status: 'Review' } : tr));
        const approveTranscript = vi.fn().mockResolvedValue({});
        // Confirm re-read still reports Review - approve hasn't landed server-side yet.
        const readTranscripts = vi.fn().mockResolvedValue(SOURCE_IN_REVIEW);
        const service = mockService({ readTranscripts, approveTranscript });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Approve Transcript' }));
        await screen.findByText(/Almost there/);
        // Edit must disappear here - clicking it now would let the user start editing
        // a transcript that's actually already Live, and Save would fail server-side.
        expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      });

      it('turns segment text into an editable, pre-filled textarea after clicking Edit', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textbox.value).toBe('Hello there.');
        fireEvent.change(textbox, { target: { value: 'Hello world.' } });
        expect(textbox.value).toBe('Hello world.');
      });

      it('saves the full edited segment list via updateTranscript(contentId, transcriptId, segments)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          json: async () => ({ segments: [{ id: 0, start: 0, end: 2.5, text: 'Hello there.' }, { id: 1, text: 'Bye.' }] }),
        }));
        const updateTranscript = vi.fn().mockResolvedValue({});
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW), updateTranscript });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Corrected text here' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(updateTranscript).toHaveBeenCalledWith('do_1', 't_en', [
          { id: 0, start: 0, end: 2.5, text: 'Corrected text here' },
          { id: 1, text: 'Bye.', start: undefined, end: undefined },
        ]));
      });

      it('exits edit mode and shows the saved text after a successful save', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ id: 0, text: 'Hello there.' }] }) }));
        const service = mockService({
          readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW),
          updateTranscript: vi.fn().mockResolvedValue({}),
        });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Corrected text here' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.getByText('Corrected text here')).toBeInTheDocument());
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      });

      it('shows an error and stays in edit mode when the save fails (negative)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ id: 0, text: 'Hello there.' }] }) }));
        const service = mockService({
          readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW),
          updateTranscript: vi.fn().mockRejectedValue(new Error('Save failed')),
        });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Corrected text here' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByText('Save failed')).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });

      it('discards edits and returns to read-only text on Cancel', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited text.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByText('Hello there.')).toBeInTheDocument();
        expect(screen.queryByText('Edited text.')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      });

      it('does not leak edit mode when re-opening segments after Back to languages (negative)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ segments: [{ text: 'Hello there.' }] }) }));
        const service = mockService({ readTranscripts: vi.fn().mockResolvedValue(SOURCE_IN_REVIEW) });
        const ed = makeEd({ drawer: 'transcripts', service });
        render(<TranscriptsDrawer ed={ed} />);
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Back to languages/ }));
        await screen.findByText('English');
        fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
        await screen.findByText('Hello there.');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
      });
    });
  });
});
