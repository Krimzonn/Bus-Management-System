# Bus Management System — Final Vertical Implementation Slices (D4)

> **Purpose:** This document is the implementation roadmap and working context for AI-assisted, slice-by-slice development of the Bus Management System. Each slice delivers a user-visible capability end-to-end (UI, API, persistence, business rules, and relevant checks), rather than completing one technical layer across the whole product.
>
> **Source baseline:** PRD v1.2, the supplied Architecture document, the prior implementation-slices draft, and the decisions resolved in this conversation. Deliverable 4 and Testing Instructions/Quality Gates are also incorporated.
>
> **Important:** Implement slices in order, one slice at a time. Do not generate the entire product in one prompt. Do not restructure the existing repository without a concrete reason and explicit approval.

---

## 1. Fixed project decisions

### Technology and architecture

- Frontend: React.
- Backend: Node.js + Express.
- Database: PostgreSQL.
- Client/backend communication: REST API using HTTP and JSON.
- Architecture: modular monolith, deployed/run as one backend application.
- Preserve the existing repository structure, conventions, scripts, and working code. Inspect the repository before changing it.
- No microservices.
- English is the initial UI language. Keep localization-ready structure so Urdu and RTL can be added later.
- Passenger booking is **out of scope**. Do not create seat booking, passenger reservation, or passenger booking reports.

### Initial roles

- **Admin:** full administrative access.
- **Administrative Staff:** operational access as specified below.
- **Transportation Manager:** transportation operations and assignment decisions.
- **Driver:** access only to own assigned trips and relevant notifications.
- **Applicant:** access only to own application and status.

Do not add a Passenger booking role or passenger booking workflow.

### Permission baseline

| Capability | Admin | Administrative Staff | Transportation Manager | Driver | Applicant |
|---|---|---|---|---|---|
| Manage internal users/roles | Full | No | No | No | No |
| Bus/driver/route records | Full | Operational view only | Create/update/archive | No | No |
| Bus default route/driver | Full | No | Yes | No | No |
| Schedule create/edit/cancel | Full | View only | Yes | No | No |
| Start/complete trip | Full/override | No | Yes | Own assigned trip only | No |
| Replacement driver selection | Full | No | Yes | No | No |
| Maintenance | Full | Create/view/edit operational records | Create/view/edit | No | No |
| Fuel | Full | Create/view/edit operational records | Create/view/edit | No | No |
| Recruitment decisions | Full | No | No | No | No |
| Recruitment operational viewing | Full | No | View where needed | No | Own application |
| Operational reports | Full | Yes | Yes | Own trip information only | Own application only |
| Audit logs | Full | No | No | No | No |
| Own notifications | Yes | Yes | Yes | Yes | Yes |

Enforce permissions in the backend on every protected request. Frontend navigation is not an authorization mechanism.

### Fixed business rules

**Buses**
- Minimum maintained fields include bus number, seating capacity, status, required license category, and optional default route/default driver.
- Statuses: Active, Inactive, Under Maintenance.
- Bus number is unique and must not be reused, including after archival.
- Inactive or Under Maintenance buses cannot be assigned to new trips.
- Bus defaults are optional and can be overridden on a schedule.
- Referenced buses are archived rather than physically deleted.

**Drivers**
- Statuses: Available, On Leave, Absent.
- On Leave and Absent drivers cannot be assigned.
- Available status does not override a schedule conflict.
- Driver license number is unique and stores category and expiry date.
- Driver must have the required category and license valid on the actual trip date.
- Warning window: license expires within 30 days, inclusive of the 30th day; already expired licenses are in the expired list.
- Drivers with history are archived, not physically deleted. Archived drivers cannot be assigned.

**Routes**
- Statuses: Unblocked and Blocked.
- Blocked or archived routes cannot be assigned to new trips.
- Referenced routes are archived rather than physically deleted.

**Schedules**
- Record travel date, departure and arrival times, bus, driver, route, and status.
- Statuses: Scheduled, In Progress, Completed, Cancelled.
- Status changes are action-based; do not automatically start or complete trips based only on clock time.
- Admin and Transportation Manager can manage schedules. Drivers may start/complete only their own assigned trips. Drivers cannot change assignment fields or cancel trips.
- Cancelled trips do not create assignment conflicts.
- Completed and cancelled trips are historical and not treated as active assignment conflicts.
- The same driver or bus cannot have overlapping trip intervals.
- No additional buffer/turnaround time is required. Back-to-back trips are allowed.
- Account for cross-date and overnight trips: if arrival time is earlier than departure time on a schedule's travel date, arrival is the following day.
- Conflict prevention must hold under concurrent requests; perform checks and writes transactionally or with an equivalent reliable database-level strategy.

**Replacement drivers**
- Suggest candidates who are active, Available, not archived, license-valid on trip date, category-qualified, and not assigned to an overlapping non-cancelled trip.
- Manager chooses the replacement. Never auto-assign.
- Revalidate all eligibility and conflicts when the final change is saved.
- Empty results must be explained clearly.

**Recruitment**
- Application Submitted → Under Review → Test/Interview → Selected or Rejected.
- Selected applicants proceed to Driver Registration.
- Admin is responsible for reviewing, recording test/interview information and making selection/rejection.
- Test/interview is a simple recorded step; do not build a separate driving-test scoring subsystem.
- Applicant sees only own application/status.
- Prevent duplicate application submission where applicable and preserve history.

**Maintenance**
- Bus-linked entry includes service date, type, description/work performed, cost, odometer where available, and optional next service date.
- Records can be edited by authorized staff; preserve history and archive when referenced rather than physically deleting.
- History is chronological.
- Upcoming maintenance: due within the next 30 days (inclusive).
- Overdue: due date earlier than today (due date itself is not overdue until the next day).
- Show upcoming/overdue in the app. No external notification channel.

**Fuel**
- Bus-linked record includes purchase date, liters, total cost, odometer.
- Quantity must be greater than zero; cost and odometer must be non-negative.
- Odometer readings must not decrease chronologically for a bus; edited entries are validated against neighboring readings.
- Expenditure is sum of costs in an inclusive date range.
- Efficiency estimate: distance between first and last valid odometer points in the selected range divided by total liters recorded in that range. If insufficient/inconsistent data, show “Insufficient data,” not a fabricated number. This is an operational estimate, not tank-to-tank measurement.
- Currency uses the app's existing configured currency; if none exists, do not invent a currency symbol.

**Notifications**
- In-app only: notification list/panel, unread count, read state, history.
- Events: schedule assigned/changed/cancelled → assigned driver; replacement assignment → new driver; license expiring/expired → Admin and Transportation Manager; maintenance upcoming/overdue → Admin and Transportation Manager; applicant status change → applicant.
- Users see only their own notifications.
- Notification failure must not roll back the originating business action. No SMS, email or WhatsApp.

**Audit**
- Append-only audit history for important operations.
- Audit login/logout where practical without recording secrets; bus, driver, license, route, schedule, replacement, recruitment, maintenance, fuel, and user/permission changes.
- Capture actor, action, entity type/id, timestamp, before/after values where applicable, correlation ID where available.
- Write critical audit entries atomically with the business action where feasible.
- Only Admin can view audit logs.

**Reports**
1. Fleet report.
2. Driver/license report.
3. Schedule report.
4. Fuel report.
5. Maintenance report.
6. Recruitment report.
7. Conflict/eligibility report.
- Read-only; date filters and relevant filters; CSV export where meaningful.
- No passenger booking report or advanced analytics beyond useful operational summaries.

**Basic security**
- Maintained password hashing; never plaintext passwords.
- Authentication and backend RBAC.
- Server-side input validation.
- Safe/parameterized database access.
- Protection against common web vulnerabilities (including XSS and CSRF as applicable to the chosen auth mechanism).
- Secure session/token handling.
- Restricted sensitive data and audit access.
- Secrets in environment variables and excluded from Git.
- Rate-limit public authentication/registration endpoints where practical.
- Do not log secrets/tokens.
- Keep security practical, but do not omit the baseline.

**Initial non-functional targets (targets, not proven results)**
- Normal API response: under 2 seconds under normal load.
- Page load: under 3 seconds under normal load.
- 50 concurrent users.
- Availability target: 99%, excluding planned maintenance.
- Correctness under concurrent assignment attempts.
- Responsive desktop/tablet/mobile UI.
- Clear, non-silent errors.

---

## 2. Architecture and implementation constraints

1. **Vertical slice:** A slice should deliver a usable user journey or capability from interface through API and persistence to acceptance checks. Avoid horizontal work such as “all database models,” “all APIs,” or “all frontend screens” as separate product slices unless it is a narrowly scoped foundation needed by subsequent slices.
2. **Module ownership:** Each domain module owns its business rules and persistence. Cross-module calls use module public services/interfaces; avoid direct cross-module table access.
3. **Scheduling is the only assignment writer.** Fleet, Drivers and Routes expose eligibility/read interfaces; they do not write assignments.
4. **Thin controllers:** Controllers authenticate, authorize, validate request shape, call services and map results. Business rules reside in module services.
5. **Reporting is read-only.**
6. **Audit is append-only.**
7. **Notifications are best-effort and do not roll back business operations.**
8. **Preserve repository conventions.** Do not rename, move or replace existing project structure just to match this document.
9. **Supporting artefacts:** Claude may create schema/model details, API contracts, wireframes, component design and test cases when needed; keep generated artefacts that become implementation context.
10. If an actual repository constraint conflicts with this document, stop and report the conflict with evidence rather than silently changing architecture.

---

## 3. D4 vertical-slice execution loop (mandatory)

For **each** slice, repeat this loop. Do not skip human review or integration evidence.

1. **Select:** Identify slice ID/name, requirements and acceptance criteria.
2. **Load context:** Provide the coding agent only the relevant PRD, architecture, ADR, `AGENTS.md`, prior accepted code and supporting artefacts.
3. **Refine:** Confirm scope and acceptance criteria; agent may propose concise checks/tests.
4. **Choose mode:** Use HITL (human-in-the-loop) or AFK/delegated mode, with a brief reason recorded. Prefer HITL for high-risk, uncertain, security-sensitive, data-integrity or architectural work.
5. **Implement:** AI implements the slice and makes focused correction iterations.
6. **Check:** Run relevant functional, negative, EP/BVA where applicable, and regression checks.
7. **Human review:** Team decides **Accept / Revise / Reject**. Review functionality, constraints, architecture and unnecessary work. AI claims alone do not constitute acceptance.
8. **Integrate:** Integrate only accepted work.
9. **Update context:** Update `plan.md`, current status, and ADR/architecture/context files where needed. Preserve plan history (versioned files or retrievable Git history).

### Quality gates for every slice

- **Gate 1 — Readiness (before coding):** Clear scope, linked requirement(s), acceptance criteria and dependencies. If not, revise plan/context before implementation.
- **Gate 2 — Functional verification (after coding):** Core expected behaviour works; important negative cases are handled; EP/BVA cases pass where meaningful. If not, revise and retest.
- **Gate 3 — Architecture/constraint check (before integration):** No obvious violation of architecture, ADRs, `AGENTS.md` or agreed constraints. If not, revise implementation or seek an approved context change.
- **Gate 4 — Regression/integration check (before accepting):** Slice integrates and does not obviously break previously accepted work. If not, fix before acceptance.
- **Gate 5 — Final product check (after all slices):** Main end-to-end flows work; promised scope is demonstrable; important edge cases and selected NFRs are reasonably verified.

Testing should be lightweight and proportionate. Do not mechanically apply EP/BVA to every field or create oversized test suites. Prioritize core behaviour, important negative cases, relevant boundaries and integration.

### Minimum evidence per slice

Maintain a concise Workflow Evidence Log with:
- Slice ID/name and requirement reference.
- Responsible/leading group member.
- Acceptance criteria.
- HITL/AFK mode and brief reason.
- AI chat/task reference.
- Significant iterations, corrections or rejected approaches.
- Test/check evidence and result.
- Human decision: Accept / Revise / Reject, with reason.
- Major issue/change.
- `plan.md` version.
- Integration status.

Keep evidence of AI conversations, branches, revised/rejected approaches, failures/self-corrections, context updates and ADR changes. Retain a concise test record with: requirement/slice, test type, input/condition, expected result, actual result, pass/fail. Do not invent test results; record what was actually run.

---

## 4. Prioritized vertical implementation slices

Implement **one slice at a time**, in this order. A slice must include its own UI, API, database changes, validation, relevant business rules and tests. Its acceptance criteria must be demonstrated before the next slice is treated as complete.

### Slice 1 — Existing-repository bootstrap and application run path

**User value:** Team and coding agent can run, inspect and verify the existing application reliably.

**Scope**
- Inspect repository, structure, existing code, dependencies, scripts and README.
- Preserve existing project organization and functioning features.
- Establish/confirm React UI, Express backend and PostgreSQL connection without unnecessary restructuring.
- Establish or confirm development environment configuration, health check, migration workflow, safe development seed workflow, test/lint commands and startup instructions.
- Establish a consistent API response/error convention and frontend API client boundary.
- Provide `.env.example` with placeholders only and exclude secrets.
- Confirm modular-monolith boundaries and document them briefly.

**Acceptance criteria**
- Application starts reproducibly using documented instructions.
- React can reach Express; Express can connect to PostgreSQL.
- Health endpoint returns non-sensitive health information.
- Existing structure and working code are preserved.
- No secret is committed.
- At least one automated/basic check can run using the documented workflow.

**Checks**
- Successful startup and health check.
- Invalid environment/database configuration fails clearly.
- Confirm no credentials appear in logs or repository.

---

### Slice 2 — Secure account access and role-based application entry

**User value:** Each user can sign in and access only the parts of the application their role permits.

**Scope**
- Implement authentication, logout and session/token lifecycle appropriate to the repository.
- Secure password hashing.
- Admin bootstrap process documented and safe; no hardcoded production credentials.
- Backend authorization middleware/capability checks.
- Login/logout UI and protected application shell.
- Role-aware navigation and access-denied handling.
- Admin user management: create/update/deactivate internal accounts and assign supported roles; prevent unauthorized privilege changes.
- Applicant account access may be delivered with the recruitment slice; avoid prematurely creating applicant workflow here.

**Acceptance criteria**
- Valid user can authenticate and logout.
- Protected API and UI routes require authentication.
- Role checks are enforced server-side.
- Unauthorized requests fail without leaking protected data.
- Admin can manage internal accounts/roles.
- Passwords are not stored plaintext.
- Inactive accounts cannot authenticate.
- No account can self-elevate privileges.

**Checks**
- Valid/invalid credentials; missing credentials.
- Protected route without auth.
- Role-permission negative cases.
- EP/BVA for password and input fields where meaningful.
- Logout/session invalidation.

---

### Slice 3 — Admin audit trail for account and foundational actions

**User value:** Admin can inspect who performed important foundational/system actions.

**Scope**
- Implement append-only audit storage and an Admin-only audit UI/API.
- Capture actor, action, entity type/id, timestamp and before/after values where appropriate.
- Capture account creation/update/deactivation and permission changes, and authentication events where practical without logging secrets.
- Add pagination/filtering appropriate for a simple audit list.
- Establish reusable audit interface for later domain slices.

**Acceptance criteria**
- Audited actions create entries with correct actor/entity/time.
- Audit entries cannot be edited or deleted through application UI/API.
- Only Admin can view the audit log.
- Audit logging does not expose passwords, tokens or unnecessary sensitive data.
- Audit event is recorded transactionally with critical account changes where feasible.

**Checks**
- Verify audit entry for account/role changes.
- Attempt access from non-Admin role.
- Attempt mutation/deletion through API.
- Check audit payloads for secrets.

---

### Slice 4 — Maintain buses and their default assignments

**User value:** Transportation Manager can maintain active fleet records and defaults needed to plan trips.

**Scope**
- Bus list, search/filter, create, view, edit, status update and archive flows.
- Fields include bus number, seating capacity, status, required license category and optional default route/default driver.
- Uniqueness validation for bus number including archived records.
- Defaults can be selected from valid active records; allow clearing a default.
- Admin full access; Transportation Manager manage; Administrative Staff operational view only.
- Audit create/update/status/archive actions.
- Bus archival preserves references/history.

**Acceptance criteria**
- Authorized manager can create/view/update/archive a bus.
- Bus number cannot be duplicated or reused, including archived bus numbers.
- Status choices are Active, Inactive and Under Maintenance.
- Inactive and Under Maintenance buses cannot be eligible for new assignment.
- Defaults can be set, updated, cleared and later overridden by schedule-specific selection.
- Archived bus is excluded from active lists and assignment eligibility.
- Unauthorized roles cannot mutate buses.
- History/reference is not physically deleted.

**Checks**
- Valid and invalid bus records.
- Duplicate bus-number negative case, including archived record.
- Capacity and required-category field boundaries/validation.
- Active vs inactive vs maintenance vs archived eligibility.

---

### Slice 5 — Maintain routes and route availability

**User value:** Transportation Manager can maintain routes and prevent trips from using blocked routes.

**Scope**
- Route list, search/filter, create, view, edit, status change and archive.
- Preserve existing repository/PRD route fields; route must have a unique identifiable name/code and maintainable route details.
- Statuses Unblocked and Blocked.
- Admin full access; Transportation Manager manage; Administrative Staff view only.
- Audit route changes and archival.

**Acceptance criteria**
- Manager can maintain route records.
- Blocked route cannot be selected for a new assignment.
- Archived route cannot be selected for a new assignment.
- Active/unblocked routes are selectable where appropriate.
- Referenced routes are archived, not physically deleted.
- Permissions are enforced server-side.

**Checks**
- Valid/invalid route data.
- Block/unblock transitions and selection eligibility.
- Archive and history preservation.
- Unauthorized update attempts.

---

### Slice 6 — Maintain driver profiles, status and licenses

**User value:** Transportation Manager can maintain drivers and understand whether they are qualified for future assignments.

**Scope**
- Driver list, search/filter, create, view, edit, status change and archive.
- Driver status: Available, On Leave, Absent.
- License number, category and expiry date, with unique license number.
- License expiry list: expiring within 30 days, expired and valid; window is inclusive of the 30th day and excludes already expired licenses from the expiring-soon list.
- Eligibility query exposed through Drivers public interface: status, archival, license expiry on trip date and category matching.
- Administrative Staff view-only.
- Audit driver and license changes.

**Acceptance criteria**
- Manager can maintain driver records and license details.
- License number uniqueness is enforced.
- On Leave, Absent and archived drivers are ineligible.
- License must be valid on the scheduled trip date, not merely assignment creation date.
- Required bus category matches driver's license category.
- Expiry warning list accurately implements the 30-day window.
- Historical driver records are preserved by archival.
- Drivers cannot access other drivers' private records through unauthorized API/UI.

**Checks**
- Valid/invalid license fields.
- Duplicate license number.
- Expiry boundary: 30 days, 31 days, expiry date, day after expiry.
- Category mismatch.
- Status/archive eligibility.
- Negative unauthorized access cases.

---

### Slice 7 — Create, view, edit, cancel and operate schedules

**User value:** Transportation Manager can plan trips and drivers can see and operate their own assigned trips.

**Scope**
- Schedule list and filters, create, detail, edit assignment fields, cancel, start and complete actions.
- Schedule fields: travel date, departure time, arrival time, bus, driver, route and status.
- Apply bus default route/driver during creation as initial values only; manager can override both.
- Integrate eligibility checks from Fleet, Drivers and Routes.
- Conflict detection for same bus or driver with overlapping intervals.
- Overnight interval handling and cross-date correctness.
- Cancelled schedules excluded from conflicts; completed/cancelled preserved as history.
- Transaction-safe conflict validation to prevent race conditions.
- Action-based status changes: Scheduled → In Progress → Completed; cancellation is a separate action.
- Admin/Transportation Manager manage; Administrative Staff view-only; Driver views own trip and may start/complete own assigned trip only.
- Audit schedule actions and assignment changes.
- Generate in-app schedule notifications through Notifications interface when that slice is available; until then, use an integration seam/placeholder and complete notification behaviour in Slice 11.

**Acceptance criteria**
- Authorized manager can create a schedule with eligible bus, driver and route.
- Defaults prepopulate but can be overridden.
- Inactive/Under Maintenance/archived bus, Blocked/archived route, unavailable/archived driver, license/category mismatch cannot be assigned.
- Same bus or driver cannot be assigned overlapping intervals.
- Back-to-back intervals are allowed.
- Overnight trip intervals are handled correctly.
- Cancelled schedule does not block new assignment.
- Schedule status changes only through allowed actions, not automatic clock transitions.
- Driver cannot edit assignment data or operate someone else's trip.
- Concurrent requests attempting overlapping assignment cannot both succeed.
- Schedule history is preserved.

**Checks**
- Functional create/edit/cancel/start/complete journey.
- Negative eligibility and permission cases.
- EP/BVA for dates, times and interval edges.
- Same-time, partial overlap, containment, back-to-back, overnight and cross-date cases.
- Concurrent conflict attempt.
- Regression check for bus, route and driver records.

---

### Slice 8 — Replacement driver suggestions and reassignment

**User value:** Transportation Manager can replace an unavailable driver without creating an invalid assignment.

**Scope**
- Schedule detail action to request replacement candidates.
- Candidate list with clear eligibility reason/summary.
- Candidate eligibility: Available, active/not archived, license valid on trip date, category qualified, and no overlapping non-cancelled trip.
- Manager selects candidate.
- Reassignment transaction revalidates all constraints.
- Audit old and new driver and actor.
- Integration with in-app notification event seam.

**Acceptance criteria**
- System lists only eligible candidates.
- Candidate list is empty with clear explanation if no eligible drivers.
- Manager, not system, chooses replacement.
- Final save rechecks all constraints.
- Replacement cannot create a schedule conflict.
- Assignment history/audit records old/new driver.
- Driver role cannot perform reassignment.

**Checks**
- Eligible/ineligible candidates for status, license, category, conflict and archival.
- Stale candidate becoming ineligible between suggestion and save.
- No-candidate result.
- Audit/reassignment integrity.

---

### Slice 9 — Applicant submission, review and driver registration

**User value:** Applicants can submit and track applications, and Admin can process applications through a simple recruitment workflow.

**Scope**
- Applicant registration/access and application submission.
- Application list/detail for Admin.
- Workflow: Application Submitted → Under Review → Test/Interview → Selected or Rejected.
- Record test/interview notes/outcome at a basic level; no separate driving-test scoring subsystem.
- Admin final selection/rejection.
- Applicant can view only own application/status.
- Selected applicant proceeds to driver registration through Drivers public interface.
- Preserve recruitment history and audit status/decision changes.
- Prevent duplicate application submission where applicable.

**Acceptance criteria**
- Applicant can register and submit an application.
- Applicant can see own status only.
- Admin can review, record interview/test step and select/reject.
- Status transition is visible and persisted.
- Selected applicant can be registered as a driver without duplicating driver data.
- Rejected/selected applications remain historical.
- Unauthorized users cannot read or modify applications.

**Checks**
- Required/missing/invalid application inputs.
- Duplicate application.
- Status transition checks.
- Applicant isolation: one applicant cannot access another's application.
- Selection/registration integration and audit.

---

### Slice 10 — Bus maintenance records and due/overdue review

**User value:** Authorized staff can record maintenance history and identify upcoming or overdue service.

**Scope**
- Bus maintenance list and bus-specific history.
- Create/view/edit/archive maintenance records.
- Fields: bus, service date, type, work description, cost, odometer where available, next scheduled service date.
- Chronological history.
- Upcoming and overdue status/list/filter.
- Admin, Administrative Staff and Transportation Manager permissions as agreed.
- Audit maintenance actions.
- No external notification service.

**Acceptance criteria**
- Authorized staff can record and update maintenance.
- Records are associated with a bus and displayed chronologically.
- Upcoming due within next 30 days (inclusive); overdue when due date is earlier than today.
- Due date itself is not overdue.
- Archive preserves history.
- Invalid cost/date/odometer data is handled.
- Archived bus remains historically visible in maintenance history.

**Checks**
- Valid/invalid record.
- Cost and odometer boundaries.
- Upcoming boundary: 30 days, 31 days, due today, overdue tomorrow.
- Permissions and history retention.

---

### Slice 11 — Fuel purchases, odometer validation and fuel summary

**User value:** Authorized staff can record fuel purchases and review fuel cost/usage estimates.

**Scope**
- Fuel list filtered by bus and date.
- Create/view/edit/archive fuel records.
- Fields: bus, purchase date, liters, total cost, odometer.
- Chronological odometer validation; editing validates against neighboring readings.
- Inclusive date range fuel report for quantity, expenditure and efficiency where data permits.
- Efficiency estimate: distance between first and last valid odometer points in the range divided by total liters for that range.
- “Insufficient data” when calculation cannot be safely produced.
- Currency display uses existing app config or numeric total if none configured.
- Admin, Administrative Staff and Transportation Manager permissions.
- Audit fuel actions.

**Acceptance criteria**
- Authorized staff can record fuel purchases.
- Quantity > 0; cost and odometer ≥ 0.
- Odometer does not decrease chronologically for the bus.
- Edit is validated against chronological neighbors.
- Date-range filter is inclusive.
- Total cost and quantity are accurate.
- Efficiency calculation follows the defined estimate and displays insufficient data when needed.
- Archived/history data remains preserved.

**Checks**
- Quantity/cost/odometer invalid and boundary values.
- Odometer sequence and edit-between-neighbors cases.
- Inclusive date range start/end boundaries.
- Calculation with valid points and insufficient/inconsistent data.
- Permissions and audit.

---

### Slice 12 — In-app notifications across operational journeys

**User value:** Users receive relevant in-app updates without relying on external channels.

**Scope**
- Notification list/panel, unread count, read/unread action and history.
- Per-user notification access.
- Connect notification events from schedule assignment/change/cancel, replacement assignment, license expiry/approaching expiry, maintenance upcoming/overdue and applicant status change.
- Event recipients as fixed rules.
- Notification creation is best-effort and must not roll back business actions.
- No email/SMS/WhatsApp.

**Acceptance criteria**
- Users can view only their own notifications.
- Unread count reflects state.
- Mark-read state persists.
- Schedule events notify assigned driver.
- Replacement assignment notifies newly assigned driver.
- License expiry and maintenance events notify Admin and Transportation Manager.
- Applicant status updates notify the applicant.
- Notification failure does not undo originating action and is handled/logged reasonably.
- Notification history is retained.

**Checks**
- Each event/recipient mapping.
- Access isolation.
- Unread/read state.
- Notification failure handling without business-action rollback.
- Duplicate-event handling where applicable.

---

### Slice 13 — Operational reports and CSV export

**User value:** Authorized users can review and export operational information without modifying records.

**Scope**
- Fleet report.
- Driver/license report.
- Schedule report.
- Fuel report.
- Maintenance report.
- Recruitment report.
- Conflict/eligibility report.
- Relevant date, bus, driver, route and status filters.
- CSV export where meaningful.
- Read-only report access and role permissions.
- Report data sourced from module public read interfaces.

**Acceptance criteria**
- Each of the seven reports is available and displays accurate data for the selected filters.
- Date ranges are inclusive.
- CSV export matches the selected filter/report data.
- Reports do not mutate domain records.
- Permission restrictions apply.
- Conflict/eligibility report reflects current applicable conflict/eligibility rules.
- No passenger booking report is created.

**Checks**
- Report correctness against representative records.
- Filter boundaries.
- CSV output.
- Negative permission checks.
- Verify reporting does not change data.

---

### Slice 14 — Responsive, coherent UI and localization readiness

**User value:** Users can use the integrated system across supported screen sizes with consistent, accessible interaction.

**Scope**
- Review and refine layout across desktop, tablet and mobile browser sizes.
- Consistent navigation, empty states, loading states, validation feedback, error states and confirmation for destructive/archive/cancel actions.
- Accessible labels, keyboard navigation and sensible focus behaviour where practical.
- English string centralization/localization-ready structure.
- Prepare layout direction and localization mechanisms for future Urdu/RTL without delivering Urdu translations in this release.
- Avoid adding new business functionality beyond agreed scope.

**Acceptance criteria**
- Core flows are usable at desktop, tablet and mobile viewport sizes.
- Navigation and forms remain usable without horizontal overflow where expected.
- Empty, loading, error and success states are coherent.
- English UI text is centralized sufficiently to enable later localization.
- Future RTL/localization can be introduced without major architectural rewrite.
- No passenger booking or unrelated functionality is introduced.

**Checks**
- Manual responsive review of main flows.
- Keyboard/labels review on key forms.
- Regression checks for navigation, validation and role-specific surfaces.

---

### Slice 15 — Integrated end-to-end verification, NFR checks and release readiness

**User value:** Team can demonstrate the promised product as a coherent, verified system.

**Scope**
- End-to-end verification of main flows:
  1. Admin bootstrap/login and account/role management.
  2. Create bus, route and driver/license records.
  3. Create schedule using defaults/overrides and verify eligibility.
  4. Detect and prevent bus/driver clash.
  5. Start/complete/cancel trip actions.
  6. Replacement-driver suggestion and reassignment.
  7. Recruitment application → review → selection/rejection → driver registration.
  8. Maintenance record and upcoming/overdue review.
  9. Fuel record and date-range report.
  10. In-app notification events and recipient visibility.
  11. Audit review.
  12. Operational reports and CSV exports.
- Run relevant regression checks for previously accepted slices.
- Verify important negative cases and meaningful EP/BVA.
- Verify selected NFRs where practical: response/page-load targets, 50-user workload, concurrent assignment integrity and availability/recovery claims only if testable in the chosen environment.
- Record actual performance/test results; do not claim targets achieved without evidence.
- Final local execution/deployment instructions.
- Prepare demo scenario and evidence collection.

**Acceptance criteria**
- Main end-to-end flows are demonstrable.
- Important negative and boundary cases are verified where meaningful.
- Selected NFRs have actual recorded results or are explicitly marked unverified.
- Critical integration failures are resolved before demo.
- Application can be run using documented instructions.
- Workflow evidence, plan history and test records are complete enough to reconstruct slice evolution.
- Team has retained evidence of at least one meaningful AI revision/rejection and one complete accepted vertical-slice loop, as required by D4 demo expectations.

**Checks**
- Final Gate 5: main flows, promised scope, important edge cases and selected NFRs.
- Keep concise evidence; testing must support development, not dominate it.

---

## 5. Final product exclusions

Do not implement unless the project team explicitly approves a scope change and updates PRD/architecture/plan:

- Passenger trip or seat booking.
- Passenger booking reports.
- Email, SMS, WhatsApp or external notification-provider integration.
- Microservices.
- Automated schedule status transitions based only on clock time.
- Automatic replacement-driver assignment.
- Advanced analytics beyond the agreed operational reports.
- Separate driving-test scoring subsystem.
- Unrelated features not traceable to PRD or approved decisions.

---

## 6. Supporting artefacts and mandatory plan history

D4 expects the team to maintain implementation context. Keep/update:

- `PRD.md` (or existing canonical PRD filename).
- `architecture.md` (or existing canonical architecture filename).
- `AGENTS.md`.
- ADRs where decisions change.
- `README.md`.
- `plan.md`, including:
  - Product objective.
  - Current implementation assumptions/open issues (only genuine remaining implementation-level questions; do not reopen settled business decisions).
  - Vertical slices.
  - Priorities and sequence.
  - Dependencies.
  - Acceptance criteria or references.
  - Current slice status.
- Preserve meaningful `plan.md` versions (`plan-v01.md`, `plan-v02.md`, etc.) or retrievable Git history.
- Supporting AI-generated artefacts that become relevant implementation context.
- Workflow Evidence Log.
- Group Contribution Log.

### Suggested plan status values

`Not Started` → `In Progress` → `Awaiting Human Review` → `Accepted` → `Integrated`

Use `Revise` or `Rejected` as recorded review decisions; do not mark a slice accepted merely because code exists.

---

## 7. Workflow Evidence Log template

Use a concise record for each slice:

| Field | Record |
|---|---|
| Slice ID / name | |
| Related requirement(s) | |
| Responsible member | |
| Acceptance criteria | |
| HITL / AFK mode + reason | |
| AI task/chat reference | |
| Iterations / corrections / rejected approach | |
| Test type and condition | |
| Expected result | |
| Actual result | |
| Pass / Fail | |
| Human decision (Accept / Revise / Reject) + reason | |
| Major issue/change | |
| plan.md version | |
| Integration status | |

Retain concise test evidence using the same fields as the instructor's template: Slice/Requirement, Test Type, Input/Condition, Expected Result, Actual Result, Pass/Fail.

---

## 8. Final demo readiness checklist (D4)

Before demo, verify and retain evidence for:

- [ ] Working product and major user flows.
- [ ] Core promised requirements fulfilled.
- [ ] Vertical-slice decomposition and slice order visible in `plan.md`.
- [ ] `plan.md` evolution/history available.
- [ ] At least one complete implementation loop with evidence.
- [ ] At least one AI output/approach revised or rejected and documented.
- [ ] Integration of multiple slices.
- [ ] Basic functional and negative testing evidence.
- [ ] Relevant EP/BVA evidence where meaningful.
- [ ] One meaningful CCP trade-off/alternative documented in final report.
- [ ] Individual contributions and Group Contribution Log.
- [ ] Members can explain the product, architecture, plan, major decisions and challenges.
- [ ] Execution/deployment instructions work.
- [ ] Known limitations/unverified NFRs are stated honestly.

---

## 9. CCP analysis reminder for final report

D4 final report must include concise CCP Analysis covering:
- Problem statement and real-world gap.
- Complexity drivers and interacting constraints.
- At least one engineering trade-off.
- At least two alternatives considered and why selected approach was preferred (ADRs can support this).
- System integration.
- Solution evaluation with a meaningful metric/evidence.
- Scalability and feasibility limitations.
- Relevant ethical/societal considerations: privacy, security, legal, safety, cultural, accessibility or societal impact.

Do not invent metrics or claim evaluation results before conducting them.

---

## 10. Task prompt template for the coding agent

Use this for each slice instead of asking Claude to build the complete product:

> Implement **Slice [ID and name]** from `IMPLEMENTATION_SLICES.md`.
>
> Before coding, inspect the existing repository and read only the relevant PRD, architecture, `AGENTS.md`, ADRs, prior accepted code and supporting artefacts. Preserve the existing project structure and conventions.
>
> Implement this slice end-to-end (user interface, API, persistence, business rules, relevant validation and tests/checks) within the slice's scope. Do not implement later slices or unrelated features.
>
> First confirm the slice's scope, dependencies and acceptance criteria. Propose a concise test/check plan. Implement in focused changes. Run the checks and report genuine results. Do not claim tests passed unless they were run.
>
> Check relevant negative cases and EP/BVA only where meaningful. Check that previously accepted functionality is not broken. Identify any architecture/constraint violation or genuine conflict and stop rather than silently making an unapproved decision.
>
> Return: summary of changes, files changed, generated supporting artefacts, checks actually run and results, remaining issues, and recommended human decision (**Accept / Revise / Reject**). Do not mark the slice accepted; that is the team's decision.
>
> After human acceptance and integration, update `plan.md`, preserve plan history, and complete the Workflow Evidence Log.

---

## 11. Implementation principle

Build the product **slice-by-slice**, with each slice delivering a meaningful, integrated capability. Keep the work aligned with the approved requirements and architecture, test proportionately, record evidence, and have the team decide **Accept / Revise / Reject** before integrating. The coding agent is a contributor; the group remains responsible for correctness, decisions, integration and demonstration.
