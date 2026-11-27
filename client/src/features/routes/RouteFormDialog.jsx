import { useId, useRef, useState } from "react";
import RouteDialog from "./RouteDialog.jsx";
import RouteIcon from "./RouteIcon.jsx";
import {
  FIELD_FOR_CODE,
  MAX_TEXT_LENGTH,
  diffRoute,
  hasEdits,
  routeErrorMessage,
  validateRouteForm,
} from "./routeModel.js";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="rt-field">
      <label className="rt-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="rt-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : (
        <p className="rt-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

// Presentational form. The page supplies onSubmit(payload), which performs the
// API call and throws on failure. On success the page closes this dialog.
export default function RouteFormDialog({ mode, route, onSubmit, onClose }) {
  const isEdit = mode === "edit";
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    routeCode: `${uid}-code`,
    name: `${uid}-name`,
    origin: `${uid}-origin`,
    destination: `${uid}-destination`,
  };

  const [values, setValues] = useState(() => ({
    routeCode: isEdit ? route.routeCode : "",
    name: isEdit ? route.name : "",
    origin: isEdit ? route.origin : "",
    destination: isEdit ? route.destination : "",
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // blocks double submits before re-render

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFormError("");
  }

  const unchanged = isEdit && !hasEdits(route, values);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const { errors: found, input } = validateRouteForm(values, mode);
    setErrors(found);
    if (!input) {
      setFormError("Please correct the highlighted fields.");
      return;
    }

    let payload = input;
    if (isEdit) {
      payload = diffRoute(route, input);
      if (Object.keys(payload).length === 0) {
        setFormError("There are no changes to save.");
        return;
      }
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError("");
    try {
      await onSubmit(payload);
    } catch (error) {
      const message = routeErrorMessage(error);
      const field = FIELD_FOR_CODE[error?.code];
      if (field && !(isEdit && field === "routeCode")) {
        setErrors({ [field]: message });
      } else {
        setFormError(message);
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const describe = (key) => (errors[key] ? `${ids[key]}-error` : `${ids[key]}-hint`);

  return (
    <RouteDialog
      variant="modal"
      labelledBy={ids.title}
      onClose={onClose}
      dismissible={!submitting}
    >
      <form className="rt-form" onSubmit={handleSubmit} noValidate>
        <header className="rt-dialog-head">
          <div>
            <h2 className="rt-dialog-title" id={ids.title}>
              {isEdit ? `Edit route ${route.routeCode}` : "Create route"}
            </h2>
            <p className="rt-dialog-sub">
              {isEdit
                ? "Only the fields you change are saved."
                : "New routes start as Unblocked."}
            </p>
          </div>
          <button
            type="button"
            className="rt-icon-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <RouteIcon name="x" size={18} />
          </button>
        </header>

        <div className="rt-dialog-body">
          {formError && (
            <p className="bm-alert bm-alert-error" role="alert">
              {formError}
            </p>
          )}

          <Field
            id={ids.routeCode}
            label="Route code"
            error={errors.routeCode}
            hint={
              isEdit
                ? "A route code cannot be changed after the route is created."
                : "Saved in upper case, for example RT-001. Codes are unique and never reused."
            }
          >
            <input
              id={ids.routeCode}
              className="rt-input"
              value={values.routeCode}
              onChange={(e) => update("routeCode", e.target.value)}
              maxLength={30}
              autoComplete="off"
              disabled={isEdit || submitting}
              aria-invalid={Boolean(errors.routeCode)}
              aria-describedby={describe("routeCode")}
              data-autofocus={isEdit ? undefined : ""}
            />
          </Field>

          <Field
            id={ids.name}
            label="Route name"
            error={errors.name}
            hint={`Up to ${MAX_TEXT_LENGTH} characters.`}
          >
            <input
              id={ids.name}
              className="rt-input"
              value={values.name}
              onChange={(e) => update("name", e.target.value)}
              maxLength={MAX_TEXT_LENGTH}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describe("name")}
              data-autofocus={isEdit ? "" : undefined}
            />
          </Field>

          <Field
            id={ids.origin}
            label="Origin"
            error={errors.origin}
            hint={`Where the route starts. Up to ${MAX_TEXT_LENGTH} characters.`}
          >
            <input
              id={ids.origin}
              className="rt-input"
              value={values.origin}
              onChange={(e) => update("origin", e.target.value)}
              maxLength={MAX_TEXT_LENGTH}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={Boolean(errors.origin)}
              aria-describedby={describe("origin")}
            />
          </Field>

          <Field
            id={ids.destination}
            label="Destination"
            error={errors.destination}
            hint={`Where the route ends. Up to ${MAX_TEXT_LENGTH} characters.`}
          >
            <input
              id={ids.destination}
              className="rt-input"
              value={values.destination}
              onChange={(e) => update("destination", e.target.value)}
              maxLength={MAX_TEXT_LENGTH}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={Boolean(errors.destination)}
              aria-describedby={describe("destination")}
            />
          </Field>
        </div>

        <footer className="rt-dialog-foot">
          <button
            type="button"
            className="bm-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="bm-btn bm-btn-primary"
            disabled={submitting || unchanged}
          >
            {submitting
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create route"}
          </button>
        </footer>
      </form>
    </RouteDialog>
  );
}