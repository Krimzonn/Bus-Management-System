import { useEffect, useState } from "react";
import { errorMessage, listAudit } from "./services/api.js";

const ACTIONS = [
  ["account.created", "Account created"],
  ["account.email_updated", "Account email updated"],
  ["account.role_changed", "Account role changed"],
  ["account.activated", "Account activated"],
  ["account.deactivated", "Account deactivated"],
  ["auth.login_succeeded", "Successful login"],
  ["auth.logout", "Logout"],
];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatSnapshot(value) {
  if (!value || Object.keys(value).length === 0) return "—";
  return JSON.stringify(value, null, 2);
}

export default function AuditPage() {
  const [filters, setFilters] = useState({ actorId: "", action: "", entityType: "", entityId: "", from: "", to: "" });
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], page: 1, limit: 25 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAudit({ ...applied, page: String(page), limit: "25" })
      .then((data) => { if (!cancelled) { setResult(data); setError(""); } })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applied, page]);

  function handleSubmit(event) {
    event.preventDefault();
    const next = { ...filters };
    if (next.from) next.from = new Date(next.from).toISOString();
    if (next.to) next.to = new Date(next.to).toISOString();
    setPage(1);
    setApplied(next);
  }

  function clearFilters() {
    setFilters({ actorId: "", action: "", entityType: "", entityId: "", from: "", to: "" });
    setPage(1);
    setApplied({});
  }

  return (
    <div className="accounts">
      <div className="row-between">
        <div><h2>Audit log</h2><p className="muted small">Account changes and authentication activity.</p></div>
        <button type="button" onClick={() => setApplied({ ...applied })} disabled={loading}>Refresh</button>
      </div>
      <form className="card audit-filters" onSubmit={handleSubmit}>
        <div className="audit-filter-grid">
          <div><label htmlFor="audit-actor">Actor ID</label><input id="audit-actor" inputMode="numeric" value={filters.actorId} onChange={(e) => setFilters({ ...filters, actorId: e.target.value })} /></div>
          <div><label htmlFor="audit-action">Action</label><select id="audit-action" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}><option value="">All actions</option>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor="audit-entity-type">Entity type</label><select id="audit-entity-type" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}><option value="">All entities</option><option value="account">Account</option><option value="auth">Authentication</option></select></div>
          <div><label htmlFor="audit-entity-id">Entity ID</label><input id="audit-entity-id" value={filters.entityId} onChange={(e) => setFilters({ ...filters, entityId: e.target.value })} /></div>
          <div><label htmlFor="audit-from">From</label><input id="audit-from" type="datetime-local" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
          <div><label htmlFor="audit-to">To</label><input id="audit-to" type="datetime-local" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
        </div>
        <div className="inline-row"><button type="submit" className="primary" disabled={loading}>Apply filters</button><button type="button" onClick={clearFilters} disabled={loading}>Clear</button></div>
      </form>
      {error && <p className="message error" role="alert">{error}</p>}
      {loading && <p className="muted" role="status">Loading audit entries…</p>}
      {!loading && !error && result.items.length === 0 && <section className="card"><p>No audit entries found.</p></section>}
      {!error && result.items.length > 0 && (
        <section className="card">
          <div className="row-between">
            <p className="muted small">Page {result.page} · {result.items.length} entries shown</p>
            <div className="inline-row">
              <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || page === 1}>Previous</button>
              <button type="button" onClick={() => setPage((value) => value + 1)} disabled={loading || result.items.length < result.limit}>Next</button>
            </div>
          </div>
          <div className="table-wrap"><table className="audit-table">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{result.items.map((entry) => (
              <tr key={entry.id}>
                <td data-label="Time">{formatDate(entry.created_at)}</td>
                <td data-label="Actor">{entry.actor_email || "System"}<br /><span className="muted small">ID: {entry.actor_id ?? "—"}</span></td>
                <td data-label="Action"><code>{entry.action}</code></td>
                <td data-label="Entity">{entry.entity_type} #{entry.entity_id}</td>
                <td data-label="Before"><pre className="audit-snapshot">{formatSnapshot(entry.before_data)}</pre></td>
                <td data-label="After"><pre className="audit-snapshot">{formatSnapshot(entry.after_data)}</pre></td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
