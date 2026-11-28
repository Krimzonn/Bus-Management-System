import { DUE_META } from "./maintenanceModel.js";

// Only overdue and upcoming records get a badge. Everything else has no due
// status to show.
export function DueBadge({ status }) {
  const meta = DUE_META[status];
  if (!meta) return <span className="mt-muted" aria-label="No due status">—</span>;
  return <span className={`mt-badge mt-tone-${meta.tone}`}>{meta.label}</span>;
}

export function ArchivedBadge() {
  return <span className="mt-badge mt-badge-archived">Archived</span>;
}

export function BusArchivedBadge() {
  return <span className="mt-badge mt-badge-archived">Archived bus</span>;
}