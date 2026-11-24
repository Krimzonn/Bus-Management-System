import { useState } from "react";
import AuthLayout from "../layouts/AuthLayout.jsx";
import Icon from "../components/Icon.jsx";
import { errorMessage, login } from "../services/api.js";

// Same behaviour as before: login(), error text from api.js, session notice.
export default function LoginPage({ notice, onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      setPassword(""); // do not keep the password around
      onLoggedIn(user);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue."
      footer="Internal accounts are created by an Admin."
    >
      <form className="bm-form" onSubmit={handleSubmit} noValidate={false}>
        {notice && (
          <p className="bm-alert bm-alert-info" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="bm-alert bm-alert-error" role="alert">
            {error}
          </p>
        )}

        <div className="bm-field">
          <label className="bm-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="bm-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
          />
        </div>

        <div className="bm-field">
          <label className="bm-label" htmlFor="password">
            Password
          </label>
          <div className="bm-password">
            <input
              id="password"
              className="bm-input"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={submitting}
            />
            <button
              type="button"
              className="bm-password-toggle"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              disabled={submitting}
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="bm-btn bm-btn-primary bm-btn-block"
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
