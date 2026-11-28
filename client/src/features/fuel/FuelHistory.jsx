import { useEffect, useId, useState } from "react";
import { getBusFuelHistory } from "./fuelApi.js";
import { ArchivedBadge } from "./FuelBadges.jsx";
import {
  HISTORY_PAGE_SIZE,
  formatCost,
  formatDate,
  formatDateTime,
  formatLiters,
  formatOdometer,
  fuelErrorMessage,
} from "./fuelModel.js";
import "./fuel.css";

// Fuel history of one bus, oldest purchase first (chronological), shown inside
// the bus details drawer. Archived records are included and marked, and an
// archived bus keeps its history. Each entry expands to its full details.
// Read-only: records are managed on the Fuel page.
export default function FuelHistory({ busId }) {
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
    getBusFuelHistory(busId, { page: String(req.page), limit: String(HISTORY_PAGE_SIZE) })
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
          error: fuelErrorMessage(err),
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
    <section className="fu-history" aria-labelledby={titleId} aria-busy={loading}>
      <h3 className="fu-history-title" id={titleId}>
        Fuel history
      </h3>

      {data.bus?.isArchived && (
        <p className="fu-history-note">This bus is archived. Its fuel history is preserved.</p>
      )}

      {denied ? (
        <p className="fu-history-note">You do not have access to fuel records.</p>
      ) : (
        <>
          {data.error && (
            <div className="fu-history-error">
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
            <p className="fu-history-note" role="status">
              Loading fuel history…
            </p>
          )}

          {!loading && !data.error && data.items.length === 0 && (
            <p className="fu-history-note">No fuel has been recorded for this bus yet.</p>
          )}

          {data.items.length > 0 && (
            <>
              <p className="fu-history-note">
                {data.total} {data.total === 1 ? "record" : "records"}, oldest purchase first.
              </p>
              <ul className="fu-history-list">
                {data.items.map((record) => (
                  <li key={record.id}>
                    <details className="fu-hist-item">
                      <summary>
                        <span className="fu-hist-date">{formatDate(record.purchaseDate)}</span>
                        <span className="fu-hist-type">
                          {formatLiters(record.liters)} L · odometer {formatOdometer(record.odometer)}
                        </span>
                        {record.isArchived && <ArchivedBadge />}
                      </summary>
                      <dl className="fu-hist-dl">
                        <div>
                          <dt>Fuel quantity</dt>
                          <dd>{formatLiters(record.liters)} liters</dd>
                        </div>
                        <div>
                          <dt>Total cost</dt>
                          <dd>{formatCost(record.totalCost)}</dd>
                        </div>
                        <div>
                          <dt>Odometer</dt>
                          <dd>{formatOdometer(record.odometer)}</dd>
                        </div>
                        <div>
                          <dt>Record</dt>
                          <dd>{record.isArchived ? "Archived" : "Current"}</dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{formatDateTime(record.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>Last updated</dt>
                          <dd>{formatDateTime(record.updatedAt)}</dd>
                        </div>
                        {record.isArchived && (
                          <div>
                            <dt>Archived</dt>
                            <dd>{formatDateTime(record.archivedAt)}</dd>
                          </div>
                        )}
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