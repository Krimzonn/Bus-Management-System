import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../services/api.js";
import { CAPABILITIES, can } from "../utils/permissions.js";
import FuelDetails from "../features/fuel/FuelDetails.jsx";
import FuelFormDialog from "../features/fuel/FuelFormDialog.jsx";
import FuelIcon from "../features/fuel/FuelIcon.jsx";
import FuelSummary from "../features/fuel/FuelSummary.jsx";
import { ArchivedBadge, BusArchivedBadge } from "../features/fuel/FuelBadges.jsx";
import {
  archiveFuel,
  createFuel,
  getFuelRecord,
  listFuel,
  updateFuel,
} from "../features/fuel/fuelApi.js";
import {
  ARCHIVE_VIEWS,
  PAGE_SIZE,
  STALE_CODES,
  dateInRange,
  formatCost,
  formatDate,
  formatLiters,
  formatOdometer,
  fuelErrorMessage,
} from "../features/fuel/fuelModel.js";
import useFuelBuses from "../features/fuel/useFuelBuses.js";
import "../features/fuel/fuel.css";

const EMPTY_RESULT = { items: [], page: 1, limit: PAGE_SIZE, total: 0 };
const DEFAULT_APPLIED = { busId: "", purchaseFrom: "", purchaseTo: "", archived: "false" };
const EMPTY_DRAFT = { purchaseFrom: "", purchaseTo: "" };

function SkeletonRows() {
  return (
    <div className="fu-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="fu-skel-row" key={i}>
          <span className="fu-skel" />
          <span className="fu-skel" />
          <span className="fu-skel" />
          <span className="fu-skel fu-skel-pill" />
        </div>
      ))}
    </div>
  );
}

function NoAccess() {
  return (
    <div className="fu-page">
      <section className="fu-panel">
        <div className="fu-state">
          <span className="fu-state-icon">
            <FuelIcon name="lock" size={22} />
          </span>
          <h2 className="fu-state-title">Fuel management is not available</h2>
          <p className="fu-state-text">
            Your role does not include access to fuel records. Ask an Admin if you think this is a
            mistake.
          </p>
        </div>
      </section>
    </div>
  );
}

function FuelWorkspace({ canManage, canArchive }) {
  const [applied, setApplied] = useState(DEFAULT_APPLIED); // sent to the API
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [reloadCount, setReloadCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null); // { mode: "create" } | { mode: "edit", record }
  const [toast, setToast] = useState(null);
  const [settled, setSettled] = useState({ request: null, data: EMPTY_RESULT, error: "" });

  const busOptions = useFuelBuses(true);
  const reloadBuses = busOptions.reload;
  const selectableBuses = useMemo(
    () => busOptions.buses.filter((bus) => !bus.isArchived),
    [busOptions.buses],
  );

  const request = useMemo(
    () => ({ applied, page, reload: reloadCount }),
    [applied, page, reloadCount],
  );

  useEffect(() => {
    let cancelled = false;
    listFuel({ ...request.applied, page: String(request.page), limit: String(PAGE_SIZE) })
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) setSettled({ request, data: EMPTY_RESULT, error: fuelErrorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  // Open the record with fresh data from the server.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    getFuelRecord(selectedId)
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
  const { items, page: dataPage, limit, total } = settled.data;
  const error = settled.error;

  const showError = !loading && Boolean(error);
  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;
  const showTable = items.length > 0 && !showError;

  const hasFilters =
    Boolean(applied.busId || applied.purchaseFrom || applied.purchaseTo) ||
    applied.archived !== "false";
  const hasDraft = Boolean(draft.purchaseFrom || draft.purchaseTo);

  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

  const refresh = () => setReloadCount((count) => count + 1);

  /* ---- filters ---- */

  function applySelect(key, value) {
    setApplied((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function submitFilters(event) {
    event.preventDefault();
    const { purchaseFrom, purchaseTo } = draft;
    if ((purchaseFrom && !dateInRange(purchaseFrom)) || (purchaseTo && !dateInRange(purchaseTo))) {
      setFilterError("Enter real dates.");
      return;
    }
    if (purchaseFrom && purchaseTo && purchaseFrom > purchaseTo) {
      setFilterError("“From” must be on or before “To”.");
      return;
    }
    setFilterError("");
    setApplied((current) => ({ ...current, purchaseFrom, purchaseTo }));
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
    getFuelRecord(id)
      .then((fresh) => setSelected((current) => (current && current.id === fresh.id ? fresh : current)))
      .catch((err) => {
        if (err instanceof ApiError && err.code === "FUEL_RECORD_NOT_FOUND") {
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
    setSelected((current) => (open ? record : current && current.id === record.id ? record : current));
    setForm(null);
    setToast({ id: Date.now(), text });
    refresh();
  }

  const handleCreate = (input) =>
    run(null, async () => {
      const record = await createFuel(input);
      applySaved(record, `Fuel record added for bus ${record.busNumber}.`, { open: true });
    });

  const handleUpdate = (record, changes) =>
    run(record.id, async () => {
      const updated = await updateFuel(record.id, changes);
      applySaved(updated, "Fuel record updated.");
    });

  const handleArchive = (record) =>
    run(record.id, async () => {
      const updated = await archiveFuel(record.id);
      applySaved(updated, "Fuel record archived. It stays in the bus fuel history.");
    });

  function openForm(next) {
    reloadBuses(); // fresh bus list for the selector
    setForm(next);
  }

  /* ---- render ---- */

  let emptyTitle = "No fuel records yet";
  let emptyText = canManage
    ? "Add the first fuel record to start tracking fuel use."
    : "Fuel records will appear here once they have been added.";
  if (hasFilters && applied.archived === "true" && !applied.busId && !applied.purchaseFrom && !applied.purchaseTo) {
    emptyTitle = "No archived fuel records";
    emptyText = "Records you archive are kept here for history.";
  } else if (hasFilters) {
    emptyTitle = "No fuel records match your filters";
    emptyText = "Try different dates or another bus, or reset the filters.";
  }

  return (
    <div className="fu-page">
      <header className="fu-header">
        <div>
          <div className="fu-title-row">
            <h1 className="fu-title">Fuel Management</h1>
            {!canManage && <span className="fu-pill">View only</span>}
          </div>
          <p className="fu-subtitle">
            Record fuel purchases, keep odometer readings consistent and review fuel use per bus.
          </p>
        </div>
        <div className="fu-header-actions">
          <button
            type="button"
            className="bm-btn"
            onClick={() => {
              refresh();
              reloadBuses();
            }}
            disabled={loading}
          >
            <FuelIcon name="refresh" className={loading ? "fu-spin" : ""} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canManage && (
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              onClick={() => openForm({ mode: "create" })}
            >
              <FuelIcon name="plus" /> Add Fuel Record
            </button>
          )}
        </div>
      </header>

      <p className="fu-sr-only" role="status">
        {loading ? "Loading fuel records…" : ""}
      </p>

      <FuelSummary buses={busOptions.buses} reloadKey={reloadCount} />

      <section className="fu-panel" aria-busy={loading} aria-label="Fuel records">
        {loading && items.length > 0 && <div className="fu-progress" aria-hidden="true" />}

        <div className="fu-panel-head">
          <h2 className="fu-panel-title">Fuel records</h2>
          <p className="fu-panel-sub">
            Newest purchase first.
            {!showSkeleton && !showError ? ` ${total} ${total === 1 ? "record" : "records"}.` : ""}
          </p>
        </div>

        <form className="fu-filters" onSubmit={submitFilters}>
          <div className="fu-filter-grid">
            <div className="fu-field">
              <label className="fu-label" htmlFor="fu-bus">
                Bus
              </label>
              <select
                id="fu-bus"
                className="fu-input fu-select"
                value={applied.busId}
                disabled={busOptions.loading}
                onChange={(e) => applySelect("busId", e.target.value)}
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
            <div className="fu-field">
              <label className="fu-label" htmlFor="fu-from">
                Purchase date from
              </label>
              <input
                id="fu-from"
                type="date"
                className="fu-input"
                value={draft.purchaseFrom}
                onChange={(e) => {
                  setDraft((c) => ({ ...c, purchaseFrom: e.target.value }));
                  setFilterError("");
                }}
              />
            </div>
            <div className="fu-field">
              <label className="fu-label" htmlFor="fu-to">
                Purchase date to
              </label>
              <input
                id="fu-to"
                type="date"
                className="fu-input"
                value={draft.purchaseTo}
                onChange={(e) => {
                  setDraft((c) => ({ ...c, purchaseTo: e.target.value }));
                  setFilterError("");
                }}
              />
            </div>
            <div className="fu-field">
              <label className="fu-label" htmlFor="fu-archived">
                Show
              </label>
              <select
                id="fu-archived"
                className="fu-input fu-select"
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

          {busOptions.error && (
            <p className="fu-field-error" role="alert">
              The bus filter is unavailable: {busOptions.error}
            </p>
          )}
          {filterError && (
            <p className="fu-field-error" role="alert">
              {filterError}
            </p>
          )}

          <div className="fu-filter-actions">
            <button
              type="button"
              className="bm-btn fu-btn-ghost"
              onClick={resetFilters}
              disabled={!hasDraft && !hasFilters}
            >
              Reset
            </button>
            <button type="submit" className="bm-btn bm-btn-primary">
              Apply dates
            </button>
          </div>
        </form>

        {showSkeleton && <SkeletonRows />}

        {showError && (
          <div className="fu-state">
            <span className="fu-state-icon fu-state-icon-red">
              <FuelIcon name="alert" size={22} />
            </span>
            <h3 className="fu-state-title">Couldn’t load fuel records</h3>
            <p className="fu-state-text" role="alert">
              {error}
            </p>
            <button type="button" className="bm-btn" onClick={refresh}>
              <FuelIcon name="refresh" /> Try again
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="fu-state">
            <span className="fu-state-icon">
              <FuelIcon name="inbox" size={22} />
            </span>
            {page > 1 ? (
              <>
                <h3 className="fu-state-title">No more records</h3>
                <p className="fu-state-text">
                  This page is empty. The previous page holds the last records.
                </p>
                <button type="button" className="bm-btn" onClick={() => setPage(page - 1)}>
                  <FuelIcon name="chevronLeft" /> Previous page
                </button>
              </>
            ) : (
              <>
                <h3 className="fu-state-title">{emptyTitle}</h3>
                <p className="fu-state-text">{emptyText}</p>
                {hasFilters ? (
                  <button type="button" className="bm-btn" onClick={resetFilters}>
                    Reset filters
                  </button>
                ) : (
                  canManage && (
                    <button
                      type="button"
                      className="bm-btn bm-btn-primary"
                      onClick={() => openForm({ mode: "create" })}
                    >
                      <FuelIcon name="plus" /> Add Fuel Record
                    </button>
                  )
                )}
              </>
            )}
          </div>
        )}

        {showTable && (
          <>
            <div className="fu-table-scroll">
              <table className="fu-table">
                <caption className="fu-sr-only">Fuel records, newest purchase first</caption>
                <thead>
                  <tr>
                    <th scope="col">Bus</th>
                    <th scope="col">Purchase date</th>
                    <th scope="col">Liters</th>
                    <th scope="col">Total cost</th>
                    <th scope="col">Odometer</th>
                    <th scope="col">
                      <span className="fu-sr-only">Actions</span>
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
                      <td className="fu-td-bus">
                        <span className="fu-bus">
                          {record.busNumber ?? `#${record.busId}`}
                          {record.isBusArchived && <BusArchivedBadge />}
                          {record.isArchived && <ArchivedBadge />}
                        </span>
                      </td>
                      <td className="fu-num" data-label="Purchased">
                        {formatDate(record.purchaseDate)}
                      </td>
                      <td className="fu-num" data-label="Liters">
                        {formatLiters(record.liters)}
                      </td>
                      <td className="fu-num" data-label="Cost">
                        {formatCost(record.totalCost)}
                      </td>
                      <td className="fu-num" data-label="Odometer">
                        {formatOdometer(record.odometer)}
                      </td>
                      <td className="fu-td-actions">
                        <span className="fu-row-actions">
                          <button
                            type="button"
                            className="bm-btn bm-btn-sm"
                            aria-label={`View fuel record for bus ${record.busNumber} on ${formatDate(record.purchaseDate)}`}
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
                              aria-label={`Edit fuel record for bus ${record.busNumber} on ${formatDate(record.purchaseDate)}`}
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

            <div className="fu-pager">
              <p className="fu-pager-info">
                Showing{" "}
                <strong>
                  {rangeStart}–{rangeEnd}
                </strong>{" "}
                of <strong>{total}</strong> · Page {dataPage}
              </p>
              <div className="fu-pager-actions">
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page - 1)}
                  disabled={loading || page === 1}
                >
                  <FuelIcon name="chevronLeft" size={14} /> Previous
                </button>
                <button
                  type="button"
                  className="bm-btn bm-btn-sm"
                  onClick={() => setPage(page + 1)}
                  disabled={loading || dataPage * limit >= total}
                >
                  Next <FuelIcon name="chevronRight" size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {selected && (
        <FuelDetails
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
        <FuelFormDialog
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

      <div className="fu-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="fu-toast" key={toast.id}>
            <FuelIcon name="check" size={16} />
            <span>{toast.text}</span>
            <button
              type="button"
              className="fu-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
            >
              <FuelIcon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FuelPage({ user }) {
  if (!can(user, CAPABILITIES.VIEW_FUEL)) return <NoAccess />;
  return (
    <FuelWorkspace
      canManage={can(user, CAPABILITIES.MANAGE_FUEL)}
      canArchive={can(user, CAPABILITIES.ARCHIVE_FUEL)}
    />
  );
}