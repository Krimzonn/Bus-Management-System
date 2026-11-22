# AGENTS.md — Bus Management System

Operational instructions for any AI coding agent working in this repository. This file says **what you must and must not do**. The reasoning lives in `ARCHITECTURE.md` and `ADR/`.

---

## 1. Product intent

A responsive web application that replaces the registers, spreadsheets and messages a transport organization uses today. It centralizes buses and maintenance history, drivers and licenses, routes, schedules and assignments, fuel purchases, driver recruitment and reports. It blocks invalid assignments, alerts the Admin to schedule clashes, sends SMS with an in-app fallback, keeps an audit log of critical changes, and supports English and Urdu. Primary client: the Transportation Manager.

## 2. Source documents and precedence

Read before any work:

1. `PRD.md` (v1.2): what the system must do. Requirement IDs (FR-*, BR-*, NFR-*, EC-*, AC-*, D-*) are the project vocabulary.
2. `ARCHITECTURE.md`: how the system is structured and why.
3. `ADR/ADR-001` to `ADR-007`: individual decisions. ADR-006 is superseded by ADR-007; do not follow it.

Authority: **accepted ADR > ARCHITECTURE.md > AGENTS.md** for structure; **PRD.md** for behavior. If documents conflict, do not resolve it yourself; follow Section 9.

Cite requirement IDs in code comments, commits and PR descriptions (e.g. `// BR-02`).

## 3. Agreed technology

Decided (ADR-001, ADR-002, ADR-007):
- **Client:** React single-page app, responsive, English/Urdu with RTL.
- **Backend:** Node.js, HTTP/JSON API, modular monolith.
- **Database:** one PostgreSQL database, tables owned per module.

**Not yet confirmed:** TypeScript, the Node.js framework, the database access approach. Propose options with trade-offs and wait for approval; do not choose silently.

## 4. Modules and boundaries

Each backend module **owns its data** and keeps to its responsibility.

| Module | Responsible for | Must NOT |
|---|---|---|
| **API Layer** | HTTP boundary: authenticate, check capability via Identity & Access, validate input shape, call module services, return JSON/error codes | Contain business rules; touch tables |
| **Identity & Access** | Authentication, sessions/tokens, roles, central authorization policy, role-to-capability matrix | Contain other modules' business logic |
| **Fleet** | Buses, bus status, archival, maintenance history, overdue-service identification | Decide assignments |
| **Drivers** | Drivers, driver status, licenses, 30-day expiring-license list | Decide assignments |
| **Routes** | Routes and Blocked/Unblocked status | Decide assignments |
| **Scheduling** | Schedules; **the only creator/changer of assignments**; eligibility (BR-01/02/03/13); clash detection and resolution; alternative-driver check (BR-04) | Write Fleet, Drivers or Routes data |
| **Recruitment** | Registration, applications, interviews, approve/reject (BR-08) | Create schedules; give applicants internal access |
| **Fuel** | Fuel purchases; quantity/expenditure per bus and date range | Own the definition of a bus |
| **Reporting** | Read-only reports across modules | Write data; read other modules' tables |
| **Notifications** | Notification requests, SMS gateway adapter, in-app fallback, language templates | Block or roll back business operations |
| **Audit** | Append-only audit log (actor, timestamp, entity, action) | Offer edit or delete of entries |

The **React client** is presentation only: screens, forms, navigation, translated text, RTL, display of results and errors. It calls the API Layer and nothing else.

## 5. Dependency and interface rules

Hard rules; a violation is a defect even if the code works.

1. **Allowed dependencies** (arrow = "may call"):
   - API Layer → Identity & Access, then all domain modules
   - Scheduling → Fleet, Drivers, Routes (read only), Notifications, Audit
   - Recruitment → Drivers (create driver on approval), Notifications, Audit
   - Fuel → Fleet (bus must exist), Audit
   - Reporting → read/query interfaces of Fleet, Drivers, Routes, Scheduling, Recruitment, Fuel
   - Fleet, Drivers, Routes, Fuel → Audit
2. **Anything not listed is forbidden** without an ADR. Notably: Fleet, Drivers and Routes never depend on Scheduling; nothing depends on the API Layer or on Reporting.
3. **Tables and internals are private.** Other modules use only a module's public service (commands) and query (read-only) interface, exposed from **one entry point**. No imports from internal files, no cross-module joins or table access.
4. **The client talks only to the API Layer.** No database access; no business rules.
5. **Only Scheduling creates or changes assignments**; no handler, script or seed may write one.
6. **The SMS provider is reached only through the Notifications gateway adapter.**

## 6. Architectural constraints

These hold for all code you write. Source: `ARCHITECTURE.md` Section 9 and the ADRs.

1. **Modular monolith.** No microservices, message brokers or extra data stores without an ADR (ADR-001, ADR-002).
2. **Fixed stack.** React + Node.js + PostgreSQL (ADR-007). No other framework, ORM, state-management library, UI kit, cache, queue or external service without approval.
3. **Backend is the only authority.** Business rules and security decisions live in the backend. Hiding a button is convenience, not security.
4. **No invalid assignment can be saved by any path**, including direct API calls. Eligibility (BR-01/02/03/13) is enforced in Scheduling (ADR-004).
5. **Authorization is server-side, central, and per request** (ADR-003). Every endpoint except public registration/application requires authentication and a capability check. Outside Identity & Access, check capabilities, never role names. No auto-generated CRUD or admin panels that bypass module services.
6. **Audit is atomic and append-only** (ADR-005). A critical change writes its audit entry in the same database transaction as the change; Audit never updates or deletes entries, including in tests and seeds.
7. **Notification failure never fails a business operation** (ADR-005). On SMS failure create an in-app notification (BR-10). Record the notification before sending.
8. **Archive, do not delete.** Referenced records are archived; maintenance and audit entries are never physically deleted (ADR-002).
9. **Stateless backend.** No per-user state in process memory; sessions/tokens verifiable by any instance (NFR-03).
10. **Errors are codes plus data, not display text.** The client translates them. The backend owns SMS/notification templates; the client owns UI text.
11. **All user-facing text is translatable** (English and Urdu), and RTL must work. No hard-coded strings.
12. **No behavior for open decisions** (Section 7). Raise a question instead.
13. **Passenger booking is not built** until D-03 is decided.

## 7. Open decisions: do not invent behavior

Do not implement, guess or default these. Build only the stated placeholder and ask.

| Decision | You may | You must not |
|---|---|---|
| D-01 clash definition | Create the clash-policy **interface** in Scheduling | Implement detection logic or conditions |
| D-02 roles/permissions | Build the capability model and policy hook | Invent role-to-capability assignments |
| D-03 passenger booking | Nothing | Build booking, a Passenger role, or FR-REP-04 |
| D-04 default route/driver on bus | Raise first | Model route/driver fields on the bus |
| D-05 / BR-11 status timing | Check eligibility at save time only | Add re-validation or effective-date rules |
| D-09 delete vs archive | Archive | Hard-delete referenced records |
| D-10 notification events/retries | Build channel and fallback mechanism | Invent events, recipients or retry rules |
| D-11 audit scope/viewers/retention | Make the critical-action list **configurable** | Hard-code the list or retention |
| D-13 security/privacy | Raise first | Choose token/session storage or password handling |
| D-15 Urdu scope | Build RTL and translation structure | Decide what gets translated |
| D-17 recruitment details | Raise first | Model applicant fields or statuses |
| D-21 fuel consumption method | Isolate the calculation in **one function** | Pick a method (liters purchased only as an approved placeholder) |

Other items the PRD marks open (e.g. D-06, D-07, D-16, D-19, D-20, D-22) follow the same rule. The driving test is not an in-system feature (PRD Section 4).

## 8. Human approval required

Stop and ask before you:

- add any technology listed in Section 3 as unconfirmed, or anything forbidden by Section 6.2;
- add, remove or rename a module, or change its responsibility or owned data;
- add a dependency not listed in Section 5, or loosen a boundary for convenience;
- change an ADR, `ARCHITECTURE.md` or this file (propose the edit; do not make it);
- change authentication, authorization, sessions, password handling, or what is audited;
- change the schema so data moves between modules, or make a breaking API change;
- implement anything in Section 7, or add destructive operations (delete, truncate, drop, lossy migrations).

You may proceed without asking on: implementing a specified requirement inside its owning module, tests, behavior-preserving refactors, and documentation fixes that change no decisions.

## 9. Ambiguity, conflicts and ADRs

- If a requirement is ambiguous or open, or documents disagree: **stop, state the issue, list options with trade-offs, and ask.** Do not choose silently or implement both.
- If the architecture seems wrong or blocking, say so and propose a change; do not work around it.
- If a task needs a rule in this file broken, refuse that part and say which rule.
- State any assumption you make on unrelated work so it can be reviewed.
- Never invent requirements, IDs, ADR content, client decisions or test results.
- Treat **Accepted** ADRs as binding and **Proposed** ones as the intended direction (flag anything that looks wrong). Never contradict an ADR in code; to change one, propose a superseding ADR. If a significant decision (boundaries, data ownership, security, technology) has no ADR, raise it as a candidate decision.

## 10. Structure and conventions

The agent may propose the layout; the human team approves it.

- Client and backend are separate codebases in one repository. The client has no shared code containing business rules.
- One folder per backend module, named as in Section 4, with a single public entry point. Table names or groupings identify the owning module.
- A module making a critical change passes its **database transaction** to Audit; Audit does not open its own for that entry.
- The permission matrix, clash policy and fuel calculation each sit behind one replaceable function or interface.
- Keep the API contract (resources, shapes, error codes) documented and current. The format is not agreed; ask before choosing.
- Every enforced rule (BR-01/02/03/13, audit atomicity, SMS fallback) has an **API-level** test, so "a direct call with an ineligible driver is rejected" is demonstrable.
- Use PRD glossary terms; no synonyms.
- Prefer the smallest structure that meets the architecture. No layers or abstractions that no requirement or ADR calls for.

## 11. When asked to propose an initial structure

This validates the context; it is not product development.

1. Read all context and summarize the modules and rules in a few lines.
2. Propose the client and backend structure with one entry per Section 4 module, its public entry point, what it owns and which modules it may depend on (per Section 5).
3. List assumptions, ambiguities and open decisions you hit, and how you handled them.
4. Do **not** implement features, add dependencies, choose unconfirmed technology, or write business logic. Skeletons only.

## 12. Definition of done

A change is done when it satisfies its cited requirement IDs without touching Section 7, stays in its owning module within Section 5, respects Section 6, has tests (API-level for enforced rules), adds no unapproved technology, and reports its assumptions and open questions.
