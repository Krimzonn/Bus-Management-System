import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, listAudit, roleLabel } from "./services/api.js";

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 25;
const EMPTY_FILTERS = {
  actorId: "",
  action: "",
  entityType: "",
  entityId: "",
  from: "",
  to: "",
};
const EMPTY_RESULT = { items: [], page: 1, limit: PAGE_SIZE };
const FILTER_KEYS = [
  "action",
  "entityType",
  "entityId",
  "actorId",
  "from",
  "to",
];

const FILTER_LABELS = {
  action: "Action",
  entityType: "Entity type",
  entityId: "Entity ID",
  actorId: "Actor ID",
  from: "From",
  to: "To",
};

// Same actions as before; tone only controls the badge colour.
const ACTION_META = {
  "account.created": { label: "Account created", tone: "green" },
  "account.email_updated": { label: "Account email updated", tone: "blue" },
  "account.role_changed": { label: "Account role changed", tone: "violet" },
  "account.activated": { label: "Account activated", tone: "green" },
  "account.deactivated": { label: "Account deactivated", tone: "red" },
  "auth.login_succeeded": { label: "Successful login", tone: "indigo" },
  "auth.logout": { label: "Logout", tone: "slate" },
};

const ENTITY_LABELS = { account: "Account", auth: "Authentication" };
const FIELD_LABELS = { email: "Email", role: "Role", isActive: "Status" };

// Local messages for backend codes that api.js does not translate yet.
const AUDIT_ERRORS = {
  INVALID_AUDIT_FILTER:
    "One of the filters is not valid. Check the values and the date range, then try again.",
  INVALID_PAGINATION:
    "That page is not available. Go back to the first page and try again.",
};

function auditErrorMessage(error) {
  return AUDIT_ERRORS[error?.code] || errorMessage(error);
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const clockFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const shortFmt = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const chipFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const fullFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "long",
});

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function snapshot(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function formatValue(key, value) {
  if (key === "role") return roleLabel(value);
  if (key === "isActive")
    return value === true ? "Active" : value === false ? "Inactive" : "—";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatRaw(value) {
  if (!value || Object.keys(value).length === 0) return "—";
  return JSON.stringify(value, null, 2);
}

function describeFilter(key, value) {
  if (key === "action") return ACTION_META[value]?.label ?? value;
  if (key === "entityType") return ENTITY_LABELS[value] ?? value;
  if (key === "from" || key === "to") {
    const date = parseDate(value);
    return date ? chipFmt.format(date) : value;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, no dependency)                                  */
/* ------------------------------------------------------------------ */

const ICON_PATHS = {
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  login: (
    <>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  chevronRight: <polyline points="9 18 15 12 9 6" />,
  chevronLeft: <polyline points="15 18 9 12 15 6" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  arrowRight: (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
};

function Icon({ name, size = 16, className = "" }) {
  return (
    <svg
      className={`al-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

function ActionBadge({ action }) {
  const meta = ACTION_META[action] ?? { label: action, tone: "slate" };
  return <span className={`al-badge al-tone-${meta.tone}`}>{meta.label}</span>;
}

function TimeCell({ date }) {
  if (!date) return <span className="al-muted">—</span>;
  return (
    <time className="al-time" dateTime={date.toISOString()}>
      <span className="al-time-date">{dateFmt.format(date)}</span>
      <span className="al-time-clock">{clockFmt.format(date)}</span>
    </time>
  );
}

function ActorCell({ entry }) {
  const email = entry.actor_email;
  const initial = (email || "S").charAt(0).toUpperCase();
  const tint = Number(entry.actor_id) % 6 || 0;
  return (
    <div className="al-actor">
      <span className={`al-avatar al-av-${tint}`} aria-hidden="true">
        {initial}
      </span>
      <span className="al-actor-text">
        <span className="al-actor-email" title={email || "System"}>
          {email || "System"}
        </span>
        <span className="al-actor-id">ID {entry.actor_id ?? "—"}</span>
      </span>
    </div>
  );
}

function EntityCell({ entry }) {
  return (
    <div className="al-entity">
      <span className="al-entity-type">
        {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
      </span>
      <span className="al-mono">
        {entry.entity_id != null ? `#${entry.entity_id}` : "—"}
      </span>
    </div>
  );
}

function StatCard({ tone, icon, label, state, value, note, percent }) {
  return (
    <li className={`al-stat al-tone-${tone}`}>
      <div className="al-stat-top">
        <span className="al-stat-label">{label}</span>
        <span className="al-stat-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="al-stat-value">
        {state === "loading" ? (
          <span className="al-skel al-skel-value" />
        ) : state === "ready" ? (
          value
        ) : (
          "—"
        )}
      </div>
      <div className="al-stat-note">
        {state === "loading" ? (
          <span className="al-skel al-skel-note" />
        ) : state === "ready" ? (
          note
        ) : (
          "Unavailable"
        )}
      </div>
      {percent !== undefined && state === "ready" && (
        <div
          className="al-meter"
          role="img"
          aria-label={`${percent}% of the entries on this page`}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="al-skel-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="al-skel-row" key={i}>
          <span className="al-skel" />
          <span className="al-skel" />
          <span className="al-skel al-skel-pill" />
          <span className="al-skel" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail side panel                                                  */
/* ------------------------------------------------------------------ */

function ChangeSection({ entry }) {
  const before = snapshot(entry.before_data);
  const after = snapshot(entry.after_data);
  const hasBefore = Boolean(before && Object.keys(before).length);
  const hasAfter = Boolean(after && Object.keys(after).length);

  if (!hasBefore && !hasAfter) {
    return (
      <p className="al-muted">
        No before/after values were recorded for this event.
      </p>
    );
  }

  // Only "after" values exist (for example a creation or a login): list them.
  if (!hasBefore) {
    return (
      <dl className="al-dl">
        {Object.entries(after).map(([key, value]) => (
          <div className="al-dl-row" key={key}>
            <dt>{FIELD_LABELS[key] ?? key}</dt>
            <dd>{formatValue(key, value)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after ?? {})]),
  ];
  return (
    <ul className="al-changes">
      {keys.map((key) => {
        const inBefore = Object.hasOwn(before, key);
        const inAfter = Boolean(after) && Object.hasOwn(after, key);
        const same = inBefore && inAfter && before[key] === after[key];
        return (
          <li className={`al-change${same ? " is-same" : ""}`} key={key}>
            <div className="al-change-field">
              {FIELD_LABELS[key] ?? key}
              {same && <span className="al-change-note">Unchanged</span>}
            </div>
            <div className="al-change-values">
              <div className="al-val al-val-before">
                <span className="al-val-tag">Before</span>
                <span className={inBefore ? "" : "al-muted"}>
                  {inBefore ? formatValue(key, before[key]) : "—"}
                </span>
              </div>
              <div className="al-val al-val-after">
                <span className="al-val-tag">After</span>
                <span className={inAfter ? "" : "al-muted"}>
                  {inAfter ? formatValue(key, after[key]) : "—"}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DetailDrawer({ entry, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Modal behaviour: focus handling, Escape to close, focus trap, scroll lock.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll(
        'button:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const meta = ACTION_META[entry.action];
  const when = parseDate(entry.created_at);
  const before = snapshot(entry.before_data);
  const after = snapshot(entry.after_data);

  return (
    <div
      className="al-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="al-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="al-drawer-title"
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="al-drawer-head">
          <div>
            <ActionBadge action={entry.action} />
            <h2 className="al-drawer-title" id="al-drawer-title">
              {meta?.label ?? entry.action}
            </h2>
            <p className="al-drawer-sub">
              {when ? fullFmt.format(when) : "Time unavailable"}
            </p>
          </div>
          <button
            type="button"
            className="al-btn al-btn-ghost al-btn-icon"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close details"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="al-drawer-body">
          <section aria-labelledby="al-sec-event">
            <h3 className="al-section-title" id="al-sec-event">
              Event
            </h3>
            <dl className="al-dl">
              <div className="al-dl-row">
                <dt>Event ID</dt>
                <dd className="al-mono-strong">#{entry.id}</dd>
              </div>
              <div className="al-dl-row">
                <dt>Recorded at</dt>
                <dd>
                  {when ? (
                    <>
                      {fullFmt.format(when)}
                      <span className="al-dd-sub">
                        UTC {when.toISOString()}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="al-dl-row">
                <dt>Actor</dt>
                <dd>
                  {entry.actor_email || "System"}
                  <span className="al-dd-sub">ID {entry.actor_id ?? "—"}</span>
                </dd>
              </div>
              <div className="al-dl-row">
                <dt>Entity</dt>
                <dd>
                  {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
                  <span className="al-dd-sub">
                    {entry.entity_id != null
                      ? `#${entry.entity_id}`
                      : "No entity ID"}
                  </span>
                </dd>
              </div>
              <div className="al-dl-row">
                <dt>Action key</dt>
                <dd className="al-mono-strong">{entry.action}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="al-sec-changes">
            <h3 className="al-section-title" id="al-sec-changes">
              Changes
            </h3>
            <ChangeSection entry={entry} />
          </section>

          <details className="al-raw">
            <summary>View raw data</summary>
            <div className="al-raw-block">
              <h4>Before</h4>
              <pre>{formatRaw(before)}</pre>
            </div>
            <div className="al-raw-block">
              <h4>After</h4>
              <pre>{formatRaw(after)}</pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function AuditPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS); // what is typed in the form
  const [applied, setApplied] = useState({}); // what was sent to the API
  const [page, setPage] = useState(1);
  const [reloadCount, setReloadCount] = useState(0);
  const [filterError, setFilterError] = useState("");
  const [selected, setSelected] = useState(null);
  const [settled, setSettled] = useState({
    request: null,
    data: EMPTY_RESULT,
    error: "",
  });

  // Each change to filters, page or refresh creates a new request object.
  const request = useMemo(
    () => ({ filters: applied, page, reload: reloadCount }),
    [applied, page, reloadCount],
  );

  useEffect(() => {
    let cancelled = false;
    listAudit({
      ...request.filters,
      page: String(request.page),
      limit: String(PAGE_SIZE),
    })
      .then((data) => {
        if (!cancelled) setSettled({ request, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled)
          setSettled({
            request,
            data: EMPTY_RESULT,
            error: auditErrorMessage(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const loading = settled.request !== request;
  const { items, page: dataPage, limit } = settled.data;
  const error = settled.error;

  const showError = !loading && Boolean(error);
  const showSkeleton = loading && items.length === 0;
  const showEmpty = !loading && !error && items.length === 0;
  const showTable = items.length > 0;

  const hasFilters = Object.keys(applied).length > 0;
  const hasDraft = Object.values(filters).some(Boolean);

  // Summary cards: derived only from the entries currently loaded (the API
  // returns no totals), so every label says "on this page".
  const stats = useMemo(() => {
    const actors = new Set(
      items.map((e) => e.actor_id ?? e.actor_email ?? "system"),
    );
    return {
      total: items.length,
      actors: actors.size,
      account: items.filter((e) => e.entity_type === "account").length,
      auth: items.filter((e) => e.entity_type === "auth").length,
    };
  }, [items]);

  const statState = showSkeleton
    ? "loading"
    : showError
      ? "unavailable"
      : "ready";
  const percent = (n) =>
    stats.total ? Math.round((n / stats.total) * 100) : 0;
  const newest = items.length ? parseDate(items[0].created_at) : null;

  const rangeStart = (dataPage - 1) * limit + 1;
  const rangeEnd = rangeStart + items.length - 1;

  const chips = FILTER_KEYS.filter((key) => applied[key]).map((key) => ({
    key,
    label: FILTER_LABELS[key],
    text: describeFilter(key, applied[key]),
  }));

  /* ---- handlers ---- */

  function refresh() {
    setReloadCount((count) => count + 1);
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key === "from" || key === "to") setFilterError("");
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (
      filters.from &&
      filters.to &&
      new Date(filters.from) >= new Date(filters.to)
    ) {
      setFilterError("“From” must be earlier than “To”.");
      return;
    }
    setFilterError("");

    const next = {};
    for (const key of FILTER_KEYS) {
      const value = filters[key].trim();
      if (!value) continue;
      next[key] =
        key === "from" || key === "to" ? new Date(value).toISOString() : value;
    }
    setSelected(null);
    setPage(1);
    setApplied(next);
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setFilterError("");
    setSelected(null);
    setPage(1);
    setApplied({});
  }

  function removeFilter(key) {
    setFilters((current) => ({ ...current, [key]: "" }));
    setApplied((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSelected(null);
    setPage(1);
  }

  function goToPage(next) {
    setSelected(null);
    setPage(Math.max(1, next));
  }

  function openEntry(entry) {
    // Do not open the panel when the user is selecting text to copy it.
    if (window.getSelection()?.toString()) return;
    setSelected(entry);
  }

  /* ---- render ---- */

  return (
    <div className="al">
      {/* Header */}
      <header className="al-header">
        <div>
          <div className="al-title-row">
            <h1 className="al-title">Audit log</h1>
            <span className="al-pill">
              <Icon name="shield" size={13} /> Admin only
            </span>
          </div>
          <p className="al-subtitle">
            An append-only history of account changes and authentication
            activity.
          </p>
        </div>
        <button
          type="button"
          className="al-btn al-btn-primary"
          onClick={refresh}
          disabled={loading}
        >
          <Icon name="refresh" className={loading ? "al-spin" : ""} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <p className="sr-only" role="status">
        {loading ? "Loading audit entries…" : ""}
      </p>

      {/* Summary cards */}
      <ul className="al-stats" aria-label="Summary of the entries on this page">
        <StatCard
          tone="violet"
          icon="activity"
          label="Entries on this page"
          state={statState}
          value={stats.total}
          note={
            newest
              ? `Newest ${shortFmt.format(newest)}`
              : "Nothing on this page"
          }
        />
        <StatCard
          tone="blue"
          icon="users"
          label="Distinct actors"
          state={statState}
          value={stats.actors}
          note="Across the entries shown"
        />
        <StatCard
          tone="green"
          icon="edit"
          label="Account changes"
          state={statState}
          value={stats.account}
          note={`${percent(stats.account)}% of this page`}
          percent={percent(stats.account)}
        />
        <StatCard
          tone="indigo"
          icon="login"
          label="Sign-in activity"
          state={statState}
          value={stats.auth}
          note={`${percent(stats.auth)}% of this page`}
          percent={percent(stats.auth)}
        />
      </ul>

      {/* Filters */}
      <section className="al-panel" aria-label="Filters">
        <form className="al-filters" onSubmit={handleSubmit}>
          <div className="al-filter-grid">
            <div className="al-field">
              <label className="al-label" htmlFor="audit-action">
                Action
              </label>
              <select
                id="audit-action"
                className="al-input al-select"
                value={filters.action}
                onChange={(e) => updateFilter("action", e.target.value)}
              >
                <option value="">All actions</option>
                {Object.entries(ACTION_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="al-field">
              <label className="al-label" htmlFor="audit-entity-type">
                Entity type
              </label>
              <select
                id="audit-entity-type"
                className="al-input al-select"
                value={filters.entityType}
                onChange={(e) => updateFilter("entityType", e.target.value)}
              >
                <option value="">All entities</option>
                {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="al-field">
              <label className="al-label" htmlFor="audit-entity-id">
                Entity ID
              </label>
              <input
                id="audit-entity-id"
                className="al-input"
                autoComplete="off"
                placeholder="e.g. 19"
                value={filters.entityId}
                onChange={(e) => updateFilter("entityId", e.target.value)}
              />
            </div>
            <div className="al-field">
              <label className="al-label" htmlFor="audit-actor">
                Actor ID
              </label>
              <input
                id="audit-actor"
                className="al-input"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="e.g. 7"
                value={filters.actorId}
                onChange={(e) =>
                  updateFilter("actorId", e.target.value.replace(/\D/g, ""))
                }
              />
            </div>
            <div className="al-field">
              <label className="al-label" htmlFor="audit-from">
                From
              </label>
              <input
                id="audit-from"
                className="al-input"
                type="datetime-local"
                value={filters.from}
                onChange={(e) => updateFilter("from", e.target.value)}
              />
            </div>
            <div className="al-field">
              <label className="al-label" htmlFor="audit-to">
                To
              </label>
              <input
                id="audit-to"
                className="al-input"
                type="datetime-local"
                value={filters.to}
                onChange={(e) => updateFilter("to", e.target.value)}
              />
            </div>
          </div>

          {filterError && (
            <p className="al-inline-error" role="alert">
              {filterError}
            </p>
          )}

          <div className="al-filter-actions">
            <button
              type="button"
              className="al-btn al-btn-ghost"
              onClick={clearFilters}
              disabled={loading || (!hasDraft && !hasFilters)}
            >
              Reset
            </button>
            <button
              type="submit"
              className="al-btn al-btn-primary"
              disabled={loading}
            >
              Apply filters
            </button>
          </div>

          {chips.length > 0 && (
            <ul className="al-chips" aria-label="Active filters">
              {chips.map((chip) => (
                <li className="al-chip" key={chip.key}>
                  <span>{chip.label}:</span>
                  <strong title={chip.text}>{chip.text}</strong>
                  <button
                    type="button"
                    className="al-chip-x"
                    onClick={() => removeFilter(chip.key)}
                    aria-label={`Remove filter ${chip.label}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </section>

      {/* Results */}
      <section
        className="al-panel"
        aria-busy={loading}
        aria-label="Audit entries"
      >
        {loading && items.length > 0 && (
          <div className="al-progress" aria-hidden="true" />
        )}

        <div className="al-panel-head">
          <div>
            <h2 className="al-panel-title">Activity</h2>
            <p className="al-panel-sub">
              {showTable
                ? "Newest first. Select an entry to see its full details."
                : "Account changes and authentication events."}
            </p>
          </div>
        </div>

        {showSkeleton && <SkeletonRows />}

        {showError && (
          <div className="al-state">
            <span className="al-state-icon al-tone-red">
              <Icon name="alert" size={22} />
            </span>
            <h3 className="al-state-title">Couldn’t load audit entries</h3>
            <p className="al-state-text" role="alert">
              {error}
            </p>
            <button type="button" className="al-btn" onClick={refresh}>
              <Icon name="refresh" /> Try again
            </button>
          </div>
        )}

        {showEmpty && (
          <div className="al-state">
            <span className="al-state-icon al-tone-slate">
              <Icon name="inbox" size={22} />
            </span>
            {page > 1 ? (
              <>
                <h3 className="al-state-title">No more entries</h3>
                <p className="al-state-text">
                  This page is empty. The previous page holds the last entries.
                </p>
                <button
                  type="button"
                  className="al-btn"
                  onClick={() => goToPage(page - 1)}
                >
                  <Icon name="chevronLeft" /> Previous page
                </button>
              </>
            ) : hasFilters ? (
              <>
                <h3 className="al-state-title">
                  No entries match your filters
                </h3>
                <p className="al-state-text">
                  Try a wider date range or remove one of the filters.
                </p>
                <button type="button" className="al-btn" onClick={clearFilters}>
                  Reset filters
                </button>
              </>
            ) : (
              <>
                <h3 className="al-state-title">No audit entries yet</h3>
                <p className="al-state-text">
                  Account changes and sign-in activity will appear here as they
                  happen.
                </p>
              </>
            )}
          </div>
        )}

        {showTable && !showError && (
          <>
            <div className="al-table-scroll">
              <table className="al-table">
                <caption className="sr-only">
                  Audit log entries, newest first
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Entity</th>
                    <th scope="col">
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((entry) => (
                    <tr
                      key={entry.id}
                      className={selected?.id === entry.id ? "is-selected" : ""}
                      onClick={() => openEntry(entry)}
                    >
                      <td className="al-td-time">
                        <TimeCell date={parseDate(entry.created_at)} />
                      </td>
                      <td className="al-td-actor">
                        <ActorCell entry={entry} />
                      </td>
                      <td className="al-td-action">
                        <ActionBadge action={entry.action} />
                      </td>
                      <td className="al-td-entity">
                        <EntityCell entry={entry} />
                      </td>
                      <td className="al-td-go">
                        <button
                          type="button"
                          className="al-row-btn"
                          aria-label={`View details: ${ACTION_META[entry.action]?.label ?? entry.action}, entry ${entry.id}`}
                        >
                          <Icon name="chevronRight" size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="al-pager">
              <p className="al-pager-info">
                Showing{" "}
                <strong>
                  {rangeStart}–{rangeEnd}
                </strong>{" "}
                · Page {dataPage}
              </p>
              <div className="al-pager-actions">
                <button
                  type="button"
                  className="al-btn al-btn-sm"
                  onClick={() => goToPage(page - 1)}
                  disabled={loading || page === 1}
                >
                  <Icon name="chevronLeft" size={14} /> Previous
                </button>
                <button
                  type="button"
                  className="al-btn al-btn-sm"
                  onClick={() => goToPage(page + 1)}
                  disabled={loading || items.length < limit}
                >
                  Next <Icon name="chevronRight" size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {selected && (
        <DetailDrawer
          key={selected.id}
          entry={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
