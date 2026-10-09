import React from 'react';
import Drawer from '../Drawer';
import type { EditorController } from '../../useEditor';
import { t } from '../../i18n/i18n';
import { CaptionsIcon } from '../../icons';
import { enrichmentDefinition } from '../../services/enrichment/registry';
import { ENRICHMENT_UI } from './enrichmentUi';

/** Drawer shell shared by every enrichment type: title and body come from the registry and the type's panel. */
const EnrichmentsDrawer: React.FC<{ ed: EditorController }> = ({ ed }) => {
  const { lang, drawer, setDrawer, enrichmentDrawerType, enrichmentObjects, enrichmentsLoading, enrichmentsError, reloadEnrichments } = ed;
  const type = enrichmentDrawerType;
  const def = type ? enrichmentDefinition(type) : undefined;
  const ui = type ? ENRICHMENT_UI[type] : undefined;
  const Icon = ui?.icon ?? CaptionsIcon;

  const body = !ui || !type ? null : enrichmentsLoading ? (
    <div className="ce-center" style={{ padding: 40 }}>
      <div className="ce-spinner ce-spinner--sm" />
    </div>
  ) : enrichmentsError ? (
    <div className="ce-enrichments-empty">
      <Icon size={28} />
      <p className="ce-enrichments-empty-title">{t(lang, def?.loadErrorKey ?? 'ERROR_GENERIC')}</p>
      <button type="button" className="ce-btn ce-btn--ghost" onClick={reloadEnrichments} style={{ marginTop: 12 }}>
        {t(lang, 'RETRY')}
      </button>
    </div>
  ) : (
    <ui.Panel ed={ed} objects={enrichmentObjects.filter((o) => o.enrichmentObjectType === type)} />
  );

  return (
    <Drawer
      open={drawer === 'enrichments'}
      onClose={() => setDrawer(null)}
      titleIcon={<Icon size={18} />}
      title={def ? t(lang, def.drawerTitleKey) : ''}
      closeLabel={t(lang, 'CLOSE')}
      className="ce-drawer--enrichments"
    >
      {body}
    </Drawer>
  );
};

export default EnrichmentsDrawer;
