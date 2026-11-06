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

/** A fake service covering everything useEditor + UploadService touch on mount/upload. */
function svc(over: Record<string, unknown> = {}) {
  return {
    readContent: vi.fn(),
    readPrimaryCategories: vi.fn().mockResolvedValue([]),
    createLock: vi.fn().mockResolvedValue({}),
    retireLock: vi.fn().mockResolvedValue(undefined),
    sendForReview: vi.fn().mockResolvedValue({}),
    listEnrichmentObjects: vi.fn().mockResolvedValue([]),
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

describe('Dynamic Assess content view gating', () => {
  it('lands on the player view with no artifactUrl, unlike ordinary content (positive)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent({
      identifier: 'do_dynamic_assess_1',
      mimeType: 'application/vnd.ekstep.ecml-archive',
      primaryCategory: 'Dynamic Course Assessment',
      artifactUrl: undefined,
    }));
    expect(result.current.view).toBe('player');
  });

  it('ordinary content with no artifactUrl still lands on the upload view (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent({ artifactUrl: undefined }));
    expect(result.current.view).toBe('upload');
  });

  it('auto-opens the metadata drawer on load in edit mode (positive)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent({
      identifier: 'do_dynamic_assess_2',
      mimeType: 'application/vnd.ekstep.ecml-archive',
      primaryCategory: 'Dynamic Course Assessment',
      status: 'Draft',
      artifactUrl: undefined,
    }));
    await waitFor(() => expect(result.current.drawer).toBe('metadata'));
  });

  it('reads the body (generated questions) for Dynamic Assess content (positive)', async () => {
    const service = svc();
    await mountWithContent(service, videoContent({ identifier: 'do_da_body', primaryCategory: 'Dynamic Course Assessment', artifactUrl: undefined }));
    // No framework, so the skill field falls back to "skill" like the backend.
    expect(service.readContent).toHaveBeenCalledWith('do_da_body', 'edit', { withBody: true, extraFields: ['skill'] });
  });

  it('never reads the body for ordinary content (negative)', async () => {
    const service = svc();
    await mountWithContent(service, videoContent({ artifactUrl: 'https://cdn/video.mp4' }));
    for (const call of (service.readContent as ReturnType<typeof vi.fn>).mock.calls) expect(call[2]).toBeUndefined();
  });

  it('does not auto-open the metadata drawer for ordinary content (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, videoContent({ artifactUrl: 'https://cdn/video.mp4' }));
    expect(result.current.drawer).toBeNull();
  });
});

describe('useEditor — Dynamic Assess refreshBody polling', () => {
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_1', mimeType: 'application/vnd.ekstep.ecml-archive',
    primaryCategory: 'Dynamic Course Assessment', status: 'Draft',
    totalQuestions: 3, lastUpdatedOn: 't0',
    skill: ['Physics'], difficultyTarget: '{"E":1,"M":1,"D":1}', ...over,
  } as Partial<ContentData>);

  it('blocks Generate with a clear message when Skill is not saved, instead of a misleading wait (positive)', async () => {
    const refreshContentBody = vi.fn();
    const service = svc({ refreshContentBody });
    const result = await mountWithContent(service, daContent({ skill: [] }));
    await act(async () => { await result.current.refreshBody(); });
    expect(refreshContentBody).not.toHaveBeenCalled();
    expect(result.current.toast?.msg).toBe('Set Skill and Difficulty Target before generating questions.');
    expect(result.current.dynamicAssessRefreshing).toBe(false);
  });

  it('blocks Generate when every difficulty count is zero (negative)', async () => {
    const refreshContentBody = vi.fn();
    const service = svc({ refreshContentBody });
    const result = await mountWithContent(service, daContent({ difficultyTarget: '{"E":0,"M":0,"D":0}' }));
    await act(async () => { await result.current.refreshBody(); });
    expect(refreshContentBody).not.toHaveBeenCalled();
  });

  it('detects a regenerate that keeps the same count via lastUpdatedOn, without needing a publish (positive)', async () => {
    const refreshContentBody = vi.fn().mockResolvedValue({});
    const service = svc({ refreshContentBody });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      const readContent = service.readContent as ReturnType<typeof vi.fn>;
      readContent
        .mockResolvedValueOnce(daContent())                         // baseline
        .mockResolvedValueOnce(daContent())                         // poll 1: job not done
        .mockResolvedValue(daContent({ lastUpdatedOn: 't1' }));     // poll 2: job wrote

      await act(async () => { await result.current.refreshBody(); });
      expect(refreshContentBody).toHaveBeenCalledWith('do_da_1', 'u1'); // logged-in user as lastPublishedBy
      expect(result.current.dynamicAssessRefreshing).toBe(true);

      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.dynamicAssessRefreshing).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      expect(result.current.toast?.msg).toBe('Questions generated');
      expect(result.current.content?.pkgVersion ?? 0).toBe(0); // still an unpublished Draft
    } finally {
      vi.useRealTimers();
    }
  });

  it('says generation is still in progress, not done, when nothing changes before the poll limit (negative)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      await act(async () => { await result.current.refreshBody(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 21); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      expect(result.current.toast?.msg).toMatch(/haven't appeared yet/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useEditor — Dynamic Assess refreshBody timeout', () => {
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_t', mimeType: 'application/vnd.ekstep.ecml-archive',
    primaryCategory: 'Dynamic Course Assessment', status: 'Draft',
    totalQuestions: 0, lastUpdatedOn: 't0',
    skill: ['Physics'], difficultyTarget: '{"E":1,"M":1,"D":1}', ...over,
  } as Partial<ContentData>);

  it('shows what the server has after the poll limit, even when the job wrote before the baseline read (positive)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      // The job finished before the baseline read, so no poll ever sees a change.
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(daContent({ totalQuestions: 3, lastUpdatedOn: 't1' }));
      await act(async () => { await result.current.refreshBody(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 21); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      expect(result.current.content?.totalQuestions).toBe(3);
      expect(result.current.hasGeneratedBody).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still says pending, and clears the loader, when the last read fails (negative)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      (service.readContent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
      await act(async () => { await result.current.refreshBody(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 21); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      expect(result.current.toast?.msg).toMatch(/haven't appeared yet/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useEditor — Dynamic Assess completion and writes during generation', () => {
  const quiz = (levels: Record<string, string>) => JSON.stringify({
    theme: { stage: [{ 'org.ekstep.questionset': { config: { __cdata: JSON.stringify({ dynamic_assess: { skills: ['Physics'], target: { E: 1, M: 0, D: 0 }, levels } }) } } }] },
  });
  const oldBody = quiz({ q1: 'EASY', q2: 'EASY' });
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_c', mimeType: 'application/vnd.ekstep.ecml-archive',
    primaryCategory: 'Dynamic Course Assessment', status: 'Draft', totalQuestions: 1, lastUpdatedOn: 't0',
    skill: ['Physics'], difficultyTarget: '{"E":1,"M":0,"D":0}', body: oldBody, ...over,
  } as Partial<ContentData>);

  it('reports done on the first poll when the job wrote before the baseline read (positive)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      // Baseline and every poll already see the job's write: new body, new timestamp.
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(daContent({ lastUpdatedOn: 't1', body: quiz({ q3: 'EASY', q4: 'EASY' }) }));
      await act(async () => { await result.current.refreshBody(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      expect(result.current.toast?.msg).toBe('Questions generated');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting while the Live edit copy only carries the old body (negative)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      // The API's edit copy bumps lastUpdatedOn before the baseline read but keeps the old quiz.
      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(daContent({ lastUpdatedOn: 't1' }));
      await act(async () => { await result.current.refreshBody(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 3); });
      expect(result.current.dynamicAssessRefreshing).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores header Save and Send for Review while generating, and allows them after (positive/negative)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      await act(async () => { await result.current.refreshBody(); });
      expect(result.current.dynamicAssessRefreshing).toBe(true);
      await act(async () => { await result.current.saveDraft(); await result.current.sendForReview(); });
      expect(service.updateContent).not.toHaveBeenCalled();
      expect(service.sendForReview).not.toHaveBeenCalled();

      (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(daContent({ lastUpdatedOn: 't2', body: quiz({ q5: 'EASY', q6: 'EASY' }) }));
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      await act(async () => { await result.current.saveDraft(); });
      expect(service.updateContent).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks Generate with a translated message when the session has no user id (positive)', async () => {
    const refreshContentBody = vi.fn();
    const service = svc({ refreshContentBody });
    (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(daContent());
    const { result } = renderHook(() => useEditor({ context: { ...mockContext, user: { ...mockContext.user, id: '' } }, contentId: 'do_da_c', service }));
    await waitFor(() => expect(result.current.content?.identifier).toBe('do_da_c'));
    await act(async () => { await result.current.refreshBody(); });
    expect(refreshContentBody).not.toHaveBeenCalled();
    expect(result.current.toast?.msg).toMatch(/no user/);
    expect(result.current.dynamicAssessRefreshing).toBe(false);
  });

  it('never stacks a poll on a read still in flight (positive)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      const readContent = service.readContent as ReturnType<typeof vi.fn>;
      readContent.mockResolvedValueOnce(daContent()); // baseline
      await act(async () => { await result.current.refreshBody(); });
      readContent.mockClear();
      readContent.mockReturnValue(new Promise(() => {})); // the first poll's read never returns
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 4); });
      expect(readContent).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out in a hidden tab instead of keeping the overlay up forever (positive)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    const originalHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    vi.useFakeTimers();
    try {
      await act(async () => { await result.current.refreshBody(); });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 21); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
      expect(result.current.toast?.msg).toMatch(/haven't appeared yet/);
    } finally {
      vi.useRealTimers();
      if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
    }
  });

  it('regenerates when a save only switches the framework (positive)', async () => {
    const refreshContentBody = vi.fn().mockResolvedValue({});
    const result = await mountWithContent(svc({ refreshContentBody }), daContent({ framework: 'BMGS' }));
    await act(async () => { await result.current.saveMetadata({ framework: 'USF', skill: ['Physics'] }, { skillField: 'skill' }); });
    await waitFor(() => expect(refreshContentBody).toHaveBeenCalled());
  });

  it('is a plain save when the framework stays the same (negative)', async () => {
    const refreshContentBody = vi.fn();
    const result = await mountWithContent(svc({ refreshContentBody }), daContent({ framework: 'BMGS' }));
    await act(async () => { await result.current.saveMetadata({ framework: 'BMGS', skill: ['Physics'] }, { skillField: 'skill' }); });
    expect(refreshContentBody).not.toHaveBeenCalled();
  });
});

describe('useEditor — Save also generates when needed', () => {
  const generatedBody = JSON.stringify({
    theme: { stage: [{ 'org.ekstep.questionset': { config: { __cdata: JSON.stringify({ dynamic_assess: { skills: ['Physics'], target: { E: 1, M: 0, D: 0 } } }) } } }] },
  });
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_2', mimeType: 'application/vnd.ekstep.ecml-archive', primaryCategory: 'Dynamic Course Assessment', ...over,
  } as Partial<ContentData>);

  it('generates right after the first save that has Skill and Difficulty Target (positive)', async () => {
    const refreshContentBody = vi.fn().mockResolvedValue({});
    const result = await mountWithContent(svc({ refreshContentBody }), daContent({ totalQuestions: 0 } as Partial<ContentData>));
    await act(async () => { await result.current.saveMetadata({ skill: ['Physics'], difficultyTarget: '{"E":1,"M":0,"D":0}' }, { skillField: 'skill' }); });
    await waitFor(() => expect(refreshContentBody).toHaveBeenCalledWith('do_da_2', 'u1'));
    expect(result.current.dynamicAssessRefreshing).toBe(true);
  });

  it('regenerates when a save changes the Skill of already-generated questions (positive)', async () => {
    const refreshContentBody = vi.fn().mockResolvedValue({});
    const content = daContent({ totalQuestions: 3, skill: ['Physics'], difficultyTarget: '{"E":1,"M":0,"D":0}', body: generatedBody } as Partial<ContentData>);
    const result = await mountWithContent(svc({ refreshContentBody }), content);
    await act(async () => { await result.current.saveMetadata({ skill: ['Physics', 'Chemistry'] }, { skillField: 'skill' }); });
    await waitFor(() => expect(refreshContentBody).toHaveBeenCalled());
  });

  it('is a plain save, with no generate call, for a spelling fix (negative)', async () => {
    const refreshContentBody = vi.fn();
    const content = daContent({ totalQuestions: 3, skill: ['Physics'], difficultyTarget: '{"E":1,"M":0,"D":0}', body: generatedBody } as Partial<ContentData>);
    const result = await mountWithContent(svc({ refreshContentBody }), content);
    await act(async () => { await result.current.saveMetadata({ name: 'Fixed typo' }); });
    expect(refreshContentBody).not.toHaveBeenCalled();
    expect(result.current.toast?.msg).toBe('Details saved — content updated');
  });

  it('keeps the generic toast for other content (negative)', async () => {
    const result = await mountWithContent(svc(), videoContent());
    await act(async () => { await result.current.saveMetadata({ name: 'Renamed' }); });
    expect(result.current.toast?.msg).toBe('Details saved — content updated');
  });
});

describe('useEditor — Dynamic Assess settings changed after generation', () => {
  const generatedBody = JSON.stringify({
    theme: { stage: [{ 'org.ekstep.questionset': { config: { __cdata: JSON.stringify({ dynamic_assess: { skills: ['Physics'], target: { E: 3, M: 3, D: 3 } } }) } } }] },
  });
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_s', mimeType: 'application/vnd.ekstep.ecml-archive',
    primaryCategory: 'Dynamic Course Assessment', status: 'Draft', totalQuestions: 9,
    skill: ['Physics'], difficultyTarget: '{"E":3,"M":3,"D":3}', body: generatedBody, ...over,
  } as Partial<ContentData>);

  it('blocks Send for Review when the target was changed without regenerating (positive)', async () => {
    const service = svc();
    const result = await mountWithContent(service, daContent({ difficultyTarget: '{"E":3,"M":2,"D":3}' } as Partial<ContentData>));
    expect(result.current.dynamicAssessStale).toBe(true);
    await act(async () => { await result.current.sendForReview(); });
    expect(service.sendForReview).not.toHaveBeenCalled();
    expect(result.current.toast?.msg).toMatch(/changed since the questions were generated/);
  });

  it('saves but does not submit when the review drawer itself changes the skill (positive)', async () => {
    const service = svc();
    const result = await mountWithContent(service, daContent());
    expect(result.current.dynamicAssessStale).toBe(false);
    await act(async () => { await result.current.saveMetadataAndSubmit({ skill: ['Chemistry'] }, { skillField: 'skill' }); });
    expect(service.updateContent).toHaveBeenCalled();
    expect(service.sendForReview).not.toHaveBeenCalled();
    expect(result.current.dynamicAssessStale).toBe(true);
  });

  it('blocks Publish for a reviewer when settings do not match the questions (positive)', async () => {
    const publishContent = vi.fn().mockResolvedValue({});
    const service = svc({ publishContent });
    const result = await mountWithContent(service, daContent({ skill: ['Chemistry'] }));
    await act(async () => { await result.current.publish(); });
    expect(publishContent).not.toHaveBeenCalled();
    expect(result.current.toast?.msg).toMatch(/Request changes/);
  });

  it('submits normally when the settings still match the generated questions (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, daContent());
    await act(async () => { await result.current.sendForReview(); });
    expect(service.sendForReview).toHaveBeenCalledWith('do_da_s');
  });

  it('never flags ordinary content, whatever its fields say (negative)', async () => {
    const service = svc();
    const result = await mountWithContent(service, daContent({ primaryCategory: 'Learning Resource', difficultyTarget: '{"E":1}' } as Partial<ContentData>));
    expect(result.current.dynamicAssessStale).toBe(false);
    await act(async () => { await result.current.sendForReview(); });
    expect(service.sendForReview).toHaveBeenCalled();
  });
});

describe('useEditor — Dynamic Assess Generate edge cases', () => {
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_g', mimeType: 'application/vnd.ekstep.ecml-archive',
    primaryCategory: 'Dynamic Course Assessment', status: 'Live',
    totalQuestions: 6, lastUpdatedOn: 't0',
    skill: ['Physics'], difficultyTarget: '{"E":2,"M":2,"D":2}', ...over,
  } as Partial<ContentData>);

  it('ignores the edit-copy write the API makes for Live content and waits for the job (positive)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    const result = await mountWithContent(service, daContent());
    vi.useFakeTimers();
    try {
      (service.readContent as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(daContent({ lastUpdatedOn: 't-img' }))      // baseline, after the API created the .img copy
        .mockResolvedValueOnce(daContent({ lastUpdatedOn: 't-img' }))      // poll 1: job not done
        .mockResolvedValue(daContent({ lastUpdatedOn: 't-job' }));         // poll 2: job wrote
      await act(async () => { await result.current.refreshBody(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.dynamicAssessRefreshing).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.dynamicAssessRefreshing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops polling when the editor unmounts mid-generation (negative)', async () => {
    const service = svc({ refreshContentBody: vi.fn().mockResolvedValue({}) });
    (service.readContent as ReturnType<typeof vi.fn>).mockResolvedValue(daContent());
    const { result, unmount } = renderHook(() => useEditor({ context: mockContext, contentId: 'do_da_g', service }));
    await waitFor(() => expect(result.current.content?.identifier).toBe('do_da_g'));
    vi.useFakeTimers();
    try {
      await act(async () => { await result.current.refreshBody(); });
      unmount();
      const callsAtUnmount = (service.readContent as ReturnType<typeof vi.fn>).mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000 * 5);
      expect((service.readContent as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtUnmount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses Send for Review before any questions are generated, whatever the caller (positive)', async () => {
    const service = svc();
    const result = await mountWithContent(service, daContent({ status: 'Draft', totalQuestions: 0 }));
    await act(async () => { await result.current.sendForReview(); });
    expect(service.sendForReview).not.toHaveBeenCalled();
    expect(result.current.toast?.msg).toBe('Generate questions before sending for review');
  });

  it('translates the knowlg-service per-skill rejection instead of showing its English text (positive)', async () => {
    const rejection = Object.assign(new Error('Fewer than 6 Live questions found for skill(s): Azure'), { code: 'ERR_SKILL_INSUFFICIENT_POOL' });
    const service = svc({ refreshContentBody: vi.fn().mockRejectedValue(rejection) });
    const result = await mountWithContent(service, daContent({ status: 'Draft' }));
    await act(async () => { await result.current.refreshBody(); });
    expect(result.current.toast?.msg).toBe('Each skill needs at least 6 Live questions. Too few for: Azure');
    expect(result.current.dynamicAssessRefreshing).toBe(false);
  });
});

describe('useEditor — Dynamic Assess skills live in the framework\'s deepest category', () => {
  const bmgs = [{ code: 'board', name: 'Board', index: 1, terms: [] }, { code: 'topic', name: 'Topic', index: 2, terms: [] }];
  const daContent = (over: Partial<ContentData> = {}): ContentData => videoContent({
    identifier: 'do_da_topic', mimeType: 'application/vnd.ekstep.ecml-archive', primaryCategory: 'Dynamic Course Assessment',
    status: 'Draft', framework: 'BMGS', difficultyTarget: '{"E":1,"M":0,"D":0}', ...over,
  } as Partial<ContentData>);

  it('reads the selection from the deepest category field, not a field named skill (positive)', async () => {
    const service = svc({ readFramework: vi.fn().mockResolvedValue(bmgs) });
    const result = await mountWithContent(service, daContent({ topic: ['Algebra'], skill: ['Stray'] } as Partial<ContentData>));
    expect(service.readContent).toHaveBeenCalledWith('do_da_topic', 'edit', { withBody: true, extraFields: ['topic'] });
    await waitFor(() => expect(result.current.content?.dynamicSkills).toEqual(['Algebra']));
  });

  it('generates after a save that writes the deepest category, and keeps that field in polled reads (positive)', async () => {
    const refreshContentBody = vi.fn().mockResolvedValue({});
    const service = svc({ readFramework: vi.fn().mockResolvedValue(bmgs), refreshContentBody });
    const result = await mountWithContent(service, daContent());
    await act(async () => { await result.current.saveMetadata({ topic: ['Algebra'] }, { skillField: 'topic' }); });
    await waitFor(() => expect(refreshContentBody).toHaveBeenCalledWith('do_da_topic', 'u1'));
    expect(result.current.content?.dynamicSkills).toEqual(['Algebra']);
  });

  it('never resolves a framework or reads extra fields for ordinary content (negative)', async () => {
    const readFramework = vi.fn().mockResolvedValue(bmgs);
    const service = svc({ readFramework });
    await mountWithContent(service, videoContent({ artifactUrl: 'https://cdn/video.mp4', framework: 'BMGS' } as Partial<ContentData>));
    expect(readFramework).not.toHaveBeenCalled();
    for (const call of (service.readContent as ReturnType<typeof vi.fn>).mock.calls) expect(call[2]).toBeUndefined();
  });
});
