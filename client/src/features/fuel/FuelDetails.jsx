import { useId, useState } from "react";
import FuelDialog from "./FuelDialog.jsx";
import FuelIcon from "./FuelIcon.jsx";
import { ArchivedBadge, BusArchivedBadge } from "./FuelBadges.jsx";
import {
  formatCost,
  formatDate,
  formatDateTime,
  formatLiters,
  formatOdometer,
  fuelErrorMessage,
} from "./fuelModel.js";

function Row({ label, children }) {
  return (
    <div className="fu-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Presentational drawer. onArchive(record) is supplied by the page, performs the
// API call and throws on failure. Which buttons appear is only a convenience:
// the backend allows or refuses every action itself.
export default function FuelDetails({ record, canManage, canArchive, onClose, onEdit, onArchive }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const confirmTitleId = `${uid}-confirm-title`;
  const confirmTextId = `${uid}-confirm-text`;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function confirmArchive() {
    setBusy(true);
    setError("");
    try {
      await onArchive(record);
    } catch (err) {
      setError(fuelErrorMessage(err));
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  }

  const editable = canManage && !record.isArchived;
  const archivable = canArchive && !record.isArchived;

  return (
    <>
      <FuelDialog variant="drawer" labelledBy={titleId} onClose={onClose}>
        <header className="fu-dialog-head">
          <div>
            <div className="fu-badge-row">
              {record.isArchived && <ArchivedBadge />}
              {record.isBusArchived && <BusArchivedBadge />}
            </div>
            <h2 className="fu-dialog-title" id={titleId}>
              Bus {record.busNumber}
            </h2>
            <p className="fu-dialog-sub">
              {formatDate(record.purchaseDate)} · {formatLiters(record.liters)} liters
            </p>
          </div>
          <button
            type="button"
            className="fu-icon-btn"
            onClick={onClose}
            aria-label="Close details"
            data-autofocus=""
          >
            <FuelIcon name="x" size={18} />
          </button>
        </header>

        <div className="fu-dialog-body">
          {error && (
            <p className="bm-alert bm-alert-error" role="alert">
              {error}
            </p>
          )}
          {record.isArchived && (
            <p className="bm-alert bm-alert-info" role="status">
              This record is archived. It is kept for history but can no longer be edited.
            </p>
          )}
          {!canManage && !record.isArchived && (
            <p className="bm-alert bm-alert-info" role="status">
              You have view-only access to fuel records.
            </p>
          )}

          <section aria-labelledby={`${uid}-details`}>
            <h3 className="fu-section-title" id={`${uid}-details`}>
              Purchase details
            </h3>
            <dl className="fu-dl">
              <Row label="Bus">
                {record.busNumber}
                {record.isBusArchived && <span className="fu-dd-sub">This bus is archived.</span>}
              </Row>
              <Row label="Purchase date">{formatDate(record.purchaseDate)}</Row>
              <Row label="Fuel quantity">{formatLiters(record.liters)} liters</Row>
              <Row label="Total cost">{formatCost(record.totalCost)}</Row>
              <Row label="Odometer">{formatOdometer(record.odometer)}</Row>
              <Row label="Record">{record.isArchived ? "Archived" : "Current"}</Row>
            </dl>
          </section>

          <section aria-labelledby={`${uid}-history`}>
            <h3 className="fu-section-title" id={`${uid}-history`}>
              Record history
            </h3>
            <dl className="fu-dl">
              <Row label="Created">
                {formatDateTime(record.createdAt)}
                {record.createdBy && <span className="fu-dd-sub">By account #{record.createdBy}</span>}
              </Row>
              <Row label="Last updated">
                {formatDateTime(record.updatedAt)}
                {record.updatedBy && <span className="fu-dd-sub">By account #{record.updatedBy}</span>}
              </Row>
              {record.isArchived && (
                <Row label="Archived">
                  {formatDateTime(record.archivedAt)}
                  {record.archivedBy && (
                    <span className="fu-dd-sub">By account #{record.archivedBy}</span>
                  )}
                </Row>
              )}
            </dl>
          </section>

          {(editable || archivable) && (
            <section aria-labelledby={`${uid}-actions`}>
              <h3 className="fu-section-title" id={`${uid}-actions`}>
                Manage record
              </h3>
              <div className="fu-actions">
                {editable && (
                  <button
                    type="button"
                    className="bm-btn"
                    onClick={() => onEdit(record)}
                    disabled={busy}
                  >
                    <FuelIcon name="edit" /> Edit record
                  </button>
                )}
                {archivable && (
                  <button
                    type="button"
                    className="bm-btn fu-btn-danger"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                  >
                    <FuelIcon name="archive" /> Archive record
                  </button>
                )}
              </div>
              {archivable && (
                <p className="fu-field-hint fu-actions-hint">
                  Archiving removes the record from the active lists. It is not deletion.
                </p>
              )}
            </section>
          )}
        </div>
      </FuelDialog>

      {confirming && (
        <FuelDialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setConfirming(false)}
          dismissible={!busy}
        >
          <div className="fu-confirm">
            <h2 className="fu-dialog-title" id={confirmTitleId}>
              Archive this fuel record?
            </h2>
            <p className="fu-confirm-text" id={confirmTextId}>
              The record for bus {record.busNumber} ({formatDate(record.purchaseDate)},{" "}
              {formatLiters(record.liters)} liters) will leave the active lists and can no longer be
              edited. It also stops counting toward the active odometer sequence and the default
              summary. Archiving is not deletion: the record stays in the bus’s fuel history, marked
              as archived. There is no way to restore it from this screen.
            </p>
            <div className="fu-confirm-actions">
              <button
                type="button"
                className="bm-btn"
                onClick={() => setConfirming(false)}
                disabled={busy}
                data-autofocus=""
              >
                Cancel
              </button>
              <button
                type="button"
                className="bm-btn fu-btn-danger-solid"
                onClick={confirmArchive}
                disabled={busy}
              >
                {busy ? "Archiving…" : "Archive record"}
              </button>
            </div>
          </div>
        </FuelDialog>
      )}
    </>
  );
}