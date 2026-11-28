import { useId, useState } from "react";
import BusIcon from "./BusIcon.jsx";
import BusStatusBadge, { ArchivedBadge } from "./BusStatusBadge.jsx";
import Dialog from "./Dialog.jsx";
import { BUS_STATUSES, busErrorMessage, formatDateTime } from "./busModel.js";
import MaintenanceHistory from "../maintenance/MaintenanceHistory.jsx";
import FuelHistory from "../fuel/FuelHistory.jsx";

function Row({ label, children }) {
  return (
    <div className="bus-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Presentational. onChangeStatus(bus, status) and onArchive(bus) are supplied by
// the page, perform the API call, and throw on failure.
export default function BusDetailsDrawer({
  bus,
  canManage,
  onClose,
  onEdit,
  onChangeStatus,
  onArchive,
}) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const confirmTitleId = `${uid}-confirm-title`;
  const confirmTextId = `${uid}-confirm-text`;

  const [statusChoice, setStatusChoice] = useState(bus.status);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function saveStatus() {
    setBusy("status");
    setError("");
    try {
      await onChangeStatus(bus, statusChoice);
    } catch (err) {
      setError(busErrorMessage(err));
    } finally {
      setBusy("");
    }
  }

  async function confirmArchive() {
    setBusy("archive");
    setError("");
    try {
      await onArchive(bus);
    } catch (err) {
      setError(busErrorMessage(err));
    } finally {
      setConfirming(false);
      setBusy("");
    }
  }

  const editable = canManage && !bus.isArchived;

  return (
    <>
      <Dialog variant="drawer" labelledBy={titleId} onClose={onClose}>
        <header className="bus-dialog-head">
          <div>
            <div className="bus-badge-row">
              <BusStatusBadge status={bus.status} />
              {bus.isArchived && <ArchivedBadge />}
            </div>
            <h2 className="bus-dialog-title" id={titleId}>
              {bus.busNumber}
            </h2>
            <p className="bus-dialog-sub">
              {bus.seatingCapacity} seats · License {bus.requiredLicenseCategory}
            </p>
          </div>
          <button
            type="button"
            className="bus-icon-btn"
            onClick={onClose}
            aria-label="Close details"
            data-autofocus=""
          >
            <BusIcon name="x" size={18} />
          </button>
        </header>

        <div className="bus-dialog-body">
          {bus.isArchived && (
            <p className="bm-alert bm-alert-info" role="status">
              This bus is archived. It is kept for history but can no longer be
              edited, and its number can never be reused.
            </p>
          )}
          {!canManage && !bus.isArchived && (
            <p className="bm-alert bm-alert-info" role="status">
              You have view-only access to buses.
            </p>
          )}
          {error && (
            <p className="bm-alert bm-alert-error" role="alert">
              {error}
            </p>
          )}

          <section aria-labelledby={`${uid}-details`}>
            <h3 className="bus-section-title" id={`${uid}-details`}>
              Details
            </h3>
            <dl className="bus-dl">
              <Row label="Bus number">{bus.busNumber}</Row>
              <Row label="Seating capacity">{bus.seatingCapacity} seats</Row>
              <Row label="License category">{bus.requiredLicenseCategory}</Row>
              <Row label="Status">
                <BusStatusBadge status={bus.status} />
              </Row>
              <Row label="Record">
                {bus.isArchived ? "Archived" : "Current"}
              </Row>
            </dl>
          </section>

          <section aria-labelledby={`${uid}-history`}>
            <h3 className="bus-section-title" id={`${uid}-history`}>
              Record history
            </h3>
            <dl className="bus-dl">
              <Row label="Created">{formatDateTime(bus.createdAt)}</Row>
              <Row label="Last updated">{formatDateTime(bus.updatedAt)}</Row>
              {bus.isArchived && (
                <Row label="Archived">{formatDateTime(bus.archivedAt)}</Row>
              )}
            </dl>
          </section>

          <MaintenanceHistory busId={bus.id} />

          <FuelHistory busId={bus.id} />

          {editable && (
            <>
              <section aria-labelledby={`${uid}-edit`}>
                <h3 className="bus-section-title" id={`${uid}-edit`}>
                  Bus details
                </h3>
                <button
                  type="button"
                  className="bm-btn"
                  onClick={() => onEdit(bus)}
                  disabled={busy !== ""}
                >
                  <BusIcon name="edit" /> Edit seating capacity or category
                </button>
              </section>

              <fieldset className="bus-fieldset" disabled={busy !== ""}>
                <legend className="bus-section-title">Change status</legend>
                <div className="bus-radio-group">
                  {BUS_STATUSES.map((status) => (
                    <label className="bus-radio" key={status.value}>
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
                <p className="bus-field-hint">
                  Buses that are Inactive or Under maintenance cannot be
                  assigned to new trips.
                </p>
                <div>
                  <button
                    type="button"
                    className="bm-btn bm-btn-primary"
                    onClick={saveStatus}
                    disabled={busy !== "" || statusChoice === bus.status}
                  >
                    {busy === "status" ? "Saving…" : "Update status"}
                  </button>
                </div>
              </fieldset>

              <section
                className="bus-danger-zone"
                aria-labelledby={`${uid}-archive`}
              >
                <h3 className="bus-section-title" id={`${uid}-archive`}>
                  Archive
                </h3>
                <p className="bus-field-hint">
                  Archiving takes the bus out of the current list. It is not
                  deletion: the record and its history are kept.
                </p>
                <div>
                  <button
                    type="button"
                    className="bm-btn bus-btn-danger"
                    onClick={() => setConfirming(true)}
                    disabled={busy !== ""}
                  >
                    <BusIcon name="archive" /> Archive bus
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </Dialog>

      {confirming && (
        <Dialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setConfirming(false)}
          dismissible={busy === ""}
        >
          <div className="bus-confirm">
            <h2 className="bus-dialog-title" id={confirmTitleId}>
              Archive bus {bus.busNumber}?
            </h2>
            <p className="bus-confirm-text" id={confirmTextId}>
              The bus will leave the current list and can no longer be edited,
              have its status changed, or be assigned to new trips. Archiving is
              not deletion: the record, its history and its bus number are
              kept, and the number can never be reused. There is no way to
              restore an archived bus from this screen.
            </p>
            <div className="bus-confirm-actions">
              <button
                type="button"
                className="bm-btn"
                onClick={() => setConfirming(false)}
                disabled={busy !== ""}
                data-autofocus=""
              >
                Cancel
              </button>
              <button
                type="button"
                className="bm-btn bus-btn-danger-solid"
                onClick={confirmArchive}
                disabled={busy !== ""}
              >
                {busy === "archive" ? "Archiving…" : "Archive bus"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}