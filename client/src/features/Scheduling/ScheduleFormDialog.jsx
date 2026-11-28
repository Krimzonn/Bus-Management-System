import { useEffect, useId, useRef, useState } from "react";
import ScheduleDialog from "./ScheduleDialog.jsx";
import ScheduleIcon from "./ScheduleIcon.jsx";
import {
  FIELD_FOR_CODE,
  addDays,
  advisoryMessages,
  busLabel,
  busOk,
  diffSchedule,
  driverLabel,
  driverOk,
  formatDate,
  isCalendarDate,
  isOvernight,
  routeLabel,
  routeOk,
  scheduleErrorMessage,
  selectable,
  validateScheduleForm,
} from "./scheduleModel.js";

function Field({ id, label, error, hint, children }) {
  return (
    <div className="sc-field">
      <label className="sc-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="sc-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="sc-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// Presentational form. The page supplies onSubmit(payload), which performs the
// API call and throws on failure; on success the page closes this dialog.
// In create mode an empty driver/route means "use the bus default".
export default function ScheduleFormDialog({ mode, schedule, lookups, onSubmit, onClose }) {
  const isEdit = mode === "edit";
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    travelDate: `${uid}-date`,
    departureTime: `${uid}-dep`,
    arrivalTime: `${uid}-arr`,
    busId: `${uid}-bus`,
    driverId: `${uid}-driver`,
    routeId: `${uid}-route`,
  };

  const [values, setValues] = useState(() => ({
    travelDate: isEdit ? schedule.travelDate : "",
    departureTime: isEdit ? schedule.departureTime : "",
    arrivalTime: isEdit ? schedule.arrivalTime : "",
    busId: isEdit ? schedule.busId : "",
    driverId: isEdit ? schedule.driverId : "",
    routeId: isEdit ? schedule.routeId : "",
  }));
  const [errors, setErrors] = useState({});
  const [flagged, setFlagged] = useState(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // blocks double submits before re-render
  const alertRef = useRef(null);

  useEffect(() => {
    if (formError) alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [formError]);

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFlagged(null);
    setFormError("");
  }

  const { buses, drivers, routes } = lookups;
  const optionsReady = !lookups.loading && !lookups.error;
  const bus = buses.find((item) => item.id === values.busId);
  const nameOf = (list, id, pick, fallback) => list.find((item) => item.id === id)?.[pick] ?? fallback;
  const defaultDriver = bus?.defaultDriverId
    ? nameOf(drivers, bus.defaultDriverId, "fullName", `driver #${bus.defaultDriverId}`)
    : null;
  const defaultRoute = bus?.defaultRouteId
    ? nameOf(routes, bus.defaultRouteId, "routeCode", `route #${bus.defaultRouteId}`)
    : null;

  const unchanged = isEdit && Object.keys(diffSchedule(schedule, values)).length === 0;
  const advice = optionsReady ? advisoryMessages(values, lookups) : [];
  const overnight =
    values.departureTime && values.arrivalTime && isOvernight(values.departureTime, values.arrivalTime);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submittingRef.current) return;

    const { errors: found, input } = validateScheduleForm(values, mode, buses);
    setErrors(found);
    if (!input) {
      setFormError("Please correct the highlighted fields.");
      return;
    }

    let payload = input;
    if (isEdit) {
      payload = diffSchedule(schedule, input);
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
      setFormError(scheduleErrorMessage(error));
      setFlagged(FIELD_FOR_CODE[error?.code] ?? null);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const invalid = (key) => Boolean(errors[key]) || flagged === key;
  const describe = (key) => (errors[key] ? `${ids[key]}-error` : `${ids[key]}-hint`);
  const control = (key) => ({
    id: ids[key],
    className: "sc-input",
    value: values[key],
    onChange: (e) => update(key, e.target.value),
    disabled: submitting,
    "aria-invalid": invalid(key),
    "aria-describedby": describe(key),
  });
  const selectControl = (key) => ({
    ...control(key),
    className: "sc-input sc-select",
    disabled: submitting || !optionsReady,
  });

  const currentBusId = isEdit ? schedule.busId : null;

  return (
    <ScheduleDialog variant="modal" labelledBy={ids.title} onClose={onClose} dismissible={!submitting}>
      {(close) => (
        <form className="sc-form" onSubmit={handleSubmit} noValidate>
          <header className="sc-dialog-head">
            <div>
              <h2 className="sc-dialog-title" id={ids.title}>
                {isEdit ? `Edit trip on ${formatDate(schedule.travelDate)}` : "Create a schedule"}
              </h2>
              <p className="sc-dialog-sub">
                {isEdit
                  ? "Only the fields you change are saved. The whole assignment is checked again."
                  : "Eligibility and clashes are checked when you save."}
              </p>
            </div>
            <button
              type="button"
              className="sc-icon-btn"
              onClick={close}
              disabled={submitting}
              aria-label="Close"
            >
              <ScheduleIcon name="x" size={18} />
            </button>
          </header>

          <div className="sc-dialog-body">
            {formError && (
              <p className="bm-alert bm-alert-error" role="alert" ref={alertRef}>
                {formError}
              </p>
            )}
            {lookups.loading && (
              <p className="bm-alert bm-alert-info" role="status">
                Loading buses, drivers and routes…
              </p>
            )}
            {lookups.error && (
              <p className="bm-alert bm-alert-error" role="alert">
                {lookups.error} Close this window and use Refresh to try again.
              </p>
            )}

            <section className="sc-form-group" aria-label="Trip timing">
              <h3 className="sc-section-title">Trip timing</h3>
              <Field id={ids.travelDate} label="Travel date" error={errors.travelDate}>
                <input {...control("travelDate")} type="date" data-autofocus="" />
              </Field>
              <div className="sc-form-row">
                <Field id={ids.departureTime} label="Departure" error={errors.departureTime}>
                  <input {...control("departureTime")} type="time" step="60" />
                </Field>
                <Field id={ids.arrivalTime} label="Arrival" error={errors.arrivalTime}>
                  <input {...control("arrivalTime")} type="time" step="60" />
                </Field>
              </div>
              {overnight && (
                <p className="sc-field-hint">
                  Arrives the next day
                  {isCalendarDate(values.travelDate) && ` (${formatDate(addDays(values.travelDate, 1))})`}.
                </p>
              )}
            </section>

            <section className="sc-form-group" aria-label="Assignment">
              <h3 className="sc-section-title">Assignment</h3>
              <Field
                id={ids.busId}
                label="Bus"
                error={errors.busId}
                hint="Only active buses are listed."
              >
                <select {...selectControl("busId")}>
                  <option value="">Select a bus…</option>
                  {selectable(buses, busOk, currentBusId).map((item) => (
                    <option key={item.id} value={item.id}>
                      {busLabel(item)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id={ids.driverId}
                label="Driver"
                error={errors.driverId}
                hint={
                  !isEdit && defaultDriver
                    ? `Bus default: ${defaultDriver}. Choose another driver to override it.`
                    : "Only available drivers are listed."
                }
              >
                <select {...selectControl("driverId")}>
                  <option value="">
                    {!isEdit && defaultDriver ? `Use bus default (${defaultDriver})` : "Select a driver…"}
                  </option>
                  {selectable(drivers, driverOk, isEdit ? schedule.driverId : null).map((item) => (
                    <option key={item.id} value={item.id}>
                      {driverLabel(item)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                id={ids.routeId}
                label="Route"
                error={errors.routeId}
                hint={
                  !isEdit && defaultRoute
                    ? `Bus default: ${defaultRoute}. Choose another route to override it.`
                    : "Only unblocked routes are listed."
                }
              >
                <select {...selectControl("routeId")}>
                  <option value="">
                    {!isEdit && defaultRoute ? `Use bus default (${defaultRoute})` : "Select a route…"}
                  </option>
                  {selectable(routes, routeOk, isEdit ? schedule.routeId : null).map((item) => (
                    <option key={item.id} value={item.id}>
                      {routeLabel(item)}
                    </option>
                  ))}
                </select>
              </Field>

              {advice.length > 0 && (
                <ul className="sc-advice" aria-label="Things to check">
                  {advice.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <footer className="sc-dialog-foot">
            <button type="button" className="bm-btn" onClick={close} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="bm-btn bm-btn-primary"
              disabled={submitting || unchanged || !optionsReady}
            >
              {submitting
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create schedule"}
            </button>
          </footer>
        </form>
      )}
    </ScheduleDialog>
  );
}
