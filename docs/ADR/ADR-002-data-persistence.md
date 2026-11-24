# ADR-002: Data Persistence and Ownership — Single Relational Database, Module-Owned Tables, Archival over Deletion

**Status:** Proposed (change to Accepted after team sign-off)
**Date:** November 2026
**Related ASRs/drivers:** ASR-08, ASR-10, ASR-11, ASR-04
**Source:** PRD v1.2 — FR-BUS-03, FR-MNT-02, EC-10, FR-REP-01–05, FR-FUEL-02, NFR-04, D-09

## Context
Schedules, maintenance history, fuel records, reports and audit entries all reference buses, drivers and routes. Removing a referenced record would damage history (EC-10), and whether "remove" means deletion or archival is unresolved (D-09). Reports aggregate across entities by date range (FR-REP, FR-FUEL-02). A bus's maintenance history must be retained (FR-MNT-02). Data must be restorable within 4 hours (NFR-04).

## Alternatives considered
1. **Document/NoSQL store.** Flexible schema while requirements change. Weaker referential integrity, harder cross-entity date-range reporting.
2. **Separate database per module.** Strongest isolation. Breaks atomic audit with the business change, complicates backup/restore and cross-module reports; excessive for this scale.
3. **Single relational database, each module owns its tables.** Transactions spanning a change and its audit entry, foreign keys protecting history, straightforward date-range queries, one backup target.

## Decision
- Use **one relational database** as the only authoritative data store.
- **Each module owns its tables.** Only the owning module reads or writes them directly. Other modules use the owner's public interface (read-only queries for Reporting).
- Records referenced by schedules, reports, maintenance, fuel or audit entries are **archived (marked inactive/removed), not physically deleted**, until D-09 is decided by the client. "Remove bus" (FR-BUS-03) therefore means archive.
- Maintenance entries and audit entries are never physically deleted by application code.
- The DBMS product is PostgreSQL, decided in ADR-006 and carried forward in ADR-007.

## Rationale
Relational integrity protects historical references (ASR-10). SQL supports the date-range and cross-entity queries reports need (ASR-11). A single store gives one restore target (ASR-08) and allows the audit write to share the change's transaction (ASR-04). Archival is the safer default while D-09 is open because it can later be turned into hard deletion, but deleted history cannot be recovered.

## Trade-offs / consequences
- (+) Data integrity and simple reporting.
- (+) Reversible: archival can be tightened later.
- (−) Table ownership is a convention inside a shared database, so it relies on AGENTS.md and review.
- (−) Schema changes need migrations while requirements are still moving.
- (−) Archived records accumulate; queries must exclude them by default.
- (−) If the client requires permanent deletion (D-09), this ADR must be revisited for referenced records.
