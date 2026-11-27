import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  archiveRoute,
  createRoute,
  getRoute,
  listRoutes,
  setRouteStatus,
  updateRoute,
} from "../services/api.js";
import { CAPABILITIES, can } from "../utils/permissions.js";
import RouteDetails from "../features/routes/RouteDetails.jsx";
import RouteFormDialog from "../features/routes/RouteFormDialog.jsx";
import RouteIcon from "../features/routes/RouteIcon.jsx";
import RouteStatusBadge, {
  ArchivedBadge,
} from "../features/routes/RouteStatusBadge.jsx";
import {
  ARCHIVE_VIEWS,
  PAGE_SIZE,
  ROUTE_STATUSES,
  routeErrorMessage,
} from "../features/routes/routeModel.js";
import "../features/routes/routes.css";

const EMPTY_RESULT = { items: [], page: 1, limit: PAGE_SIZE, total: 0 };
const DEFAULT_FILTERS = { q: "", status: "", archived: "false" };
// Errors meaning "your copy of this route is out of date": reload.
const STALE_CODES = new Set([
  "ROUTE_NOT_FOUND",
  "ROUTE_ARCHIVED",
  "ROUTE_ALREADY_ARCHIVED",
]);
// Below this width the details open in a drawer instead of a side panel.
const STACKED_QUERY = "(max-width: 960px)";

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
    <div className="rt-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="rt-skel-row" key={i}>
          <div className="rt-skel-lines">
            <span className="rt-skel rt-skel-short" />
            <span className="rt-skel" />
          </div>
          <span className="rt-skel rt-skel-pill" />
        </div>
      ))}
    </div>
  );
}

function NoAccess() {
  return (
    <div className="rt-page">
      <section className="rt-panel">
        <div className="rt-state">
          <span className="rt-state-icon">
            <RouteIcon name="lock" size={22} />
          </span>
          <h2 className="rt-state-title">Route management is not available</h2>
          <p className="rt-state-text">
            Your role does not include access to routes. Ask an Admin if you
            think this is a mistake.
          </p>
        </div>
      </section>
    </div>
  );
}

function EmptyDetails() {
  return (
    <section className="rt-panel rt-detail rt-detail-empty" aria-label="Route details">
      <div className="rt-state">
        <span className="rt-state-icon">
          <RouteIcon name="route" size={22} />
        </span>
        <h2 className="rt-state-title">No route selected</h2>
        <p className="rt-state-text">Select a route to view its details.</p>
      </div>
    </section>
  );
}

function RoutesWorkspace({ canManage }) {
  const stacked = useMediaQuery(STACKED_QUERY);
  const [applied, setApplied] = useState(DEFAULT_FILTERS); // sent to the API
  const [draftQuery, setDraftQuery] = useState("");
  const [page, setPage] = useState(1);
  const [reloadCount, setReloadCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null); // { mode: "create" | "edit", route? }
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
    listRoutes({
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
            error: routeErrorMessage(err),
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
  const showList = items.length > 0;

  const hasFilters =
    Boolean(applied.q || applied.status) || applied.archived !== "false";
  const hasDraft = Boolean(draftQuery);

  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

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
    setApplied(DEFAULT_FILTERS);
    setPage(1);
  }

  /* ---- refresh and synchronisation ---- */

  const refresh = () => setReloadCount((count) => count + 1);

  // Re-read one route so the details panel matches the server.
  function resyncSelected(id) {
    getRoute(id)
      .then((fresh) =>
        setSelected((current) => (current && current.id === fresh.id ? fresh : current)),
      )
      .catch((err) => {
        if (err instanceof ApiError && err.code === "ROUTE_NOT_FOUND") {
          setSelected((current) => (current && current.id === id ? null : current));
        }
      });
  }

  function refreshAll() {
    refresh();
    if (selected) resyncSelected(selected.id);
  }

  /* ---- mutations (the only place that calls the API) ---- */

  async function run(id, action) {
    try {
      return await action();
    } catch (err) {
      if (err instanceof ApiError && STALE_CODES.has(err.code)) {
        refresh();
        if (id) resyncSelected(id);
      }
      throw err;
    }
  }

  function applySaved(route, text, { open = false } = {}) {
    setSelected((current) =>
      open ? route : current && current.id === route.id ? route : current,
    );
    setForm(null);
    setToast({ id: Date.now(), text });
    refresh();
  }

  const handleCreate = (input) =>
    run(null, async () => {
      const route = await createRoute(input);
      applySaved(route, `Route ${route.routeCode} was created.`, { open: true });
    });

  const handleUpdate = (route, changes) =>
    run(route.id, async () => {
      const updated = await updateRoute(route.id, changes);
      applySaved(updated, `Route ${updated.routeCode} was updated.`);
    });

  const handleStatus = (route, status) =>
    run(route.id, async () => {
      const updated = await setRouteStatus(route.id, status);
      applySaved(
        updated,
        `Route ${updated.routeCode} was ${updated.status === "blocked" ? "blocked" : "unblocked"}.`,
      );
    });

  const handleArchive = (route) =>
    run(route.id, async () => {
      const updated = await archiveRoute(route.id);
      applySaved(updated, `Route ${updated.routeCode} was archived.`);
    });

  /* ---- render ---- */

  const details = selected ? (
    <RouteDetails
      key={selected.id}
      route={selected}
      canManage={canManage}
      asDrawer={stacked}
      onClose={() => setSelected(null)}
      onEdit={(route) => setForm({ mode: "edit", route })}
      onChangeStatus={handleStatus}
      onArchive={handleArchive}
    />
  ) : null;

  return (
    <div className="rt-page">
      <header className="rt-header">
        <div>
          <div className="rt-title-row">
            <h1 className="rt-title">Route Management</h1>
            {!canManage && <span className="rt-pill">View only</span>}
          </div>
          <p className="rt-subtitle">
            Manage and monitor the routes operated by Al-Madani Travellers.
          </p>
        </div>
        <div className="rt-header-actions">
          <button type="button" className="bm-btn" onClick={refreshAll} disabled={loading}>
            <RouteIcon name="refresh" className={loading ? "rt-spin" : ""} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {canManage && (
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              onClick={() => setForm({ mode: "create" })}
            >
              <RouteIcon name="plus" /> Create Route
            </button>
          )}
        </div>
      </header>

      <p className="sr-only" role="status">
        {loading ? "Loading routes…" : ""}
      </p>

      <div className="rt-split">
        <section className="rt-panel rt-list-panel" aria-busy={loading} aria-label="Routes">
          {loading && items.length > 0 && <div className="rt-progress" aria-hidden="true" />}

          <form className="rt-filters" onSubmit={submitSearch}>
            <div className="rt-search-row">
              <div className="rt-field rt-field-grow">
                <label className="rt-label" htmlFor="rt-q">
                  Search
                </label>
                <div className="rt-search">
                  <RouteIcon name="search" className="rt-search-icon" />
                  <input
                    id="rt-q"
                    className="rt-input rt-search-input"
                    type="search"
                    placeholder="Code, name, origin or destination"
                    maxLength={100}
                    autoComplete="off"
                    value={draftQuery}
                    onChange={(e) => setDraftQuery(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="bm-btn bm-btn-primary rt-search-btn">
                Search
              </button>
            </div>
            <div className="rt-filter-row">
              <div className="rt-field">
                <label className="rt-label" htmlFor="rt-status">
                  Status
                </label>
                <select
                  id="rt-status"
                  className="rt-input rt-select"
                  value={applied.status}
                  onChange={(e) => applySelect("status", e.target.value)}
                >
                  <option value="">All statuses</option>
                  {ROUTE_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rt-field">
                <label className="rt-label" htmlFor="rt-archived">
                  Show
                </label>
                <select
                  id="rt-archived"
                  className="rt-input rt-select"
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
              <button
                type="button"
                className="bm-btn rt-btn-ghost"
                onClick={resetFilters}
                disabled={!hasDraft && !hasFilters}
              >
                Reset
              </button>
            </div>
          </form>

          <div className="rt-list-head">
            <h2 className="rt-panel-title">Routes</h2>
            {!showSkeleton && !showError && (
              <p className="rt-panel-sub">
                {total} {total === 1 ? "route" : "routes"}
              </p>
            )}
          </div>

          {showSkeleton && <SkeletonRows />}

          {showError && (
            <div className="rt-state">
              <span className="rt-state-icon rt-state-icon-red">
                <RouteIcon name="alert" size={22} />
              </span>
              <h3 className="rt-state-title">Couldn’t load routes</h3>
              <p className="rt-state-text" role="alert">
                {error}
              </p>
              <button type="button" className="bm-btn" onClick={refresh}>
                <RouteIcon name="refresh" /> Try again
              </button>
            </div>
          )}

          {showEmpty && (
            <div className="rt-state">
              <span className="rt-state-icon">
                <RouteIcon name="inbox" size={22} />
              </span>
              {page > 1 ? (
                <>
                  <h3 className="rt-state-title">No more routes</h3>
                  <p className="rt-state-text">
                    This page is empty. The previous page holds the last routes.
                  </p>
                  <button type="button" className="bm-btn" onClick={() => setPage(page - 1)}>
                    <RouteIcon name="chevronLeft" /> Previous page
                  </button>
                </>
              ) : hasFilters ? (
                <>
                  <h3 className="rt-state-title">No routes match your filters</h3>
                  <p className="rt-state-text">
                    Try a different search or remove a filter.
                  </p>
                  <button type="button" className="bm-btn" onClick={resetFilters}>
                    Reset filters
                  </button>
                </>
              ) : (
                <>
                  <h3 className="rt-state-title">No routes yet</h3>
                  <p className="rt-state-text">
                    {canManage
                      ? "Create the first route to start building the network."
                      : "Routes will appear here once they have been created."}
                  </p>
                  {canManage && (
                    <button
                      type="button"
                      className="bm-btn bm-btn-primary"
                      onClick={() => setForm({ mode: "create" })}
                    >
                      <RouteIcon name="plus" /> Create Route
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {showList && !showError && (
            <>
              <ul className="rt-list" aria-label="Routes sorted by route code">
                {items.map((route) => {
                  const isSelected = selected?.id === route.id;
                  return (
                    <li key={route.id}>
                      <button
                        type="button"
                        className={`rt-row${isSelected ? " is-selected" : ""}`}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => setSelected(route)}
                      >
                        <span className="rt-row-main">
                          <span className="rt-row-top">
                            <span className="rt-code">{route.routeCode}</span>
                            {route.isArchived && <ArchivedBadge />}
                          </span>
                          <span className="rt-row-name">{route.name}</span>
                          <span className="rt-row-path">
                            {route.origin} → {route.destination}
                          </span>
                        </span>
                        <RouteStatusBadge status={route.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="rt-pager">
                <p className="rt-pager-info">
                  Showing{" "}
                  <strong>
                    {rangeStart}–{rangeEnd}
                  </strong>{" "}
                  of <strong>{total}</strong> · Page {dataPage}
                </p>
                <div className="rt-pager-actions">
                  <button
                    type="button"
                    className="bm-btn bm-btn-sm"
                    onClick={() => setPage(page - 1)}
                    disabled={loading || page === 1}
                  >
                    <RouteIcon name="chevronLeft" size={14} /> Previous
                  </button>
                  <button
                    type="button"
                    className="bm-btn bm-btn-sm"
                    onClick={() => setPage(page + 1)}
                    disabled={loading || dataPage * limit >= total}
                  >
                    Next <RouteIcon name="chevronRight" size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {!stacked && <aside className="rt-aside">{details ?? <EmptyDetails />}</aside>}
      </div>

      {stacked && details}

      {form && (
        <RouteFormDialog
          key={form.mode === "edit" ? form.route.id : "create"}
          mode={form.mode}
          route={form.route}
          onClose={() => setForm(null)}
          onSubmit={
            form.mode === "create"
              ? handleCreate
              : (changes) => handleUpdate(form.route, changes)
          }
        />
      )}

      <div className="rt-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="rt-toast" key={toast.id}>
            <RouteIcon name="check" size={16} />
            <span>{toast.text}</span>
            <button
              type="button"
              className="rt-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
            >
              <RouteIcon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RoutesPage({ user }) {
  if (!can(user, CAPABILITIES.VIEW_ROUTES)) return <NoAccess />;
  return <RoutesWorkspace canManage={can(user, CAPABILITIES.MANAGE_ROUTES)} />;
}