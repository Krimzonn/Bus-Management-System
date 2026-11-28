export const STATUS_LABELS = Object.freeze({
  submitted: "Application Submitted",
  under_review: "Under Review",
  test_interview: "Test/Interview",
  selected: "Selected",
  rejected: "Rejected",
});
const STAGES = ["submitted", "under_review", "test_interview"];
export function workflowSteps(status) {
  const steps = [...STAGES, status === "rejected" ? "rejected" : "selected"];
  const index = steps.indexOf(status);
  return steps.map((stage, i) => ({
    stage,
    label: STATUS_LABELS[stage],
    state: i === index ? "current" : i < index ? "done" : "pending",
  }));
}
export function recruitmentActions(application, { own, manage }) {
  const status = application.status;
  return {
    beginReview: manage && status === "submitted",
    beginInterview: manage && status === "under_review",
    recordInterview: manage && status === "test_interview",
    finalize:
      manage &&
      status === "test_interview" &&
      Boolean(application.interview_outcome),
    registerDriver: own && status === "selected" && !application.driver_id,
  };
}
