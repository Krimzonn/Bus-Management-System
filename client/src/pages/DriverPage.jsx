import { useEffect, useState } from "react";
import { createDriver, listDrivers, listLicenseExpiry } from "../services/api.js";
import { CAPABILITIES, can } from "../utils/permissions.js";

import DriverFormDialog from "../features/drivers/DriverFormDialog.jsx";
import DriverIcon from "../features/drivers/DriverIcon.jsx";
import DriverWorkspace from "../features/drivers/DriverWorkspace.jsx";
import LicenseMonitoring from "../features/drivers/LicenseMonitoring.jsx";

import { driverErrorMessage } from "../features/drivers/DriverModel.js";
import "../features/drivers/drivers.css";

const TABS = [
  { key: "directory", label: "Directory", icon: "users" },
  { key: "licenses", label: "License monitoring", icon: "alert" },
  { key: "archived", label: "Archived drivers", icon: "archive" },
];

// Exact totals: each call asks for one row and reads `total`, so pagination can
// never make a figure partial. Alerts = expired + expiring soon (backend classes).
async function loadStats() {
  const active = (status) => listDrivers({ archived: "false", status, page: "1", limit: "1" });
  const expiry = (state) => listLicenseExpiry({ state, page: "1", limit: "1" });
  const [all, available, onLeave, absent, expired, soon, valid] = await Promise.all([
    active(""),
    active("available"),
    active("on_leave"),
    active("absent"),
    expiry("expired"),
    expiry("expiring_soon"),
    expiry("valid"),
  ]);
  return {
    total: all.total,
    available: available.total,
    onLeave: onLeave.total,
    absent: absent.total,
    expired: expired.total,
    expiring_soon: soon.total,
    valid: valid.total,
    alerts: expired.total + soon.total,
    asOf: soon.asOf,
  };
}

function NoAccess() {
  return (
    <div className="dr-page">
      <section className="dr-panel">
        <div className="dr-state">
          <span className="dr-state-icon">
            <DriverIcon name="lock" size={22} />
          </span>
          <h2 className="dr-state-title">Driver management is not available</h2>
          <p className="dr-state-text">
            Your role does not include access to drivers. Ask an Admin if you think this is a
            mistake.
          </p>
        </div>
      </section>
    </div>
  );
}

function StatCard({ tone, label, status, value, note }) {
  return (
    <li className={`dr-stat dr-tone-${tone}`}>
      <span className="dr-stat-label">{label}</span>
      <span className="dr-stat-value">
        {status === "loading" ? <span className="dr-skel dr-skel-value" /> : status === "ready" ? value : "—"}
      </span>
      <span className="dr-stat-note">{status === "error" ? "Unavailable" : note}</span>
    </li>
  );
}

function DriversShell({ canManage }) {
  const [tab, setTab] = useState("directory");
  const [focus, setFocus] = useState({ id: null, n: 0 }); // driver to open in Directory
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState(null);
  const [statsState, setStatsState] = useState({ key: -1, data: null, error: "" });

  useEffect(() => {
    let cancelled = false;
    loadStats()
      .then((data) => {
        if (!cancelled) setStatsState({ key: reloadKey, data, error: "" });
      })
      .catch((err) => {
        if (!cancelled) {
          setStatsState({ key: reloadKey, data: null, error: driverErrorMessage(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = () => setReloadKey((key) => key + 1);
  const notify = (text) => setToast({ id: Date.now(), text });

  const statsLoading = statsState.key !== reloadKey;
  const status =
    statsState.data && !(statsLoading && !statsState.data)
      ? "ready"
      : statsLoading
        ? "loading"
        : "error";
  const stats = statsState.data;
  const summary = { status, data: stats };
  const asOf = stats?.asOf ?? null;

  function openDriver(id) {
    setFocus((current) => ({ id, n: current.n + 1 }));
    setTab("directory");
  }

  async function handleCreate(input) {
    const driver = await createDriver(input);
    setCreating(false);
    notify(`${driver.fullName} was added.`);
    refresh();
    openDriver(driver.id);
  }

  return (
    <div className="dr-page">
      <header className="dr-header">
        <div>
          <div className="dr-title-row">
            <h1 className="dr-title">Driver Management</h1>
            {!canManage && <span className="dr-pill">View only</span>}
          </div>
          <p className="dr-subtitle">
            Manage driver profiles, availability and license qualifications.
          </p>
        </div>
        <div className="dr-header-actions">
          <button type="button" className="bm-btn" onClick={refresh} disabled={statsLoading}>
            <DriverIcon name="refresh" className={statsLoading ? "dr-spin" : ""} />
            {statsLoading ? "Refreshing…" : "Refresh"}
          </button>
          {canManage && (
            <button type="button" className="bm-btn bm-btn-primary" onClick={() => setCreating(true)}>
              <DriverIcon name="plus" /> Add Driver
            </button>
          )}
        </div>
      </header>

      <p className="sr-only" role="status">
        {statsLoading ? "Loading drivers…" : ""}
      </p>

      <ul className="dr-stats" aria-label="Driver overview">
        <StatCard
          tone="navy"
          label="Total drivers"
          status={status}
          value={stats?.total}
          note="Active, not archived"
        />
        <StatCard
          tone="green"
          label="Available drivers"
          status={status}
          value={stats?.available}
          note="Status: available"
        />
        <StatCard
          tone="amber"
          label="On leave / Absent"
          status={status}
          value={stats ? stats.onLeave + stats.absent : undefined}
          note={stats ? `${stats.onLeave} on leave · ${stats.absent} absent` : ""}
        />
        <StatCard
          tone="red"
          label="License alerts"
          status={status}
          value={stats?.alerts}
          note={stats ? `${stats.expired} expired · ${stats.expiring_soon} expiring soon` : ""}
        />
      </ul>

      <div className="dr-tabs" role="tablist" aria-label="Driver sections">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`dr-tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls="dr-tabpanel"
            className={`dr-tab${tab === item.key ? " is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            <DriverIcon name={item.icon} size={15} /> {item.label}
          </button>
        ))}
      </div>

      <div id="dr-tabpanel" role="tabpanel" aria-labelledby={`dr-tab-${tab}`} className="dr-tabpanel">
        {tab === "licenses" ? (
          <LicenseMonitoring summary={summary} reloadKey={reloadKey} onOpenDriver={openDriver} />
        ) : (
          <DriverWorkspace
            key={tab === "directory" ? `directory-${focus.n}` : "archived"}
            scope={tab}
            canManage={canManage}
            asOf={asOf}
            initialId={tab === "directory" ? focus.id : null}
            reloadKey={reloadKey}
            onChanged={refresh}
            notify={notify}
            onCreate={() => setCreating(true)}
          />
        )}
      </div>

      {creating && (
        <DriverFormDialog mode="create" onClose={() => setCreating(false)} onSubmit={handleCreate} />
      )}

      <div className="dr-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="dr-toast" key={toast.id}>
            <DriverIcon name="check" size={16} />
            <span>{toast.text}</span>
            <button
              type="button"
              className="dr-toast-close"
              onClick={() => setToast(null)}
              aria-label="Dismiss message"
            >
              <DriverIcon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DriversPage({ user }) {
  if (!can(user, CAPABILITIES.VIEW_DRIVERS)) return <NoAccess />;
  return <DriversShell canManage={can(user, CAPABILITIES.MANAGE_DRIVERS)} />;
}