import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEditor } from './useEditor';
import { detectFileMime } from './services/UploadService';
import type { ContentEditorService } from './services/ContentEditorService';
import type { ContentData, EnrichmentObject } from './types';
import { mockContext } from './test/mockEd';

vi.mock('./services/UploadService', () => ({
  UploadService: class {
    getPresignedUrl = vi.fn().mockResolvedValue('https://signed');
    putToCloud = vi.fn().mockResolvedValue(undefined);
    finalizeUpload = vi.fn().mockResolvedValue(undefined);
    finalizeUrl = vi.fn().mockResolvedValue(undefined);
  },
  detectFileMime: vi.fn(),
  detectUrlMime: vi.fn(),
}));

const video = (over: Partial<ContentData> = {}): ContentData => ({
  identifier: 'do_1', name: 'Lecture', mimeType: 'video/mp4', status: 'Draft',
  artifactUrl: 'https://cdn/do_1.mp4', createdBy: 'u1', versionKey: 'vk0', ...over,
});

const transcript = (over: Partial<EnrichmentObject> = {}): EnrichmentObject => ({
  identifier: 't_en', enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Live',
  language: 'English', languageCode: 'en', sourceLanguage: true, ...over,
});

/** A fake service covering everything useEditor touches. `reads` are returned in order, then the last one repeats. */
function makeService(reads: ContentData[], over: Record<string, unknown> = {}) {
  const readContent = vi.fn();
  reads.forEach((r, i) => (i < reads.length - 1 ? readContent.mockResolvedValueOnce(r) : readContent.mockResolvedValue(r)));
  return {
    readPrimaryCategories: vi.fn().mockResolvedValue([]),
    readContent,
    updateContent: vi.fn().mockResolvedValue({ versionKey: 'vk-new' }),
    listEnrichmentObjects: vi.fn().mockResolvedValue([]),
    createLock: vi.fn().mockResolvedValue({}),
    retireLock: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ContentEditorService & {
    readContent: ReturnType<typeof vi.fn>;
    updateContent: ReturnType<typeof vi.fn>;
    listEnrichmentObjects: ReturnType<typeof vi.fn>;
  };
}

async function openEditor(service: ReturnType<typeof makeService>) {
  const hook = renderHook(() => useEditor({ context: mockContext, contentId: 'do_1', service, onClose: vi.fn() }));
  await waitFor(() => expect(hook.result.current.content?.identifier).toBe('do_1'));
  return hook;
}

const mp4 = () => new File(['x'], 'lecture.mp4');

beforeEach(() => {
  vi.mocked(detectFileMime).mockResolvedValue('video/mp4');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useEditor — saving enrichmentTypes on upload', () => {
  it('saves the ticked types with the versionKey of the fresh read, and updates local state', async () => {
    const service = makeService([video({ versionKey: 'vk0' }), video({ versionKey: 'vk-fresh' })]);
    const { result } = await openEditor(service);
    await act(async () => { await result.current.uploadFile(mp4(), ['Transcript']); });
    expect(service.updateContent).toHaveBeenCalledTimes(1);
    expect(service.updateContent).toHaveBeenCalledWith('do_1', { enrichmentTypes: ['Transcript'] }, 'vk-fresh');
    expect(result.current.content?.versionKey).toBe('vk-new');
    expect(result.current.content?.enrichmentTypes).toEqual(['Transcript']);
    expect(result.current.uploadSuccess).toBe(true);
  });

  it('makes no update call when nothing is ticked (negative)', async () => {
    const service = makeService([video(), video({ versionKey: 'vk-fresh' })]);
    const { result } = await openEditor(service);
    await act(async () => { await result.current.uploadFile(mp4(), []); });
    await act(async () => { await result.current.uploadFile(mp4()); });
    expect(service.updateContent).not.toHaveBeenCalled();
    expect(result.current.content?.enrichmentTypes).toBeUndefined();
  });

  it('makes no update call when the detected mimeType is not video, even if the file is named .mp4 (negative)', async () => {
    vi.mocked(detectFileMime).mockResolvedValue('application/pdf');
    const service = makeService([video(), video({ versionKey: 'vk-fresh' })]);
    const { result } = await openEditor(service);
    await act(async () => { await result.current.uploadFile(mp4(), ['Transcript']); });
    expect(service.updateContent).not.toHaveBeenCalled();
  });

  it('drops a type that has no registry entry (negative)', async () => {
    const service = makeService([video(), video({ versionKey: 'vk-fresh' })]);
    const { result } = await openEditor(service);
    await act(async () => { await result.current.uploadFile(mp4(), ['Summary']); });
    expect(service.updateContent).not.toHaveBeenCalled();
  });

  it('keeps the upload successful and shows a toast when the save fails (negative)', async () => {
    const service = makeService([video(), video({ versionKey: 'vk-fresh' })], {
      updateContent: vi.fn().mockRejectedValue(new Error('conflict')),
    });
    const { result } = await openEditor(service);
    await act(async () => { await result.current.uploadFile(mp4(), ['Transcript']); });
    expect(result.current.uploadSuccess).toBe(true);
    expect(result.current.view).toBe('player');
    expect(result.current.toast?.msg).toMatch(/Couldn't save the transcript request/);
    expect(result.current.content?.versionKey).toBe('vk-fresh');
    expect(result.current.content?.enrichmentTypes).toBeUndefined();
  });
});

describe('useEditor — enrichment objects on open', () => {
  it('lists the objects once for a published video, and derives presentEnrichmentTypes', async () => {
    const list = [transcript()];
    const service = makeService([video({ pkgVersion: 1 })], { listEnrichmentObjects: vi.fn().mockResolvedValue(list) });
    const { result } = await openEditor(service);
    await waitFor(() => expect(result.current.enrichmentsChecked).toBe(true));
    expect(service.listEnrichmentObjects).toHaveBeenCalledTimes(1);
    expect(service.listEnrichmentObjects).toHaveBeenCalledWith('do_1', ['Transcript']);
    expect(result.current.enrichmentObjects).toEqual(list);
    expect(result.current.presentEnrichmentTypes).toEqual(['Transcript']);
  });

  it('makes no call for a never-published video (no pkgVersion), and is checked immediately (negative)', async () => {
    const service = makeService([video()]);
    const { result } = await openEditor(service);
    await waitFor(() => expect(result.current.enrichmentsChecked).toBe(true));
    expect(service.listEnrichmentObjects).not.toHaveBeenCalled();
    expect(result.current.presentEnrichmentTypes).toEqual([]);
  });

  it('makes no call for non-video content, even when published (negative)', async () => {
    const service = makeService([video({ mimeType: 'application/pdf', pkgVersion: 2 })]);
    const { result } = await openEditor(service);
    await waitFor(() => expect(result.current.enrichmentsChecked).toBe(true));
    expect(service.listEnrichmentObjects).not.toHaveBeenCalled();
  });

  it('does not poll: no further calls as time passes (negative)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const service = makeService([video({ pkgVersion: 1 })]);
    const { result } = await openEditor(service);
    await waitFor(() => expect(result.current.enrichmentsChecked).toBe(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(service.listEnrichmentObjects).toHaveBeenCalledTimes(1);
  });

  it('lists again when the content gains a pkgVersion (e.g. after a re-read)', async () => {
    vi.mocked(detectFileMime).mockResolvedValue('video/mp4');
    const service = makeService([video(), video({ pkgVersion: 1, versionKey: 'vk-fresh' })]);
    const { result } = await openEditor(service);
    expect(service.listEnrichmentObjects).not.toHaveBeenCalled();
    await act(async () => { await result.current.uploadFile(mp4()); });
    await waitFor(() => expect(service.listEnrichmentObjects).toHaveBeenCalledTimes(1));
  });

  it('reloadEnrichments lists again and replaces the objects', async () => {
    const service = makeService([video({ pkgVersion: 1 })], {
      listEnrichmentObjects: vi.fn()
        .mockResolvedValueOnce([transcript({ status: 'Processing' })])
        .mockResolvedValue([transcript({ status: 'Live' })]),
    });
    const { result } = await openEditor(service);
    await waitFor(() => expect(result.current.enrichmentObjects[0]?.status).toBe('Processing'));
    act(() => result.current.reloadEnrichments());
    await waitFor(() => expect(result.current.enrichmentObjects[0]?.status).toBe('Live'));
    expect(service.listEnrichmentObjects).toHaveBeenCalledTimes(2);
  });

  it('flags an error with empty objects when the list fails, and clears it on a successful retry (negative)', async () => {
    const service = makeService([video({ pkgVersion: 1 })], {
      listEnrichmentObjects: vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue([transcript()]),
    });
    const { result } = await openEditor(service);
    await waitFor(() => expect(result.current.enrichmentsError).toBe(true));
    expect(result.current.enrichmentObjects).toEqual([]);
    expect(result.current.enrichmentsChecked).toBe(true);
    act(() => result.current.reloadEnrichments());
    await waitFor(() => expect(result.current.enrichmentsError).toBe(false));
    expect(result.current.enrichmentObjects).toHaveLength(1);
  });

  it('openEnrichmentDrawer opens the enrichments drawer for the given type', async () => {
    const service = makeService([video({ pkgVersion: 1 })], { listEnrichmentObjects: vi.fn().mockResolvedValue([transcript()]) });
    const { result } = await openEditor(service);
    act(() => result.current.openEnrichmentDrawer('Transcript'));
    expect(result.current.drawer).toBe('enrichments');
    expect(result.current.enrichmentDrawerType).toBe('Transcript');
  });
});
