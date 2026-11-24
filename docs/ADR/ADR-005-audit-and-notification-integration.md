# ADR-005: Audit and Notification Integration (Cross-Cutting Capabilities)

**Status:** Proposed (change to Accepted after team sign-off)
**Date:** November 2026
**Related ASRs/drivers:** ASR-04, ASR-05, ASR-06
**Source:** PRD v1.2 — FR-AUD-01–03, BR-09, FR-NOT-01/02, BR-10, EC-07, EC-08, FR-UI-02, D-10, D-11, D-15

## Context
Every module may produce critical changes that must be logged with actor and timestamp (BR-09). Notifications (SMS, with an in-app fallback on failure) are used for clash alerts and other events not yet fully defined (D-10). SMS depends on an external provider that may fail or be unavailable. Messages must be available in English and Urdu (D-15). The list of critical actions, audit viewers and retention are open (D-11).

## Alternatives considered
**Audit**
1. Asynchronous, event-based audit logging. Decoupled, but a change can commit without its audit entry.
2. Each module writes its own history. Inconsistent and hard to review.
3. A single Audit module called synchronously within the business transaction.

**Notifications**
1. Call the SMS provider directly from business code. Simple, but ties core operations to an external service and its failures.
2. Notifications module with a gateway interface, triggered after the business transaction commits, with in-app fallback.

## Decision
- **Audit:** the Audit module exposes one interface for recording an entry (actor, timestamp, entity, action, summary). Modules call it **inside the same transaction** as the critical change. If the audit write fails, the change fails. The audit store is **append-only**: the application provides no update or delete operation on audit entries.
- **What counts as critical** is a configurable list decided by humans (D-11); modules must not invent audit categories.
- **Notifications:** modules request a notification through the Notifications interface **after** their transaction commits. Notifications is the only module that communicates with the SMS provider, through a gateway adapter, so the provider can change without affecting other modules.
- If SMS delivery fails under the agreed failure definition (D-10), Notifications creates an **in-app notification** (BR-10). A notification failure never rolls back or blocks the business operation.
- Message text is produced from **language-specific templates** (English/Urdu); modules pass data and event type, not prewritten text.
- Which events notify whom, retry behavior and failure definition are not decided here. The agent must not invent them.

## Rationale
Synchronous in-transaction audit guarantees "no critical change without an entry" (ASR-04). Isolating the SMS provider and making notification post-commit keeps core scheduling and records working when the provider fails (ASR-05). Templates keep Urdu support from being retrofitted (ASR-06).

## Trade-offs / consequences
- (+) Reliable, consistent audit trail and one place to apply D-11 policy.
- (+) Provider can be replaced; failures are contained.
- (−) Audit writes add some cost to each critical operation and make Audit a dependency of every module.
- (−) If the audit write fails the user's change is rejected (deliberate, but users may notice).
- (−) Post-commit notification means a crash between commit and send could lose a notification unless the Notifications module persists pending notifications. Its design should record notifications before sending.
- (−) Event list, recipients, retry and failure definition remain blocked until D-10 is answered.
