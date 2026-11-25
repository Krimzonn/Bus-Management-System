import { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon.jsx";
import {
  errorMessage,
  getHealth,
  listAccounts,
  listAudit,
  roleLabel,
} from "../services/api.js";

/* ---- Data loading (module-level loaders keep the effect dependencies stable) ---- */

const loadHealth = () => getHealth();
const loadAccounts = () => listAccounts();
const loadRecent = () => listAudit({ page: "1", limit: "6" });

function useLoad(load, enabled = true) {
  const [reloadCount, setReloadCount] = useState(0);
  const [settled, setSettled] = useState({ key: -1, data: null, error: "" });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setSettled({ key: reloadCount, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled)
          setSettled({
            key: reloadCount,
            data: null,
            error: errorMessage(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [load, enabled, reloadCount]);

  const loading = enabled && settled.key !== reloadCount;
  const status = !enabled
    ? "idle"
    : loading
      ? "loading"
      : settled.error
        ? "error"
        : "ready";
  return {
    status,
    data: settled.data,
    error: settled.error,
    reload: () => setReloadCount((n) => n + 1),
  };
}

/* ---- Static presentation data (labels only; no operational data) ---- */

const ACTION_LABELS = {
  "account.created": "Account created",
  "account.email_updated": "Account email updated",
  "account.role_changed": "Account role changed",
  "account.activated": "Account activated",
  "account.deactivated": "Account deactivated",
  "auth.login_succeeded": "Successful login",
  "auth.logout": "Logout",
};

// Modules that exist in the roadmap but are not built yet. Display only:
// nothing here grants or implies access. The per-role lists follow the
// permission baseline in IMPLEMENTATION_SLICES.md.
const PLANNED_MODULES = {
  buses: { label: "Buses", icon: "bus", text: "Fleet records and status" },
  routes: { label: "Routes", icon: "route", text: "Routes and availability" },
  drivers: {
    label: "Drivers",
    icon: "users",
    text: "Driver profiles and licences",
  },
  schedules: {
    label: "Schedules",
    icon: "calendar",
    text: "Trips and assignments",
  },
  recruitment: {
    label: "Recruitment",
    icon: "file",
    text: "Applications and decisions",
  },
  reports: {
    label: "Reports",
    icon: "file",
    text: "Read-only operational reports",
  },
  maintenance: {
    label: "Maintenance",
    icon: "wrench",
    text: "Service history",
  },
  fuel: { label: "Fuel", icon: "fuel", text: "Fuel purchases" },
  trips: { label: "My trips", icon: "calendar", text: "Trips assigned to you" },
  application: {
    label: "My application",
    icon: "file",
    text: "Your application status",
  },
};

const PLANNED_BY_ROLE = {
  admin: ["buses", "routes", "drivers", "schedules", "recruitment", "reports"],
  transportation_manager: ["buses", "routes", "drivers", "schedules"],
  administrative_staff: ["maintenance", "fuel", "reports"],
  driver: ["trips"],
  applicant: ["application"],
  passenger: [],
};

/* ---- Formatting ---- */

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatWhen(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? timeFmt.format(date) : "—";
}

/* ---- Small pieces ---- */

function StatCard({ tone, icon, label, status, value, note }) {
  return (
    <li className={`bm-stat bm-tone-${tone}`}>
      <div className="bm-stat-top">
        <span className="bm-stat-label">{label}</span>
        <span className="bm-stat-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="bm-stat-value">
        {status === "loading" ? (
          <span className="bm-skel bm-skel-value" />
        ) : status === "ready" ? (
          value
        ) : (
          "—"
        )}
      </div>
      <div className="bm-stat-note">
        {status === "loading" ? (
          <span className="bm-skel bm-skel-note" />
        ) : status === "ready" ? (
          note
        ) : (
          "Unavailable"
        )}
      </div>
    </li>
  );
}

function PanelState({ status, error, onRetry, children }) {
  if (status === "loading") {
    return (
      <div className="bm-skel-stack" aria-hidden="true">
        <span className="bm-skel" />
        <span className="bm-skel" />
        <span className="bm-skel" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="bm-panel-state">
        <p className="bm-alert bm-alert-error" role="alert">
          {error}
        </p>
        <button type="button" className="bm-btn bm-btn-sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return children;
}

function ModuleTile({ icon, label, text, onOpen }) {
  const body = (
    <>
      <span className="bm-module-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="bm-module-text">
        <span className="bm-module-name">{label}</span>
        <span className="bm-module-desc">{text}</span>
      </span>
    </>
  );
  if (onOpen) {
    return (
      <li>
        <button type="button" className="bm-module is-live" onClick={onOpen}>
          {body}
          <Icon name="arrowRight" size={16} className="bm-module-go" />
        </button>
      </li>
    );
  }
  return (
    <li>
      <div className="bm-module is-planned" aria-disabled="true">
        {body}
        <span className="bm-tag">Planned</span>
      </div>
    </li>
  );
}

/* ---- Page ---- */

export default function HomePage({ user, onNavigate }) {
  const [now] = useState(() => new Date());
  const isAdmin = user.role === "admin";

  const health = useLoad(loadHealth);
  const accounts = useLoad(loadAccounts, isAdmin);
  const recent = useLoad(loadRecent, isAdmin);

  const accountStats = useMemo(() => {
    const list = Array.isArray(accounts.data) ? accounts.data : [];
    return {
      total: list.length,
      active: list.filter((a) => a.isActive).length,
      withoutRole: list.filter((a) => !a.role),
    };
  }, [accounts.data]);

  const busy = [health, accounts, recent].some(
    (load) => load.status === "loading",
  );

  function refreshAll() {
    health.reload();
    if (isAdmin) {
      accounts.reload();
      recent.reload();
    }
  }

  const healthy =
    health.status === "ready" && health.data?.status === "healthy";
  const healthStat = {
    status: health.status === "idle" ? "loading" : health.status,
    value: healthy ? "Healthy" : "Degraded",
    note: health.data?.database
      ? `Database ${health.data.database}`
      : "API and database",
  };

  const planned = (PLANNED_BY_ROLE[user.role] ?? []).map((key) => ({
    key,
    ...PLANNED_MODULES[key],
  }));
  const recentItems = recent.data?.items ?? [];
  const pending = accountStats.withoutRole;

  return (
    <div className="bm-home">
      {/* Welcome */}
      <section className="bm-hero">
        <div>
          <p className="bm-hero-date">{dateFmt.format(now)}</p>
          <h1 className="bm-hero-title">{greetingFor(now)}</h1>
          <p className="bm-hero-sub">
            Signed in as <strong>{user.email}</strong>
            <span className="bm-hero-role">{roleLabel(user.role)}</span>
          </p>
        </div>
        <button
          type="button"
          className="bm-btn bm-btn-light"
          onClick={refreshAll}
          disabled={busy}
        >
          <Icon name="refresh" className={busy ? "bm-spin" : ""} />
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      {!user.role && (
        <p className="bm-alert bm-alert-info" role="status">
          No role has been assigned to your account yet. Ask an Admin to assign
          one.
        </p>
      )}

      {/* Overview */}
      <ul className="bm-stats" aria-label="System overview">
        {isAdmin && (
          <>
            <StatCard
              tone="violet"
              icon="users"
              label="Internal accounts"
              status={accounts.status}
              value={accountStats.total}
              note="All internal accounts"
            />
            <StatCard
              tone="green"
              icon="check"
              label="Active accounts"
              status={accounts.status}
              value={accountStats.active}
              note={`${accountStats.total - accountStats.active} inactive`}
            />
            <StatCard
              tone="amber"
              icon="alert"
              label="Without a role"
              status={accounts.status}
              value={pending.length}
              note={pending.length ? "Need a role assigned" : "Nothing pending"}
            />
          </>
        )}
        {!isAdmin && (
          <>
            <StatCard
              tone="violet"
              icon="shield"
              label="Your role"
              status="ready"
              value={roleLabel(user.role)}
              note="Set by an Admin"
            />
            <StatCard
              tone="green"
              icon="check"
              label="Account"
              status="ready"
              value="Active"
              note="You are signed in"
            />
          </>
        )}
        <StatCard
          tone={healthy ? "blue" : "red"}
          icon="server"
          label="System status"
          status={healthStat.status}
          value={healthStat.value}
          note={healthStat.note}
        />
      </ul>

      {/* Admin: tasks + activity */}
      {isAdmin && (
        <div className="bm-two">
          <section className="bm-panel" aria-labelledby="bm-pending-title">
            <div className="bm-panel-head">
              <h2 id="bm-pending-title" className="bm-panel-title">
                Pending tasks
              </h2>
              <p className="bm-panel-sub">
                Accounts that cannot do anything until they have a role.
              </p>
            </div>
            <div className="bm-panel-body">
              <PanelState
                status={accounts.status}
                error={accounts.error}
                onRetry={accounts.reload}
              >
                {pending.length === 0 ? (
                  <p className="bm-empty">
                    <Icon name="check" size={16} /> Nothing needs your
                    attention.
                  </p>
                ) : (
                  <ul className="bm-list">
                    {pending.slice(0, 5).map((account) => (
                      <li key={account.id} className="bm-list-row">
                        <span className="bm-list-main">
                          <span className="bm-list-title" title={account.email}>
                            {account.email}
                          </span>
                          <span className="bm-list-sub">No role assigned</span>
                        </span>
                        <button
                          type="button"
                          className="bm-btn bm-btn-sm"
                          onClick={() => onNavigate("accounts")}
                        >
                          Assign role
                        </button>
                      </li>
                    ))}
                    {pending.length > 5 && (
                      <li className="bm-list-more">
                        and {pending.length - 5} more in Accounts
                      </li>
                    )}
                  </ul>
                )}
              </PanelState>
            </div>
          </section>

          <section className="bm-panel" aria-labelledby="bm-activity-title">
            <div className="bm-panel-head bm-panel-head-row">
              <div>
                <h2 id="bm-activity-title" className="bm-panel-title">
                  Recent activity
                </h2>
                <p className="bm-panel-sub">The latest audit entries.</p>
              </div>
              <button
                type="button"
                className="bm-link"
                onClick={() => onNavigate("audit")}
              >
                View all <Icon name="arrowRight" size={14} />
              </button>
            </div>
            <div className="bm-panel-body">
              <PanelState
                status={recent.status}
                error={recent.error}
                onRetry={recent.reload}
              >
                {recentItems.length === 0 ? (
                  <p className="bm-empty">No audit entries yet.</p>
                ) : (
                  <ul className="bm-list">
                    {recentItems.map((entry) => (
                      <li key={entry.id} className="bm-list-row">
                        <span className="bm-list-main">
                          <span className="bm-list-title">
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                          <span
                            className="bm-list-sub"
                            title={entry.actor_email}
                          >
                            {entry.actor_email || "System"}
                          </span>
                        </span>
                        <time
                          className="bm-list-time"
                          dateTime={entry.created_at}
                        >
                          {formatWhen(entry.created_at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelState>
            </div>
          </section>
        </div>
      )}

      {/* Modules */}
      <section className="bm-panel" aria-labelledby="bm-modules-title">
        <div className="bm-panel-head">
          <h2 id="bm-modules-title" className="bm-panel-title">
            Modules
          </h2>
          <p className="bm-panel-sub">
            {isAdmin
              ? "Open what is available now. Planned modules are shown for reference only."
              : planned.length
                ? "These modules are planned for your role and are not available yet."
                : "No modules are available for your role in this release."}
          </p>
        </div>
        <div className="bm-panel-body">
          <ul className="bm-modules">
            {isAdmin && (
              <>
                <ModuleTile
                  icon="users"
                  label="Accounts"
                  text="Create accounts and assign roles"
                  onOpen={() => onNavigate("accounts")}
                />
                <ModuleTile
                  icon="clock"
                  label="Audit log"
                  text="Review account and sign-in activity"
                  onOpen={() => onNavigate("audit")}
                />
              </>
            )}
            {planned.map((module) => (
              <ModuleTile
                key={module.key}
                icon={module.icon}
                label={module.label}
                text={module.text}
              />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
