import { useId, useState } from "react";
import DriverDialog from "./DriverDialog.jsx";
import DriverIcon from "./DriverIcon.jsx";
import DriverStatusBadge, { ArchivedBadge, LicenseBadge } from "./DriverStatusBadge.jsx";
import {
  DRIVER_STATUSES,
  LICENSE_BY_VALUE,
  STATUS_BY_VALUE,
  driverErrorMessage,
  formatDate,
  formatDateTime,
  licenseMessage,
} from "./DriverModel.js";

function Row({ label, children }) {
  return (
    <div className="dr-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Shown only when the driver's current profile already rules out new trips.
// Never a general Eligible / Ineligible label: eligibility is trip-specific.
function standingNote(driver) {
  if (driver.isArchived) return "This driver is archived and cannot be assigned to new trips.";
  if (driver.status === "on_leave") return "This driver is On leave and cannot be assigned to new trips.";
  if (driver.status === "absent") return "This driver is Absent and cannot be assigned to new trips.";
  return "";
}

// Presentational. onChangeStatus(driver, status) and onArchive(driver) are supplied
// by the workspace, perform the API call, and throw on failure.
export default function DriverProfile({
  driver,
  asOf,
  canManage,
  asDrawer,
  onClose,
  onEdit,
  onChangeStatus,
  onArchive,
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const confirmTitleId = `${uid}-confirm-title`;
  const confirmTextId = `${uid}-confirm-text`;

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(null); // "status" | "archive"
  const [statusChoice, setStatusChoice] = useState(driver.status);

  async function confirmAction() {
    const kind = confirming;
    setBusy(kind);
    setError("");
    try {
      if (kind === "archive") await onArchive(driver);
      else await onChangeStatus(driver, statusChoice);
    } catch (err) {
      setError(driverErrorMessage(err));
    } finally {
      setConfirming(null);
      setBusy("");
    }
  }

  const editable = canManage && !driver.isArchived;
  const licenseTone = LICENSE_BY_VALUE[driver.licenseStatus]?.tone ?? "grey";
  const note = standingNote(driver);

  const content = (close) => (
    <>
      <header className="dr-detail-head">
        <div className="dr-detail-head-main">
          <div className="dr-badge-row">
            <DriverStatusBadge status={driver.status} />
            <LicenseBadge state={driver.licenseStatus} />
            {driver.isArchived && <ArchivedBadge />}
          </div>
          <h2 className="dr-detail-title" id={titleId}>
            {driver.fullName}
          </h2>
          <p className="dr-detail-sub">Driver ID #{driver.id}</p>
        </div>
        <button
          type="button"
          className="dr-icon-btn"
          onClick={close}
          aria-label="Close details"
          data-autofocus=""
        >
          <DriverIcon name="x" size={18} />
        </button>
      </header>

      <div className="dr-detail-body">
        {error && (
          <p className="bm-alert bm-alert-error" role="alert">
            {error}
          </p>
        )}
        {driver.isArchived && (
          <p className="bm-alert bm-alert-info" role="status">
            This driver is archived. The record is kept for history but can no longer be
            edited or have its status changed.
          </p>
        )}
        {!canManage && !driver.isArchived && (
          <p className="bm-alert bm-alert-info" role="status">
            You have view-only access to drivers.
          </p>
        )}

        <section aria-labelledby={`${uid}-overview`}>
          <h3 className="dr-section-title" id={`${uid}-overview`}>
            Driver overview
          </h3>
          <dl className="dr-dl">
            <Row label="Full name">{driver.fullName}</Row>
            <Row label="Driver ID">#{driver.id}</Row>
            <Row label="Status">
              <DriverStatusBadge status={driver.status} />
            </Row>
            <Row label="Record">{driver.isArchived ? "Archived" : "Current"}</Row>
            <Row label="Created">{formatDateTime(driver.createdAt)}</Row>
            <Row label="Last updated">{formatDateTime(driver.updatedAt)}</Row>
            {driver.isArchived && <Row label="Archived">{formatDateTime(driver.archivedAt)}</Row>}
          </dl>
        </section>

        <section aria-labelledby={`${uid}-license`}>
          <h3 className="dr-section-title" id={`${uid}-license`}>
            License information
          </h3>
          <div className={`dr-license dr-tone-${licenseTone}`}>
            <div className="dr-license-top">
              <span className="dr-license-label">License number</span>
              <LicenseBadge state={driver.licenseStatus} />
            </div>
            <p className="dr-license-number">{driver.licenseNumber}</p>
            <div className="dr-license-grid">
              <div>
                <span className="dr-license-label">Category</span>
                <p className="dr-license-value">{driver.licenseCategory}</p>
              </div>
              <div>
                <span className="dr-license-label">Expiry date</span>
                <p className="dr-license-value">{formatDate(driver.licenseExpiryDate)}</p>
              </div>
            </div>
            <p className="dr-license-message" role="status">
              {licenseMessage(driver, asOf)}
            </p>
          </div>
        </section>

        <section aria-labelledby={`${uid}-qualification`}>
          <h3 className="dr-section-title" id={`${uid}-qualification`}>
            Driver qualification
          </h3>
          <div className="dr-qual">
            <p>
              Driver eligibility is evaluated against the scheduled trip date and required
              license category.
            </p>
            {note && <p className="dr-qual-note">{note}</p>}
          </div>
        </section>

        {editable && (
          <section aria-labelledby={`${uid}-actions`}>
            <h3 className="dr-section-title" id={`${uid}-actions`}>
              Manage driver
            </h3>
            <div className="dr-actions">
              <button
                type="button"
                className="bm-btn"
                onClick={() => onEdit(driver)}
                disabled={busy !== ""}
              >
                <DriverIcon name="edit" /> Edit driver
              </button>
              <button
                type="button"
                className="bm-btn"
                onClick={() => {
                  setStatusChoice(driver.status);
                  setConfirming("status");
                }}
                disabled={busy !== ""}
              >
                <DriverIcon name="clock" /> Change status
              </button>
              <button
                type="button"
                className="bm-btn dr-btn-danger"
                onClick={() => setConfirming("archive")}
                disabled={busy !== ""}
              >
                <DriverIcon name="archive" /> Archive driver
              </button>
            </div>
            <p className="dr-field-hint dr-actions-hint">
              Archiving removes the driver from the active list. It is not deletion.
            </p>
          </section>
        )}
      </div>
    </>
  );

  return (
    <>
      {asDrawer ? (
        <DriverDialog variant="drawer" labelledBy={titleId} onClose={onClose}>
          {content}
        </DriverDialog>
      ) : (
        <section className="dr-panel dr-detail dr-fade-in" aria-labelledby={titleId}>
          {content(onClose)}
        </section>
      )}

      {confirming && (
        <DriverDialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setConfirming(null)}
          dismissible={busy === ""}
        >
          {(close) => (
            <div className="dr-confirm">
              {confirming === "archive" ? (
                <>
                  <h2 className="dr-dialog-title" id={confirmTitleId}>
                    Archive {driver.fullName}?
                  </h2>
                  <p className="dr-confirm-text" id={confirmTextId}>
                    The driver will leave the active list and will be ineligible for all
                    future assignments. They can no longer be edited or have their status
                    changed. Archiving is not deletion: the record and its history are
                    kept, and the license number can never be reused. There is no way to
                    restore an archived driver from this screen.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="dr-dialog-title" id={confirmTitleId}>
                    Change status for {driver.fullName}
                  </h2>
                  <div id={confirmTextId}>
                    <fieldset className="dr-fieldset" disabled={busy !== ""}>
                      <legend className="sr-only">Driver status</legend>
                      <div className="dr-radio-group">
                        {DRIVER_STATUSES.map((status) => (
                          <label className="dr-radio" key={status.value}>
                            <input
                              type="radio"
                              name={`${uid}-status`}
                              value={status.value}
                              checked={statusChoice === status.value}
                              onChange={() => setStatusChoice(status.value)}
                            />
                            <span>{status.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <p className="dr-field-hint">
                      Drivers who are On leave or Absent cannot be assigned to new trips.
                    </p>
                  </div>
                </>
              )}
              <div className="dr-confirm-actions">
                <button
                  type="button"
                  className="bm-btn"
                  onClick={close}
                  disabled={busy !== ""}
                  data-autofocus=""
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`bm-btn ${confirming === "archive" ? "dr-btn-danger-solid" : "bm-btn-primary"}`}
                  onClick={confirmAction}
                  disabled={
                    busy !== "" ||
                    (confirming === "status" && statusChoice === driver.status)
                  }
                >
                  {confirming === "archive"
                    ? busy !== ""
                      ? "Archiving…"
                      : "Archive driver"
                    : busy !== ""
                      ? "Saving…"
                      : `Set ${STATUS_BY_VALUE[statusChoice]?.label.toLowerCase() ?? "status"}`}
                </button>
              </div>
            </div>
          )}
        </DriverDialog>
      )}
    </>
  );
}