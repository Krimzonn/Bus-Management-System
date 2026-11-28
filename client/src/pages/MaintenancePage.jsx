import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../services/api.js";
import { CAPABILITIES, can } from "../utils/permissions.js";
import MaintenanceDetails from "../features/maintenance/MaintenanceDetails.jsx";
import MaintenanceFormDialog from "../features/maintenance/MaintenanceFormDialog.jsx";
import MaintenanceIcon from "../features/maintenance/MaintenanceIcon.jsx";
import {
  ArchivedBadge,
  BusArchivedBadge,
  DueBadge,
} from "../features/maintenance/MaintenanceBadges.jsx";
import {
  archiveMaintenance,
  createMaintenance,
  getMaintenance,
  listMaintenance,
  listOverdueMaintenance,
  listUpcomingMaintenance,
  updateMaintenance,
} from "../features/maintenance/maintenanceApi.js";
import {
  MAX_SEARCH_LENGTH,
  PAGE_SIZE,
  STALE_CODES,
  VIEWS,
  formatCost,
  formatDate,
  formatOdometer,
  isCalendarDate,
  maintenanceErrorMessage,
} from "../features/maintenance/maintenanceModel.js";
import useBusOptions from "../features/maintenance/useBusOptions.js";
import "../features/maintenance/maintenance.css";

const EMPTY_RESULT = { items: [], page: 1, limit: PAGE_SIZE, total: 0 };
const DEFAULT_APPLIED = { q: "", busId: "", serviceFrom: "", serviceTo: "" };
const EMPTY_DRAFT = { q: "", serviceFrom: "", serviceTo: "" };

const VIEW_TEXT = {
  active: "Records that are not archived, newest service date first.",
  upcoming:
    "Next service date from today through 30 days ahead. A record due today is upcoming, not overdue.",
  overdue: "Next service date is earlier than today. A record due today is not overdue.",
  archived: "Archived records are kept for history and cannot be edited.",
};

const EMPTY_COPY = {
  active: ["No maintenance records yet", "Add the first record to start a service history."],
  upcoming: ["Nothing is due soon", "No active record has a next service date in the next 30 days."],
  overdue: ["Nothing is overdue", "No active record has a next service date that has passed."],
  archived: ["No archived records", "Records you archive are kept here for history."],
};

// The due endpoints accept only busId and paging, so q and dates are not sent there.
function fetchView(view, applied, page) {
  const paging = { page: String(page), limit: String(PAGE_SIZE) };
  if (view === "upcoming") return listUpcomingMaintenance({ busId: applied.busId, ...paging });
  if (view === "overdue") return listOverdueMaintenance({ busId: applied.busId, ...paging });
  return listMaintenance({
    archived: view === "archived" ? "true" : "false",
    q: applied.q,
    busId: applied.busId,
    serviceFrom: applied.serviceFrom,
    serviceTo: applied.serviceTo,
    ...paging,
  });
}

// Exact totals: each call asks for one row and reads `total`.
async function loadStats() {
  const one = { page: "1", limit: "1" };
  const [active, archived, upcoming, overdue] = await Promise.all([
    listMaintenance({ archived: "false", ...one }),
    listMaintenance({ archived: "true", ...one }),
    listUpcomingMaintenance(one),
    listOverdueMaintenance(one),
  ]);
  return {
    active: active.total,
    archived: archived.total,
    upcoming: upcoming.total,
    overdue: overdue.total,
  };
}

function SkeletonRows() {
  return (
    <div className="mt-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="mt-skel-row" key={i}>
          <span className="mt-skel" />
          <span className="mt-skel" />
          <span className="mt-skel" />
          <span className="mt-skel mt-skel-pill" />
        </div>
      ))}
    </div>
  );
}

function NoAccess() {
  return (
    <div className="mt-page">
      <section className="mt-panel">
        <div className="mt-state">
          <span className="mt-state-icon">
            <MaintenanceIcon name="lock" size={22} />
          </span>
          <h2 className="mt-state-title">Maintenance management is not available</h2>
          <p className="mt-state-text">
            Your role does not include access to maintenance records. Ask an Admin if you think
            this is a mistake.
          </p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ tone, label, value, note, state, pressed, onClick }) {
  return (
    <li>
      <button
        type="button"
        className={`mt-stat mt-tone-${tone}`}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <span className="mt-stat-label">{label}</span>
        <span className="mt-stat-value">
          {state === "loading" ? (
            <span className="mt-skel mt-skel-value" />
          ) : state === "ready" ? (
            value
          ) : (
            "—"
          )}
        </span>
        <span className="mt-stat-note">{state === "error" ? "Unavailable" : note}</span>
      </button>
    </li>
  );
}

function MaintenanceWorkspace({ canManage, canArchive }) {
  const [view, setView] = useState("active");
  const [applied, setApplied] = useState(DEFAULT_APPLIED); // sent to the API
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [reloadCount, setReloadCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null); // { mode: "create" } | { mode: "edit", record }
  const [toast, setToast] = useState(null);
  const [settled, setSettled] = useState({ request: null, data: EMPTY_RESULT, error: "" });
  const [stats, setStats] = useState({ key: -1, data: null, error: "" });

  const busOptions = useBusOptions(true);
  const reloadBuses = busOptions.reload;
  const selectableBuses = useMemo(
    () => busOptions.buses.filter((bus) => !bus.isArchived),
    [busOptions.buses],
  );

  const dueView = view === "upcoming" || view === "overdue";
  const request = useMemo(
    () => ({ view, applied, page, reload: reloadCount }),
    [view, applied, page, reloadCount],
  );

  useEffect(() => {
    let cancelled = false;
    fetchView(request.view, request.applied, request.page)
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setSettled({ request, data: EMPTY_RESULT, error: maintenanceErrorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    loadStats()
      .then((data) => {
        if (!cancelled) setStats({ key: reloadCount, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setStats({ key: reloadCount, data: null, error: maintenanceErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  // Open the record with fresh data from the server.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    getMaintenance(selectedId)
      .then((fresh) => {
        if (!cancelled) setSelected((current) => (current && current.id === fresh.id ? fresh : current));
      })
      .catch(() => {
        // The row data stays; list reloads show what still exists.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const loading = settled.request !== request;
  const { items, page: dataPage, limit, total, asOf, upcomingThrough } = settled.data;
  const error = settled.error;

  const showError = !loading && Boolean(error);
  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;
  const showTable = items.length > 0 && !showError;

  const statsLoading = stats.key !== reloadCount && !stats.data;
  const statState = stats.data ? "ready" : statsLoading ? "loading" : "error";

  const hasFilters = dueView
    ? Boolean(applied.busId)
    : Boolean(applied.q || applied.busId || applied.serviceFrom || applied.serviceTo);
  const hasDraft = Boolean(draft.q || draft.serviceFrom || draft.serviceTo);

  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

  const refresh = () => setReloadCount((count) => count + 1);

  /* ---- views and filters ---- */

  function chooseView(next) {
    setView(next);
    setPage(1);
  }

  function applyBus(value) {
    setApplied((current) => ({ ...current, busId: value }));
    setPage(1);
  }

  function submitFilters(event) {
    event.preventDefault();
    const { q, serviceFrom, serviceTo } = draft;
    if ((serviceFrom && !isCalendarDate(serviceFrom)) || (serviceTo && !isCalendarDate(serviceTo))) {
      setFilterError("Enter real dates.");
      return;
    }
    if (serviceFrom && serviceTo && serviceFrom > serviceTo) {
      setFilterError("“From” must be on or before “To”.");
      return;
    }
    setFilterError("");
    setApplied((current) => ({ ...current, q: q.trim(), serviceFrom, serviceTo }));
    setPage(1);
  }

  function resetFilters() {
    setDraft(EMPTY_DRAFT);
    setFilterError("");
    setApplied(DEFAULT_APPLIED);
    setPage(1);
  }

  /* ---- mutations (the only place that calls the mutating API functions) ---- */

  function resync(id) {
    getMaintenance(id)
      .then((fresh) =>
        setSelected((current) => (current && current.id === fresh.id ? fresh : current)),
      )
      .catch((err) => {
        if (err instanceof ApiError && err.code === "MAINTENANCE_NOT_FOUND") {
          setSelected((current) => (current && current.id === id ? null : current));
        }
      });
  }

  async function run(id, action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof ApiError && STALE_CODES.has(err.code)) {
        refresh();
        if (id) resync(id);
      }
      throw err;
    }
  }

  function applySaved(record, text, { open = false } = {}) {
    setSelected((current) =>
      open ? record : current && current.id === record.id ? record : current,
    );
    setForm(null);
    setToast({ id: Date.now(), text });
    refresh();
  }

  const handleCreate = (input) =>
    run(null, async () => {
      const record = await createMaintenance(input);
      applySaved(record, `Maintenance record added for bus ${record.busNumber}.`, { open: true });
    });

  const handleUpdate = (record, changes) =>
    run(record.id, async () => {
      const updated = await updateMaintenance(record.id, changes);
      applySaved(updated, "Maintenance record updated.");
    });

  const handleArchive = (record) =>
    run(record.id, async () => {
      const updated = await archiveMaintenance(record.id);
      applySaved(updated, "Maintenance record archived. It stays in the bus history.");
    });

  function openForm(next) {
    reloadBuses(); // fresh bus list for the selector
    setForm(next);
  }

  /* ---- render ---- */

  const [emptyTitle, emptyText] =
    hasFilters && !dueView
      ? ["No records match your filters", "Try a different search or remove a filter."]
      : hasFilters
        ? ["No records for this bus", "Choose another bus or reset the filter."]
        : EMPTY_COPY[view];

  return (
    <div className="mt-page">
      <header className="mt-header">
        <div>
          <div className="mt-title-row">
            <h1 className="mt-title">Maintenance Management</h1>
            {!canManage && <span className="mt-pill">View only</span>}
          </div>
          <p className="mt-subtitle">
            Record bus service history and keep track of upcoming and overdue maintenance.
          </p>
        </div>
        <div className="mt-header-actions">
          <button
            type="button"
            className="bm-btn"
            onClick={() => {
              refresh();
              reloadBuses();
            }}
            disabled={loading}
          >
            <MaintenanceIcon name="refresh" className={loading ? "mt-spin" : ""} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canManage && (
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              onClick={() => openForm({ mode: "create" })}
            >
              <MaintenanceIcon name="plus" /> Add Maintenance Record
            </button>
          )}
        </div>
      </header>

      <p className="mt-sr-only" role="status">
        {loading ? "Loading maintenance records…" : ""}
      </p>

      <ul className="mt-stats" aria-label="Maintenance overview">
        <StatCard
          tone="navy"
          label="Active records"
          value={stats.data?.active}
          note="Not archived"
          state={statState}
          pressed={view === "active"}
          onClick={() => chooseView("active")}
        />
        <StatCard
          tone="amber"
          label="Upcoming maintenance"
          value={stats.data?.upcoming}
          note="Due within 30 days"
          state={statState}
          pressed={view === "upcoming"}
          onClick={() => chooseView("upcoming")}
        />
        <StatCard
          tone="red"
          label="Overdue maintenance"
          value={stats.data?.overdue}
          note="Next service date passed"
          state={statState}
          pressed={view === "overdue"}
          onClick={() => chooseView("overdue")}
        />
        <StatCard
          tone="grey"
          label="Archived records"
          value={stats.data?.archived}
          note="Kept for history"
          state={statState}
          pressed={view === "archived"}
          onClick={() => chooseView("archived")}
        />
      </ul>

      <div className="mt-tabs" role="group" aria-label="Maintenance views">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`mt-tab${view === item.key ? " is-active" : ""}`}
            aria-pressed={view === item.key}
            onClick={() => chooseView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="mt-panel" aria-busy={loading} aria-label="Maintenance records">
        {loading && items.length > 0 && <div className="mt-progress" aria-hidden="true" />}

        <form className="mt-filters" onSubmit={submitFilters}>
          <div className="mt-filter-grid">
            {!dueView && (
              <>
                <div className="mt-field">
                  <label className="mt-label" htmlFor="mt-q">
                    Search
                  </label>
                  <div className="mt-search">
                    <MaintenanceIcon name="search" className="mt-search-icon" />
                    <input
                      id="mt-q"
                      className="mt-input mt-search-input"
                      type="search"
                      placeholder="Maintenance type or description"
                      maxLength={MAX_SEARCH_LENGTH}
                      autoComplete="off"
                      value={draft.q}
                      onChange={(e) => setDraft((c) => ({ ...c, q: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="mt-field">
                  <label className="mt-label" htmlFor="mt-from">
                    Service date from
                  </label>
                  <input
                    id="mt-from"
                    type="date"
                    className="mt-input"
                    value={draft.serviceFrom}
                    onChange={(e) => {
                      setDraft((c) => ({ ...c, serviceFrom: e.target.value }));
                      setFilterError("");
                    }}
                  />
                </div>
                <div className="mt-field">
                  <label className="mt-label" htmlFor="mt-to">
                    Service date to
                  </label>
                  <input
                    id="mt-to"
                    type="date"
                    className="mt-input"
                    value={draft.serviceTo}
                    onChange={(e) => {
                      setDraft((c) => ({ ...c, serviceTo: e.target.value }));
                      setFilterError("");
                    }}
                  />
                </div>
              </>
            )}
            <div className="mt-field">
              <label className="mt-label" htmlFor="mt-bus">
                Bus
              </label>
              <select
                id="mt-bus"
                className="mt-input mt-select"
                value={applied.busId}
                disabled={busOptions.loading}
                onChange={(e) => applyBus(e.target.value)}
              >
                <option value="">All buses</option>
                {busOptions.buses.map((bus) => (
                  <option key={bus.id} value={bus.id}>
                    {bus.busNumber}
                    {bus.isArchived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {busOptions.error && (
            <p className="mt-field-error" role="alert">
              The bus filter is unavailable: {busOptions.error}
            </p>
          )}
          {filterError && (
            <p className="mt-field-error" role="alert">
              {filterError}
            </p>
          )}
          {dueView && (
            <p className="mt-note">
              Due lists can be narrowed by bus only. Use “All active” to search by text or service
              date.
            </p>
          )}

          <div className="mt-filter-actions">
            <button
              type="button"
              className="bm-btn mt-btn-ghost"
              onClick={resetFilters}
              disabled={!hasDraft && !hasFilters}
            >
              Reset
            </button>
            {!dueView && (
              <button type="submit" className="bm-btn bm-btn-primary">
                Apply
              </button>
            )}
          </div>
        </form>

        <div className="mt-panel-head">
          <h2 className="mt-panel-title">{VIEWS.find((v) => v.key === view).label}</h2>
          <p className="mt-panel-sub">
            {VIEW_TEXT[view]}
            {!loading && !showError && view === "upcoming" && upcomingThrough
              ? ` (${formatDate(asOf)} to ${formatDate(upcomingThrough)})`
              : ""}
          </p>
        </div>

        {showSkeleton && <SkeletonRows />}

        {showError && (
          <div className="mt-state">
            <span className="mt-state-icon mt-state-icon-red">
              <MaintenanceIcon name="alert" size={22} />
            </span>
            <h3 className="mt-state-title">Couldn’t load maintenance records</h3>
            <p className="mt-state-text" role="alert">
              {error}
            </p>
            <button type="button" className="bm-btn" onClick={refresh}>
              <MaintenanceIcon name="refresh" /> Try again
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="mt-state">
            <span className="mt-state-icon">
              <MaintenanceIcon name={view === "overdue" ? "check" : "inbox"} size={22} />
            </span>
            {page > 1 ? (
              <>
                <h3 className="mt-state-title">No more records</h3>
                <p className="mt-state-text">
                  This page is empty. The previous page holds the last records.
                </p>
                <button type="button" className="bm-btn" onClick={() => setPage(page - 1)}>
                  <MaintenanceIcon name="chevronLeft" /> Previous page
                </button>
              </>
            ) : (
              <>
                <h3 className="mt-state-title">{emptyTitle}</h3>
                <p className="mt-state-text">{emptyText}</p>
                {hasFilters ? (
                  <button type="button" className="bm-btn" onClick={resetFilters}>
                    Reset filters
                  </button>
                ) : (
                  view === "active" &&
                  canManage && (
                    <button
                      type="button"
                      className="bm-btn bm-btn-primary"
                      onClick={() => openForm({ mode: "create" })}
                    >
                      <MaintenanceIcon name="plus" /> Add Maintenance Record
                    </button>
                  )
                )}
              </>
            )}
          </div>
        )}

        {showTable && (
          <>
            <div className="mt-table-scroll">
              <table className="mt-table">
                <caption className="mt-sr-only">Maintenance records</caption>
                <thead>
                  <tr>
                    <th scope="col">Bus</th>
                    <th scope="col">Maintenance type</th>
                    <th scope="col">Service date</th>
                    <th scope="col">Cost</th>
                    <th scope="col">Odometer</th>
                    <th scope="col">Next service</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="mt-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((record) => (
                    <tr
                      key={record.id}
                      className={selected?.id === record.id ? "is-selected" : ""}
                      onClick={() => {
                        if (!window.getSelection()?.toString()) setSelected(record);
                      }}
                    >
                      <td className="mt-td-bus">
                        <span className="mt-bus">
                          {record.busNumber}
                          {record.isBusArchived && <BusArchivedBadge />}
                        </span>
                      </td>
                      <td className="mt-td-type">
                        {record.maintenanceType}
                        <span className="mt-cell-sub">{record.workDescription}</span>
                      </td>
                      <td className="mt-num" data-label="Serviced">
                        {formatDate(record.serviceDate)}
                      </td>
                      <td className="mt-num" data-label="Cost">
                        {formatCost(record.cost)}
                      </td>
                      <td className="mt-num" data-label="Odometer">
                        {formatOdometer(record.odometer)}
                      </td>
                      <td className="mt-num" data-label="Next service">
                        {formatDate(record.nextServiceDate)}
                      </td>
                      <td className="mt-td-status">
                        {record.isArchived ? (
                          <ArchivedBadge />
                        ) : (
                          <DueBadge status={record.dueStatus} />
                        )}
                      </td>
                      <td className="mt-td-actions">
                        <span className="mt-row-actions">
                          <button
                            type="button"
                            className="bm-btn bm-btn-sm"
                            aria-label={`View ${record.maintenanceType} for bus ${record.busNumber}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(record);
                            }}
                          >
                            View
                          </button>
                          {canManage && !record.isArchived && (
                            <button
                              type="button"
                              className="bm-btn bm-btn-sm"
                              aria-label={`Edit ${record.maintenanceType} for bus ${record.busNumber}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openForm({ mode: "edit", record });
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

            <div className="mt-pager">
              <p className="mt-pager-info">
                Showing{" "}
                <strong>
                  {rangeStart}–{rangeEnd}
                </strong>{" "}
                of <strong>{total}</strong> · Page {dataPage}
              </p>
              <div className="mt-pager-actions">
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page - 1)}
                  disabled={loading || page === 1}
                >
                  <MaintenanceIcon name="chevronLeft" size={14} /> Previous
                </button>
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page + 1)}
                  disabled={loading || dataPage * limit >= total}
                >
                  Next <MaintenanceIcon name="chevronRight" size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {selected && (
        <MaintenanceDetails
          key={selected.id}
          record={selected}
          canManage={canManage}
          canArchive={canArchive}
          onClose={() => setSelected(null)}
          onEdit={(record) => openForm({ mode: "edit", record })}
          onArchive={handleArchive}
        />
      )}

      {form && (
        <MaintenanceFormDialog
          key={form.mode === "edit" ? form.record.id : "create"}
          mode={form.mode}
          record={form.record}
          buses={selectableBuses}
          busesLoading={busOptions.loading}
          busesError={busOptions.error}
          onClose={() => setForm(null)}
          onSubmit={
            form.mode === "create"
              ? handleCreate
              : (changes) => handleUpdate(form.record, changes)
          }
        />
      )}

      <div className="mt-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="mt-toast" key={toast.id}>
            <MaintenanceIcon name="check" size={16} />
            <span>{toast.text}</span>
            <button
              type="button"
              className="mt-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
            >
              <MaintenanceIcon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MaintenancePage({ user }) {
  if (!can(user, CAPABILITIES.VIEW_MAINTENANCE)) return <NoAccess />;
  return (
    <MaintenanceWorkspace
      canManage={can(user, CAPABILITIES.MANAGE_MAINTENANCE)}
      canArchive={can(user, CAPABILITIES.ARCHIVE_MAINTENANCE)}
    />
  );
}