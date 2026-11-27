import { STATUS_BY_VALUE } from "./routeModel.js";

export default function RouteStatusBadge({ status }) {
  const meta = STATUS_BY_VALUE[status] ?? { label: status, tone: "grey" };
  return <span className={`rt-badge rt-tone-${meta.tone}`}>{meta.label}</span>;
}

export function ArchivedBadge() {
  return <span className="rt-badge rt-badge-archived">Archived</span>;
}