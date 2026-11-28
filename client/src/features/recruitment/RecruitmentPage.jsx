import { useEffect, useRef, useState } from "react";
import {
  listRecruitment,
  getRecruitment,
  submitRecruitment,
  changeRecruitmentStatus,
  saveRecruitmentInterview,
  registerRecruitmentDriver,
  errorMessage,
} from "../../services/api.js";
import { CAPABILITIES, can } from "../../utils/permissions.js";
import DriverFormDialog from "../drivers/DriverFormDialog.jsx";
import {
  STATUS_LABELS as labels,
  workflowSteps,
  recruitmentActions,
} from "./recruitmentModel.js";
import "../drivers/drivers.css";
import "./recruitment.css";

const EMPTY_APPLICATION = { fullName: "", experience: "" };
const EMPTY_INTERVIEW = { date: "", notes: "", outcome: "" };
const EVENT_LABELS = {
  submitted: "Application submitted",
  status_changed: "Status changed",
  interview_recorded: "Interview information recorded",
  driver_registered: "Driver registration completed",
};

function Field({
  label,
  value,
  onChange,
  type = "text",
  maxLength,
  required = true,
}) {
  return (
    <label className="rec-field">
      {label}
      <input
        className="bm-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

function Fields({ values, setValues, fields }) {
  return fields.map(([key, label, type, maxLength, required]) => (
    <Field
      key={key}
      label={label}
      type={type}
      maxLength={maxLength}
      required={required}
      value={values[key]}
      onChange={(value) => setValues((old) => ({ ...old, [key]: value }))}
    />
  ));
}

function recruitmentError(err) {
  return err?.code === "INVALID_INPUT"
    ? "Check the information you entered and try again."
    : errorMessage(err);
}

function History({ history }) {
  return (
    <ol className="rec-history">
      {history.map((h) => (
        <li key={h.id}>
          <strong>{labels[h.new_status]}</strong>
          <small>
            {EVENT_LABELS[h.event] ?? h.event} ·{" "}
            {new Date(h.created_at).toLocaleString()}
          </small>
          {h.details?.interviewDate && (
            <p>Interview date: {h.details.interviewDate}</p>
          )}
          {h.details?.outcome && <p>Outcome: {h.details.outcome}</p>}
          {h.details?.notes && <p>{h.details.notes}</p>}
          {h.details?.decisionReason && <p>{h.details.decisionReason}</p>}
          {h.details?.driverId && <p>Driver record #{h.details.driverId}</p>}
        </li>
      ))}
    </ol>
  );
}

export default function RecruitmentPage({ user }) {
  const own = can(user, CAPABILITIES.APPLY_RECRUITMENT);
  const manage = can(user, CAPABILITIES.MANAGE_RECRUITMENT);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [revision, setRevision] = useState(0);
  const [listResult, setListResult] = useState(null);
  const [detailResult, setDetailResult] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(EMPTY_APPLICATION);
  const [interview, setInterview] = useState(EMPTY_INTERVIEW);
  const [reason, setReason] = useState("");
  const [driverOpen, setDriverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useRef(false);
  const listKey = JSON.stringify([own, query, filter, page, revision]);
  const detailKey = JSON.stringify([own, selectedId, revision]);
  const listLoading = listResult?.key !== listKey;
  const detailLoading = Boolean(selectedId && detailResult?.key !== detailKey);
  const items = listLoading ? [] : (listResult?.items ?? []);
  const detail = !detailLoading && selectedId ? detailResult?.data : null;
  const actions = detail ? recruitmentActions(detail, { own, manage }) : {};
  const refresh = () => setRevision((v) => v + 1);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () => {
        listRecruitment(own, { q: query.trim(), status: filter, page })
          .then((data) => {
            if (active)
              setListResult({
                key: listKey,
                items: own ? data : data.items,
                hasMore: !own && data.hasMore,
              });
          })
          .catch((err) => {
            if (active)
              setListResult({ key: listKey, error: recruitmentError(err) });
          });
      },
      own ? 0 : 200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [own, query, filter, page, listKey]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    getRecruitment(own, selectedId)
      .then((data) => {
        if (!active) return;
        setDetailResult({ key: detailKey, data });
        setInterview({
          date: data.interview_date ?? "",
          notes: data.interview_notes ?? "",
          outcome: data.interview_outcome ?? "",
        });
      })
      .catch((err) => {
        if (active)
          setDetailResult({ key: detailKey, error: recruitmentError(err) });
      });
    return () => {
      active = false;
    };
  }, [own, selectedId, detailKey]);

  function open(id) {
    if (selectedId === id) return;
    setSelectedId(id);
    setReason("");
    setDriverOpen(false);
    setError("");
    setNotice("");
  }

  async function act(operation) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      setSelectedId(result.id);
      setReason("");
      refresh();
      setNotice("Changes saved successfully.");
    } catch (err) {
      setError(recruitmentError(err));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  function next(status) {
    const final = status === "selected" || status === "rejected";
    if (
      final &&
      !window.confirm(
        `Finalize this application as ${labels[status]}? This cannot be undone.`,
      )
    )
      return;
    void act(() =>
      changeRecruitmentStatus(detail.id, {
        status,
        ...(final ? { reason } : {}),
      }),
    );
  }

  return (
    <section className="rec-page">
      <header>
        <p className="rec-eyebrow">Recruitment</p>
        <h1>{own ? "My applications" : "Applicant review"}</h1>
        <p>Track applications, interviews and driver registration.</p>
        <button
          className="bm-btn"
          onClick={refresh}
          disabled={busy || driverOpen}
        >
          Refresh
        </button>
      </header>
      {error && (
        <p className="bm-alert bm-alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="bm-alert bm-alert-info" role="status">
          {notice}
        </p>
      )}

      {own && !listLoading && !listResult?.error && items.length === 0 && (
        <form
          className="rec-card rec-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => submitRecruitment(form));
          }}
        >
          <h2>Submit an application</h2>
          <fieldset disabled={busy}>
            <Fields
              values={form}
              setValues={setForm}
              fields={[
                ["fullName", "Full name", "text", 100],
                [
                  "experience",
                  "Driving experience / qualifications",
                  "text",
                  255,
                ],
              ]}
            />
            <button className="bm-btn bm-btn-primary">
              {busy ? "Submitting…" : "Submit application"}
            </button>
          </fieldset>
        </form>
      )}

      <div className="rec-card" aria-busy={listLoading}>
        <h2>Applications</h2>
        {!own && (
          <div className="rec-filters">
            <Field
              label="Search applicants"
              value={query}
              maxLength={100}
              required={false}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
            />
            <label className="rec-field">
              Status
              <select
                className="bm-input"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {Object.entries(labels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {listLoading ? (
          <p role="status">Loading applications…</p>
        ) : listResult?.error ? (
          <p role="alert">
            {listResult.error}{" "}
            <button className="bm-btn" onClick={refresh}>
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p>No applications found.</p>
        ) : (
          <div className="rec-list">
            {items.map((row) => (
              <button
                type="button"
                disabled={busy || driverOpen}
                className="rec-list-item"
                key={row.id}
                aria-pressed={selectedId === row.id}
                onClick={() => open(row.id)}
              >
                <span>
                  <strong>{row.full_name}</strong>
                  <small>
                    #{row.id} · {row.applicant_email}
                  </small>
                </span>
                <span className={`rec-badge rec-${row.status}`}>
                  {labels[row.status]}
                </span>
              </button>
            ))}
          </div>
        )}
        {!own && !listLoading && !listResult?.error && (
          <div className="rec-actions rec-pagination">
            <button
              className="bm-btn"
              disabled={page === 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="bm-btn"
              disabled={!listResult?.hasMore || page === 10000}
              onClick={() => setPage((v) => v + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {detailLoading && <p role="status">Loading application details…</p>}
      {!detailLoading && selectedId && detailResult?.error && (
        <p role="alert">
          {detailResult.error}{" "}
          <button className="bm-btn" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      {detail && (
        <div className="rec-card">
          <h2>Application #{detail.id}</h2>
          <p>
            <strong>{detail.full_name}</strong> · {detail.applicant_email}
          </p>
          <p>{detail.experience}</p>
          <ol className="rec-progress">
            {workflowSteps(detail.status).map((step) => (
              <li
                key={step.stage}
                className={`rec-${step.state}`}
                aria-current={step.state === "current" ? "step" : undefined}
              >
                {step.label}
              </li>
            ))}
          </ol>
          {detail.interview_date && (
            <p>
              Interview: {detail.interview_date} ·{" "}
              {detail.interview_outcome || "Scheduled, outcome pending"}{" "}
              {detail.interview_notes ? `— ${detail.interview_notes}` : ""}
            </p>
          )}
          {detail.decision_reason && <p>Decision: {detail.decision_reason}</p>}
          {actions.beginReview && (
            <button
              className="bm-btn bm-btn-primary"
              disabled={busy}
              onClick={() => next("under_review")}
            >
              Begin review
            </button>
          )}
          {actions.beginInterview && (
            <button
              className="bm-btn bm-btn-primary"
              disabled={busy}
              onClick={() => next("test_interview")}
            >
              Move to test/interview
            </button>
          )}
          {actions.recordInterview && (
            <>
              <form
                className="rec-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(() =>
                    saveRecruitmentInterview(detail.id, interview),
                  );
                }}
              >
                <fieldset disabled={busy}>
                  <Fields
                    values={interview}
                    setValues={setInterview}
                    fields={[
                      ["date", "Interview date", "date"],
                      [
                        "notes",
                        "Interview notes (required for a recorded outcome)",
                        "text",
                        255,
                        Boolean(interview.outcome),
                      ],
                    ]}
                  />
                  <label className="rec-field">
                    Outcome
                    <select
                      className="bm-input"
                      value={interview.outcome}
                      onChange={(e) =>
                        setInterview({ ...interview, outcome: e.target.value })
                      }
                    >
                      {!detail.interview_outcome && (
                        <option value="">Scheduled / outcome pending</option>
                      )}
                      <option value="completed">Completed</option>
                      <option value="passed">Passed</option>
                      <option value="failed">Failed</option>
                    </select>
                  </label>
                  <button className="bm-btn bm-btn-primary">
                    Save interview information
                  </button>
                </fieldset>
              </form>
              {actions.finalize && (
                <div className="rec-form">
                  <Field
                    label="Decision reason (optional)"
                    value={reason}
                    onChange={setReason}
                    maxLength={255}
                    required={false}
                  />
                  <div className="rec-actions">
                    <button
                      className="bm-btn bm-btn-primary"
                      disabled={busy}
                      onClick={() => next("selected")}
                    >
                      Select applicant
                    </button>
                    <button
                      className="bm-btn"
                      disabled={busy}
                      onClick={() => next("rejected")}
                    >
                      Reject applicant
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {detail.status === "rejected" && (
            <p>
              {own
                ? "Your application was not selected. Your application history remains available."
                : "This application was rejected and remains in the historical record."}
            </p>
          )}
          {detail.driver_id && (
            <p role="status">
              Driver registration completed. Driver record #{detail.driver_id}.
            </p>
          )}
          {actions.registerDriver && (
            <div className="rec-form">
              <h3>Next step: driver registration</h3>
              <button
                className="bm-btn bm-btn-primary"
                disabled={busy}
                onClick={() => setDriverOpen(true)}
              >
                Register as driver
              </button>
            </div>
          )}
          {driverOpen && actions.registerDriver && (
            <DriverFormDialog
              mode="registration"
              driver={{ fullName: detail.full_name }}
              onClose={() => setDriverOpen(false)}
              onSubmit={async (input) => {
                await registerRecruitmentDriver(detail.id, input);
                setDriverOpen(false);
                setNotice("Driver registration completed.");
                refresh();
              }}
            />
          )}
          <h3>Application history</h3>
          <History history={detail.history} />
        </div>
      )}
    </section>
  );
}
