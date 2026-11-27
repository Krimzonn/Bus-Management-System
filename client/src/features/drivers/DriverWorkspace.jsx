import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  archiveDriver,
  getDriver,
  listDrivers,
  setDriverStatus,
  updateDriver,
} from "../../services/api.js";
import DriverFormDialog from "./DriverFormDialog.jsx";
import DriverIcon from "./DriverIcon.jsx";
import DriverProfile from "./DriverProfile.jsx";
import DriverStatusBadge, { ArchivedBadge, LicenseBadge } from "./DriverStatusBadge.jsx";
import {
  ARCHIVE_VIEWS,
  DRIVER_STATUSES,
  LICENSE_STATES,
  PAGE_SIZE,
  driverErrorMessage,
  formatDate,
} from "./DriverModel.js";

const EMPTY_RESULT = { items: [], page: 1, limit: PAGE_SIZE, total: 0 };
// Errors meaning "your copy of this driver is out of date": reload.
const STALE_CODES = new Set(["DRIVER_NOT_FOUND", "DRIVER_ARCHIVED", "DRIVER_ALREADY_ARCHIVED"]);
// Below this width the profile opens in a drawer instead of a side panel.
const STACKED_QUERY = "(max-width: 960px)";

const defaultFilters = (scope) => ({
  q: "",
  status: "",
  licenseStatus: "",
  archived: scope === "archived" ? "true" : "false",
});

function useMediaQuery(query) {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function SkeletonRows() {
  return (
    <div className="dr-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="dr-skel-row" key={i}>
          <div className="dr-skel-lines">
            <span className="dr-skel dr-skel-short" />
            <span className="dr-skel" />
          </div>
          <span className="dr-skel dr-skel-pill" />
        </div>
      ))}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <section className="dr-panel dr-detail" aria-busy="true" aria-label="Loading driver">
      <div className="dr-detail-body" aria-hidden="true">
        <span className="dr-skel dr-skel-pill" style={{ width: 120 }} />
        <span className="dr-skel" style={{ height: 22, width: "55%" }} />
        <span className="dr-skel" style={{ height: 120 }} />
        <span className="dr-skel" style={{ height: 140 }} />
        <span className="dr-skel" style={{ height: 60 }} />
      </div>
    </section>
  );
}

function EmptyDetails({ error, archivedScope }) {
  return (
    <section className="dr-panel dr-detail dr-detail-empty" aria-label="Driver details">
      <div className="dr-state">
        <span className={`dr-state-icon${error ? " dr-state-icon-red" : ""}`}>
          <DriverIcon name={error ? "alert" : "users"} size={22} />
        </span>
        <h2 className="dr-state-title">{error ? "Couldn’t load the driver" : "No driver selected"}</h2>
        <p className="dr-state-text" role={error ? "alert" : undefined}>
          {error ||
            (archivedScope
              ? "Select an archived driver to inspect the record."
              : "Select a driver to view their profile and license.")}
        </p>
      </div>
    </section>
  );
}

// scope "directory": active drivers by default, with an archive filter.
// scope "archived": archived drivers only, shown read-only.
export default function DriverWorkspace({
  scope,
  canManage,
  asOf,
  initialId,
  reloadKey,
  onChanged,
  notify,
  onCreate,
}) {
  const archivedScope = scope === "archived";
  const stacked = useMediaQuery(STACKED_QUERY);
  const [applied, setApplied] = useState(() => defaultFilters(scope));
  const [draftQuery, setDraftQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState({ loading: Boolean(initialId), error: "" });
  const [form, setForm] = useState(null); // { driver } when editing
  const [settled, setSettled] = useState({ request: null, data: EMPTY_RESULT, error: "" });

  const request = useMemo(() => ({ applied, page, reload: reloadKey }), [applied, page, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    listDrivers({ ...request.applied, page: String(request.page), limit: String(PAGE_SIZE) })
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setSettled({ request, data: EMPTY_RESULT, error: driverErrorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  // Open a driver chosen elsewhere (License monitoring, or just created).
  useEffect(() => {
    if (!initialId) return undefined;
    let cancelled = false;
    getDriver(initialId)
      .then((driver) => {
        if (cancelled) return;
        setSelected(driver);
        setFocus({ loading: false, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setFocus({ loading: false, error: driverErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const loading = settled.request !== request;
  const { items, page: dataPage, limit, total } = settled.data;
  const error = settled.error;

  const showError = !loading && Boolean(error);
  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;
  const showList = items.length > 0;

  const hasFilters =
    Boolean(applied.q || applied.status || applied.licenseStatus) ||
    (!archivedScope && applied.archived !== "false");
  const hasDraft = Boolean(draftQuery);

  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

  // Keep the profile in step with the list: use whichever copy is newer.
  const listed = selected ? items.find((driver) => driver.id === selected.id) : null;
  const shown =
    listed && Date.parse(listed.updatedAt) > Date.parse(selected.updatedAt) ? listed : selected;

  /* ---- filters ---- */

  function applySelect(key, value) {
    setApplied((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function submitSearch(event) {
    event.preventDefault();
    setApplied((current) => ({ ...current, q: draftQuery.trim() }));
    setPage(1);
  }

  function resetFilters() {
    setDraftQuery("");
    setApplied(defaultFilters(scope));
    setPage(1);
  }

  /* ---- synchronisation ---- */

  function resyncSelected(id) {
    getDriver(id)
      .then((fresh) =>
        setSelected((current) => (current && current.id === fresh.id ? fresh : current)),
      )
      .catch((err) => {
        if (err instanceof ApiError && err.code === "DRIVER_NOT_FOUND") {
          setSelected((current) => (current && current.id === id ? null : current));
        }
      });
  }

  /* ---- mutations (the only place in this view that calls the API) ---- */

  async function run(id, action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof ApiError && STALE_CODES.has(err.code)) {
        onChanged();
        resyncSelected(id);
      }
      throw err;
    }
  }

  function applySaved(driver, text, { clear = false } = {}) {
    setSelected(clear ? null : driver);
    setForm(null);
    notify(text);
    onChanged();
  }

  const handleUpdate = (driver, changes) =>
    run(driver.id, async () => {
      const updated = await updateDriver(driver.id, changes);
      const licenseChanged = ["licenseNumber", "licenseCategory", "licenseExpiryDate"].some(
        (key) => key in changes,
      );
      applySaved(
        updated,
        licenseChanged
          ? `License details for ${updated.fullName} were updated.`
          : `${updated.fullName} was updated.`,
      );
    });

  const handleStatus = (driver, status) =>
    run(driver.id, async () => {
      const updated = await setDriverStatus(driver.id, status);
      applySaved(updated, `${updated.fullName} is now ${statusLabel(updated.status)}.`);
    });

  const handleArchive = (driver) =>
    run(driver.id, async () => {
      const updated = await archiveDriver(driver.id);
      // An archived driver leaves the active list, so the selection is cleared there.
      applySaved(updated, `${updated.fullName} was archived.`, {
        clear: applied.archived === "false",
      });
    });

  /* ---- render ---- */

  const details = shown ? (
    <DriverProfile
      key={shown.id}
      driver={shown}
      asOf={asOf}
      canManage={canManage}
      asDrawer={stacked}
      onClose={() => setSelected(null)}
      onEdit={(driver) => setForm({ driver })}
      onChangeStatus={handleStatus}
      onArchive={handleArchive}
    />
  ) : null;

  return (
    <>
      <div className="dr-split">
        <section className="dr-panel dr-list-panel" aria-busy={loading} aria-label="Drivers">
          {loading && items.length > 0 && <div className="dr-progress" aria-hidden="true" />}

          <form className="dr-filters" onSubmit={submitSearch}>
            <div className="dr-search-row">
              <div className="dr-field dr-field-grow">
                <label className="dr-label" htmlFor={`dr-q-${scope}`}>
                  Search
                </label>
                <div className="dr-search">
                  <DriverIcon name="search" className="dr-search-icon" />
                  <input
                    id={`dr-q-${scope}`}
                    className="dr-input dr-search-input"
                    type="search"
                    placeholder="Name or license number"
                    maxLength={100}
                    autoComplete="off"
                    value={draftQuery}
                    onChange={(e) => setDraftQuery(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="bm-btn bm-btn-primary">
                Search
              </button>
            </div>
            <div className="dr-filter-row">
              <div className="dr-field">
                <label className="dr-label" htmlFor={`dr-status-${scope}`}>
                  Driver status
                </label>
                <select
                  id={`dr-status-${scope}`}
                  className="dr-input dr-select"
                  value={applied.status}
                  onChange={(e) => applySelect("status", e.target.value)}
                >
                  <option value="">All</option>
                  {DRIVER_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="dr-field">
                <label className="dr-label" htmlFor={`dr-license-${scope}`}>
                  License status
                </label>
                <select
                  id={`dr-license-${scope}`}
                  className="dr-input dr-select"
                  value={applied.licenseStatus}
                  onChange={(e) => applySelect("licenseStatus", e.target.value)}
                >
                  <option value="">All</option>
                  {LICENSE_STATES.map((state) => (
                    <option key={state.value} value={state.value}>
                      {state.label}
                    </option>
                  ))}
                </select>
              </div>
              {!archivedScope && (
                <div className="dr-field">
                  <label className="dr-label" htmlFor="dr-archived">
                    Show
                  </label>
                  <select
                    id="dr-archived"
                    className="dr-input dr-select"
                    value={applied.archived}
                    onChange={(e) => applySelect("archived", e.target.value)}
                  >
                    {ARCHIVE_VIEWS.map((view) => (
                      <option key={view.value} value={view.value}>
                        {view.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                className="bm-btn dr-btn-ghost"
                onClick={resetFilters}
                disabled={!hasDraft && !hasFilters}
              >
                Reset
              </button>
            </div>
          </form>

          <div className="dr-list-head">
            <h2 className="dr-panel-title">{archivedScope ? "Archived drivers" : "Driver directory"}</h2>
            {!showSkeleton && !showError && (
              <p className="dr-panel-sub">
                {total} {total === 1 ? "driver" : "drivers"}
              </p>
            )}
          </div>

          {showSkeleton && <SkeletonRows />}

          {showError && (
            <div className="dr-state">
              <span className="dr-state-icon dr-state-icon-red">
                <DriverIcon name="alert" size={22} />
              </span>
              <h3 className="dr-state-title">Couldn’t load drivers</h3>
              <p className="dr-state-text" role="alert">
                {error}
              </p>
              <button type="button" className="bm-btn" onClick={onChanged}>
                <DriverIcon name="refresh" /> Try again
              </button>
            </div>
          )}

          {showEmpty && (
            <div className="dr-state">
              <span className="dr-state-icon">
                <DriverIcon name="inbox" size={22} />
              </span>
              {page > 1 ? (
                <>
                  <h3 className="dr-state-title">No more drivers</h3>
                  <p className="dr-state-text">
                    This page is empty. The previous page holds the last drivers.
                  </p>
                  <button type="button" className="bm-btn" onClick={() => setPage(page - 1)}>
                    <DriverIcon name="chevronLeft" /> Previous page
                  </button>
                </>
              ) : hasFilters ? (
                <>
                  <h3 className="dr-state-title">No drivers match your filters</h3>
                  <p className="dr-state-text">Try a different search or remove a filter.</p>
                  <button type="button" className="bm-btn" onClick={resetFilters}>
                    Reset filters
                  </button>
                </>
              ) : archivedScope ? (
                <>
                  <h3 className="dr-state-title">No archived drivers</h3>
                  <p className="dr-state-text">
                    Drivers you archive are kept here for history.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="dr-state-title">No drivers yet</h3>
                  <p className="dr-state-text">
                    {canManage
                      ? "Add the first driver to start building the team."
                      : "Drivers will appear here once they have been added."}
                  </p>
                  {canManage && (
                    <button type="button" className="bm-btn bm-btn-primary" onClick={onCreate}>
                      <DriverIcon name="plus" /> Add driver
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {showList && !showError && (
            <>
              <ul
                className="dr-list"
                aria-label={archivedScope ? "Archived drivers by name" : "Drivers sorted by name"}
              >
                {items.map((driver) => {
                  const isSelected = shown?.id === driver.id;
                  return (
                    <li key={driver.id}>
                      <button
                        type="button"
                        className={`dr-row${isSelected ? " is-selected" : ""}`}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => setSelected(driver)}
                      >
                        <span className="dr-row-main">
                          <span className="dr-row-top">
                            <span className="dr-row-name">{driver.fullName}</span>
                            {driver.isArchived && !archivedScope && <ArchivedBadge />}
                          </span>
                          <span className="dr-row-sub">
                            <span className="dr-code">ID #{driver.id}</span>
                            <span className="dr-dot" aria-hidden="true">·</span>
                            <span className="dr-code">{driver.licenseNumber}</span>
                          </span>
                          {archivedScope && driver.archivedAt && (
                            <span className="dr-row-sub">
                              Archived {formatDate(driver.archivedAt.slice(0, 10))}
                            </span>
                          )}
                        </span>
                        <span className="dr-row-badges">
                          <DriverStatusBadge status={driver.status} />
                          <LicenseBadge state={driver.licenseStatus} />
                        </span>
                      </button>
                    </li>
                  );
                })}
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

        {!stacked && (
          <aside className="dr-aside">
            {focus.loading ? (
              <ProfileSkeleton />
            ) : (
              (details ?? <EmptyDetails error={focus.error} archivedScope={archivedScope} />)
            )}
          </aside>
        )}
      </div>

      {stacked && details}

      {form && (
        <DriverFormDialog
          key={form.driver.id}
          mode="edit"
          driver={form.driver}
          onClose={() => setForm(null)}
          onSubmit={(changes) => handleUpdate(form.driver, changes)}
        />
      )}
    </>
  );
}

function statusLabel(status) {
  return DRIVER_STATUSES.find((s) => s.value === status)?.label.toLowerCase() ?? status;
}