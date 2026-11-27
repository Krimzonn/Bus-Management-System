import { LICENSE_BY_VALUE, STATUS_BY_VALUE } from "./DriverModel.js";

export default function DriverStatusBadge({ status }) {
  const meta = STATUS_BY_VALUE[status] ?? { label: status, tone: "grey" };
  return <span className={`dr-badge dr-tone-${meta.tone}`}>{meta.label}</span>;
}

export function LicenseBadge({ state }) {
  const meta = LICENSE_BY_VALUE[state] ?? { label: state, tone: "grey" };
  return (
    <span className={`dr-badge dr-tone-${meta.tone}`}>License: {meta.label.toLowerCase()}</span>
  );
}

export function ArchivedBadge() {
  return <span className="dr-badge dr-badge-archived">Archived</span>;
}