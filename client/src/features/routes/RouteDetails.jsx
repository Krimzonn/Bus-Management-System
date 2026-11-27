import { useId, useState } from "react";
import RouteDialog from "./RouteDialog.jsx";
import RouteIcon from "./RouteIcon.jsx";
import RouteStatusBadge, { ArchivedBadge } from "./RouteStatusBadge.jsx";
import { formatDateTime, routeErrorMessage } from "./routeModel.js";

function Row({ label, children }) {
  return (
    <div className="rt-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function availabilityOf(route) {
  if (route.isArchived) {
    return { ok: false, text: "Archived. Not available for new assignments." };
  }
  if (route.status === "blocked") {
    return { ok: false, text: "Blocked. Not available for new assignments." };
  }
  return { ok: true, text: "Available for new assignments." };
}

function confirmCopy(kind, route) {
  if (kind === "block") {
    return {
      title: `Block route ${route.routeCode}?`,
      text: "A blocked route can no longer be selected for new assignments. Records that already reference it are kept. You can unblock it at any time.",
      action: "Block route",
      busy: "Blocking…",
      danger: true,
    };
  }
  if (kind === "unblock") {
    return {
      title: `Unblock route ${route.routeCode}?`,
      text: "The route will become available for new assignments again.",
      action: "Unblock route",
      busy: "Unblocking…",
      danger: false,
    };
  }
  return {
    title: `Archive route ${route.routeCode}?`,
    text: "The route will leave the active list and will no longer be available for new assignments. It can no longer be edited or have its status changed. Archiving is not deletion: the record and its history are kept, and the route code can never be reused. There is no way to restore an archived route from this screen.",
    action: "Archive route",
    busy: "Archiving…",
    danger: true,
  };
}

// Presentational. onChangeStatus(route, status) and onArchive(route) are
// supplied by the page, perform the API call, and throw on failure.
// asDrawer=true renders inside a drawer (small screens); otherwise as a panel.
export default function RouteDetails({
  route,
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
  const [confirming, setConfirming] = useState(null); // "block" | "unblock" | "archive"

  async function confirmAction() {
    const kind = confirming;
    setBusy(kind);
    setError("");
    try {
      if (kind === "archive") await onArchive(route);
      else await onChangeStatus(route, kind === "block" ? "blocked" : "unblocked");
    } catch (err) {
      setError(routeErrorMessage(err));
    } finally {
      setConfirming(null);
      setBusy("");
    }
  }

  const editable = canManage && !route.isArchived;
  const availability = availabilityOf(route);
  const copy = confirming ? confirmCopy(confirming, route) : null;

  const content = (
    <>
      <header className="rt-detail-head">
        <div className="rt-detail-head-main">
          <div className="rt-badge-row">
            <RouteStatusBadge status={route.status} />
            {route.isArchived && <ArchivedBadge />}
          </div>
          <h2 className="rt-detail-title" id={titleId}>
            {route.name}
          </h2>
          <p className="rt-detail-sub">
            <span className="rt-code">{route.routeCode}</span>
          </p>
        </div>
        <button
          type="button"
          className="rt-icon-btn"
          onClick={onClose}
          aria-label="Close details"
          data-autofocus=""
        >
          <RouteIcon name="x" size={18} />
        </button>
      </header>

      <div className="rt-detail-body">
        {error && (
          <p className="bm-alert bm-alert-error" role="alert">
            {error}
          </p>
        )}

        <p
          className={`rt-availability ${availability.ok ? "rt-availability-ok" : "rt-availability-no"}`}
          role="status"
        >
          <RouteIcon name={availability.ok ? "check" : "ban"} size={16} />
          {availability.text}
        </p>

        {route.isArchived && (
          <p className="bm-alert bm-alert-info" role="status">
            This route is archived. It is kept for history but can no longer be
            edited, and its code can never be reused.
          </p>
        )}
        {!canManage && !route.isArchived && (
          <p className="bm-alert bm-alert-info" role="status">
            You have view-only access to routes.
          </p>
        )}

        <section aria-labelledby={`${uid}-details`}>
          <h3 className="rt-section-title" id={`${uid}-details`}>
            Details
          </h3>
          <dl className="rt-dl">
            <Row label="Route code">
              <span className="rt-code">{route.routeCode}</span>
            </Row>
            <Row label="Route name">{route.name}</Row>
            <Row label="Origin">{route.origin}</Row>
            <Row label="Destination">{route.destination}</Row>
            <Row label="Status">
              <RouteStatusBadge status={route.status} />
            </Row>
            <Row label="Record">{route.isArchived ? "Archived" : "Current"}</Row>
          </dl>
        </section>

        <section aria-labelledby={`${uid}-history`}>
          <h3 className="rt-section-title" id={`${uid}-history`}>
            Record history
          </h3>
          <dl className="rt-dl">
            <Row label="Created">{formatDateTime(route.createdAt)}</Row>
            <Row label="Last updated">{formatDateTime(route.updatedAt)}</Row>
            {route.isArchived && (
              <Row label="Archived">{formatDateTime(route.archivedAt)}</Row>
            )}
          </dl>
        </section>

        {editable && (
          <section aria-labelledby={`${uid}-actions`}>
            <h3 className="rt-section-title" id={`${uid}-actions`}>
              Manage route
            </h3>
            <div className="rt-actions">
              <button
                type="button"
                className="bm-btn"
                onClick={() => onEdit(route)}
                disabled={busy !== ""}
              >
                <RouteIcon name="edit" /> Edit route
              </button>
              {route.status === "unblocked" ? (
                <button
                  type="button"
                  className="bm-btn rt-btn-danger"
                  onClick={() => setConfirming("block")}
                  disabled={busy !== ""}
                >
                  <RouteIcon name="ban" /> Block route
                </button>
              ) : (
                <button
                  type="button"
                  className="bm-btn"
                  onClick={() => setConfirming("unblock")}
                  disabled={busy !== ""}
                >
                  <RouteIcon name="check" /> Unblock route
                </button>
              )}
              <button
                type="button"
                className="bm-btn rt-btn-danger"
                onClick={() => setConfirming("archive")}
                disabled={busy !== ""}
              >
                <RouteIcon name="archive" /> Archive route
              </button>
            </div>
            <p className="rt-field-hint rt-actions-hint">
              Archiving removes the route from the active list. It is not
              deletion.
            </p>
          </section>
        )}
      </div>
    </>
  );

  return (
    <>
      {asDrawer ? (
        <RouteDialog variant="drawer" labelledBy={titleId} onClose={onClose}>
          {content}
        </RouteDialog>
      ) : (
        <section className="rt-panel rt-detail" aria-labelledby={titleId}>
          {content}
        </section>
      )}

      {copy && (
        <RouteDialog
          variant="confirm"
          labelledBy={confirmTitleId}
          describedBy={confirmTextId}
          onClose={() => setConfirming(null)}
          dismissible={busy === ""}
        >
          <div className="rt-confirm">
            <h2 className="rt-dialog-title" id={confirmTitleId}>
              {copy.title}
            </h2>
            <p className="rt-confirm-text" id={confirmTextId}>
              {copy.text}
            </p>
            <div className="rt-confirm-actions">
              <button
                type="button"
                className="bm-btn"
                onClick={() => setConfirming(null)}
                disabled={busy !== ""}
                data-autofocus=""
              >
                Cancel
              </button>
              <button
                type="button"
                className={`bm-btn ${copy.danger ? "rt-btn-danger-solid" : "bm-btn-primary"}`}
                onClick={confirmAction}
                disabled={busy !== ""}
              >
                {busy !== "" ? copy.busy : copy.action}
              </button>
            </div>
          </div>
        </RouteDialog>
      )}
    </>
  );
}