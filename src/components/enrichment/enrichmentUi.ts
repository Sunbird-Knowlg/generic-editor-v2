import type React from 'react';
import { CaptionsIcon } from '../../icons';
import type { EnrichmentPanelProps } from './types';
import TranscriptPanel from './TranscriptPanel';

/** UI half of the enrichment registry (kept apart from services/enrichment so useEditor never imports components): header icon and drawer panel per type. */
export const ENRICHMENT_UI: Record<string, { icon: React.FC<{ size?: number }>; Panel: React.ComponentType<EnrichmentPanelProps> }> = {
  Transcript: { icon: CaptionsIcon, Panel: TranscriptPanel },
};
