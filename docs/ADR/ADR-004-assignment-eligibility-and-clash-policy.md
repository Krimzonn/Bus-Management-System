# ADR-004: Assignment Eligibility and Clash Policy Owned by Scheduling

**Status:** Proposed (change to Accepted after team sign-off)
**Date:** November 2026
**Related ASRs/drivers:** ASR-01, ASR-02, DRV-01
**Source:** PRD v1.2 — BR-01, BR-02, BR-03, BR-04, BR-05, BR-13, FR-DRV-02/03, FR-ROUTE-02, FR-LIC-03, FR-SCH-07–09, D-01, D-04, D-05, D-06

## Context
An assignment (bus + driver + route) is only valid if the bus is not Inactive/Under Maintenance (BR-01), the driver is not On Leave/Absent (BR-02) and has an unexpired license (BR-13), and the route is not Blocked (BR-03). These facts live in three different modules. Schedule clashes must be detected and brought to the Admin (BR-05), but the clash definition (D-01), alternative-driver eligibility beyond Available status (D-06), status timing (D-05) and the data model for default assignments (D-04) are all undecided.

## Alternatives considered
1. **Validation in UI forms.** Quick feedback, bypassable and duplicated across screens.
2. **Each entity module enforces its own rule.** Rules sit near the data, but no single place sees the whole assignment, rules can be skipped by a new code path, and clash detection needs all entities anyway.
3. **Scheduling owns eligibility and clash rules and queries the other modules through their interfaces.**

## Decision
- The **Scheduling module is the only place an assignment/schedule can be created or changed.** No other module, UI or script may write schedules.
- Scheduling checks BR-01, BR-02, BR-03 and BR-13 **before saving every assignment**, by reading bus status, driver status, license validity and route status through the Fleet, Drivers and Routes interfaces. Scheduling does not read their tables and does not modify their data.
- **Eligibility rules and the clash rule are separate, replaceable policy components inside Scheduling**, so a client change to D-01, D-05 or D-06 modifies one component.
- A clash raises an alert to the Admin through the Notifications interface (ADR-005). Resolution remains an Admin action (BR-05); an alternative driver must have Available status (BR-04) and pass the same eligibility checks.
- Undecided behavior (clash conditions, effect of later status changes on future schedules, no-eligible-driver handling) is **not invented**. It is implemented behind the policy interfaces only after the client decides, and the agent must raise it as a question.

## Rationale
A single enforcement point guarantees no path bypasses the rules, which is exactly what G-02 and G-11 require (ASR-01). Putting clash logic in a replaceable policy contains the biggest requirement risk (ASR-02, DRV-01).

## Trade-offs / consequences
- (+) Rules cannot be skipped by new screens or modules.
- (+) Volatile rules are isolated and testable.
- (−) Scheduling depends on three modules and becomes a central, important module.
- (−) Per-assignment checks require cross-module reads; acceptable at 250 users.
- (−) Until D-01/D-05 are answered, clash detection and re-validation of existing future schedules cannot be completed, only structured for.
