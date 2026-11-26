import { STATUS_BY_VALUE } from "./busModel.js";

export default function BusStatusBadge({ status }) {
  const meta = STATUS_BY_VALUE[status] ?? { label: status, tone: "grey" };
  return <span className={`bus-badge bus-tone-${meta.tone}`}>{meta.label}</span>;
}

export function ArchivedBadge() {
  return <span className="bus-badge bus-badge-archived">Archived</span>;
}