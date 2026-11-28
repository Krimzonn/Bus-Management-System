# Implementation Plan — Bus Management System

**Version:** 02  
**Date:** November 2026  
**Previous version:** `plan-v01.md`

## 1. Project Status

**Objective:** Build a web-based Bus Management System that centralizes transportation operations, replaces manual record-keeping, and supports secure role-based access.

**Current status:** Slices 1–3 have been implemented, tested, and integrated into `main`. Slice 4 is the next implementation target.

## 2. Completed Work

| Slice | Scope | Status |
|---|---|---|
| 1 | Repository bootstrap, application run path, backend/database setup, migrations, health check and API boundary | Complete — Integrated |
| 2 | Authentication, protected access, role-based authorization and internal account management | Complete — Integrated |
| 3 | Audit persistence, foundational event recording, Admin-only audit access and audit UI | Complete — Integrated |

The main branch also includes the Al-Madani Travellers public landing page and responsive UI refinements.

## 3. Current Work

**Slice 4 — Maintain buses and their default assignments**

**Status:** Not Started — Next Target

Scope summary:
- Bus listing, search and filtering
- Create, view and edit bus records
- Bus status management and archival
- Bus number uniqueness validation
- Seating capacity and required license category
- Audit bus changes
- Role-based access

**Open decision:** Resolve the architecture/documentation conflict regarding optional default route and default driver fields before implementing those fields.

Full requirements and acceptance criteria are defined in `IMPLEMENTATION_SLICES.md`.

## 4. Remaining Roadmap

| Slice | Scope | Status |
|---|---|---|
| 4 | Fleet management (bus records, status, archive, validation, audit and RBAC) | Next |
| 5 | Route management and route availability | Not Started |
| 6 | Driver profiles, status and licenses | Not Started |
| 7 | Scheduling, eligibility and clash detection | Not Started |
| 8 | Clash resolution and replacement drivers | Not Started |
| 9 | Recruitment and onboarding | Not Started |
| 10 | Maintenance and service history | Not Started |
| 11 | Fuel management | Not Started |
| 12 | Notifications | Not Started |
| 13 | Operational reports and exports | Not Started |
| 14 | Responsive design and localization | Not Started |
| 15 | End-to-end verification, NFR checks and release readiness | Not Started |

## 5. Next Steps

- [x] Confirm `main` as the implementation baseline.
- [ ] Resolve the default-route/default-driver ownership decision.
- [x] Review Slice 4 requirements and acceptance criteria.
- [ ] Implement Slice 4 on a feature branch.
- [ ] Run tests, lint, build, regression and manual checks.
- [ ] Review and accept the slice before merging.
- [ ] Update this plan and workflow evidence after integration.

## 6. Version History

| Version | Date | Summary |
|---|---|---|
| v01 | 24 November 2026 | Initial foundation-focused implementation plan; foundation later completed. |
| v02 | November 2026 | Updated to reflect integrated Slices 1–3 and identify Slice 4 as the next target. |
