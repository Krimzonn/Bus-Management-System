import { useId, useRef, useState } from "react";
import BusIcon from "./BusIcon.jsx";
import Dialog from "./Dialog.jsx";
import {
  BUS_STATUSES,
  FIELD_FOR_CODE,
  MAX_SEATING_CAPACITY,
  busErrorMessage,
  diffBus,
  hasEdits,
  validateBusForm,
} from "./busModel.js";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="bus-field">
      <label className="bus-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="bus-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="bus-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Presentational form. The page supplies onSubmit(payload), which performs the
// API call and throws on failure. On success the page closes this dialog.
export default function BusFormDialog({ mode, bus, onSubmit, onClose }) {
  const isEdit = mode === "edit";
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    busNumber: `${uid}-number`,
    seatingCapacity: `${uid}-capacity`,
    requiredLicenseCategory: `${uid}-category`,
    status: `${uid}-status`,
  };

  const [values, setValues] = useState(() => ({
    busNumber: isEdit ? bus.busNumber : "",
    seatingCapacity: isEdit ? String(bus.seatingCapacity) : "",
    requiredLicenseCategory: isEdit ? bus.requiredLicenseCategory : "",
    status: "active",
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

  const unchanged = isEdit && !hasEdits(bus, values);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const { errors: found, input } = validateBusForm(values, mode);
    setErrors(found);
    if (!input) {
      setFormError("Please correct the highlighted fields.");
      return;
    }

    let payload = input;
    if (isEdit) {
      payload = diffBus(bus, input);
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
      const message = busErrorMessage(error);
      const field = FIELD_FOR_CODE[error?.code];
      if (field && !(isEdit && field === "busNumber")) {
        setErrors({ [field]: message });
      } else {
        setFormError(message);
      }
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const describe = (key) =>
    errors[key] ? `${ids[key]}-error` : `${ids[key]}-hint`;

  return (
    <Dialog
      variant="modal"
      labelledBy={ids.title}
      onClose={onClose}
      dismissible={!submitting}
    >
      <form className="bus-form" onSubmit={handleSubmit} noValidate>
        <header className="bus-dialog-head">
          <div>
            <h2 className="bus-dialog-title" id={ids.title}>
              {isEdit ? `Edit bus ${bus.busNumber}` : "Add a bus"}
            </h2>
            <p className="bus-dialog-sub">
              {isEdit
                ? "Only the fields you change are saved."
                : "Register a new bus in the fleet."}
            </p>
          </div>
          <button
            type="button"
            className="bus-icon-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <BusIcon name="x" size={18} />
          </button>
        </header>

        <div className="bus-dialog-body">
          {formError && (
            <p className="bm-alert bm-alert-error" role="alert">
              {formError}
            </p>
          )}

          <Field
            id={ids.busNumber}
            label="Bus number"
            error={errors.busNumber}
            hint={
              isEdit
                ? "A bus number cannot be changed after the bus is created."
                : "Saved in upper case, for example BUS-101. Numbers are unique and never reused."
            }
          >
            <input
              id={ids.busNumber}
              className="bus-input"
              value={values.busNumber}
              onChange={(e) => update("busNumber", e.target.value)}
              maxLength={30}
              autoComplete="off"
              disabled={isEdit || submitting}
              aria-invalid={Boolean(errors.busNumber)}
              aria-describedby={describe("busNumber")}
              data-autofocus={isEdit ? undefined : ""}
            />
          </Field>

          <Field
            id={ids.seatingCapacity}
            label="Seating capacity"
            error={errors.seatingCapacity}
            hint={`A whole number from 1 to ${MAX_SEATING_CAPACITY}.`}
          >
            <input
              id={ids.seatingCapacity}
              className="bus-input"
              inputMode="numeric"
              value={values.seatingCapacity}
              onChange={(e) =>
                update("seatingCapacity", e.target.value.replace(/\D/g, ""))
              }
              maxLength={3}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={Boolean(errors.seatingCapacity)}
              aria-describedby={describe("seatingCapacity")}
              data-autofocus={isEdit ? "" : undefined}
            />
          </Field>

          <Field
            id={ids.requiredLicenseCategory}
            label="Required license category"
            error={errors.requiredLicenseCategory}
            hint="For example HTV. Saved in upper case."
          >
            <input
              id={ids.requiredLicenseCategory}
              className="bus-input"
              value={values.requiredLicenseCategory}
              onChange={(e) =>
                update("requiredLicenseCategory", e.target.value)
              }
              maxLength={20}
              autoComplete="off"
              disabled={submitting}
              aria-invalid={Boolean(errors.requiredLicenseCategory)}
              aria-describedby={describe("requiredLicenseCategory")}
            />
          </Field>

          {!isEdit && (
            <Field
              id={ids.status}
              label="Initial status"
              hint="You can change the status later."
            >
              <select
                id={ids.status}
                className="bus-input bus-select"
                value={values.status}
                onChange={(e) => update("status", e.target.value)}
                disabled={submitting}
                aria-describedby={`${ids.status}-hint`}
              >
                {BUS_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <footer className="bus-dialog-foot">
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
                : "Adding…"
              : isEdit
                ? "Save changes"
                : "Add bus"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}