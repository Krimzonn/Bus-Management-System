# ADR-003: Authentication and Authorization Boundary

**Status:** Proposed (change to Accepted after team sign-off)
**Date:** November 2026
**Related ASRs/drivers:** ASR-03, ASR-09, DRV-01
**Source:** PRD v1.2 — FR-ACCESS-01–03, BR-06, BR-07, NFR-05, FR-REC-01/02, D-02, D-13, D-22

## Context
The role-by-capability matrix is incomplete and is a baseline blocker (D-02). Known rules: only the Admin may add/update/remove buses (BR-06); all Administrative Staff share one fixed permission set (BR-07), whose content is open. Drivers can register publicly and apply for posts (FR-REC-01/02), which exposes an unauthenticated surface and personal data (license numbers, applicant details). Security details (D-13) are unspecified.

## Alternatives considered
1. **Hide forbidden actions in the UI only.** Fast, but anyone can call the server directly. Not real access control.
2. **Permission checks written independently inside each module.** No central component, but scattered, inconsistent, and every answer to D-02 would touch many files.
3. **Central authorization policy enforced server-side at the application boundary, with the role-to-capability matrix held as data.**

## Decision
- **Authentication** is handled solely by the Identity & Access module. All internal functions require an authenticated session.
- **Authorization is enforced on the server** at the application boundary (before a module's operation runs) through one policy in Identity & Access. UI hiding is a convenience only, never the control.
- The **role-to-capability matrix is data/configuration**, not hard-coded checks in modules. Modules declare the capability an operation needs (e.g. "manage-bus") and ask the policy.
- The **public area** (driver registration and application) is separated from the internal area. Applicants can reach only their own registration/application data.
- Roles are not hard-wired beyond what the PRD confirms; Admin, Administrative Staff, Transportation Manager, Driver, Passenger and Applicant are configurable until D-02 is resolved.
- Session mechanism and credential storage details are implementation decisions to be made under D-13 and raised to humans; they are not decided here.

## Rationale
One enforcement point makes access control testable and lets the client's eventual answers to D-02/D-22 change data instead of code (ASR-03). Server-side enforcement is the only control that can't be bypassed. Separating the public registration surface reduces exposure of internal functions and personal data (ASR-09).

## Trade-offs / consequences
- (+) Single place to audit and test permissions.
- (+) Requirement changes in D-02 are cheap.
- (−) Every operation must go through the check; a skipped check is a vulnerability, so AGENTS.md forbids bypass and reviews must verify it.
- (−) A capability-based model is slightly more work up front than a few role checks.
- (−) Passenger and Applicant behavior stays provisional until D-03 and D-17 are decided.
