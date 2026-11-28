import { STATUS_BY_VALUE } from "./scheduleModel.js";

export default function ScheduleStatusBadge({ status }) {
  const meta = STATUS_BY_VALUE[status] ?? { label: status, tone: "grey" };
  return <span className={`sc-badge sc-tone-${meta.tone}`}>{meta.label}</span>;
}
