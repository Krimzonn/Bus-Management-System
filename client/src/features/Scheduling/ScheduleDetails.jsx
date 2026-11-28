import { useId, useState } from "react";
import ReplacementDrawer from "./ReplacementDrawer.jsx";
import ScheduleDialog from "./ScheduleDialog.jsx";
import ScheduleIcon from "./ScheduleIcon.jsx";
import ScheduleStatusBadge from "./ScheduleStatusBadge.jsx";
import {
  formatDate,
  formatDateTime,
  scheduleErrorMessage,
} from "./scheduleModel.js";

function Row({ label, children }) {
  return (
    <div className="sc-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const CONFIRM = {
  start: {
    title: "Start this trip?",
    text: "The trip will be marked In progress. Status never changes by itself with the clock. Once started, the assignment can no longer be edited and the trip can no longer be cancelled.",
    action: "Start trip",
    busy: "Starting…",
  },
  complete: {
    title: "Complete this trip?",
    text: "The trip will be marked Completed and kept in the history. This cannot be undone.",
    action: "Complete trip",
    busy: "Completing…",
  },
  cancel: {
    title: "Cancel this trip?",
    text: "The trip stays in the history as Cancelled, and its bus and driver become free for those times. This cannot be undone.",
    action: "Cancel trip",
    busy: "Cancelling…",
    danger: true,
  },
};

// Presentational. onAction(schedule, "start" | "complete" | "cancel") is supplied
// by the workspace, calls the API and throws on failure. Which buttons appear
// is only a convenience: the backend allows or refuses every action itself.
//
// Slice 8: onReplaced(updatedSchedule) and onReplacementStale(id) are supplied by the
// page. The replacement action is offered only to roles with manage-schedules, and
// only while the trip has not started.
export default function ScheduleDetails({
  schedule,
  mode, // "manage" | "own"
  canManage,
  canOperate,
  asDrawer,
  onClose,
  onEdit,
  onAction,
  onReplaced,
  onReplacementStale,
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const confirmTitleId = `${uid}-confirm-title`;
  const confirmTextId = `${uid}-confirm-text`;

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null);
  const [replacing, setReplacing] = useState(false);

  async function confirmAction() {
    const kind = confirming;
    setBusy(kind);
    setError("");
    try {
      await onAction(schedule, kind);
    } catch (err) {
      setError(scheduleErrorMessage(err));
    } finally {
      setConfirming(null);
      setBusy("");
    }
  }

  const { status } = schedule;
  const manage = mode === "manage" && canManage;
  const operate = mode === "own" && canOperate;
  const canEdit = manage && status === "scheduled";
  const canStart = (manage || operate) && status === "scheduled";
  const canComplete = (manage || operate) && status === "in_progress";
  const canCancel = manage && status === "scheduled";
  const canReplace = manage && status === "scheduled";
  const hasActions =
    canEdit || canStart || canComplete || canCancel || canReplace;
  const finished = status === "completed" || status === "cancelled";
  const overnight = schedule.arrivalDate !== schedule.travelDate;
  const route = schedule.route;
  const copy = confirming ? CONFIRM[confirming] : null;

  const content = (close) => (
    <>
      <header className="sc-detail-head">
        <div className="sc-detail-head-main">
          <div className="sc-badge-row">
            <ScheduleStatusBadge status={status} />
            {overnight && (
              <span className="sc-badge sc-tone-navy">Overnight</span>
            )}
          </div>
          <h2 className="sc-detail-title" id={titleId}>
            {route
              ? `${route.routeCode} · ${route.origin} → ${route.destination}`
              : `Route #${schedule.routeId}`}
          </h2>
          <p className="sc-detail-sub">Trip #{schedule.id}</p>
        </div>
        <button
          type="button"
          className="sc-icon-btn"
          onClick={close}
          aria-label="Close details"
          data-autofocus=""
        >
          <ScheduleIcon name="x" size={18} />
        </button>
      </header>

      <div className="sc-detail-body">
        {error && (
          <p className="bm-alert bm-alert-error" role="alert">
            {error}
          </p>
        )}
        {mode === "manage" && !canManage && (
          <p className="bm-alert bm-alert-info" role="status">
            You have view-only access to schedules.
          </p>
        )}
        {finished && (
          <p className="bm-alert bm-alert-info" role="status">
            This trip is {status === "completed" ? "completed" : "cancelled"}.
            It is kept for history and can no longer be changed.
          </p>
        )}

        <section aria-labelledby={`${uid}-trip`}>
          <h3 className="sc-section-title" id={`${uid}-trip`}>
            Trip
          </h3>
          <div className="sc-trip">
            <div className="sc-trip-end">
              <span className="sc-trip-label">Departure</span>
              <span className="sc-trip-time">{schedule.departureTime}</span>
              <span className="sc-trip-date">
                {formatDate(schedule.travelDate, true)}
              </span>
            </div>
            <ScheduleIcon
              name="arrowRight"
              size={20}
              className="sc-trip-arrow"
            />
            <div className="sc-trip-end">
              <span className="sc-trip-label">Arrival</span>
              <span className="sc-trip-time">{schedule.arrivalTime}</span>
              <span className="sc-trip-date">
                {formatDate(schedule.arrivalDate, true)}
                {overnight && " · next day"}
              </span>
            </div>
          </div>
        </section>

        <section aria-labelledby={`${uid}-assign`}>
          <h3 className="sc-section-title" id={`${uid}-assign`}>
            Assignment
          </h3>
          <dl className="sc-dl">
            <Row label="Bus">
              {schedule.bus ? schedule.bus.busNumber : `#${schedule.busId}`}
            </Row>
            <Row label="Driver">
              {schedule.driver
                ? schedule.driver.fullName
                : `#${schedule.driverId}`}
            </Row>
            <Row label="Route">
              {route ? (
                <>
                  <strong>{route.routeCode}</strong> · {route.name}
                  <span className="sc-dd-sub">
                    {route.origin} → {route.destination}
                  </span>
                </>
              ) : (
                `#${schedule.routeId}`
              )}
            </Row>
          </dl>
        </section>

        <section aria-labelledby={`${uid}-record`}>
          <h3 className="sc-section-title" id={`${uid}-record`}>
            Record history
          </h3>
          <dl className="sc-dl">
            <Row label="Created">{formatDateTime(schedule.createdAt)}</Row>
            <Row label="Last updated">{formatDateTime(schedule.updatedAt)}</Row>
            {schedule.startedAt && (
              <Row label="Started">{formatDateTime(schedule.startedAt)}</Row>
            )}
            {schedule.completedAt && (
              <Row label="Completed">
                {formatDateTime(schedule.completedAt)}
              </Row>
            )}
            {schedule.cancelledAt && (
              <Row label="Cancelled">
                {formatDateTime(schedule.cancelledAt)}
              </Row>
            )}
          </dl>
        </section>

        {hasActions && (
          <section aria-labelledby={`${uid}-actions`}>
            <h3 className="sc-section-title" id={`${uid}-actions`}>
              Trip actions
            </h3>
            <div className="sc-actions">
              {canEdit && (
                <button
                  type="button"
                  className="bm-btn"
                  onClick={() => onEdit(schedule)}
                  disabled={busy !== ""}
                >
                  <ScheduleIcon name="edit" /> Edit trip
                </button>
              )}
              {canReplace && (
                <button
                  type="button"
                  className="bm-btn"
                  onClick={() => setReplacing(true)}
                  disabled={busy !== ""}
                >
                  <ScheduleIcon name="users" /> Find replacement drivers
                </button>
              )}
              {canStart && (
                <button
                  type="button"
                  className="bm-btn bm-btn-primary"
                  onClick={() => setConfirming("start")}
                  disabled={busy !== ""}
                >
                  <ScheduleIcon name="play" /> Start trip
                </button>
              )}
              {canComplete && (
                <button
                  type="button"
                  className="bm-btn bm-btn-primary"
                  onClick={() => setConfirming("complete")}
                  disabled={busy !== ""}
                >
                  <ScheduleIcon name="checkCircle" /> Complete trip
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="bm-btn sc-btn-danger"
                  onClick={() => setConfirming("cancel")}
                  disabled={busy !== ""}
                >
                  <ScheduleIcon name="ban" /> Cancel trip
                </button>
              )}
            </div>
            <p className="sc-field-hint sc-actions-hint">
              Trips change status only through these actions, never
              automatically with time.
            </p>
          </section>
        )}
      </div>
    </>
  );

  return (
    <>
      {asDrawer ? (
        <ScheduleDialog variant="drawer" labelledBy={titleId} onClose={onClose}>
          {content}
        </ScheduleDialog>
      ) : (
        <section
          className="sc-panel sc-detail sc-fade-in"
          aria-labelledby={titleId}
        >
          {content(onClose)}
        </section>
      )}

      {copy && (
        <ScheduleDialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setConfirming(null)}
          dismissible={busy === ""}
        >
          {(close) => (
            <div className="sc-confirm">
              <h2 className="sc-dialog-title" id={confirmTitleId}>
                {copy.title}
              </h2>
              <p className="sc-confirm-text" id={confirmTextId}>
                {copy.text}
              </p>
              <div className="sc-confirm-actions">
                <button
                  type="button"
                  className="bm-btn"
                  onClick={close}
                  disabled={busy !== ""}
                  data-autofocus=""
                >
                  Keep as is
                </button>
                <button
                  type="button"
                  className={`bm-btn ${copy.danger ? "sc-btn-danger-solid" : "bm-btn-primary"}`}
                  onClick={confirmAction}
                  disabled={busy !== ""}
                >
                  {busy !== "" ? copy.busy : copy.action}
                </button>
              </div>
            </div>
          )}
        </ScheduleDialog>
      )}

      {replacing && canReplace && (
        <ReplacementDrawer
          schedule={schedule}
          canReassign={canReplace}
          onClose={() => setReplacing(false)}
          onReplaced={(updated, candidate) => {
            setReplacing(false);
            onReplaced?.(updated, candidate);
          }}
          onStale={(id) => onReplacementStale?.(id)}
        />
      )}
    </>
  );
}
