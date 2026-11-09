import React from 'react';
import { statusLabel, statusTone } from './statusUtils';

/** Status dot and label shared by every enrichment panel. */
const EnrichmentStatusBadge: React.FC<{ lang: string; status?: string }> = ({ lang, status }) => (
  <span className={`ce-enrichment-status ce-enrichment-status--${statusTone(status)}`}>
    <span className="ce-enrichment-status-dot" /> {statusLabel(lang, status)}
  </span>
);

export default EnrichmentStatusBadge;
