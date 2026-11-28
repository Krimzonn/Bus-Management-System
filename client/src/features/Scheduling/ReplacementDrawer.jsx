import { useEffect, useId, useState } from "react";
import ScheduleDialog from "./ScheduleDialog.jsx";
import ScheduleIcon from "./ScheduleIcon.jsx";
import { getReplacementCandidates, replaceDriver } from "./scheduleApi.js";
import {
  EMPTY_REASONS,
  REPLACEMENT_REFRESH_CODES,
  REPLACEMENT_STALE_CODES,
  formatDate,
  scheduleErrorMessage,
} from "./scheduleModel.js";
import "./replacement.css";

// Slice 8. Right-side drawer listing the drivers the backend considers eligible to
// replace the current driver, and the confirmation step for the manager's choice.
//
// The list is advisory and read-only. Nothing is assigned until the manager confirms,
// and the backend then checks everything again (status, archival, license on the
// travel date, category, overlaps), so a stale candidate is refused with a code that
// is shown here and the list is reloaded.
//
// Props:
//   schedule     the trip (with bus/driver/route summaries)
//   canReassign  true only for roles with manage-schedules (UI hint; the API enforces it)
//   onClose()    close the drawer
//   onReplaced(updatedSchedule)   called once after a successful reassignment
//   onStale(id)  called when the trip itself changed (not found / no longer editable)

function SkeletonCards() {
  return (
    <div
      className="rp-list"
      role="status"
      aria-label="Loading eligible drivers"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div className="sc-skeleton rp-skel-card" key={index} />
      ))}
    </div>
  );
}

function CandidateCard({ candidate, index, canReassign, disabled, onSelect }) {
  return (
    <li className="rp-card" style={{ "--rp-i": index }}>
      <div className="rp-card-top">
        <div>
          <h4 className="rp-card-name">{candidate.fullName}</h4>
          <p className="rp-card-id">Driver ID #{candidate.id}</p>
        </div>
        <span className="rp-eligible">
          <ScheduleIcon name="check" size={13} /> Eligible
        </span>
      </div>
      <ul className="rp-checks">
        <li>
          <ScheduleIcon
            name="checkCircle"
            size={15}
            className="rp-check-icon"
          />
          <span>Available for assignment</span>
        </li>
        <li>
          <ScheduleIcon
            name="checkCircle"
            size={15}
            className="rp-check-icon"
          />
          <span>
            License valid through {formatDate(candidate.licenseExpiryDate)},
            after the travel date
          </span>
        </li>
        <li>
          <ScheduleIcon
            name="checkCircle"
            size={15}
            className="rp-check-icon"
          />
          <span>
            Category {candidate.licenseCategory} qualified for this bus
          </span>
        </li>
        <li>
          <ScheduleIcon
            name="checkCircle"
            size={15}
            className="rp-check-icon"
          />
          <span>No overlapping trip</span>
        </li>
      </ul>
      {canReassign && (
        <div className="rp-card-foot">
          <button
            type="button"
            className="bm-btn bm-btn-primary"
            onClick={() => onSelect(candidate)}
            disabled={disabled}
            aria-label={`Select ${candidate.fullName} as replacement`}
          >
            Select driver
          </button>
        </div>
      )}
    </li>
  );
}

export default function ReplacementDrawer({
  schedule,
  canReassign,
  onClose,
  onReplaced,
  onStale,
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const confirmTitleId = `${uid}-confirm-title`;
  const confirmTextId = `${uid}-confirm-text`;

  const [reloadKey, setReloadKey] = useState(0);
  const [settled, setSettled] = useState({ key: -1, data: null, error: "" });
  const [notice, setNotice] = useState(""); // problem from the last save attempt
  const [selected, setSelected] = useState(null); // candidate awaiting confirmation
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getReplacementCandidates(schedule.id)
      .then((data) => {
        if (!cancelled) setSettled({ key: reloadKey, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled)
          setSettled({
            key: reloadKey,
            data: null,
            error: scheduleErrorMessage(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [schedule.id, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);
  const loading = settled.key !== reloadKey;
  const { data, error } = settled;
  const candidates = data?.candidates ?? [];
  const summary = data?.summary ?? null;
  const reason = data?.emptyReason
    ? (EMPTY_REASONS[data.emptyReason] ?? null)
    : null;

  const currentDriver = schedule.driver
    ? schedule.driver.fullName
    : `Driver #${schedule.driverId}`;
  const route = schedule.route;
  const overnight = schedule.arrivalDate !== schedule.travelDate;

  async function confirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setNotice("");
    try {
      const updated = await replaceDriver(schedule.id, selected.id);
      onReplaced(updated, selected);
    } catch (err) {
      setSelected(null);
      setSubmitting(false);
      setNotice(scheduleErrorMessage(err));
      if (err?.code && REPLACEMENT_STALE_CODES.has(err.code))
        onStale(schedule.id);
      // Stale candidate, or a bus/route that changed: reload so the list is truthful.
      if (
        err?.code &&
        (REPLACEMENT_REFRESH_CODES.has(err.code) ||
          REPLACEMENT_STALE_CODES.has(err.code))
      ) {
        reload();
      }
    }
  }

  return (
    <>
      <ScheduleDialog
        variant="drawer"
        labelledBy={titleId}
        onClose={onClose}
        dismissible={!submitting}
      >
        {(close) => (
          <>
            <header className="sc-detail-head">
              <div className="rp-head-main">
                <div className="sc-badge-row">
                  <span className="sc-badge sc-tone-gold">Replacement</span>
                </div>
                <h2 className="sc-detail-title" id={titleId}>
                  Find a replacement driver
                </h2>
                <p className="sc-detail-sub">
                  Trip #{schedule.id} · {formatDate(schedule.travelDate)},{" "}
                  {schedule.departureTime} → {schedule.arrivalTime}
                </p>
              </div>
              <button
                type="button"
                className="sc-icon-btn"
                onClick={close}
                disabled={submitting}
                aria-label="Close replacement drivers"
                data-autofocus=""
              >
                <ScheduleIcon name="x" size={18} />
              </button>
            </header>

            <div className="rp-body">
              <section className="rp-context" aria-label="Trip being changed">
                <div className="rp-context-item">
                  <span className="rp-context-label">Current driver</span>
                  <span className="rp-context-value">{currentDriver}</span>
                </div>
                <div className="rp-context-item">
                  <span className="rp-context-label">Bus</span>
                  <span className="rp-context-value">
                    {schedule.bus
                      ? schedule.bus.busNumber
                      : `#${schedule.busId}`}
                  </span>
                </div>
                <div className="rp-context-item">
                  <span className="rp-context-label">Route</span>
                  <span className="rp-context-value">
                    {route ? route.routeCode : `#${schedule.routeId}`}
                  </span>
                  {route && (
                    <span className="rp-context-sub">
                      {route.origin} → {route.destination}
                    </span>
                  )}
                </div>
                <div className="rp-context-item">
                  <span className="rp-context-label">Arrives</span>
                  <span className="rp-context-value">
                    {schedule.arrivalTime}
                    {overnight && " · next day"}
                  </span>
                </div>
              </section>

              {!canReassign && (
                <p className="bm-alert bm-alert-info" role="status">
                  You have view-only access. Only an Admin or Transportation
                  Manager can reassign a driver.
                </p>
              )}
              {notice && (
                <p className="bm-alert bm-alert-error" role="alert">
                  {notice} The list below has been refreshed.
                </p>
              )}

              <section aria-label="Eligible drivers" aria-busy={loading}>
                <div className="rp-list-head">
                  <h3 className="rp-list-title">
                    {loading || error
                      ? "Eligible drivers"
                      : `${candidates.length} eligible ${candidates.length === 1 ? "driver" : "drivers"}`}
                  </h3>
                  <button
                    type="button"
                    className="bm-btn sc-btn-small"
                    onClick={reload}
                    disabled={loading || submitting}
                  >
                    <ScheduleIcon
                      name="refresh"
                      className={loading ? "sc-spin" : ""}
                    />{" "}
                    Refresh
                  </button>
                </div>
                <p className="rp-hint">
                  Suggestions are advisory. You choose the driver, and
                  everything is checked again when you save.
                </p>

                <div style={{ marginTop: "0.8rem" }}>
                  {loading && !data ? (
                    <SkeletonCards />
                  ) : error && !loading ? (
                    <div className="rp-state">
                      <span className="rp-state-icon rp-state-icon-red">
                        <ScheduleIcon name="alert" size={24} />
                      </span>
                      <h4 className="rp-state-title">
                        Couldn’t load replacement drivers
                      </h4>
                      <p className="rp-state-text" role="alert">
                        {error}
                      </p>
                      <div className="rp-state-actions">
                        <button
                          type="button"
                          className="bm-btn"
                          onClick={reload}
                        >
                          <ScheduleIcon name="refresh" /> Try again
                        </button>
                      </div>
                    </div>
                  ) : data && candidates.length === 0 ? (
                    <div className="rp-state">
                      <span className="rp-state-icon">
                        <ScheduleIcon name="users" size={24} />
                      </span>
                      <h4 className="rp-state-title">
                        {reason
                          ? reason.title
                          : "No eligible replacement drivers"}
                      </h4>
                      <p className="rp-state-text">
                        {reason
                          ? reason.text
                          : "No other driver is available, qualified and free for these times."}
                      </p>
                      <div className="rp-state-actions">
                        <button
                          type="button"
                          className="bm-btn"
                          onClick={reload}
                          disabled={loading}
                        >
                          <ScheduleIcon name="refresh" /> Check again
                        </button>
                      </div>
                    </div>
                  ) : data ? (
                    <ul
                      className="rp-list"
                      aria-label="Eligible replacement drivers"
                    >
                      {candidates.map((candidate, index) => (
                        <CandidateCard
                          key={candidate.id}
                          candidate={candidate}
                          index={index}
                          canReassign={canReassign}
                          disabled={loading || submitting}
                          onSelect={setSelected}
                        />
                      ))}
                    </ul>
                  ) : null}
                </div>

                {summary && (
                  <ul
                    className="rp-funnel"
                    aria-label="How drivers were filtered"
                    style={{ marginTop: "0.8rem" }}
                  >
                    <li>{summary.evaluated} reviewed</li>
                    <li>{summary.available} available</li>
                    <li>{summary.licenseValid} valid license</li>
                    <li>{summary.categoryQualified} qualified</li>
                    <li>{summary.withoutConflict} free</li>
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </ScheduleDialog>

      {selected && (
        <ScheduleDialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setSelected(null)}
          dismissible={!submitting}
        >
          {(close) => (
            <div className="sc-confirm">
              <h2 className="sc-dialog-title" id={confirmTitleId}>
                Replace the driver on this trip?
              </h2>
              <div id={confirmTextId}>
                <p className="rp-confirm-trip">
                  Trip #{schedule.id} · {formatDate(schedule.travelDate)},{" "}
                  {schedule.departureTime} → {schedule.arrivalTime}
                </p>
                <div className="rp-swap">
                  <div className="rp-swap-side">
                    <span className="rp-swap-label">Current driver</span>
                    <span className="rp-swap-name">{currentDriver}</span>
                  </div>
                  <ScheduleIcon
                    name="arrowRight"
                    size={20}
                    className="rp-swap-arrow"
                  />
                  <div className="rp-swap-side is-new">
                    <span className="rp-swap-label">New driver</span>
                    <span className="rp-swap-name">{selected.fullName}</span>
                  </div>
                </div>
                <p className="sc-confirm-text" style={{ margin: 0 }}>
                  Only the driver changes. Eligibility and overlaps are checked
                  again when you confirm, and the change is recorded in the
                  audit log.
                </p>
              </div>
              <div
                className="rp-confirm-actions"
                style={{ marginTop: "1.1rem" }}
              >
                <button
                  type="button"
                  className="bm-btn"
                  onClick={close}
                  disabled={submitting}
                  data-autofocus=""
                >
                  Keep current driver
                </button>
                <button
                  type="button"
                  className="bm-btn bm-btn-primary"
                  onClick={confirm}
                  disabled={submitting}
                >
                  {submitting ? "Replacing…" : "Confirm replacement"}
                </button>
              </div>
            </div>
          )}
        </ScheduleDialog>
      )}
    </>
  );
}
