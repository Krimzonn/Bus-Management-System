import { useEffect, useState } from "react";
import {
  ROLES,
  assignAccountRole,
  createAccount,
  errorMessage,
  getAccount,
  listAccounts,
  roleLabel,
  setAccountActive,
  updateAccountEmail,
} from "./services/api.js";

// Admin-only screen for internal accounts. The backend enforces the Admin
// permission on every request; App.jsx only shows this page to admins.

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function StatusBadge({ isActive }) {
  return (
    <span className={isActive ? "badge ok" : "badge off"}>
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

// ---- Create account form ---------------------------------------------------

function CreateAccountForm({ onCreated, onError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const account = await createAccount(email.trim(), password);
      setEmail("");
      setPassword("");
      onCreated(account);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Create account</h2>
      <label htmlFor="new-email">Email</label>
      <input
        id="new-email"
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        disabled={busy}
      />
      <label htmlFor="new-password">Temporary password (min. 12 characters)</label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        disabled={busy}
      />
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
      <p className="muted small">
        New accounts have no role until you assign one.
      </p>
    </form>
  );
}

// ---- Details and management of one account --------------------------------

function AccountDetail({ account, isSelf, onUpdated, onError, onClose }) {
  const [email, setEmail] = useState(account.email);
  const [role, setRole] = useState(account.role || "");
  const [busy, setBusy] = useState("");

  // Runs one action, then reports the updated account (or the error).
  async function run(name, action, successText) {
    setBusy(name);
    try {
      const updated = await action();
      onUpdated(updated, successText);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy("");
    }
  }

  function handleEmail(event) {
    event.preventDefault();
    run("email", () => updateAccountEmail(account.id, email.trim()), "Email updated.");
  }

  function handleRole(event) {
    event.preventDefault();
    run("role", () => assignAccountRole(account.id, role), "Role updated.");
  }

  function handleStatus() {
    const activate = !account.isActive;
    if (
      !activate &&
      !window.confirm(`Deactivate ${account.email}? They will no longer be able to sign in.`)
    ) {
      return;
    }
    run(
      "status",
      () => setAccountActive(account.id, activate),
      activate ? "Account activated." : "Account deactivated.",
    );
  }

  const disabled = busy !== "";

  return (
    <section className="card detail" aria-label="Account details">
      <div className="row-between">
        <h2>Account details</h2>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <dl className="info">
        <dt>ID</dt>
        <dd>{account.id}</dd>
        <dt>Email</dt>
        <dd>{account.email}{isSelf && " (you)"}</dd>
        <dt>Role</dt>
        <dd>{roleLabel(account.role)}</dd>
        <dt>Status</dt>
        <dd><StatusBadge isActive={account.isActive} /></dd>
        <dt>Created</dt>
        <dd>{formatDate(account.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatDate(account.updatedAt)}</dd>
      </dl>

      <form onSubmit={handleEmail} className="inline-form">
        <label htmlFor="edit-email">Change email</label>
        <div className="inline-row">
          <input
            id="edit-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={disabled}
          />
          <button
            type="submit"
            disabled={disabled || email.trim().toLowerCase() === account.email}
          >
            {busy === "email" ? "Saving…" : "Save email"}
          </button>
        </div>
      </form>

      <form onSubmit={handleRole} className="inline-form">
        <label htmlFor="edit-role">Role</label>
        <div className="inline-row">
          <select
            id="edit-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={disabled || isSelf}
          >
            {!account.role && <option value="">Select a role…</option>}
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={disabled || isSelf || !role || role === account.role}
          >
            {busy === "role" ? "Saving…" : "Assign role"}
          </button>
        </div>
        {isSelf && <p className="muted small">You cannot change your own role.</p>}
      </form>

      <div className="inline-form">
        <span className="label">Account status</span>
        <div className="inline-row">
          <button
            type="button"
            className={account.isActive ? "danger" : "primary"}
            onClick={handleStatus}
            disabled={disabled || (isSelf && account.isActive)}
          >
            {busy === "status"
              ? "Saving…"
              : account.isActive ? "Deactivate account" : "Activate account"}
          </button>
        </div>
        {isSelf && account.isActive && (
          <p className="muted small">You cannot deactivate your own account.</p>
        )}
      </div>
    </section>
  );
}

// ---- Page ---------------------------------------------------------------

export default function AccountsPage({ currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState(null);
  const [feedback, setFeedback] = useState(null); // { type: "success" | "error", text }

  // Load (or reload) the account list.
  useEffect(() => {
    let cancelled = false;
    listAccounts()
      .then((list) => {
        if (cancelled) return;
        setAccounts(list);
        setLoadError("");
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function reload() {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }

  function showError(text) {
    setFeedback({ type: "error", text });
  }

  // Replace one account in the list and in the detail panel.
  function applyUpdated(account, text) {
    setAccounts((list) => list.map((a) => (a.id === account.id ? account : a)));
    setSelected(account);
    setFeedback({ type: "success", text });
  }

  function handleCreated(account) {
    setAccounts((list) => [...list, account]);
    setSelected(account);
    setFeedback({
      type: "success",
      text: `Account ${account.email} created. Assign a role below.`,
    });
  }

  // Fetch the latest version of one account for the detail panel.
  async function handleSelect(id) {
    setFeedback(null);
    try {
      setSelected(await getAccount(id));
    } catch (err) {
      showError(errorMessage(err));
    }
  }

  return (
    <div className="accounts">
      <div className="row-between">
        <h2>Internal accounts</h2>
        <button type="button" onClick={reload} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {feedback && (
        <p
          className={`message ${feedback.type}`}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      )}

      <div className="accounts-layout">
        <section className="card list" aria-label="Account list">
          {loading && <p className="muted" role="status">Loading accounts…</p>}

          {!loading && loadError && (
            <p className="message error" role="alert">{loadError}</p>
          )}

          {!loading && !loadError && accounts.length === 0 && (
            <p className="muted">No accounts found.</p>
          )}

          {!loading && !loadError && accounts.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr
                      key={account.id}
                      className={selected?.id === account.id ? "selected" : ""}
                    >
                      <td data-label="Email">
                        {account.email}
                        {account.id === String(currentUser.id) && " (you)"}
                      </td>
                      <td data-label="Role">{roleLabel(account.role)}</td>
                      <td data-label="Status">
                        <StatusBadge isActive={account.isActive} />
                      </td>
                      <td>
                        <button type="button" onClick={() => handleSelect(account.id)}>
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="side">
          {selected && (
            <AccountDetail
              key={selected.id}
              account={selected}
              isSelf={selected.id === String(currentUser.id)}
              onUpdated={applyUpdated}
              onError={showError}
              onClose={() => setSelected(null)}
            />
          )}
          <CreateAccountForm onCreated={handleCreated} onError={showError} />
        </div>
      </div>
    </div>
  );
}
