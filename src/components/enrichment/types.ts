import type { EditorController } from '../../useEditor';
import type { EnrichmentObject } from '../../types';

/** Props every enrichment panel receives: the objects of its own type, plus the editor controller. */
export interface EnrichmentPanelProps {
  objects: EnrichmentObject[];
  ed: EditorController;
}
