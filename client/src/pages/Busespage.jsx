import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  archiveBus,
  createBus,
  listBuses,
  setBusStatus,
  updateBus,
} from "../services/api.js";
import { CAPABILITIES, can } from "../utils/permissions.js";
import BusDetailsDrawer from "../features/buses/BusDetailsDrawer.jsx";
import BusFormDialog from "../features/buses/BusFormDialog.jsx";
import BusIcon from "../features/buses/BusIcon.jsx";
import BusStatusBadge, {
  ArchivedBadge,
} from "../features/buses/BusStatusBadge.jsx";
import {
  ARCHIVE_VIEWS,
  BUS_STATUSES,
  PAGE_SIZE,
  busErrorMessage,
  normalizeToken,
  validateCategory,
} from "../features/buses/busModel.js";
import "../features/buses/buses.css";

const EMPTY_RESULT = { items: [], page: 1, limit: PAGE_SIZE, total: 0 };
const DEFAULT_FILTERS = {
  q: "",
  status: "",
  requiredLicenseCategory: "",
  archived: "false",
};
// Errors meaning "your copy of this bus is out of date": reload the list.
const STALE_CODES = new Set([
  "BUS_NOT_FOUND",
  "BUS_ARCHIVED",
  "BUS_ALREADY_ARCHIVED",
]);

function SkeletonRows() {
  return (
    <div className="bus-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="bus-skel-row" key={i}>
          <span className="bus-skel" />
          <span className="bus-skel" />
          <span className="bus-skel" />
          <span className="bus-skel bus-skel-pill" />
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, note, state }) {
  return (
    <li className="bus-stat">
      <span className="bus-stat-label">{label}</span>
      <span className="bus-stat-value">
        {state === "loading" ? (
          <span className="bus-skel bus-skel-value" />
        ) : state === "ready" ? (
          value
        ) : (
          "—"
        )}
      </span>
      <span className="bus-stat-note">{note}</span>
    </li>
  );
}

function NoAccess() {
  return (
    <div className="bus-page">
      <section className="bus-panel">
        <div className="bus-state">
          <span className="bus-state-icon">
            <BusIcon name="lock" size={22} />
          </span>
          <h2 className="bus-state-title">Bus management is not available</h2>
          <p className="bus-state-text">
            Your role does not include access to bus records. Ask an Admin if
            you think this is a mistake.
          </p>
        </div>
      </section>
    </div>
  );
}

function BusesWorkspace({ canManage }) {
  const [applied, setApplied] = useState(DEFAULT_FILTERS); // sent to the API
  const [draft, setDraft] = useState({ q: "", requiredLicenseCategory: "" });
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [reloadCount, setReloadCount] = useState(0);
  const [selected, setSelected] = useState(null); // bus shown in the drawer
  const [form, setForm] = useState(null); // { mode: "create" | "edit", bus? }
  const [toast, setToast] = useState(null);
  const [settled, setSettled] = useState({
    request: null,
    data: EMPTY_RESULT,
    error: "",
  });

  const request = useMemo(
    () => ({ applied, page, reload: reloadCount }),
    [applied, page, reloadCount],
  );

  useEffect(() => {
    let cancelled = false;
    listBuses({
      ...request.applied,
      page: String(request.page),
      limit: String(PAGE_SIZE),
    })
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setSettled({
            request,
            data: EMPTY_RESULT,
            error: busErrorMessage(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loading = settled.request !== request;
  const { items, page: dataPage, limit, total } = settled.data;
  const error = settled.error;

  const showError = !loading && Boolean(error);
  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;
  const showTable = items.length > 0;
  const statState = showSkeleton ? "loading" : showError ? "unavailable" : "ready";

  const hasFilters =
    Boolean(applied.q || applied.status || applied.requiredLicenseCategory) ||
    applied.archived !== "false";
  const hasDraft = Boolean(draft.q || draft.requiredLicenseCategory);

  const counts = useMemo(() => {
    const result = { active: 0, under_maintenance: 0, inactive: 0 };
    for (const bus of items) result[bus.status] += 1;
    return result;
  }, [items]);

  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

  /* ---- filters ---- */

  function applySelect(key, value) {
    setApplied((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function submitFilters(event) {
    event.preventDefault();
    const category = normalizeToken(draft.requiredLicenseCategory);
    const problem = category ? validateCategory(category) : "";
    if (problem) {
      setFilterError(problem);
      return;
    }
    setFilterError("");
    setApplied((current) => ({
      ...current,
      q: draft.q.trim(),
      requiredLicenseCategory: category,
    }));
    setPage(1);
  }

  function resetFilters() {
    setDraft({ q: "", requiredLicenseCategory: "" });
    setFilterError("");
    setApplied(DEFAULT_FILTERS);
    setPage(1);
  }

  const refresh = () => setReloadCount((count) => count + 1);

  /* ---- mutations (the only place that calls the API) ---- */

  async function run(action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof ApiError && STALE_CODES.has(err.code)) refresh();
      throw err;
    }
  }

  function applySaved(bus, text, { open = false } = {}) {
    setSelected((current) =>
      open ? bus : current && current.id === bus.id ? bus : current,
    );
    setForm(null);
    setToast({ id: Date.now(), text });
    refresh();
  }

  const handleCreate = (input) =>
    run(async () => {
      const bus = await createBus(input);
      applySaved(bus, `Bus ${bus.busNumber} was added.`, { open: true });
    });

  const handleUpdate = (bus, changes) =>
    run(async () => {
      const updated = await updateBus(bus.id, changes);
      applySaved(updated, `Bus ${updated.busNumber} was updated.`);
    });

  const handleStatus = (bus, status) =>
    run(async () => {
      const updated = await setBusStatus(bus.id, status);
      applySaved(updated, `Bus ${updated.busNumber} status updated.`);
    });

  const handleArchive = (bus) =>
    run(async () => {
      const updated = await archiveBus(bus.id);
      applySaved(updated, `Bus ${updated.busNumber} was archived.`);
    });

  /* ---- render ---- */

  return (
    <div className="bus-page">
      <header className="bus-header">
        <div>
          <div className="bus-title-row">
            <h1 className="bus-title">Bus management</h1>
            {!canManage && <span className="bus-pill">View only</span>}
          </div>
          <p className="bus-subtitle">
            Maintain the fleet: bus numbers, seating, required license category
            and status.
          </p>
        </div>
        <div className="bus-header-actions">
          <button
            type="button"
            className="bm-btn"
            onClick={refresh}
            disabled={loading}
          >
            <BusIcon name="refresh" className={loading ? "bus-spin" : ""} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canManage && (
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              onClick={() => setForm({ mode: "create" })}
            >
              <BusIcon name="plus" /> Add bus
            </button>
          )}
        </div>
      </header>

      <p className="sr-only" role="status">
        {loading ? "Loading buses…" : ""}
      </p>

      <ul className="bus-stats" aria-label="Summary">
        <StatCard
          label="Buses found"
          value={total}
          note="Matching the current filters"
          state={statState}
        />
        <StatCard
          label="Active"
          value={counts.active}
          note="On this page"
          state={statState}
        />
        <StatCard
          label="Under maintenance"
          value={counts.under_maintenance}
          note="On this page"
          state={statState}
        />
        <StatCard
          label="Inactive"
          value={counts.inactive}
          note="On this page"
          state={statState}
        />
      </ul>

      <section className="bus-panel" aria-label="Filters">
        <form className="bus-filters" onSubmit={submitFilters}>
          <div className="bus-filter-grid">
            <div className="bus-field">
              <label className="bus-label" htmlFor="bus-q">
                Bus number
              </label>
              <div className="bus-search">
                <BusIcon name="search" className="bus-search-icon" />
                <input
                  id="bus-q"
                  className="bus-input bus-search-input"
                  type="search"
                  placeholder="Search by bus number"
                  maxLength={30}
                  autoComplete="off"
                  value={draft.q}
                  onChange={(e) =>
                    setDraft((c) => ({ ...c, q: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="bus-field">
              <label className="bus-label" htmlFor="bus-category">
                License category
              </label>
              <input
                id="bus-category"
                className="bus-input"
                placeholder="e.g. HTV"
                maxLength={20}
                autoComplete="off"
                value={draft.requiredLicenseCategory}
                aria-invalid={Boolean(filterError)}
                aria-describedby={filterError ? "bus-filter-error" : undefined}
                onChange={(e) => {
                  setDraft((c) => ({
                    ...c,
                    requiredLicenseCategory: e.target.value,
                  }));
                  setFilterError("");
                }}
              />
            </div>
            <div className="bus-field">
              <label className="bus-label" htmlFor="bus-status">
                Status
              </label>
              <select
                id="bus-status"
                className="bus-input bus-select"
                value={applied.status}
                onChange={(e) => applySelect("status", e.target.value)}
              >
                <option value="">All statuses</option>
                {BUS_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="bus-field">
              <label className="bus-label" htmlFor="bus-archived">
                Show
              </label>
              <select
                id="bus-archived"
                className="bus-input bus-select"
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
          </div>

          {filterError && (
            <p className="bus-field-error" id="bus-filter-error" role="alert">
              {filterError}
            </p>
          )}

          <div className="bus-filter-actions">
            <button
              type="button"
              className="bm-btn bus-btn-ghost"
              onClick={resetFilters}
              disabled={!hasDraft && !hasFilters}
            >
              Reset
            </button>
            <button type="submit" className="bm-btn bm-btn-primary">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section className="bus-panel" aria-busy={loading} aria-label="Buses">
        {loading && items.length > 0 && (
          <div className="bus-progress" aria-hidden="true" />
        )}

        <div className="bus-panel-head">
          <h2 className="bus-panel-title">Fleet</h2>
          <p className="bus-panel-sub">
            {applied.archived === "true"
              ? "Archived buses are kept for history."
              : "Select a bus to see its details."}
          </p>
        </div>

        {showSkeleton && <SkeletonRows />}

        {showError && (
          <div className="bus-state">
            <span className="bus-state-icon bus-state-icon-red">
              <BusIcon name="alert" size={22} />
            </span>
            <h3 className="bus-state-title">Couldn’t load buses</h3>
            <p className="bus-state-text" role="alert">
              {error}
            </p>
            <button type="button" className="bm-btn" onClick={refresh}>
              <BusIcon name="refresh" /> Try again
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="bus-state">
            <span className="bus-state-icon">
              <BusIcon name="inbox" size={22} />
            </span>
            {page > 1 ? (
              <>
                <h3 className="bus-state-title">No more buses</h3>
                <p className="bus-state-text">
                  This page is empty. The previous page holds the last buses.
                </p>
                <button
                  type="button"
                  className="bm-btn"
                  onClick={() => setPage(page - 1)}
                >
                  <BusIcon name="chevronLeft" /> Previous page
                </button>
              </>
            ) : hasFilters ? (
              <>
                <h3 className="bus-state-title">No buses match your filters</h3>
                <p className="bus-state-text">
                  Try a different search or remove a filter.
                </p>
                <button type="button" className="bm-btn" onClick={resetFilters}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <h3 className="bus-state-title">No buses yet</h3>
                <p className="bus-state-text">
                  {canManage
                    ? "Add the first bus to start building the fleet."
                    : "Buses will appear here once they have been added."}
                </p>
                {canManage && (
                  <button
                    type="button"
                    className="bm-btn bm-btn-primary"
                    onClick={() => setForm({ mode: "create" })}
                  >
                    <BusIcon name="plus" /> Add bus
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {showTable && !showError && (
          <>
            <div className="bus-table-scroll">
              <table className="bus-table">
                <caption className="sr-only">Buses sorted by bus number</caption>
                <thead>
                  <tr>
                    <th scope="col">Bus number</th>
                    <th scope="col">Seats</th>
                    <th scope="col">License category</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((bus) => (
                    <tr
                      key={bus.id}
                      className={selected?.id === bus.id ? "is-selected" : ""}
                      onClick={() => {
                        if (!window.getSelection()?.toString()) setSelected(bus);
                      }}
                    >
                      <td className="bus-td-number">
                        <span className="bus-number">
                          <span className="bus-number-text">
                            {bus.busNumber}
                          </span>
                          {bus.isArchived && <ArchivedBadge />}
                        </span>
                      </td>
                      <td className="bus-td-capacity" data-label="Seats">
                        {bus.seatingCapacity}
                      </td>
                      <td className="bus-td-category" data-label="License">
                        <span className="bus-category">
                          {bus.requiredLicenseCategory}
                        </span>
                      </td>
                      <td className="bus-td-status">
                        <BusStatusBadge status={bus.status} />
                      </td>
                      <td className="bus-td-actions">
                        <span className="bus-row-actions">
                          <button
                            type="button"
                            className="bm-btn bm-btn-sm"
                            aria-label={`View details for bus ${bus.busNumber}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(bus);
                            }}
                          >
                            View
                          </button>
                          {canManage && !bus.isArchived && (
                            <button
                              type="button"
                              className="bm-btn bm-btn-sm"
                              aria-label={`Edit bus ${bus.busNumber}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setForm({ mode: "edit", bus });
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bus-pager">
              <p className="bus-pager-info">
                Showing{" "}
                <strong>
                  {rangeStart}–{rangeEnd}
                </strong>{" "}
                of <strong>{total}</strong> · Page {dataPage}
              </p>
              <div className="bus-pager-actions">
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page - 1)}
                  disabled={loading || page === 1}
                >
                  <BusIcon name="chevronLeft" size={14} /> Previous
                </button>
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page + 1)}
                  disabled={loading || dataPage * limit >= total}
                >
                  Next <BusIcon name="chevronRight" size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {selected && (
        <BusDetailsDrawer
          key={selected.id}
          bus={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onEdit={(bus) => setForm({ mode: "edit", bus })}
          onChangeStatus={handleStatus}
          onArchive={handleArchive}
        />
      )}

      {form && (
        <BusFormDialog
          key={form.mode === "edit" ? form.bus.id : "create"}
          mode={form.mode}
          bus={form.bus}
          onClose={() => setForm(null)}
          onSubmit={
            form.mode === "create"
              ? handleCreate
              : (changes) => handleUpdate(form.bus, changes)
          }
        />
      )}

      <div className="bus-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="bus-toast" key={toast.id}>
            <BusIcon name="check" size={16} />
            <span>{toast.text}</span>
            <button
              type="button"
              className="bus-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
            >
              <BusIcon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BusesPage({ user }) {
  if (!can(user, CAPABILITIES.VIEW_BUSES)) return <NoAccess />;
  return <BusesWorkspace canManage={can(user, CAPABILITIES.MANAGE_BUSES)} />;
}