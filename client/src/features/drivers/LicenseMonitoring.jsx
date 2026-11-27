import { useEffect, useMemo, useState } from "react";
import { listLicenseExpiry } from "../../services/api.js";
import DriverIcon from "./DriverIcon.jsx";
import DriverStatusBadge, { LicenseBadge } from "./DriverStatusBadge.jsx";
import { LICENSE_STATES, PAGE_SIZE, daysLabel, driverErrorMessage, formatDate } from "./DriverModel.js";

const EMPTY = { items: [], page: 1, limit: PAGE_SIZE, total: 0, asOf: null };

const EMPTY_COPY = {
  expired: ["No expired licenses", "No active driver has an expired license."],
  expiring_soon: [
    "No licenses expiring soon",
    "No active driver’s license expires within the next 30 days.",
  ],
  valid: ["No valid licenses", "No active driver has a valid license right now."],
};

// Counts come from the page (real backend totals). The list below is the backend's
// own expiry classification; nothing is re-derived here. Archived drivers are
// excluded by the backend.
export default function LicenseMonitoring({ summary, reloadKey, onOpenDriver }) {
  const [state, setState] = useState("expiring_soon");
  const [page, setPage] = useState(1);
  const [settled, setSettled] = useState({ request: null, data: EMPTY, error: "" });

  const request = useMemo(() => ({ state, page, reload: reloadKey }), [state, page, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    listLicenseExpiry({ state: request.state, page: String(request.page), limit: String(PAGE_SIZE) })
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setSettled({ request, data: EMPTY, error: driverErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const loading = settled.request !== request;
  const { items, page: dataPage, limit, total, asOf, expiringSoonThrough } = settled.data;
  const error = settled.error;
  const showError = !loading && Boolean(error);
  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;
  const showList = items.length > 0 && !showError;
  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

  const countFor = (value) => {
    if (summary.status === "loading") return <span className="dr-skel dr-skel-value" />;
    if (summary.status === "error") return "—";
    return summary.data?.[value] ?? "—";
  };

  function choose(value) {
    setState(value);
    setPage(1);
  }

  return (
    <div className="dr-monitor">
      <ul className="dr-sum-grid" aria-label="License summary">
        {[
          ["expired", "Expired", "Active drivers whose license has expired"],
          ["expiring_soon", "Expiring soon", "Expire within the next 30 days, including today"],
          ["valid", "Valid", "Not expired, including those expiring soon"],
        ].map(([value, label, note]) => {
          const tone = LICENSE_STATES.find((s) => s.value === value).tone;
          return (
            <li key={value}>
              <button
                type="button"
                className={`dr-sum dr-tone-${tone}${state === value ? " is-active" : ""}`}
                aria-pressed={state === value}
                onClick={() => choose(value)}
              >
                <span className="dr-sum-label">{label}</span>
                <span className="dr-sum-value">{countFor(value)}</span>
                <span className="dr-sum-note">{note}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="dr-panel dr-list-panel" aria-busy={loading} aria-label="License monitoring">
        {loading && items.length > 0 && <div className="dr-progress" aria-hidden="true" />}
        <div className="dr-list-head">
          <h2 className="dr-panel-title">
            {LICENSE_STATES.find((s) => s.value === state).label} licenses
          </h2>
          {!showSkeleton && !showError && (
            <p className="dr-panel-sub">
              {total} {total === 1 ? "driver" : "drivers"}
              {asOf && ` · as of ${formatDate(asOf)}`}
              {state === "expiring_soon" && expiringSoonThrough && ` · through ${formatDate(expiringSoonThrough)}`}
            </p>
          )}
        </div>

        {showSkeleton && (
          <div className="dr-skel-list" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <div className="dr-skel-row" key={i}>
                <div className="dr-skel-lines">
                  <span className="dr-skel dr-skel-short" />
                  <span className="dr-skel" />
                </div>
                <span className="dr-skel dr-skel-pill" />
              </div>
            ))}
          </div>
        )}

        {showError && (
          <div className="dr-state">
            <span className="dr-state-icon dr-state-icon-red">
              <DriverIcon name="alert" size={22} />
            </span>
            <h3 className="dr-state-title">Couldn’t load licenses</h3>
            <p className="dr-state-text" role="alert">
              {error}
            </p>
            <button type="button" className="bm-btn" onClick={() => setPage((p) => p)} disabled>
              Use Refresh above to retry
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="dr-state">
            <span className="dr-state-icon">
              <DriverIcon name={state === "expired" ? "check" : "inbox"} size={22} />
            </span>
            {page > 1 ? (
              <>
                <h3 className="dr-state-title">No more drivers</h3>
                <p className="dr-state-text">This page is empty.</p>
                <button type="button" className="bm-btn" onClick={() => setPage(page - 1)}>
                  <DriverIcon name="chevronLeft" /> Previous page
                </button>
              </>
            ) : (
              <>
                <h3 className="dr-state-title">{EMPTY_COPY[state][0]}</h3>
                <p className="dr-state-text">{EMPTY_COPY[state][1]}</p>
              </>
            )}
          </div>
        )}

        {showList && (
          <>
            <ul className="dr-list" aria-label="Drivers by license expiry date">
              {items.map((driver) => (
                <li key={driver.id}>
                  <button type="button" className="dr-mon-row" onClick={() => onOpenDriver(driver.id)}>
                    <span className="dr-row-main">
                      <span className="dr-row-name">{driver.fullName}</span>
                      <span className="dr-row-sub">
                        <span className="dr-code">ID #{driver.id}</span>
                        <span className="dr-dot" aria-hidden="true">·</span>
                        <span className="dr-code">{driver.licenseNumber}</span>
                      </span>
                    </span>
                    <span className="dr-mon-expiry">
                      <span className="dr-mon-date">{formatDate(driver.licenseExpiryDate)}</span>
                      <span className="dr-row-sub">{daysLabel(driver.licenseExpiryDate, asOf)}</span>
                    </span>
                    <span className="dr-row-badges">
                      <LicenseBadge state={driver.licenseStatus} />
                      <DriverStatusBadge status={driver.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="dr-pager">
              <p className="dr-pager-info">
                Showing{" "}
                <strong>
                  {rangeStart}–{rangeEnd}
                </strong>{" "}
                of <strong>{total}</strong> · Page {dataPage}
              </p>
              <div className="dr-pager-actions">
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page - 1)}
                  disabled={loading || page === 1}
                >
                  <DriverIcon name="chevronLeft" size={14} /> Previous
                </button>
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page + 1)}
                  disabled={loading || dataPage * limit >= total}
                >
                  Next <DriverIcon name="chevronRight" size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}