# ADR-008: Audit Architecture and Identity & Access Integration

**Status:** Proposed — pending team sign-off  
**Date:** November 24, 2026  
**Supersedes:** ADR-005 for audit architecture decisions only  
**Related:** ADR-003, ADR-005, PRD v1.2, D-11

## Context

Slice 3 introduces an append-only audit trail for foundational account and authentication events. The existing module-boundary documentation did not explicitly permit Identity & Access to emit audit events or the API Layer to query them. ADR-005 also did not define a read interface, before/after snapshots, or the distinction between strict and best-effort events.

## Decision

1. **One Audit module.** Audit owns audit storage, event validation, append operations, and read/query operations. It must not depend on domain modules.
2. **Permitted dependencies.** Identity & Access may call Audit to record events. The API Layer may call Audit to retrieve entries. Domain modules may call Audit only where their module contracts permit it.
3. **No reverse IAM dependency.** Audit must not query or join Identity & Access tables, import IAM services, or create foreign keys to IAM tables. Identity & Access resolves the authenticated actor's current ID and email from the database and passes that snapshot to Audit.
4. **Strict events.** Account creation, email changes, role changes, and activation/deactivation are written in the same PostgreSQL transaction as the corresponding account change. Failure to write the audit row rolls back the account change.
5. **Best-effort events.** Successful login and logout may be recorded independently. Failure to record these events must not block authentication or logout.
6. **Deferred events.** Failed-login events are deferred until rate limiting and abuse protections are defined. Bootstrap-user creation is excluded from this slice.
7. **Append-only storage.** The application exposes no update/delete operation. Database triggers reject UPDATE, DELETE, and TRUNCATE. These controls do not protect against table owners or superusers; the runtime database role must not own the table or have trigger-management privileges.
8. **Retrieval.** Audit reads are restricted through the existing database-backed Admin capability. Queries use parameterized filters, UTC timestamps, bounded pagination, and deterministic newest-first ordering by `created_at` and `id`.
9. **Data minimization.** Audit snapshots contain only registered, explicitly allowed fields. Passwords, password hashes, session identifiers, CSRF tokens, and other credentials must never be recorded.

## Consequences

- Identity & Access owns actor resolution and supplies the actor email snapshot; Audit stores the supplied snapshot without looking up IAM data.
- Account mutation and strict audit insertion share a transaction helper that accepts only a PoolClient obtained from that helper.
- The Audit module remains reusable by later domain modules without depending on them.
- No correlation-ID middleware is introduced in Slice 3.

## Explicitly unresolved

- D-11's project-wide configurable critical-action policy is not resolved by the Slice 3 code-level event registry.
- Audit retention and purge policy remain unresolved; no automatic deletion or purge job is implemented.
- Failed-login auditing remains deferred.
- The runtime database-role separation described above must be configured and verified in deployment operations.

## Relationship to ADR-005

This ADR supersedes ADR-005 only where audit architecture is clarified or extended. Non-conflicting notification decisions in ADR-005 remain in force. ADR-005 is retained as historical decision context and is not edited in place.
