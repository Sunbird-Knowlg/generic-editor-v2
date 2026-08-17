import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useEditor } from './useEditor';
import type { ContentEditorService } from './services/ContentEditorService';
import { mockContext } from './test/mockEd';
import type { ContentData } from './types';

/** A fake service covering everything useEditor + UploadService touch on mount/upload. */
function svc(over: Record<string, unknown> = {}) {
  return {
    readContent: vi.fn(),
    readPrimaryCategories: vi.fn().mockResolvedValue([]),
    createLock: vi.fn().mockResolvedValue({}),
    retireLock: vi.fn().mockResolvedValue(undefined),
    sendForReview: vi.fn().mockResolvedValue({}),
    createTranscript: vi.fn().mockResolvedValue({ transcriptId: 't1' }),
    readTranscripts: vi.fn().mockResolvedValue([]),
    updateContent: vi.fn().mockResolvedValue({ versionKey: 'vk2' }),
    readFormFields: vi.fn().mockResolvedValue([{ code: 'name', required: false }]),
    getBase: () => ({ baseUrl: '', apiSlug: '/action', headers: {}, fetchImpl: fetch }),
    getEndpoints: () => ({ presigned: 'content/v3/upload/url', uploadFinalize: 'content/v3/upload' }),
    ...over,
  } as unknown as ContentEditorService;
}

function videoContent(over: Partial<ContentData> = {}): ContentData {
  return {
    identifier: 'do_video_1',
    name: 'A video',
    mimeType: 'video/mp4',
    primaryCategory: 'Learning Resource',
    status: 'Draft',
    versionKey: 'vk1',
    ...over,
  } as ContentData;
}

async function mountWithContent(service: ContentEditorService, content: ContentData) {
  (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(content);
  const { result } = renderHook(() =>
    useEditor({ context: mockContext, contentId: content.identifier, service }),
  );
  await waitFor(() => expect(result.current.content?.identifier).toBe(content.identifier));
  return result;
}

function fakeFile(name: string, sizeBytes = 1024, type = 'video/mp4'): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: sizeBytes });
  return f;
}

/** Stubs the 3-call upload pipeline (presign → cloud PUT → finalize) that
 *  UploadService drives with raw fetch, independent of ContentEditorService. */
function stubUploadPipeline() {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('upload/url')) return { ok: true, json: async () => ({ result: { pre_signed_url: 'https://blob.test/upload' } }) };
    if (u === 'https://blob.test/upload') return { ok: true };
    return { ok: true, json: async () => ({ responseCode: 'OK' }) }; // finalize
  }) as unknown as typeof fetch;
}

describe('useEditor — hasTranscripts polling', () => {
  it('polls readTranscripts periodically until transcripts appear, then stops polling', async () => {
    vi.useFakeTimers();
    try {
      const readTranscripts = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ identifier: 't1', language: 'English', status: 'Live' }]);
      const service = svc({ readTranscripts });
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(videoContent());
      const { result } = renderHook(() => useEditor({ context: mockContext, contentId: 'do_video_1', service }));

      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      expect(result.current.hasTranscripts).toBe(false); // first check: not ready yet

      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(result.current.hasTranscripts).toBe(false); // still not ready on the first poll

      await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      expect(result.current.hasTranscripts).toBe(true); // second poll: now it exists

      const callsOnceConfirmed = readTranscripts.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      // No further reads once confirmed - polling stops instead of running forever.
      expect(readTranscripts.mock.calls.length).toBe(callsOnceConfirmed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not poll for non-video content (negative)', async () => {
    vi.useFakeTimers();
    try {
      const readTranscripts = vi.fn().mockResolvedValue([]);
      const service = svc({ readTranscripts });
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(videoContent({ mimeType: 'application/pdf' }));
      renderHook(() => useEditor({ context: mockContext, contentId: 'do_video_1', service }));
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(readTranscripts).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling after TRANSCRIPT_POLL_MAX_ATTEMPTS when transcripts never arrive', async () => {
    vi.useFakeTimers();
    try {
      const readTranscripts = vi.fn().mockResolvedValue([]);
      const service = svc({ readTranscripts });
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(videoContent());
      renderHook(() => useEditor({ context: mockContext, contentId: 'do_video_1', service }));

      await act(async () => { await vi.runOnlyPendingTimersAsync(); }); // initial check
      for (let i = 0; i < 15; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
      }
      const callsAtCap = readTranscripts.mock.calls.length;
      expect(callsAtCap).toBe(16); // 1 initial + 15 capped polls

      await act(async () => { await vi.advanceTimersByTimeAsync(20000 * 5); });
      // No further reads once the cap is hit - this is the "polls forever" bug being fixed.
      expect(readTranscripts.mock.calls.length).toBe(callsAtCap);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the fetch (but keeps ticking) while the tab is hidden (negative)', async () => {
    vi.useFakeTimers();
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      const readTranscripts = vi.fn().mockResolvedValue([]);
      const service = svc({ readTranscripts });
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(videoContent());
      renderHook(() => useEditor({ context: mockContext, contentId: 'do_video_1', service }));
      await act(async () => { await vi.runOnlyPendingTimersAsync(); }); // initial check always fires
      const callsAfterInitial = readTranscripts.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(20000 * 3); });
      expect(readTranscripts.mock.calls.length).toBe(callsAfterInitial);
    } finally {
      vi.useRealTimers();
      if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
    }
  });

  it('exposes the raw transcript list and transcriptsChecked alongside hasTranscripts', async () => {
    const list = [{ identifier: 't1', language: 'English', status: 'Live' }];
    const readTranscripts = vi.fn().mockResolvedValue(list);
    const service = svc({ readTranscripts });
    const result = await mountWithContent(service, videoContent());
    await waitFor(() => expect(result.current.hasTranscripts).toBe(true));
    expect(result.current.transcriptsChecked).toBe(true);
    expect(result.current.transcripts).toEqual(list);
  });

  it('marks transcriptsChecked true immediately for non-video content, without ever reading (negative)', async () => {
    const service = svc();
    (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(videoContent({ mimeType: 'application/pdf' }));
    const { result } = renderHook(() => useEditor({ context: mockContext, contentId: 'do_video_1', service }));
    await waitFor(() => expect(result.current.content).toBeTruthy());
    expect(result.current.transcriptsChecked).toBe(true);
    expect(result.current.transcripts).toEqual([]);
    expect(service.readTranscripts).not.toHaveBeenCalled();
  });
});

describe('useEditor — transcript generation on upload', () => {
  it('calls createTranscript right after a successful video upload when the checkbox was checked', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent());
    const savedFetch = globalThis.fetch;
    globalThis.fetch = stubUploadPipeline();
    try {
      await act(async () => { await result.current.uploadFile(fakeFile('lecture.mp4'), true); });
      expect(service.createTranscript).toHaveBeenCalledWith('do_video_1');
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('does not call createTranscript when the checkbox was unchecked (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent());
    const savedFetch = globalThis.fetch;
    globalThis.fetch = stubUploadPipeline();
    try {
      await act(async () => { await result.current.uploadFile(fakeFile('lecture.mp4'), false); });
      expect(service.createTranscript).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('does not call createTranscript for a non-video file even if passed true (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent({ mimeType: 'application/pdf' }));
    const savedFetch = globalThis.fetch;
    globalThis.fetch = stubUploadPipeline();
    try {
      await act(async () => { await result.current.uploadFile(fakeFile('doc.pdf', 1024, 'application/pdf'), true); });
      expect(service.createTranscript).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('a failed transcript kickoff does not block the upload-success path (negative)', async () => {
    const service = svc({ createTranscript: vi.fn().mockRejectedValue(new Error('boom')) });
    const result = await mountWithContent(service, videoContent());
    const savedFetch = globalThis.fetch;
    globalThis.fetch = stubUploadPipeline();
    try {
      await act(async () => { await result.current.uploadFile(fakeFile('lecture.mp4'), true); });
      await waitFor(() => expect(result.current.uploadSuccess).toBe(true));
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it('sendForReview no longer triggers createTranscript - that now happens at upload time (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent());
    await act(async () => { await result.current.sendForReview(); });
    expect(service.createTranscript).not.toHaveBeenCalled();
  });

  it('saveMetadataAndSubmit no longer triggers createTranscript (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent());
    await act(async () => { await result.current.saveMetadataAndSubmit({ name: 'A video (edited)' }); });
    expect(service.createTranscript).not.toHaveBeenCalled();
  });
});
