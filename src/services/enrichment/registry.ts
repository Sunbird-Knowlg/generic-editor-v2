/** Enrichment registry — one entry per backend `enrichmentObjectType`; everything outside these entries is type-agnostic. */
import type { ContentData, EnrichmentObject } from '../../types';
import { transcriptDefinition } from './transcript';

export interface EnrichmentDefinition {
  /** Matches `enrichmentObjectType` on the backend and the value stored in `ContentData.enrichmentTypes`. */
  type: string;
  /** Content mimeTypes this enrichment applies to. */
  mimeTypes: readonly string[];
  /** File extensions that trigger the upload-time prompt. */
  extensions: readonly string[];
  /** i18n keys for the upload-time checkbox and its hint. */
  uploadLabelKey: string;
  uploadHintKey: string;
  /** i18n key for the header button tooltip and aria-label. */
  headerLabelKey: string;
  /** i18n key for the drawer title. */
  drawerTitleKey: string;
  /** i18n key for the drawer's load-error title. */
  loadErrorKey: string;
  /** Returns the content with this type's objects applied, for the preview renderer. */
  applyToContent: (content: ContentData, objects: EnrichmentObject[]) => ContentData;
}

export const ENRICHMENT_REGISTRY: readonly EnrichmentDefinition[] = [transcriptDefinition];

export function enrichmentDefinition(type: string): EnrichmentDefinition | undefined {
  return ENRICHMENT_REGISTRY.find((d) => d.type === type);
}

/** Types that apply to a content mimeType. */
export function enrichmentTypesForMime(mimeType?: string): string[] {
  return mimeType ? ENRICHMENT_REGISTRY.filter((d) => d.mimeTypes.includes(mimeType)).map((d) => d.type) : [];
}

/** Definitions whose upload-time prompt applies to a file, by extension. */
export function enrichmentsForFile(file: File): EnrichmentDefinition[] {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ENRICHMENT_REGISTRY.filter((d) => d.extensions.includes(ext));
}

/** Folds every registered type's objects onto the content. */
export function applyEnrichments(content: ContentData, objects: EnrichmentObject[]): ContentData {
  return ENRICHMENT_REGISTRY.reduce(
    (acc, d) => d.applyToContent(acc, objects.filter((o) => o.enrichmentObjectType === d.type)),
    content,
  );
}
