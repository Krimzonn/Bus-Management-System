import { useId, useRef, useState } from "react";
import MaintenanceDialog from "./MaintenanceDialog.jsx";
import MaintenanceIcon from "./MaintenanceIcon.jsx";
import {
  EMPTY_FORM,
  FIELD_FOR_CODE,
  MAX_DATE,
  MAX_DESCRIPTION_LENGTH,
  MAX_TYPE_LENGTH,
  MIN_DATE,
  diffRecord,
  hasEdits,
  isCalendarDate,
  maintenanceErrorMessage,
  toCreatePayload,
  validateMaintenanceForm,
  valuesFromRecord,
} from "./maintenanceModel.js";

function Field({ id, label, required, error, hint, children }) {
  return (
    <div className="mt-field">
      <label className="mt-label" htmlFor={id}>
        {label}
        {required && <span className="mt-required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Presentational form. The page supplies onSubmit(payload), which performs the
// API call and throws on failure. On success the page closes this dialog. On
// failure the user's input is kept. `buses` are the buses that can receive a
// new record (not archived).
export default function MaintenanceFormDialog({
  mode,
  record,
  buses,
  busesLoading,
  busesError,
  onSubmit,
  onClose,
}) {
  const isEdit = mode === "edit";
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    busId: `${uid}-bus`,
    serviceDate: `${uid}-service`,
    maintenanceType: `${uid}-type`,
    workDescription: `${uid}-description`,
    cost: `${uid}-cost`,
    odometer: `${uid}-odometer`,
    nextServiceDate: `${uid}-next`,
  };

  const [values, setValues] = useState(() => (isEdit ? valuesFromRecord(record) : EMPTY_FORM));
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

  const unchanged = isEdit && !hasEdits(record, values);
  const busReady = isEdit || (!busesLoading && !busesError);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const { errors: found, input } = validateMaintenanceForm(values, mode);
    setErrors(found);
    if (!input) {
      setFormError("Please correct the highlighted fields.");
      return;
    }

    let payload;
    if (isEdit) {
      payload = diffRecord(record, input);
      if (Object.keys(payload).length === 0) {
        setFormError("There are no changes to save.");
        return;
      }
    } else {
      payload = toCreatePayload(values.busId, input);
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError("");
    try {
      await onSubmit(payload);
    } catch (error) {
      const message = maintenanceErrorMessage(error);
      const field = FIELD_FOR_CODE[error?.code];
      if (field && !(isEdit && field === "busId")) setErrors({ [field]: message });
      else setFormError(message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const describe = (key) => (errors[key] ? `${ids[key]}-error` : `${ids[key]}-hint`);
  const control = (key) => ({
    id: ids[key],
    className: "mt-input",
    value: values[key],
    onChange: (e) => update(key, e.target.value),
    disabled: submitting,
    autoComplete: "off",
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": describe(key),
  });

  const nextMin = isCalendarDate(values.serviceDate) ? values.serviceDate : MIN_DATE;

  return (
    <MaintenanceDialog
      variant="modal"
      labelledBy={ids.title}
      onClose={onClose}
      dismissible={!submitting}
    >
      <form className="mt-form" onSubmit={handleSubmit} noValidate>
        <header className="mt-dialog-head">
          <div>
            <h2 className="mt-dialog-title" id={ids.title}>
              {isEdit ? `Edit record for bus ${record.busNumber}` : "Add maintenance record"}
            </h2>
            <p className="mt-dialog-sub">
              {isEdit
                ? "Only the fields you change are saved."
                : "Fields marked * are required."}
            </p>
          </div>
          <button
            type="button"
            className="mt-icon-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <MaintenanceIcon name="x" size={18} />
          </button>
        </header>

        <div className="mt-dialog-body">
          {formError && (
            <p className="bm-alert bm-alert-error" role="alert">
              {formError}
            </p>
          )}
          {!isEdit && busesLoading && (
            <p className="bm-alert bm-alert-info" role="status">
              Loading buses…
            </p>
          )}
          {!isEdit && busesError && (
            <p className="bm-alert bm-alert-error" role="alert">
              {busesError} Close this window and use Refresh to try again.
            </p>
          )}

          <Field
            id={ids.busId}
            label="Bus"
            required
            error={errors.busId}
            hint={
              isEdit
                ? "The bus of a record cannot be changed."
                : "Archived buses cannot receive new records."
            }
          >
            <select
              {...control("busId")}
              className="mt-input mt-select"
              disabled={submitting || isEdit || !busReady}
              data-autofocus={isEdit ? undefined : ""}
            >
              {isEdit ? (
                <option value={record.busId}>{record.busNumber}</option>
              ) : (
                <>
                  <option value="">Select a bus…</option>
                  {buses.map((bus) => (
                    <option key={bus.id} value={bus.id}>
                      {bus.busNumber} · {bus.seatingCapacity} seats
                    </option>
                  ))}
                </>
              )}
            </select>
          </Field>

          <div className="mt-form-row">
            <Field id={ids.serviceDate} label="Service date" required error={errors.serviceDate}>
              <input
                {...control("serviceDate")}
                type="date"
                min={MIN_DATE}
                max={MAX_DATE}
                data-autofocus={isEdit ? "" : undefined}
              />
            </Field>
            <Field
              id={ids.nextServiceDate}
              label="Next service date"
              error={errors.nextServiceDate}
              hint="Optional. Not earlier than the service date."
            >
              <input {...control("nextServiceDate")} type="date" min={nextMin} max={MAX_DATE} />
            </Field>
          </div>

          <Field
            id={ids.maintenanceType}
            label="Maintenance type"
            required
            error={errors.maintenanceType}
            hint={`For example Oil change. Up to ${MAX_TYPE_LENGTH} characters.`}
          >
            <input {...control("maintenanceType")} maxLength={MAX_TYPE_LENGTH} />
          </Field>

          <Field
            id={ids.workDescription}
            label="Work description"
            required
            error={errors.workDescription}
            hint={`What was done, on a single line. Up to ${MAX_DESCRIPTION_LENGTH} characters.`}
          >
            <input {...control("workDescription")} maxLength={MAX_DESCRIPTION_LENGTH} />
          </Field>

          <div className="mt-form-row">
            <Field
              id={ids.cost}
              label="Cost"
              required
              error={errors.cost}
              hint="Zero or more, up to 2 decimals."
            >
              <input {...control("cost")} inputMode="decimal" maxLength={13} />
            </Field>
            <Field
              id={ids.odometer}
              label="Odometer reading"
              error={errors.odometer}
              hint="Optional whole number."
            >
              <input {...control("odometer")} inputMode="numeric" maxLength={8} />
            </Field>
          </div>
        </div>

        <footer className="mt-dialog-foot">
          <button type="button" className="bm-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="bm-btn bm-btn-primary"
            disabled={submitting || unchanged || !busReady}
          >
            {submitting
              ? isEdit
                ? "Saving…"
                : "Adding…"
              : isEdit
                ? "Save changes"
                : "Add record"}
          </button>
        </footer>
      </form>
    </MaintenanceDialog>
  );
}