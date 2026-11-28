import { useEffect, useId, useState } from "react";
import { getBusMaintenanceHistory } from "./maintenanceApi.js";
import { ArchivedBadge, DueBadge } from "./MaintenanceBadges.jsx";
import {
  HISTORY_PAGE_SIZE,
  dueMessage,
  formatCost,
  formatDate,
  formatOdometer,
  maintenanceErrorMessage,
} from "./maintenanceModel.js";
import "./maintenance.css";

// Maintenance history of one bus, newest service date first, shown inside the
// bus details drawer. Archived records are included and marked. An archived bus
// keeps its history. Read-only: records are managed on the Maintenance page.
export default function MaintenanceHistory({ busId }) {
  const uid = useId();
  const [req, setReq] = useState({ page: 1, n: 0 });
  const [data, setData] = useState({
    items: [],
    total: 0,
    bus: null,
    error: "",
    code: "",
    doneKey: null,
  });

  useEffect(() => {
    let cancelled = false;
    getBusMaintenanceHistory(busId, {
      page: String(req.page),
      limit: String(HISTORY_PAGE_SIZE),
    })
      .then((res) => {
        if (cancelled) return;
        setData((prev) => ({
          items: req.page === 1 ? res.items : [...prev.items, ...res.items],
          total: res.total,
          bus: res.bus,
          error: "",
          code: "",
          doneKey: req,
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setData((prev) => ({
          ...prev,
          error: maintenanceErrorMessage(err),
          code: err?.code ?? "",
          doneKey: req,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [busId, req]);

  const loading = data.doneKey !== req;
  const denied = data.code === "INSUFFICIENT_PERMISSION";
  const hasMore = data.items.length < data.total;
  const titleId = `${uid}-title`;

  return (
    <section className="mt-history" aria-labelledby={titleId} aria-busy={loading}>
      <h3 className="mt-history-title" id={titleId}>
        Maintenance history
      </h3>

      {data.bus?.isArchived && (
        <p className="mt-history-note">
          This bus is archived. Its maintenance history is preserved.
        </p>
      )}

      {denied ? (
        <p className="mt-history-note">You do not have access to maintenance records.</p>
      ) : (
        <>
          {data.error && (
            <div className="mt-history-error">
              <p className="bm-alert bm-alert-error" role="alert">
                {data.error}
              </p>
              <button
                type="button"
                className="bm-btn bm-btn-sm"
                onClick={() => setReq((r) => ({ page: r.page, n: r.n + 1 }))}
                disabled={loading}
              >
                Try again
              </button>
            </div>
          )}

          {loading && data.items.length === 0 && !data.error && (
            <p className="mt-history-note" role="status">
              Loading maintenance history…
            </p>
          )}

          {!loading && !data.error && data.items.length === 0 && (
            <p className="mt-history-note">No maintenance has been recorded for this bus yet.</p>
          )}

          {data.items.length > 0 && (
            <>
              <p className="mt-history-note">
                {data.total} {data.total === 1 ? "record" : "records"}, newest service first.
              </p>
              <ul className="mt-history-list">
                {data.items.map((record) => (
                  <li key={record.id}>
                    <details className="mt-hist-item">
                      <summary>
                        <span className="mt-hist-date">{formatDate(record.serviceDate)}</span>
                        <span className="mt-hist-type">{record.maintenanceType}</span>
                        {record.isArchived ? (
                          <ArchivedBadge />
                        ) : (
                          record.dueStatus !== "none" && <DueBadge status={record.dueStatus} />
                        )}
                      </summary>
                      <dl className="mt-hist-dl">
                        <div>
                          <dt>Work performed</dt>
                          <dd>{record.workDescription}</dd>
                        </div>
                        <div>
                          <dt>Cost</dt>
                          <dd>{formatCost(record.cost)}</dd>
                        </div>
                        <div>
                          <dt>Odometer</dt>
                          <dd>{formatOdometer(record.odometer)}</dd>
                        </div>
                        <div>
                          <dt>Next service</dt>
                          <dd>{formatDate(record.nextServiceDate)}</dd>
                        </div>
                        <div>
                          <dt>Status</dt>
                          <dd>{dueMessage(record)}</dd>
                        </div>
                      </dl>
                    </details>
                  </li>
                ))}
              </ul>
              {hasMore && (
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setReq((r) => ({ page: r.page + 1, n: r.n + 1 }))}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}