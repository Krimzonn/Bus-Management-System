import { useId, useRef, useState } from "react";
import FuelDialog from "./FuelDialog.jsx";
import FuelIcon from "./FuelIcon.jsx";
import {
  EMPTY_FORM,
  FIELD_FOR_CODE,
  MAX_DATE,
  MIN_DATE,
  MAX_ODOMETER,
  diffRecord,
  fuelErrorMessage,
  hasEdits,
  toCreatePayload,
  validateFuelForm,
  valuesFromRecord,
} from "./fuelModel.js";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="fu-field">
      <label className="fu-label" htmlFor={id}>
        {label}
        <span className="fu-required" aria-hidden="true"> *</span>
      </label>
      {children}
      {error ? (
        <p className="fu-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="fu-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Presentational form. The page supplies onSubmit(payload), which performs the
// API call and throws on failure. On success the page closes this dialog. On
// failure the dialog stays open and every value the user typed is kept, so an
// odometer rejection can be corrected and resubmitted.
export default function FuelFormDialog({
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
    purchaseDate: `${uid}-date`,
    liters: `${uid}-liters`,
    totalCost: `${uid}-cost`,
    odometer: `${uid}-odometer`,
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

    const { errors: found, input } = validateFuelForm(values, mode);
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
      const message = fuelErrorMessage(error);
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
    className: "fu-input",
    value: values[key],
    onChange: (e) => update(key, e.target.value),
    disabled: submitting,
    autoComplete: "off",
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": describe(key),
  });

  return (
    <FuelDialog variant="modal" labelledBy={ids.title} onClose={onClose} dismissible={!submitting}>
      <form className="fu-form" onSubmit={handleSubmit} noValidate>
        <header className="fu-dialog-head">
          <div>
            <h2 className="fu-dialog-title" id={ids.title}>
              {isEdit ? `Edit fuel record for bus ${record.busNumber}` : "Add fuel record"}
            </h2>
            <p className="fu-dialog-sub">
              {isEdit ? "Only the fields you change are saved." : "All fields are required."}
            </p>
          </div>
          <button
            type="button"
            className="fu-icon-btn"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <FuelIcon name="x" size={18} />
          </button>
        </header>

        <div className="fu-dialog-body">
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
            error={errors.busId}
            hint={
              isEdit
                ? "The bus of a record cannot be changed."
                : "Archived buses cannot receive new records."
            }
          >
            <select
              {...control("busId")}
              className="fu-input fu-select"
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

          <Field id={ids.purchaseDate} label="Purchase date" error={errors.purchaseDate}>
            <input
              {...control("purchaseDate")}
              type="date"
              min={MIN_DATE}
              max={MAX_DATE}
              data-autofocus={isEdit ? "" : undefined}
            />
          </Field>

          <div className="fu-form-row">
            <Field
              id={ids.liters}
              label="Fuel quantity (liters)"
              error={errors.liters}
              hint="Greater than zero, up to 2 decimals."
            >
              <input {...control("liters")} inputMode="decimal" maxLength={11} />
            </Field>
            <Field
              id={ids.totalCost}
              label="Total cost"
              error={errors.totalCost}
              hint="Zero or more, up to 2 decimals."
            >
              <input {...control("totalCost")} inputMode="decimal" maxLength={13} />
            </Field>
          </div>

          <Field
            id={ids.odometer}
            label="Odometer reading"
            error={errors.odometer}
            hint={`Whole number, 0 to ${MAX_ODOMETER.toLocaleString("en-US")}. Must not be lower than earlier readings for this bus.`}
          >
            <input {...control("odometer")} inputMode="numeric" maxLength={8} />
          </Field>
        </div>

        <footer className="fu-dialog-foot">
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
    </FuelDialog>
  );
}