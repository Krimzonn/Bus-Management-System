import { useCallback, useEffect, useMemo, useState } from "react";
import { CAPABILITIES, can } from "../utils/permissions.js";
import "../scheduling.css";

// Slice 7 scheduling components, API functions, model helpers and lookup hook.
// All of them live together in one folder. If yours is not client/src/features/scheduling,
// change only this block of imports.
import ScheduleDetails from "../features/scheduling/ScheduleDetails.jsx";
import ScheduleFilters from "../features/scheduling/ScheduleFilters.jsx";
import ScheduleFormDialog from "../features/scheduling/ScheduleFormDialog.jsx";
import ScheduleIcon from "../features/scheduling/ScheduleIcon.jsx";
import ScheduleStatusBadge from "../features/scheduling/ScheduleStatusBadge.jsx";
import useLookups from "../features/scheduling/useLookups.js";
import {
  createSchedule,
  manageApi,
  ownApi,
  updateSchedule,
} from "../features/scheduling/scheduleApi.js";
import {
  MAX_TRAVEL_DATE,
  MIN_TRAVEL_DATE,
  PAGE_SIZE,
  SCHEDULE_STATUSES,
  STALE_CODES,
  formatDate,
  isCalendarDate,
  isOvernight,
  scheduleErrorMessage,
} from "../features/scheduling/scheduleModel.js";

const EMPTY_FILTERS = {
  dateFrom: "",
  dateTo: "",
  status: "",
  busId: "",
  driverId: "",
  routeId: "",
};

const ACTION_NOTICE = {
  start: "Trip started. It is now In progress.",
  complete: "Trip completed and kept in the history.",
  cancel: "Trip cancelled and kept in the history.",
};

const dateOk = (value) =>
  value === "" ||
  (isCalendarDate(value) &&
    value >= MIN_TRAVEL_DATE &&
    value <= MAX_TRAVEL_DATE);

const rangeInvalid = (f) =>
  !dateOk(f.dateFrom) ||
  !dateOk(f.dateTo) ||
  Boolean(f.dateFrom && f.dateTo && f.dateFrom > f.dateTo);

// The API may return a schedule directly or wrapped as { schedule }.
const unwrap = (response) =>
  response &&
  typeof response === "object" &&
  response.schedule &&
  typeof response.schedule === "object"
    ? response.schedule
    : response;

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function rowSearchText(row) {
  return [
    row.bus?.busNumber,
    row.driver?.fullName,
    row.route?.routeCode,
    row.route?.name,
    row.route?.origin,
    row.route?.destination,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function StateBlock({ icon, title, children, tone = "" }) {
  return (
    <div className={`sc-state ${tone}`.trim()}>
      <span className="sc-state-icon">
        <ScheduleIcon name={icon} size={26} />
      </span>
      <h2 className="sc-state-title">{title}</h2>
      {children && <div className="sc-state-text">{children}</div>}
    </div>
  );
}

export default function SchedulesPage({ user }) {
  const canViewAll = can(user, CAPABILITIES.VIEW_SCHEDULES);
  const canManage = can(user, CAPABILITIES.MANAGE_SCHEDULES);
  const canViewOwn = can(user, CAPABILITIES.VIEW_OWN_TRIPS);
  const canOperate = can(user, CAPABILITIES.OPERATE_OWN_TRIPS);

  // Staff who can view all schedules use the management endpoints; drivers use /mine.
  const mode = canViewAll ? "manage" : canViewOwn ? "own" : null;
  const api = mode === "own" ? ownApi : manageApi;
  const showManage = mode === "manage" && canManage;

  const lookupsEnabled =
    mode === "manage" &&
    can(user, CAPABILITIES.VIEW_BUSES) &&
    can(user, CAPABILITIES.VIEW_DRIVERS) &&
    can(user, CAPABILITIES.VIEW_ROUTES);
  const lookups = useLookups(lookupsEnabled);
  const reloadLookups = lookups.reload;

  const wide = useMediaQuery("(min-width: 1180px)");

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS); // last valid filters sent to the API
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  const [list, setList] = useState({
    items: [],
    total: 0,
    loading: true,
    error: "",
    loaded: false,
  });
  const [stats, setStats] = useState({ loading: true, counts: null });
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null); // { mode: "create" } | { mode: "edit", schedule }
  const [notice, setNotice] = useState("");

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  // Filters that define "the set of trips" (everything except status and paging).
  const scope = useMemo(
    () =>
      mode === "manage"
        ? {
            dateFrom: applied.dateFrom,
            dateTo: applied.dateTo,
            busId: applied.busId,
            driverId: applied.driverId,
            routeId: applied.routeId,
          }
        : { dateFrom: applied.dateFrom, dateTo: applied.dateTo },
    [mode, applied],
  );

  /* ---- Schedule list ---- */
  useEffect(() => {
    if (!mode) return undefined;
    let cancelled = false;
    setList((current) => ({ ...current, loading: true, error: "" }));
    api
      .list({
        ...scope,
        status: applied.status,
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      .then((data) => {
        if (cancelled) return;
        setList({
          items: Array.isArray(data?.items) ? data.items : [],
          total: Number(data?.total) || 0,
          loading: false,
          error: "",
          loaded: true,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setList((current) => ({
          ...current,
          loading: false,
          error: scheduleErrorMessage(err),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, api, scope, applied.status, page, reloadKey]);

  // If the current page no longer exists (e.g. after cancelling the last row), step back.
  useEffect(() => {
    if (
      !list.loading &&
      !list.error &&
      list.items.length === 0 &&
      list.total > 0 &&
      page > 1
    ) {
      setPage(Math.max(1, Math.ceil(list.total / PAGE_SIZE)));
    }
  }, [list, page]);

  /* ---- Status summaries: the list endpoint's `total` for each status ---- */
  useEffect(() => {
    if (!mode) return undefined;
    let cancelled = false;
    setStats((current) => ({ ...current, loading: true }));
    Promise.all(
      SCHEDULE_STATUSES.map((status) =>
        api
          .list({ ...scope, status: status.value, page: "1", limit: "1" })
          .then((data) => Number(data?.total) || 0)
          .catch(() => null),
      ),
    ).then((totals) => {
      if (cancelled) return;
      const counts = {};
      SCHEDULE_STATUSES.forEach((status, index) => {
        counts[status.value] = totals[index];
      });
      counts.all = totals.every((value) => value !== null)
        ? totals.reduce((sum, value) => sum + value, 0)
        : null;
      setStats({ loading: false, counts });
    });
    return () => {
      cancelled = true;
    };
  }, [mode, api, scope, reloadKey]);

  /* ---- Notices ---- */
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ---- Filters ---- */
  function handleFilterChange(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (rangeInvalid(next)) {
      setApplied((previous) => ({
        ...next,
        dateFrom: previous.dateFrom,
        dateTo: previous.dateTo,
      }));
    } else {
      setApplied(next);
    }
    setPage(1);
  }

  function handleReset() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setSearch("");
    setPage(1);
  }

  const dirty = Object.values(filters).some(Boolean) || search.trim() !== "";
  const filtersActive = Object.values(applied).some(Boolean);

  /* ---- Detail view ---- */
  const refreshDetail = useCallback(
    async (id) => {
      try {
        const fresh = unwrap(await api.get(id));
        if (fresh && fresh.id === id) {
          setDetail((current) =>
            current && current.id === id ? { ...current, ...fresh } : current,
          );
        }
      } catch {
        // The details stay as they are; the list reload shows what still exists.
      }
    },
    [api],
  );

  function openDetail(row) {
    setDetail(row);
    refreshDetail(row.id);
  }

  async function handleAction(schedule, kind) {
    try {
      const updated = unwrap(await api[kind](schedule.id));
      if (updated && updated.id === schedule.id) {
        setDetail((current) =>
          current && current.id === schedule.id
            ? { ...current, ...updated }
            : current,
        );
      }
      refreshDetail(schedule.id);
      setNotice(ACTION_NOTICE[kind]);
      reload();
    } catch (err) {
      if (err?.code && STALE_CODES.has(err.code)) {
        refreshDetail(schedule.id);
        reload();
      }
      throw err; // ScheduleDetails shows the message
    }
  }

  /* ---- Slice 8: replacement driver ---- */

  // POST /schedules/:id/replacement returned the updated schedule (with bus, driver and
  // route summaries). Show it at once, re-read it from the server, and refresh the list
  // and the status counts so the new driver appears everywhere.
  function handleReplaced(updated, candidate) {
    const next = unwrap(updated);
    if (next && next.id) {
      setDetail((current) =>
        current && current.id === next.id ? { ...current, ...next } : current,
      );
      refreshDetail(next.id);
    }
    const name = candidate?.fullName ?? next?.driver?.fullName;
    setNotice(
      name
        ? `Driver replaced. ${name} is now assigned to this trip.`
        : "Driver replaced.",
    );
    reload();
  }

  // The trip itself changed while the manager was choosing (it started, was cancelled, or
  // no longer exists). Re-read it so the details stop offering the replacement action, and
  // close the details if the trip is gone.
  async function handleReplacementStale(id) {
    reload();
    try {
      const fresh = unwrap(await api.get(id));
      if (fresh && fresh.id === id) {
        setDetail((current) =>
          current && current.id === id ? { ...current, ...fresh } : current,
        );
      }
    } catch (err) {
      if (err?.code === "SCHEDULE_NOT_FOUND") {
        setDetail((current) => (current && current.id === id ? null : current));
      }
    }
  }

  /* ---- Create / edit ---- */
  function openForm(next) {
    reloadLookups(); // fresh availability for the option lists
    setForm(next);
  }

  async function handleSubmit(payload) {
    if (!form) return;
    if (form.mode === "create") {
      await createSchedule(payload);
      setNotice("Schedule created.");
    } else {
      const id = form.schedule.id;
      try {
        const updated = unwrap(await updateSchedule(id, payload));
        if (updated && updated.id === id) {
          setDetail((current) =>
            current && current.id === id ? { ...current, ...updated } : current,
          );
        }
        refreshDetail(id);
        setNotice("Schedule updated.");
      } catch (err) {
        if (err?.code && STALE_CODES.has(err.code)) {
          refreshDetail(id);
          reload();
        }
        throw err; // ScheduleFormDialog shows the message
      }
    }
    setForm(null);
    reload();
  }

  function handleRefresh() {
    reload();
    reloadLookups();
    if (detail) refreshDetail(detail.id);
  }

  /* ---- Derived view data ---- */
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      needle
        ? list.items.filter((row) => rowSearchText(row).includes(needle))
        : list.items,
    [list.items, needle],
  );
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const firstShown = list.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, list.total);

  /* ---- No access ---- */
  if (!mode) {
    return (
      <div className="sc-page">
        <section className="sc-panel">
          <StateBlock icon="lock" title="You do not have access to schedules">
            Ask an Admin if you need to view schedules or your own trips.
          </StateBlock>
        </section>
      </div>
    );
  }

  const title = mode === "own" ? "My trips" : "Schedules";
  const subtitle =
    mode === "own"
      ? "Your assigned trips. Start a trip when it departs and complete it on arrival."
      : showManage
        ? "Plan trips, assign a bus, driver and route, and follow each trip through to completion."
        : "Browse planned and past trips. You have view-only access.";
  const showDetailPanel = detail && wide;
  const showDetailDrawer = detail && !wide;
  const initialLoading = list.loading && !list.loaded;

  return (
    <div className="sc-page">
      <header className="sc-header">
        <div className="sc-header-text">
          <h1 className="sc-title">{title}</h1>
          <p className="sc-subtitle">{subtitle}</p>
        </div>
        <div className="sc-header-actions">
          <button
            type="button"
            className="bm-btn"
            onClick={handleRefresh}
            disabled={list.loading}
            aria-label="Refresh schedules"
          >
            <ScheduleIcon
              name="refresh"
              className={list.loading ? "sc-spin" : ""}
            />{" "}
            Refresh
          </button>
          {showManage && (
            <button
              type="button"
              className="bm-btn bm-btn-primary"
              onClick={() => openForm({ mode: "create" })}
            >
              <ScheduleIcon name="plus" /> Create schedule
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div className="sc-toast" role="status">
          <ScheduleIcon
            name="checkCircle"
            size={18}
            className="sc-toast-icon"
          />
          <span className="sc-toast-text">{notice}</span>
          <button
            type="button"
            className="sc-icon-btn"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            <ScheduleIcon name="x" size={16} />
          </button>
        </div>
      )}

      <section className="sc-summary" aria-label="Status summary">
        <button
          type="button"
          className="sc-stat sc-stat-total"
          aria-pressed={applied.status === ""}
          onClick={() => handleFilterChange("status", "")}
        >
          <span className="sc-stat-value">
            {stats.counts?.all ??
              (stats.loading ? (
                <span className="sc-skeleton sc-skeleton-num" />
              ) : (
                "—"
              ))}
          </span>
          <span className="sc-stat-label">All trips</span>
        </button>
        {SCHEDULE_STATUSES.map((status) => (
          <button
            key={status.value}
            type="button"
            className={`sc-stat sc-tone-${status.tone}`}
            aria-pressed={applied.status === status.value}
            onClick={() =>
              handleFilterChange(
                "status",
                applied.status === status.value ? "" : status.value,
              )
            }
          >
            <span className="sc-stat-value">
              {stats.counts?.[status.value] ??
                (stats.loading ? (
                  <span className="sc-skeleton sc-skeleton-num" />
                ) : (
                  "—"
                ))}
            </span>
            <span className="sc-stat-label">{status.label}</span>
          </button>
        ))}
      </section>

      <ScheduleFilters
        filters={filters}
        rangeError={rangeInvalid(filters)}
        lookups={lookups}
        showAssignmentFilters={lookupsEnabled}
        search={search}
        onSearch={setSearch}
        onChange={handleFilterChange}
        onReset={handleReset}
        dirty={dirty}
      />

      <div className={`sc-workspace${showDetailPanel ? " sc-has-detail" : ""}`}>
        <section
          className="sc-panel sc-list-panel"
          aria-label="Schedule list"
          aria-busy={list.loading}
        >
          {list.error && (
            <div className="sc-list-error">
              <p className="bm-alert bm-alert-error" role="alert">
                {list.error}
              </p>
              <button type="button" className="bm-btn" onClick={reload}>
                <ScheduleIcon name="refresh" /> Try again
              </button>
            </div>
          )}

          {initialLoading && !list.error ? (
            <div
              className="sc-skeleton-list"
              role="status"
              aria-label="Loading schedules"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div className="sc-skeleton sc-skeleton-row" key={index} />
              ))}
            </div>
          ) : list.loaded && list.items.length === 0 && !list.error ? (
            list.loading ? null : filtersActive ? (
              <StateBlock icon="search" title="No trips match these filters">
                Try widening the date range or clearing a filter.
                <div className="sc-state-actions">
                  <button
                    type="button"
                    className="bm-btn"
                    onClick={handleReset}
                  >
                    Reset filters
                  </button>
                </div>
              </StateBlock>
            ) : (
              <StateBlock
                icon="inbox"
                title={
                  mode === "own"
                    ? "No trips assigned to you yet"
                    : "No schedules yet"
                }
              >
                {mode === "own"
                  ? "When a manager assigns you a trip, it will appear here."
                  : showManage
                    ? "Create the first schedule to assign a bus, driver and route to a trip."
                    : "Schedules created by a manager will appear here."}
                {showManage && (
                  <div className="sc-state-actions">
                    <button
                      type="button"
                      className="bm-btn bm-btn-primary"
                      onClick={() => openForm({ mode: "create" })}
                    >
                      <ScheduleIcon name="plus" /> Create schedule
                    </button>
                  </div>
                )}
              </StateBlock>
            )
          ) : list.loaded && rows.length === 0 && !list.error ? (
            <StateBlock
              icon="search"
              title="No rows on this page match your search"
            >
              The search only covers the {list.items.length} trips loaded on
              this page.
              <div className="sc-state-actions">
                <button
                  type="button"
                  className="bm-btn"
                  onClick={() => setSearch("")}
                >
                  Clear search
                </button>
              </div>
            </StateBlock>
          ) : rows.length > 0 ? (
            <>
              <div
                className={`sc-table-wrap${list.loading ? " is-loading" : ""}`}
              >
                <table className="sc-table">
                  <caption className="sc-sr-only">
                    {title}: page {page} of {totalPages}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Time</th>
                      <th scope="col">Route</th>
                      <th scope="col">Bus</th>
                      <th scope="col">Driver</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="sc-col-actions">
                        <span className="sc-sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const overnight =
                        row.arrivalDate !== undefined
                          ? row.arrivalDate !== row.travelDate
                          : isOvernight(row.departureTime, row.arrivalTime);
                      return (
                        <tr
                          key={row.id}
                          className={detail?.id === row.id ? "is-selected" : ""}
                          onClick={() => openDetail(row)}
                        >
                          <td data-label="Date">
                            <span className="sc-cell-primary">
                              {formatDate(row.travelDate)}
                            </span>
                          </td>
                          <td data-label="Time">
                            <span className="sc-cell-primary sc-nowrap">
                              {row.departureTime} → {row.arrivalTime}
                            </span>
                            {overnight && (
                              <span className="sc-cell-sub">
                                Arrives next day
                              </span>
                            )}
                          </td>
                          <td data-label="Route">
                            <span className="sc-cell-primary">
                              {row.route
                                ? row.route.routeCode
                                : `#${row.routeId}`}
                            </span>
                            {row.route && (
                              <span className="sc-cell-sub">
                                {row.route.origin} → {row.route.destination}
                              </span>
                            )}
                          </td>
                          <td data-label="Bus">
                            {row.bus ? row.bus.busNumber : `#${row.busId}`}
                          </td>
                          <td data-label="Driver">
                            {row.driver
                              ? row.driver.fullName
                              : `#${row.driverId}`}
                          </td>
                          <td data-label="Status">
                            <ScheduleStatusBadge status={row.status} />
                          </td>
                          <td className="sc-col-actions">
                            <div className="sc-row-actions">
                              {showManage && row.status === "scheduled" && (
                                <button
                                  type="button"
                                  className="sc-icon-btn"
                                  aria-label={`Edit trip on ${formatDate(row.travelDate)}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openForm({ mode: "edit", schedule: row });
                                  }}
                                >
                                  <ScheduleIcon name="edit" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="bm-btn sc-btn-small"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openDetail(row);
                                }}
                              >
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <nav className="sc-pagination" aria-label="Pagination">
                <p className="sc-page-info">
                  Showing {firstShown}–{lastShown} of {list.total}
                </p>
                <div className="sc-pager">
                  <button
                    type="button"
                    className="bm-btn sc-btn-small"
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    disabled={page <= 1 || list.loading}
                  >
                    <ScheduleIcon name="chevronLeft" /> Previous
                  </button>
                  <span className="sc-page-count">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="bm-btn sc-btn-small"
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    disabled={page >= totalPages || list.loading}
                  >
                    Next <ScheduleIcon name="chevronRight" />
                  </button>
                </div>
              </nav>
            </>
          ) : null}
        </section>

        {showDetailPanel && (
          <aside className="sc-detail-col">
            <ScheduleDetails
              key={detail.id}
              schedule={detail}
              mode={mode}
              canManage={canManage}
              canOperate={canOperate}
              asDrawer={false}
              onClose={() => setDetail(null)}
              onEdit={(schedule) => openForm({ mode: "edit", schedule })}
              onAction={handleAction}
              onReplaced={handleReplaced}
              onReplacementStale={handleReplacementStale}
            />
          </aside>
        )}
      </div>

      {showDetailDrawer && (
        <ScheduleDetails
          key={detail.id}
          schedule={detail}
          mode={mode}
          canManage={canManage}
          canOperate={canOperate}
          asDrawer
          onClose={() => setDetail(null)}
          onEdit={(schedule) => openForm({ mode: "edit", schedule })}
          onAction={handleAction}
          onReplaced={handleReplaced}
          onReplacementStale={handleReplacementStale}
        />
      )}

      {form && showManage && (
        <ScheduleFormDialog
          mode={form.mode}
          schedule={form.schedule}
          lookups={lookups}
          onSubmit={handleSubmit}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
