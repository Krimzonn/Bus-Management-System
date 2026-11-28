import { useId, useState } from "react";
import MaintenanceDialog from "./MaintenanceDialog.jsx";
import MaintenanceIcon from "./MaintenanceIcon.jsx";
import { ArchivedBadge, BusArchivedBadge, DueBadge } from "./MaintenanceBadges.jsx";
import {
  dueMessage,
  dueTone,
  formatCost,
  formatDate,
  formatDateTime,
  formatOdometer,
  maintenanceErrorMessage,
} from "./maintenanceModel.js";

function Row({ label, children }) {
  return (
    <div className="mt-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Presentational drawer. onArchive(record) is supplied by the page, performs the
// API call and throws on failure. Which buttons appear is only a convenience:
// the backend allows or refuses every action itself.
export default function MaintenanceDetails({
  record,
  canManage,
  canArchive,
  onClose,
  onEdit,
  onArchive,
}) {
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
      setError(maintenanceErrorMessage(err));
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  }

  const editable = canManage && !record.isArchived;
  const archivable = canArchive && !record.isArchived;

  return (
    <>
      <MaintenanceDialog variant="drawer" labelledBy={titleId} onClose={onClose}>
        <header className="mt-dialog-head">
          <div>
            <div className="mt-badge-row">
              {record.isArchived ? <ArchivedBadge /> : <DueBadge status={record.dueStatus} />}
              {record.isBusArchived && <BusArchivedBadge />}
            </div>
            <h2 className="mt-dialog-title" id={titleId}>
              {record.maintenanceType}
            </h2>
            <p className="mt-dialog-sub">
              Bus {record.busNumber} · {formatDate(record.serviceDate)}
            </p>
          </div>
          <button
            type="button"
            className="mt-icon-btn"
            onClick={onClose}
            aria-label="Close details"
            data-autofocus=""
          >
            <MaintenanceIcon name="x" size={18} />
          </button>
        </header>

        <div className="mt-dialog-body">
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
              You have view-only access to maintenance records.
            </p>
          )}

          <p className={`mt-due mt-tone-${dueTone(record)}`} role="status">
            {dueMessage(record)}
          </p>

          <section aria-labelledby={`${uid}-details`}>
            <h3 className="mt-section-title" id={`${uid}-details`}>
              Service details
            </h3>
            <dl className="mt-dl">
              <Row label="Bus">
                {record.busNumber}
                {record.isBusArchived && <span className="mt-dd-sub">This bus is archived.</span>}
              </Row>
              <Row label="Service date">{formatDate(record.serviceDate)}</Row>
              <Row label="Maintenance type">{record.maintenanceType}</Row>
              <Row label="Work description">{record.workDescription}</Row>
              <Row label="Cost">{formatCost(record.cost)}</Row>
              <Row label="Odometer">{formatOdometer(record.odometer)}</Row>
              <Row label="Next service">{formatDate(record.nextServiceDate)}</Row>
              <Row label="Record">{record.isArchived ? "Archived" : "Current"}</Row>
            </dl>
          </section>

          <section aria-labelledby={`${uid}-history`}>
            <h3 className="mt-section-title" id={`${uid}-history`}>
              Record history
            </h3>
            <dl className="mt-dl">
              <Row label="Created">
                {formatDateTime(record.createdAt)}
                {record.createdBy && (
                  <span className="mt-dd-sub">By account #{record.createdBy}</span>
                )}
              </Row>
              <Row label="Last updated">
                {formatDateTime(record.updatedAt)}
                {record.updatedBy && (
                  <span className="mt-dd-sub">By account #{record.updatedBy}</span>
                )}
              </Row>
              {record.isArchived && (
                <Row label="Archived">
                  {formatDateTime(record.archivedAt)}
                  {record.archivedBy && (
                    <span className="mt-dd-sub">By account #{record.archivedBy}</span>
                  )}
                </Row>
              )}
            </dl>
          </section>

          {(editable || archivable) && (
            <section aria-labelledby={`${uid}-actions`}>
              <h3 className="mt-section-title" id={`${uid}-actions`}>
                Manage record
              </h3>
              <div className="mt-actions">
                {editable && (
                  <button
                    type="button"
                    className="bm-btn"
                    onClick={() => onEdit(record)}
                    disabled={busy}
                  >
                    <MaintenanceIcon name="edit" /> Edit record
                  </button>
                )}
                {archivable && (
                  <button
                    type="button"
                    className="bm-btn mt-btn-danger"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                  >
                    <MaintenanceIcon name="archive" /> Archive record
                  </button>
                )}
              </div>
              {archivable && (
                <p className="mt-field-hint mt-actions-hint">
                  Archiving removes the record from the active lists. It is not deletion.
                </p>
              )}
            </section>
          )}
        </div>
      </MaintenanceDialog>

      {confirming && (
        <MaintenanceDialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setConfirming(false)}
          dismissible={!busy}
        >
          <div className="mt-confirm">
            <h2 className="mt-dialog-title" id={confirmTitleId}>
              Archive this maintenance record?
            </h2>
            <p className="mt-confirm-text" id={confirmTextId}>
              The record for bus {record.busNumber} ({record.maintenanceType},{" "}
              {formatDate(record.serviceDate)}) will leave the active and due lists and can no
              longer be edited. Archiving is not deletion: the record stays in the bus’s
              maintenance history, marked as archived. There is no way to restore it from this
              screen.
            </p>
            <div className="mt-confirm-actions">
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
                className="bm-btn mt-btn-danger-solid"
                onClick={confirmArchive}
                disabled={busy}
              >
                {busy ? "Archiving…" : "Archive record"}
              </button>
            </div>
          </div>
        </MaintenanceDialog>
      )}
    </>
  );
}