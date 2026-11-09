import React from 'react';
import Drawer from '../Drawer';
import type { EditorController } from '../../useEditor';
import { t } from '../../i18n/i18n';
import { CaptionsIcon, RefreshIcon } from '../../icons';
import { enrichmentDefinition } from '../../services/enrichment/registry';
import { ENRICHMENT_UI } from './enrichmentUi';

/** Drawer shell shared by every enrichment type: title and body come from the registry and the type's panel. */
const EnrichmentsDrawer: React.FC<{ ed: EditorController }> = ({ ed }) => {
  const { lang, drawer, setDrawer, enrichmentDrawerType, enrichmentObjects, enrichmentsLoading, enrichmentsError, reloadEnrichments } = ed;
  const type = enrichmentDrawerType;
  const def = type ? enrichmentDefinition(type) : undefined;
  const ui = type ? ENRICHMENT_UI[type] : undefined;
  const Icon = ui?.icon ?? CaptionsIcon;

  const body = !ui || !type ? null : enrichmentsLoading && enrichmentObjects.length === 0 ? (
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

  // The list is fetched once per open (no polling), so a Processing status only changes on refresh.
  // Hidden while the first load runs or after an error, where the body already shows a spinner or Retry.
  const canRefresh = !!ui && !enrichmentsError && !(enrichmentsLoading && enrichmentObjects.length === 0);
  const refreshButton = canRefresh ? (
    <button
      type="button"
      className="ce-icon-btn"
      onClick={reloadEnrichments}
      disabled={enrichmentsLoading}
      aria-label={t(lang, 'REFRESH')}
      title={t(lang, 'REFRESH')}
    >
      <RefreshIcon size={14} />
    </button>
  ) : undefined;

  return (
    <Drawer
      open={drawer === 'enrichments'}
      onClose={() => setDrawer(null)}
      titleIcon={<Icon size={18} />}
      title={def ? t(lang, def.drawerTitleKey) : ''}
      closeLabel={t(lang, 'CLOSE')}
      className="ce-drawer--enrichments"
      headerAction={refreshButton}
    >
      {body}
    </Drawer>
  );
};

export default EnrichmentsDrawer;
