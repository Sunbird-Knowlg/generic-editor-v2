import { describe, it, expect } from 'vitest';
import { applyEnrichments, enrichmentDefinition, enrichmentTypesForMime, enrichmentsForFile } from './registry';
import type { ContentData, EnrichmentObject } from '../../types';

const content: ContentData = { identifier: 'do_1', name: 'Video', mimeType: 'video/mp4' };
const obj = (over: Partial<EnrichmentObject>): EnrichmentObject => ({
  identifier: 't1', enrichmentObjectType: 'Transcript', parentId: 'do_1', status: 'Live', ...over,
});
const file = (name: string) => new File(['x'], name);

describe('enrichmentTypesForMime', () => {
  it('maps video mimeTypes to Transcript', () => {
    expect(enrichmentTypesForMime('video/mp4')).toEqual(['Transcript']);
    expect(enrichmentTypesForMime('video/webm')).toEqual(['Transcript']);
  });
  it('returns nothing for non-video or missing mimeTypes (negative)', () => {
    expect(enrichmentTypesForMime('application/pdf')).toEqual([]);
    expect(enrichmentTypesForMime('video/x-youtube')).toEqual([]);
    expect(enrichmentTypesForMime(undefined)).toEqual([]);
  });
});

describe('enrichmentsForFile', () => {
  it('matches by extension, case-insensitively', () => {
    expect(enrichmentsForFile(file('a.mp4')).map((d) => d.type)).toEqual(['Transcript']);
    expect(enrichmentsForFile(file('B.WEBM')).map((d) => d.type)).toEqual(['Transcript']);
  });
  it('matches nothing for other files (negative)', () => {
    expect(enrichmentsForFile(file('a.pdf'))).toEqual([]);
    expect(enrichmentsForFile(file('noext'))).toEqual([]);
  });
});

describe('enrichmentDefinition', () => {
  it('finds a registered type and returns undefined for an unknown one (negative)', () => {
    expect(enrichmentDefinition('Transcript')?.type).toBe('Transcript');
    expect(enrichmentDefinition('Nope')).toBeUndefined();
  });
});

describe('applyEnrichments (Transcript)', () => {
  it('maps Live transcripts with a captionsUrl to the player shape, using the VTT for both urls', () => {
    const out = applyEnrichments(content, [
      obj({ identifier: 't_en', language: 'English', languageCode: 'en', sourceLanguage: true, captionsUrl: 'https://x/en.vtt', artifactUrl: 'https://x/en.json' }),
    ]);
    expect(out.transcripts).toEqual([
      { language: 'English', identifier: 't_en', languageCode: 'en', artifactUrl: 'https://x/en.vtt', wordByWordUrl: 'https://x/en.vtt', sourceLanguage: true },
    ]);
  });

  it('falls back to the upper-cased languageCode, then "UNKNOWN", for the language label', () => {
    const out = applyEnrichments(content, [
      obj({ identifier: 'a', languageCode: 'hi', captionsUrl: 'https://x/hi.vtt' }),
      obj({ identifier: 'b', captionsUrl: 'https://x/b.vtt' }),
    ]);
    expect((out.transcripts as Array<{ language: string }>).map((t) => t.language)).toEqual(['HI', 'UNKNOWN']);
  });

  it('excludes every status except Live, and any missing status (negative)', () => {
    const base = { captionsUrl: 'https://x/a.vtt' };
    for (const status of ['Draft', 'Processing', 'Review', 'Failed', 'Retired', undefined]) {
      const out = applyEnrichments(content, [obj({ ...base, status: status as EnrichmentObject['status'] })]);
      expect(out.transcripts).toBeUndefined();
    }
  });

  it('excludes a Live transcript with no captionsUrl (negative)', () => {
    expect(applyEnrichments(content, [obj({ artifactUrl: 'https://x/a.json' })]).transcripts).toBeUndefined();
  });

  it('returns the same content reference when nothing applies (negative)', () => {
    expect(applyEnrichments(content, [])).toBe(content);
  });

  it('ignores objects of other types (negative)', () => {
    const out = applyEnrichments(content, [obj({ enrichmentObjectType: 'Summary', captionsUrl: 'https://x/a.vtt' })]);
    expect(out).toBe(content);
  });
});
