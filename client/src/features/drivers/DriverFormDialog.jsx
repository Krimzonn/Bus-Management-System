import { useId, useRef, useState } from "react";
import DriverDialog from "./DriverDialog.jsx";
import DriverIcon from "./DriverIcon.jsx";
import {
  DRIVER_STATUSES,
  FIELD_FOR_CODE,
  MAX_NAME_LENGTH,
  diffDriver,
  driverErrorMessage,
  hasEdits,
  validateDriverForm,
} from "./DriverModel.js";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="dr-field">
      <label className="dr-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="dr-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : (
        <p className="dr-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

// Presentational form. The page supplies onSubmit(payload), which performs the
// API call and throws on failure. On success the page closes this dialog.
export default function DriverFormDialog({ mode, driver, onSubmit, onClose }) {
  const isEdit = mode === "edit";
  const isRegistration = mode === "registration";
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    fullName: `${uid}-name`,
    licenseNumber: `${uid}-number`,
    licenseCategory: `${uid}-category`,
    licenseExpiryDate: `${uid}-expiry`,
    status: `${uid}-status`,
  };

  const [values, setValues] = useState(() => ({
    fullName: isEdit || isRegistration ? driver.fullName : "",
    licenseNumber: isEdit ? driver.licenseNumber : "",
    licenseCategory: isEdit ? driver.licenseCategory : "",
    licenseExpiryDate: isEdit ? driver.licenseExpiryDate : "",
    status: "available",
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

  const unchanged = isEdit && !hasEdits(driver, values);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const { errors: found, input } = validateDriverForm(values, mode);
    setErrors(found);
    if (!input) {
      setFormError("Please correct the highlighted fields.");
      return;
    }

    let payload = isRegistration
      ? {
          licenseNumber: input.licenseNumber,
          licenseCategory: input.licenseCategory,
          licenseExpiryDate: input.licenseExpiryDate,
        }
      : input;
    if (isEdit) {
      payload = diffDriver(driver, input);
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
      const message = driverErrorMessage(error);
      const field = FIELD_FOR_CODE[error?.code];
      if (field) setErrors({ [field]: message });
      else setFormError(message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const describe = (key) =>
    errors[key] ? `${ids[key]}-error` : `${ids[key]}-hint`;
  const input = (key) => ({
    id: ids[key],
    className: "dr-input",
    value: values[key],
    onChange: (e) => update(key, e.target.value),
    disabled: submitting,
    autoComplete: "off",
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": describe(key),
  });

  return (
    <DriverDialog
      variant="modal"
      labelledBy={ids.title}
      onClose={onClose}
      dismissible={!submitting}
    >
      {(close) => (
        <form className="dr-form" onSubmit={handleSubmit} noValidate>
          <header className="dr-dialog-head">
            <div>
              <h2 className="dr-dialog-title" id={ids.title}>
                {isEdit
                  ? `Edit ${driver.fullName}`
                  : isRegistration
                    ? "Register as a driver"
                    : "Add a driver"}
              </h2>
              <p className="dr-dialog-sub">
                {isEdit
                  ? "Only the fields you change are saved."
                  : "Register a driver and their license."}
              </p>
            </div>
            <button
              type="button"
              className="dr-icon-btn"
              onClick={close}
              disabled={submitting}
              aria-label="Close"
            >
              <DriverIcon name="x" size={18} />
            </button>
          </header>

          <div className="dr-dialog-body">
            {formError && (
              <p className="bm-alert bm-alert-error" role="alert">
                {formError}
              </p>
            )}

            <section className="dr-form-group" aria-label="Driver information">
              <h3 className="dr-section-title">Driver information</h3>
              <Field
                id={ids.fullName}
                label="Full name"
                error={errors.fullName}
                hint={`Up to ${MAX_NAME_LENGTH} characters.`}
              >
                <input
                  {...input("fullName")}
                  maxLength={MAX_NAME_LENGTH}
                  readOnly={isRegistration}
                  data-autofocus=""
                />
              </Field>
              {!isEdit && !isRegistration && (
                <Field
                  id={ids.status}
                  label="Initial status"
                  hint="You can change the status later."
                >
                  <select
                    id={ids.status}
                    className="dr-input dr-select"
                    value={values.status}
                    onChange={(e) => update("status", e.target.value)}
                    disabled={submitting}
                    aria-describedby={`${ids.status}-hint`}
                  >
                    {DRIVER_STATUSES.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </section>

            <section className="dr-form-group" aria-label="License information">
              <h3 className="dr-section-title">License information</h3>
              <Field
                id={ids.licenseNumber}
                label="License number"
                error={errors.licenseNumber}
                hint="Saved in upper case. Unique, ignoring spaces, “-” and “/”, even across archived drivers."
              >
                <input {...input("licenseNumber")} maxLength={30} />
              </Field>
              <Field
                id={ids.licenseCategory}
                label="License category"
                error={errors.licenseCategory}
                hint="For example HTV. Must match a bus’s required category to qualify for it."
              >
                <input {...input("licenseCategory")} maxLength={20} />
              </Field>
              <Field
                id={ids.licenseExpiryDate}
                label="Expiry date"
                error={errors.licenseExpiryDate}
                hint="The license is valid through the whole of this day. Past dates are accepted so expired licenses can be recorded."
              >
                <input {...input("licenseExpiryDate")} type="date" />
              </Field>
            </section>
          </div>

          <footer className="dr-dialog-foot">
            <button
              type="button"
              className="bm-btn"
              onClick={close}
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
                  : "Adding…"
                : isEdit
                  ? "Save changes"
                  : isRegistration
                    ? "Register as driver"
                    : "Add driver"}
            </button>
          </footer>
        </form>
      )}
    </DriverDialog>
  );
}
