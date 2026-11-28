import { useEffect, useMemo, useState } from "react";
import FuelIcon from "./FuelIcon.jsx";
import { getFuelSummary } from "./fuelApi.js";
import {
  dateInRange,
  describeEfficiency,
  formatCost,
  formatLiters,
  fuelErrorMessage,
} from "./fuelModel.js";

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Default range: the first day of the current month through today (both inclusive).
function defaultRange() {
  const now = new Date();
  return {
    startDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: localDate(now),
    busId: "",
    includeArchived: false,
  };
}

function Stat({ tone, label, state, value, unit, note }) {
  return (
    <li className={`fu-stat fu-tone-${tone}`}>
      <span className="fu-stat-label">{label}</span>
      <span className="fu-stat-value">
        {state === "loading" ? (
          <span className="fu-skel fu-skel-value" />
        ) : state === "ready" ? (
          <>
            {value}
            {unit && <span className="fu-stat-unit"> {unit}</span>}
          </>
        ) : (
          "—"
        )}
      </span>
      <span className="fu-stat-note">{state === "error" ? "Unavailable" : note}</span>
    </li>
  );
}

// The authoritative totals and efficiency come from GET /fuel/summary. Nothing is
// recalculated here. Both dates are inclusive.
export default function FuelSummary({ buses, reloadKey }) {
  const [draft, setDraft] = useState(defaultRange);
  const [applied, setApplied] = useState(draft);
  const [filterError, setFilterError] = useState("");
  const [retry, setRetry] = useState(0);
  const [settled, setSettled] = useState({ request: null, data: null, error: "" });

  const request = useMemo(() => ({ applied, reloadKey, retry }), [applied, reloadKey, retry]);

  useEffect(() => {
    let cancelled = false;
    getFuelSummary({
      startDate: request.applied.startDate,
      endDate: request.applied.endDate,
      busId: request.applied.busId,
      archived: request.applied.includeArchived ? "all" : "false",
    })
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setSettled({ request, data: null, error: fuelErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const loading = settled.request !== request;
  const data = settled.data;
  const error = loading ? "" : settled.error;
  const state = loading && !data ? "loading" : error ? "error" : data ? "ready" : "loading";
  const efficiency = data ? describeEfficiency(data.efficiency) : null;
  const empty = state === "ready" && data.recordCount === 0;

  function submit(event) {
    event.preventDefault();
    const { startDate, endDate } = draft;
    if (!dateInRange(startDate) || !dateInRange(endDate)) {
      setFilterError("Enter a real start date and end date.");
      return;
    }
    if (startDate > endDate) {
      setFilterError("The start date must be on or before the end date.");
      return;
    }
    setFilterError("");
    setApplied(draft);
  }

  return (
    <section className="fu-panel fu-summary" aria-busy={loading} aria-label="Fuel summary">
      <div className="fu-panel-head">
        <h2 className="fu-panel-title">Fuel summary</h2>
        <p className="fu-panel-sub">
          Totals for the selected dates. Both the start and the end date are included.
        </p>
      </div>

      <form className="fu-filters" onSubmit={submit}>
        <div className="fu-filter-grid">
          <div className="fu-field">
            <label className="fu-label" htmlFor="fu-sum-start">
              Start date
            </label>
            <input
              id="fu-sum-start"
              type="date"
              className="fu-input"
              value={draft.startDate}
              onChange={(e) => {
                setDraft((c) => ({ ...c, startDate: e.target.value }));
                setFilterError("");
              }}
            />
          </div>
          <div className="fu-field">
            <label className="fu-label" htmlFor="fu-sum-end">
              End date
            </label>
            <input
              id="fu-sum-end"
              type="date"
              className="fu-input"
              value={draft.endDate}
              onChange={(e) => {
                setDraft((c) => ({ ...c, endDate: e.target.value }));
                setFilterError("");
              }}
            />
          </div>
          <div className="fu-field">
            <label className="fu-label" htmlFor="fu-sum-bus">
              Bus
            </label>
            <select
              id="fu-sum-bus"
              className="fu-input fu-select"
              value={draft.busId}
              onChange={(e) => setDraft((c) => ({ ...c, busId: e.target.value }))}
            >
              <option value="">All buses</option>
              {buses.map((bus) => (
                <option key={bus.id} value={bus.id}>
                  {bus.busNumber}
                  {bus.isArchived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <label className="fu-check">
            <input
              type="checkbox"
              checked={draft.includeArchived}
              onChange={(e) => setDraft((c) => ({ ...c, includeArchived: e.target.checked }))}
            />
            <span>Include archived records</span>
          </label>
        </div>
        {filterError && (
          <p className="fu-field-error" role="alert">
            {filterError}
          </p>
        )}
        <div className="fu-filter-actions">
          <button type="submit" className="bm-btn bm-btn-primary" disabled={loading}>
            {loading ? "Loading…" : "Show summary"}
          </button>
        </div>
      </form>

      {error && (
        <div className="fu-state">
          <span className="fu-state-icon fu-state-icon-red">
            <FuelIcon name="alert" size={22} />
          </span>
          <h3 className="fu-state-title">Couldn’t load the fuel summary</h3>
          <p className="fu-state-text" role="alert">
            {error}
          </p>
          <button type="button" className="bm-btn" onClick={() => setRetry((n) => n + 1)}>
            <FuelIcon name="refresh" /> Try again
          </button>
        </div>
      )}

      {!error && (
        <>
          <ul className="fu-stats" aria-label="Fuel totals for the selected range">
            <Stat
              tone="navy"
              label="Fuel records"
              state={state}
              value={data?.recordCount}
              note="In the selected range"
            />
            <Stat
              tone="amber"
              label="Total fuel"
              state={state}
              value={data ? formatLiters(data.totalLiters) : undefined}
              unit="liters"
              note="Sum of liters purchased"
            />
            <Stat
              tone="green"
              label="Total expenditure"
              state={state}
              value={data ? formatCost(data.totalCost) : undefined}
              note="No currency is configured"
            />
            <Stat
              tone={efficiency?.ok ? "navy" : "grey"}
              label="Fuel efficiency (estimate)"
              state={state}
              value={efficiency?.value}
              unit={efficiency?.unit}
              note={efficiency?.note ?? ""}
            />
          </ul>

          {empty && (
            <div className="fu-state fu-state-compact">
              <span className="fu-state-icon">
                <FuelIcon name="inbox" size={22} />
              </span>
              <h3 className="fu-state-title">No fuel records in this range</h3>
              <p className="fu-state-text">
                Choose different dates or another bus, or add a fuel record. Efficiency needs at
                least two records for a bus.
              </p>
            </div>
          )}

          {state === "ready" && data.buses.length > 0 && (
            <div className="fu-table-scroll">
              <table className="fu-table fu-table-plain">
                <caption className="fu-sr-only">Fuel totals per bus</caption>
                <thead>
                  <tr>
                    <th scope="col">Bus</th>
                    <th scope="col">Records</th>
                    <th scope="col">Liters</th>
                    <th scope="col">Total cost</th>
                    <th scope="col">Efficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buses.map((bus) => {
                    const e = describeEfficiency(bus.efficiency);
                    return (
                      <tr key={bus.busId}>
                        <td>
                          <span className="fu-bus">{bus.busNumber ?? `#${bus.busId}`}</span>
                        </td>
                        <td className="fu-num">{bus.recordCount}</td>
                        <td className="fu-num">{formatLiters(bus.totalLiters)}</td>
                        <td className="fu-num">{formatCost(bus.totalCost)}</td>
                        <td className="fu-num">{e.ok ? `${e.value} ${e.unit}` : e.value}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}