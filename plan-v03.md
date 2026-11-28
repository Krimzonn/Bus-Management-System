# Implementation Plan — Bus Management System

**Version:** 03
**Date:** December 2026
**Previous version:** `plan-v02.md`

## Current slice

**Slice 12 — In-app notifications (backend)**

**Status:** Awaiting Human Review. Backend code and tests are written and not yet run by the team.
Do not mark Accepted or Integrated until the checks below pass.

Scope delivered:

- Migration `016_notifications.sql`, Notifications module, endpoints (`GET /notifications`,
  `GET /notifications/unread-count`, `POST /notifications/:id/read`)
- Events: schedule assigned/changed/cancelled, replacement assigned, license expiring/expired,
  maintenance upcoming/overdue, applicant status change
- Best-effort post-commit delivery, dedupe index, hourly repeat-safe alert job
- Documentation: `docs/API-notifications.md`, `docs/ADR/ADR-009-notification-integration.md` (Proposed)

Not in scope: frontend notification panel (still to do), external channels.

## Checks required before acceptance

- [ ] `npm run migrate` applies 016
- [ ] `npm run lint` and `npm test` in `server/`
- [ ] Integration tests with `TEST_AUTH_EMAIL` / `TEST_AUTH_PASSWORD`
- [ ] Team sign-off on ADR-009; update ARCHITECTURE.md and AGENTS.md dependency lists if accepted
- [ ] Update `client/src/utils/permissions.js` with the two new capabilities when the UI is built

## Remaining roadmap

Slice 13 (reports) and later slices follow `IMPLEMENTATION_SLICES.md`. Statuses of Slices 4–11 are
tracked by the team's Workflow Evidence Log, not restated here.

## Version history

| Version | Date          | Summary                                              |
| ------- | ------------- | ---------------------------------------------------- |
| v02     | November 2026 | Slices 1–3 integrated; Slice 4 next.                 |
| v03     | December 2026 | Slice 12 backend implemented, awaiting human review. |
