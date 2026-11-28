import ScheduleIcon from "./ScheduleIcon.jsx";
import { SCHEDULE_STATUSES } from "./scheduleModel.js";

// Presentational filter bar. Filters apply as soon as they change. Bus, driver and
// route filters need the lookup lists, so drivers (who cannot list those) get only
// date and status. "Search this page" only narrows the rows already loaded: the
// schedules API has no free-text search.
export default function ScheduleFilters({
  filters,
  rangeError,
  lookups,
  showAssignmentFilters,
  search,
  onSearch,
  onChange,
  onReset,
  dirty,
}) {
  return (
    <form className="sc-filters" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
      <div className="sc-filter-grid">
        <div className="sc-field">
          <label className="sc-label" htmlFor="sc-from">From date</label>
          <input id="sc-from" type="date" className="sc-input" value={filters.dateFrom}
            onChange={(e) => onChange("dateFrom", e.target.value)} aria-invalid={rangeError} />
        </div>
        <div className="sc-field">
          <label className="sc-label" htmlFor="sc-to">To date</label>
          <input id="sc-to" type="date" className="sc-input" value={filters.dateTo}
            onChange={(e) => onChange("dateTo", e.target.value)} aria-invalid={rangeError} />
        </div>
        <div className="sc-field">
          <label className="sc-label" htmlFor="sc-status">Status</label>
          <select id="sc-status" className="sc-input sc-select" value={filters.status}
            onChange={(e) => onChange("status", e.target.value)}>
            <option value="">All statuses</option>
            {SCHEDULE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        {showAssignmentFilters && (
          <>
            <div className="sc-field">
              <label className="sc-label" htmlFor="sc-bus">Bus</label>
              <select id="sc-bus" className="sc-input sc-select" value={filters.busId}
                disabled={lookups.loading} onChange={(e) => onChange("busId", e.target.value)}>
                <option value="">All buses</option>
                {lookups.buses.map((b) => (
                  <option key={b.id} value={b.id}>{b.busNumber}{b.isArchived ? " (archived)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="sc-field">
              <label className="sc-label" htmlFor="sc-driver">Driver</label>
              <select id="sc-driver" className="sc-input sc-select" value={filters.driverId}
                disabled={lookups.loading} onChange={(e) => onChange("driverId", e.target.value)}>
                <option value="">All drivers</option>
                {lookups.drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.fullName}{d.isArchived ? " (archived)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="sc-field">
              <label className="sc-label" htmlFor="sc-route">Route</label>
              <select id="sc-route" className="sc-input sc-select" value={filters.routeId}
                disabled={lookups.loading} onChange={(e) => onChange("routeId", e.target.value)}>
                <option value="">All routes</option>
                {lookups.routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.routeCode} · {r.origin} → {r.destination}{r.isArchived ? " (archived)" : ""}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {rangeError && (
        <p className="sc-field-error" role="alert">
          “From date” must be on or before “To date”. The list still shows the last valid range.
        </p>
      )}
      {showAssignmentFilters && lookups.error && (
        <p className="sc-field-error" role="alert">
          Bus, driver and route filters are unavailable: {lookups.error}
        </p>
      )}

      <div className="sc-filter-foot">
        <div className="sc-field sc-field-grow">
          <label className="sc-label" htmlFor="sc-search">Search this page</label>
          <div className="sc-search">
            <ScheduleIcon name="search" className="sc-search-icon" />
            <input id="sc-search" type="search" className="sc-input sc-search-input"
              placeholder="Bus, driver or route on the rows below" maxLength={60}
              autoComplete="off" value={search} onChange={(e) => onSearch(e.target.value)} />
          </div>
        </div>
        <button type="button" className="bm-btn sc-btn-ghost" onClick={onReset} disabled={!dirty}>
          Reset filters
        </button>
      </div>
    </form>
  );
}
