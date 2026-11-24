# ADR-007: Technology Stack — React Client, Node.js API Backend, PostgreSQL

**Status:** Accepted for React, Node.js and PostgreSQL (team decision, 9 November 2026). The sub-choices marked *Proposed* below await team confirmation.
**Supersedes:** ADR-006 (Django, server-rendered UI)
**Date:** 9 November 2026
**Related ASRs/drivers:** ASR-03, ASR-06, ASR-07, ASR-08, ASR-09, DRV-02, DRV-03
**Source:** PRD v1.2 — FR-UI-01/02/03, NFR-01–05; ADR-001, ADR-002, ADR-003

## Context
ADR-006 chose Django with server-rendered pages. The team has since decided to build with React, Node.js and PostgreSQL. This changes the shape of the system: the user interface becomes a separate client application that talks to a backend over an API, so the client/server boundary, authentication handling, localization and the way module boundaries are enforced all need to be restated. ADR-001 (modular monolith) and ADR-002 (relational database, module-owned tables) remain valid.

## Alternatives considered
1. **Django + PostgreSQL, server-rendered UI (ADR-006).** One codebase, built-in auth and i18n. Not chosen by the team.
2. **Next.js (React full-stack) + PostgreSQL.** One framework for client and server rendering. Blurs the client/server boundary and the backend module boundaries, and the team asked for React + Node.js.
3. **React SPA + Node.js API backend + PostgreSQL.**

## Decision
- **Client:** React single-page application, responsive, English and Urdu with right-to-left support. It contains presentation and input handling only.
- **Backend:** Node.js application exposing an HTTP/JSON API. It is the modular monolith of ADR-001: a single deployable backend divided into the modules in architecture.md.
- **Database:** PostgreSQL (unchanged from ADR-002).
- **Client–server contract:** the API is the only interface between client and backend. The contract is documented and kept in step with the code.
- **Proposed, awaiting team confirmation:**
  - TypeScript for both client and backend (typed API contracts and module interfaces reduce agent errors).
  - A Node.js application framework that supports module structure (for example NestJS); plain Express is the alternative.
  - A single database access approach (ORM or query builder) with migrations.
- **Not decided here (must be raised for human approval):** UI component/CSS library, client i18n library, SMS provider, hosting/deployment platform, background job mechanism, session/token mechanism (D-13).

## Rationale
The team chose this stack, and it uses one language across client and backend. A separate React client suits the responsive, interactive screens (schedules, reports, forms). The Node.js backend can still be one modular monolith, so the reasons in ADR-001 are unchanged. PostgreSQL still satisfies ADR-002.

## Trade-offs / consequences
- (+) One language across the system; large React and Node ecosystem.
- (−) Two codebases and an explicit API contract to maintain. Contract drift between client and backend becomes a risk.
- (−) Nothing is provided by default: authentication, authorization, input validation, i18n and audit are all assembled from the team's own choices, and each of these must follow ADR-003 and ADR-005.
- (−) Business rules must never be duplicated in the client. Client checks are convenience only; the backend is the sole authority (ADR-003, ADR-004).
- (−) Tokens or sessions held in the browser need care against cross-site scripting. The mechanism is a D-13 decision.
- (−) Node.js does not enforce module boundaries; the rules in AGENTS.md and tooling (e.g. import restrictions) must.
- (−) Urdu/RTL, translated validation messages and date/number formats are the client's responsibility and must be designed in from the start.
