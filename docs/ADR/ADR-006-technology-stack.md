# ADR-006: Technology Stack — Django, PostgreSQL, Server-Rendered Web UI

**Status:** Superseded by ADR-007 (team changed stack to React + Node.js + PostgreSQL, 9 November 2026)
**Date:** November 2026
**Related ASRs/drivers:** ASR-03, ASR-06, ASR-07, ASR-08, ASR-09, DRV-02, DRV-03
**Source:** PRD v1.2 — FR-UI-01/02/03, NFR-01–04; ADR-001, ADR-002, ADR-003

## Context
The PRD prescribes no technology (§4). ADR-001 fixes a modular monolith and ADR-002 a relational database. The product is a web application (responsive on desktop, tablet, mobile; English and Urdu with right-to-left layout) built by a small team with an AI coding agent. A stack must be decided explicitly so the agent does not choose one itself (DRV-03).

## Alternatives considered
1. **NestJS (Node.js) + React + PostgreSQL.** Modules map well, but a separate frontend adds a second codebase and API contract with no requirement that needs it.
2. **Laravel (PHP) + MySQL.** Comparable fit; chosen only if the team knew PHP better.
3. **Spring Boot (Java).** Strong module discipline, but heavier than this project's scale needs.
4. **Django (Python) + PostgreSQL, server-rendered pages.**

## Decision
- **Backend/web framework:** Django (Python), single project, one Django app per module defined in architecture.md.
- **Database:** PostgreSQL (the relational database required by ADR-002).
- **UI:** server-rendered Django templates, responsive, no separate single-page frontend. Django's translation (i18n) facilities are used for English and Urdu, including right-to-left layout.
- **Authentication/permissions foundation:** Django's authentication and session framework, used under the central policy defined in ADR-003.
- **Not decided here (must be raised for human approval):** CSS/UI framework, SMS provider, hosting/deployment platform, background-task mechanism, specific libraries beyond Django and the PostgreSQL driver.

## Rationale
Django's app structure matches the module structure; its ORM and migrations suit relational integrity and date-range queries (ADR-002); built-in authentication, sessions and i18n cover ASR-03, ASR-06 and part of ASR-09; a single Django application with one PostgreSQL database meets the 250-user and 4-hour restoration targets (ASR-07, ASR-08) and keeps the system simple for a small team (DRV-02). The team has agreed on it.

## Trade-offs / consequences
- (+) One language and one codebase; mature, well-documented stack that AI agents know well.
- (−) Django lets any app import any other app's models, so module boundaries depend on the rules in AGENTS.md (cross-module access only through a module's public service/query interface).
- (−) The Django admin site bypasses central authorization and audit, so it must not be used for business operations.
- (−) Server-rendered UI offers less client-side interactivity; acceptable because no requirement needs it.
- (−) Locks in Python/Django; changing stack later is costly.
