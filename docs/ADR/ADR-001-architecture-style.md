# ADR-001: Architecture Style — Modular Monolith

**Status:** Accepted (team agreed, November 2026)
**Date:** November 2026
**Related ASRs/drivers:** ASR-04, ASR-07, ASR-08, DRV-01, DRV-02, DRV-04
**Source:** PRD v1.2 — NFR-03, NFR-04, FR-AUD-01–03, §14 open decisions

## Context
The Bus Management System serves one organization (one Transportation Manager, a small administrative team) and must support growth to 250 concurrent users without major architectural changes (NFR-03) and be restorable within 4 hours (NFR-04). Critical changes must always be audited (BR-09). Many requirements are still open (D-01–D-22), so parts of the design will change. The system will be implemented by an AI coding agent, which needs clear, checkable boundaries.

## Alternatives considered
1. **Microservices.** Independent deployment and scaling per service. Needs inter-service communication, distributed transactions and multiple data stores. Breaks "no change without an audit entry" (ASR-04), complicates restoration (ASR-08), and is disproportionate to team size and load.
2. **Layered monolith without module boundaries.** Simplest to start. Boundaries are implicit, so an AI agent will couple modules freely and volatile rules (clash, permissions, status timing) spread across the code.
3. **Modular monolith.** One deployable application divided into modules with explicit responsibilities, owned data and defined interfaces.

## Decision
The system is built as a **modular monolith**: a single deployable backend (the web client is a separate static front-end that only calls the backend API), one authoritative data store, and eleven modules with explicit boundaries (see architecture.md). Modules communicate only through their public interfaces, not through each other's internals or tables.

## Rationale
- One process and one transaction scope make atomic audit writes simple (ASR-04).
- A single deployable and a single data store keep backup and restoration within the 4-hour target manageable (ASR-08).
- 250 concurrent users is comfortably within what one stateless application tier can serve, with a path to run more instances (ASR-07).
- Explicit modules isolate volatile decisions so a client answer changes one module (DRV-01).
- Named modules and allowed dependencies can be written as rules in AGENTS.md and checked in review (DRV-04).

## Trade-offs / consequences
- (+) Low operational complexity; easy to explain and defend.
- (+) Modules could later be extracted into services if ever needed.
- (−) Boundaries are not compiler-enforced by default; they depend on AGENTS.md rules, code review and optionally dependency-check tooling.
- (−) The whole application scales together rather than per module (acceptable at the stated load).
- (−) A defect in one module can affect the single process.
