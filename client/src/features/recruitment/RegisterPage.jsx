import { useState } from "react";
import AuthLayout from "../../layouts/AuthLayout.jsx";
import { registerApplicant, errorMessage, login } from "../../services/api.js";
export default function RegisterPage({ onBack, onLoggedIn }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [registered, setRegistered] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!registered) {
        await registerApplicant({ email, password });
        setRegistered(true);
      }
      const user = await login(email, password);
      setPassword("");
      onLoggedIn(user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout
      title="Applicant registration"
      subtitle="Create an account to apply for a driver position."
    >
      <form className="bm-form" onSubmit={submit}>
        {error && (
          <p role="alert" className="bm-alert bm-alert-error">
            {error}
          </p>
        )}
        {registered && (
          <p role="status">Account created. Sign in to continue.</p>
        )}
        <label className="bm-field">
          Email
          <input
            className="bm-input"
            type="email"
            autoComplete="username"
            required
            maxLength={255}
            value={email}
            disabled={busy || registered}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="bm-field">
          Password (12–128 characters)
          <input
            className="bm-input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="bm-btn bm-btn-primary" disabled={busy}>
          {busy
            ? "Please wait…"
            : registered
              ? "Sign in"
              : "Create applicant account"}
        </button>
        <button
          type="button"
          className="bm-btn"
          onClick={onBack}
          disabled={busy}
        >
          Back to sign in
        </button>
      </form>
    </AuthLayout>
  );
}
