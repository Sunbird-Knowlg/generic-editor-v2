import { t, tf } from '../../i18n/i18n';

export type StatusTone = 'draft' | 'review' | 'processing' | 'live' | 'failed';

export function statusTone(status?: string): StatusTone {
  switch (status) {
    case 'Draft': return 'draft';
    case 'Review': return 'review';
    case 'Processing': return 'processing';
    case 'Live': return 'live';
    case 'Failed': return 'failed';
    default: return 'draft'; // unrecognized - safest neutral treatment
  }
}

export function statusLabel(lang: string, status?: string): string {
  // Switches on the raw status (not statusTone, which already collapses anything
  // unrecognized to 'draft') so a genuinely unexpected status still reaches the
  // fallback instead of always being silently mislabeled "Draft".
  switch (status) {
    case 'Draft': return t(lang, 'STATUS_DRAFT');
    case 'Review': return t(lang, 'STATUS_NEEDS_REVIEW');
    case 'Processing': return t(lang, 'STATUS_PROCESSING');
    case 'Live': return t(lang, 'STATUS_LIVE');
    case 'Failed': return t(lang, 'STATUS_FAILED');
    default: return status || t(lang, 'STATUS_NEEDS_REVIEW');
  }
}

/** Coarse "x min/hr/day ago", falling back to '' for a missing/invalid timestamp. */
export function relativeTime(lang: string, iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return t(lang, 'TIME_JUST_NOW');
  if (mins < 60) return tf(lang, 'TIME_MINUTES_AGO', { n: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return tf(lang, 'TIME_HOURS_AGO', { n: hrs });
  const days = Math.round(hrs / 24);
  return tf(lang, days === 1 ? 'TIME_DAY_AGO' : 'TIME_DAYS_AGO', { n: days });
}
