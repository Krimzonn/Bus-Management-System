# Product Requirements Document (PRD)

## Bus Management System



|Document control|Details|
|-|-|
|Version|1.2|
|Date|8 November 2026|
|Status|**Revised draft — human validation pending; not baselined**|
|Primary client stakeholder|Transportation Manager|
|Review basis|Project problem-discovery material, requirements decisions available in the project conversation, and *Bus Management System: PRD Critique and Human Validation Log* (22 October 2026)|
|Approval|Done.|

> \\\*\\\*Validation status:\\\*\\\* The critique log states that all validation outcomes are Pending and identifies three blockers. This document therefore cannot honestly be called validated or baselined. It incorporates the critique without treating its proposed candidate wording as client decisions. Open matters remain explicit.

## 

## 1\. Product / Feature Overview

The Bus Management System is intended to centralize information used to coordinate buses, drivers, routes, schedules, and related transportation operations.

Capabilities discussed so far include bus records and maintenance history; driver and route statuses; driver license records and expiry checks; schedules and assignment rules; schedule-clash alerts and admin-led resolution; driver registration and recruitment applications; fuel purchase records and fuel reporting; operational reports; responsive web access; English and Urdu interface support; SMS notifications with an in-app fallback when SMS fails; and an audit log for critical changes.

The detailed scope of passenger booking, user permissions, clash detection, fuel-consumption calculation, and several workflows remains unresolved.

## 

## 2\. Problem and User Need

The project problem-discovery material describes schedules, driver assignments, and route information being managed manually across registers, spreadsheets, and messages. Information is scattered, changes are passed on by hand, and finding or cross-checking accurate information takes time. This can cause delays, confusion, and incorrect information.

The Transportation Manager needs an organized way to maintain and coordinate bus, driver, route, schedule, and assignment information. Success metrics and baselines have not yet been agreed.

## 

## 3\. Goals

|Goal|Related requirements|Acceptance criteria|
|-|-|-|
|G-01 Centralize bus, driver, route, and schedule information.|FR-BUS-01–05; FR-DRV-01; FR-ROUTE-01; FR-SCH-01–06|AC-01–03, AC-07|
|G-02 Prevent assignments that violate agreed status rules.|BR-01–03|AC-04–06|
|G-03 Alert the admin to clashes and support resolution.|FR-SCH-07–09; BR-04–05|AC-08–09, conditional on clash definition|
|G-04 Support driver recruitment.|FR-REC-01–05|AC-10–12|
|G-05 Provide identified operational reports.|FR-REP-01–05|AC-13, conditional on report definitions|
|G-06 Support desktop, tablet, and mobile.|FR-UI-01, FR-UI-03, NFR-01–02|AC-14|
|G-07 Support English and Urdu.|FR-UI-02|AC-15, conditional on translation scope|
|G-08 Audit critical changes and provide SMS fallback.|FR-AUD-01–03; FR-NOT-01–02|AC-16–17|
|G-09 Meet the stated concurrency and restoration targets.|NFR-03–04|AC-18–19, conditional on test definitions|
|G-10 Maintain bus maintenance history and identify overdue services.|FR-MNT-01–04; BR-12|AC-20–22|
|G-11 Maintain driver license information and prevent expired-license assignments.|FR-LIC-01–03; BR-13|AC-23–24|
|G-12 Record fuel purchases and report fuel quantities and expenditure by date range.|FR-FUEL-01–02|AC-25–26, conditional on consumption definition|

## 

## 4\. Non-Goals / Out of Scope

The previous draft listed payment processing, GPS/live vehicle tracking, automated route optimization, and any particular implementation technology as out of scope or not to be assumed.

**Validation note:** The critique asks the client to confirm these exclusions were explicitly agreed rather than merely unmentioned. They remain proposed scope boundaries pending that confirmation.

A driving-test workflow is not specified as an in-system feature: it was mentioned during recruitment discussion, but timing, owner, recording, and effect on approval were not decided.

## 

## 5\. Users and Stakeholders

|Stakeholder|Confirmed involvement|Open matters|
|-|-|-|
|Transportation Manager|Primary client stakeholder and requirements clarifier.|Exact system permissions.|
|Admin|Manages bus records; receives clash alerts and resolves clashes; reviews driver applications, schedules interviews, and approves/rejects applicants after interview.|Relationship to Administrative Staff; remaining permissions.|
|Administrative Staff|All administrative staff were stated to share one fixed set of permissions.|Exact permission set and whether this role includes Admin.|
|Driver / Applicant|Can register and apply for relevant posts; driver status affects assignment eligibility.|Profile fields, verification, account activation, application statuses.|
|Passenger|Passenger booking/cancellation records were listed in a report category; mobile-friendly access was mentioned.|Whether booking is in scope and permitted actions.|

The role-by-capability matrix is a blocker and must be approved before baseline.

## 

## 6\. Ubiquitous Language / Glossary

|Term|Meaning|
|-|-|
|Bus status|Active, Inactive, or Under Maintenance.|
|Driver status|Available, On Leave, or Absent.|
|Route status|Blocked or Unblocked.|
|Schedule|Record containing departure time, arrival time, travel date, assigned bus, driver, and route.|
|Schedule clash|Not precisely defined yet; the conditions must be validated by the client.|
|Alternative driver|Replacement driver considered during clash resolution; confirmed status requirement is Available.|
|Admin|Role assigned the responsibilities listed in Section 5; relationship to Administrative Staff is unresolved.|
|Applicant|Person who registers and applies for a relevant post.|
|Application|Submission for a relevant post. Additional application statuses are undefined.|
|Trip|Service described in reports as scheduled, completed, delayed, or cancelled; detailed definitions are open.|
|Booking|Passenger reservation record; workflow and scope are open.|
|Critical change|Change that must be written to the audit log; complete list is open.|
|Audit log|Record of critical changes including who made each change and when.|
|Assignment|Association of a bus, driver, and route; whether a bus record also stores a default driver/route is unresolved.|
|Maintenance record|A bus-specific record containing service date, maintenance type, work description, service cost, and next scheduled service date.|
|Overdue service|A bus maintenance record whose next scheduled service date has passed.|
|Driving license|A driver credential identified by license number, category, and expiry date.|
|Expiring license|A driving license with an expiry date within the next 30 days.|
|Fuel purchase record|A bus-specific record containing purchase date, quantity in liters, total cost, and odometer reading.|
|Fuel consumption|Fuel quantity attributed to a bus over a selected date range; the calculation method requires client clarification.|

## 

## 7\. Functional Requirements

### 7.1 Bus Management

* **FR-BUS-01:** The system shall allow the Admin to add a bus record.
* **FR-BUS-02:** The system shall allow the Admin to update a bus record.
* **FR-BUS-03:** The system shall allow the Admin to remove a bus record. Whether removal means permanent deletion or archival is unresolved; implementation is blocked pending that decision.
* **FR-BUS-04:** A bus record shall include bus number, number of seats, status, route, and driver. Whether route and driver are permanent/default bus fields or schedule-specific assignments is unresolved.
* **FR-BUS-05:** The system shall support bus statuses Active, Inactive, and Under Maintenance.

### 7.2 Driver Management and Availability

* **FR-DRV-01:** The system shall support driver statuses Available, On Leave, and Absent.
* **FR-DRV-02:** The system shall prevent assignment of a driver whose status is On Leave.
* **FR-DRV-03:** The system shall prevent assignment of a driver whose status is Absent.
* **FR-DRV-04:** When a proposed assignment uses an ineligible driver, the system shall not proceed with that driver.
* **FR-DRV-05:** When the Admin selects an alternative driver to resolve a schedule clash, that driver shall have Available status.
* **Open dependency:** Available status alone may not mean the driver is free of overlapping schedules. Overlap checks and route qualifications have not been approved. Driver record creation/editing, required fields, search, and filtering are not yet defined.

### 7.3 Route Management

* **FR-ROUTE-01:** The system shall support route statuses Blocked and Unblocked.
* **FR-ROUTE-02:** The system shall prevent assignment of a bus to a Blocked route.
* **Open dependency:** Route fields, creation/editing/retirement, and the role permitted to change route status are undecided.

### 7.4 Schedule Management

* **FR-SCH-01:** Each schedule shall record departure time.
* **FR-SCH-02:** Each schedule shall record arrival time.
* **FR-SCH-03:** Each schedule shall record travel date.
* **FR-SCH-04:** Each schedule shall identify its assigned bus.
* **FR-SCH-05:** Each schedule shall identify its assigned driver.
* **FR-SCH-06:** Each schedule shall identify its route.
* **FR-SCH-07 — Blocked pending validation:** The system shall alert the Admin when a schedule clash is detected. Detection conditions and alert timing/channel are not yet specified.
* **FR-SCH-08:** The Admin shall be responsible for resolving a schedule clash.
* **FR-SCH-09:** When a replacement driver is used to resolve a clash, that driver shall have Available status.
* **Open dependency:** The role allowed to create, edit, and cancel schedules is not decided.

### 7.5 Driver Registration and Recruitment

* **FR-REC-01:** The system shall allow a new driver to register.
* **FR-REC-02:** The system shall allow a new driver to apply for a relevant post.
* **FR-REC-03:** The system shall allow the Admin to review a driver application.
* **FR-REC-04:** The system shall allow the Admin to schedule an interview for an applicant.
* **FR-REC-05:** After the interview, the system shall allow the Admin to approve or reject the applicant.
* **Open dependency:** Applicant fields, verification, application statuses, outcome communication, account handling, and the driving-test process remain unresolved.

### 7.6 Reports

The following categories were listed; whether this is the complete agreed list must be confirmed.

* **FR-REP-01:** The system shall provide reports of scheduled, completed, delayed, and cancelled trips.
* **FR-REP-02:** The system shall provide bus availability and maintenance reports.
* **FR-REP-03:** The system shall provide driver availability and assignment reports.
* **FR-REP-04 — Blocked pending scope decision:** Passenger booking and cancellation records were listed as a report category, but no confirmed requirement currently defines how bookings are created or cancelled.
* **FR-REP-05:** The system shall provide hiring application and interview outcome reports.

Report permissions, filters, definitions, formats, and print/export behavior remain open.

### 7.7 Notifications

* **FR-NOT-01:** The system shall support SMS notifications; events and recipients are not yet defined.
* **FR-NOT-02:** When SMS delivery fails for an applicable notification, the system shall provide an alternative in-app notification.
* **Open dependency:** A notification matrix must define events, recipients, channel, timing, failure criteria, retries, language, and behavior when a recipient is not signed in. Schedule-clash alert channel/timing also require confirmation.

### 7.8 Audit Log

* **FR-AUD-01:** The system shall record critical changes in an audit log.
* **FR-AUD-02:** Each audit entry shall identify who made the change.
* **FR-AUD-03:** Each audit entry shall record when the change occurred.
* **Open dependency:** Audited entities/actions, edit/delete protections, viewers, and retention are undecided.

### 7.9 Roles and Permissions

* **FR-ACCESS-01 — Blocked pending validation:** The system shall enforce the role-by-capability matrix approved by the client. The matrix is incomplete.
* **FR-ACCESS-02:** The system shall apply one fixed permission set to all Administrative Staff, as stated during elicitation.
* **FR-ACCESS-03:** Only the Admin shall be allowed to add, update, or remove bus records.

### 7.10 Interface and Language

* **FR-UI-01:** The system shall provide a responsive web application for desktop, tablet, and mobile.
* **FR-UI-02:** The system shall provide English and Urdu interface support.
* **FR-UI-03:** The system shall provide mobile-friendly access for drivers and passengers.
* **Open dependency:** Urdu right-to-left layout, translation of notifications/reports, date/number formatting, and supported device/OS versions require confirmation.

### 7.11 Bus Maintenance Management

* **FR-MNT-01:** The system shall allow the Admin to record a maintenance history entry for each bus. Each entry shall include service date, maintenance type, description of work performed, service cost, and next scheduled service date.
* **FR-MNT-02:** The system shall retain each maintenance entry as part of the maintenance history for its associated bus.
* **FR-MNT-03:** The system shall display a bus's maintenance history in chronological order.
* **FR-MNT-04:** The system shall identify buses whose next scheduled service date has passed.
* **Open dependency:** Whether maintenance entries can be edited or deleted, how multiple entries with the same service date are ordered, and whether overdue identification is shown through a dashboard, report, or notification require confirmation.

### 7.12 Driver License Management

* **FR-LIC-01:** The system shall allow the Admin to record and update each driver's driving license number, license category, and expiry date.
* **FR-LIC-02:** The system shall display a list of licenses expiring within the next 30 days.
* **FR-LIC-03:** The system shall prevent a driver with an expired driving license from being assigned to a new schedule.
* **Open dependency:** License-number uniqueness and format validation, handling of missing/invalid expiry dates, whether the 30-day window includes the current date and the 30th day, and treatment of existing schedules when a license expires require confirmation. License category is recorded; category-to-vehicle qualification rules have not been specified.

### 7.13 Fuel Management

* **FR-FUEL-01:** The system shall allow Administrative Staff to record fuel purchases for individual buses. Each record shall include purchase date, fuel quantity in liters, total cost, and odometer reading.
* **FR-FUEL-02:** The system shall calculate and display each bus's total fuel consumption and fuel expenditure for a user-selected date range.
* **Open dependency:** The requirements specify fuel purchase quantities and odometer readings but do not define the method for calculating actual fuel consumed. The client must clarify whether total liters purchased is the intended consumption measure or whether a separate calculation method (for example, based on fuel-level/full-tank records) is required. Date-range inclusivity, currency, odometer validation, and permissions to view or correct fuel records also require confirmation.

## 

## 8\. Non-Functional Requirements

Only targets present in the available decisions are retained; missing thresholds are not invented.

* **NFR-01 — Responsive access:** The web application shall support desktop, tablet, and mobile with simple and intuitive navigation. A measurable usability test is not defined.
* **NFR-02 — Browser compatibility:** The system shall support the latest stable versions of Google Chrome, Microsoft Edge, Mozilla Firefox, and Apple Safari on supported desktop and mobile operating systems. Supported OS versions are not listed.
* **NFR-03 — Concurrent use:** The system shall support growth to 250 concurrent users without major architectural changes. Load profile and response-time target are not defined; “without major architectural changes” needs clarification.
* **NFR-04 — Recovery time:** The system shall be restorable within 4 hours. Incident scope, restoration verification, and maximum acceptable data loss are not defined.
* **NFR-05 — Security and privacy (open requirement area):** Authentication, authorization enforcement, session handling, personal-data protection, registration controls, and retention have not been specified and require decisions before affected features are designed or built.

No response-time, availability, recovery-point, retention, or usability threshold has been invented.

## 

## 9\. Business Rules and Constraints

These are the canonical rule statements. Other sections reference these IDs rather than restating the rules in different wording.

* **BR-01 — Bus eligibility:** A bus with status Inactive or Under Maintenance shall not be assigned to a route.
* **BR-02 — Driver eligibility:** A driver with status On Leave or Absent shall not be assigned to a bus or route.
* **BR-03 — Route eligibility:** A bus shall not be assigned to a route with status Blocked.
* **BR-04 — Alternative driver:** An alternative driver selected for clash resolution shall have status Available.
* **BR-05 — Clash responsibility:** A schedule clash shall be brought to the Admin’s attention, and the Admin is responsible for resolving it. Clash definition and alert mechanism remain open.
* **BR-06 — Bus-record permissions:** Only the Admin may add, update, or remove bus records.
* **BR-07 — Administrative permissions:** All Administrative Staff shall share one fixed permission set; its content remains open.
* **BR-08 — Recruitment:** The Admin reviews applications, schedules interviews, and approves or rejects applicants after interview.
* **BR-09 — Audit:** Critical changes shall be logged with actor and timestamp.
* **BR-10 — SMS fallback:** If SMS delivery fails, an in-app notification alternative shall be provided for the applicable notification.
* **BR-11 — Status timing:** The time at which status rules are validated and the effect of later status changes on existing future schedules have not been decided. No temporal rule is implied.
* **BR-12 — Maintenance due date:** A bus shall be identified as requiring overdue service when its next scheduled service date has passed.
* **BR-13 — License eligibility:** A driver whose driving license has expired shall not be assigned to a new schedule.

## 

## 10\. Main User Flows / Scenarios

### 10.1 Maintain a Bus Record

1. The Admin adds, updates, or removes a bus record.
2. The record includes the fields listed in FR-BUS-04.
3. The system applies BR-06.
4. Critical changes are logged under BR-09.

Removal semantics and handling of records referenced by schedules remain unresolved.

### 10.2 Prepare an Assignment

1. A bus, driver, and route are proposed for an assignment.
2. The system applies BR-01, BR-02, and BR-03.
3. An ineligible driver cannot be used.
4. If clash resolution requires an alternative driver, BR-04 applies.

The assignment creator, validation timing, overlap checks, and no-candidate behavior remain unresolved.

### 10.3 Create and Resolve a Schedule Clash

1. A schedule is recorded with the fields in FR-SCH-01 through FR-SCH-06.
2. The client-approved clash conditions must be defined before clash detection can be built and tested.
3. When a clash is detected, the Admin is alerted.
4. The Admin resolves the clash.
5. If a replacement driver is selected, BR-04 applies.

The flow is not build-ready until clash conditions and the behavior for unresolved clashes or no eligible alternative are decided.

### 10.4 Recruit a Driver

1. A new driver registers.
2. The driver applies for a relevant post.
3. The Admin reviews the application.
4. The Admin schedules an interview.
5. After the interview, the Admin approves or rejects the applicant.

The driving-test process is omitted from this flow pending a client decision.

### 10.5 Maintain Bus Maintenance History

1. The Admin selects a bus and records a maintenance entry with service date, maintenance type, work description, service cost, and next scheduled service date.
2. The system stores the entry against that bus and displays the bus's maintenance entries in chronological order.
3. The system identifies the bus when its next scheduled service date has passed under BR-12.

### 10.6 Review Driver License Expiry

1. The Admin records or updates a driver's license number, category, and expiry date.
2. The system displays licenses expiring within the next 30 days.
3. When a new schedule assignment is attempted, the system checks license expiry and prevents assignment if the license has expired under BR-13.

### 10.7 Record Fuel Purchases and Review Fuel Reports

1. Administrative Staff select a bus and record the purchase date, fuel quantity in liters, total cost, and odometer reading.
2. A user selects a date range for a bus's fuel report.
3. The system calculates and displays fuel consumption and expenditure for that bus over the selected range.

### 10.8 Notification Fallback

1. An in-scope event triggers an SMS notification.
2. SMS delivery fails according to a failure definition that remains to be agreed.
3. The system provides an in-app notification alternative.

The event list, recipients, retries, and timing remain open.

## 

## 11\. Edge Cases and Failure Conditions

|ID|Condition|Confirmed outcome|Still unresolved|
|-|-|-|-|
|EC-01|Assignment uses an Inactive bus.|Prevent assignment under BR-01.|User-facing message.|
|EC-02|Assignment uses a bus Under Maintenance.|Prevent assignment under BR-01.|User-facing message.|
|EC-03|Assignment uses a driver On Leave or Absent.|Prevent assignment under BR-02.|What if no eligible alternative exists.|
|EC-04|Assignment uses a Blocked route.|Prevent assignment under BR-03.|User-facing message.|
|EC-05|A schedule clash is detected.|Alert the Admin; Admin resolves it under BR-05.|Clash definition, channel/timing, unresolved-clash behavior.|
|EC-06|An alternative driver is selected.|Driver status must be Available under BR-04.|Overlap availability and route qualification.|
|EC-07|SMS delivery fails.|Provide an in-app alternative under BR-10.|Failure detection, retries, signed-out recipients.|
|EC-08|A critical change occurs.|Log actor and timestamp under BR-09.|Critical-change list and audit policy.|
|EC-09|Status changes after future schedules exist.|No outcome rule agreed.|Flag, block, or reassign affected schedules.|
|EC-10|A record to remove is referenced by schedules/reports.|No outcome rule agreed.|Permanent deletion/archive and referential rules.|
|EC-11|A bus next scheduled service date has passed.|Identify the bus as overdue for service under BR-12.|Dashboard/report/notification presentation and date-boundary handling.|
|EC-12|A maintenance history entry is recorded for a bus.|Store the required service details and display entries chronologically.|Edit/delete permissions and tie-breaking for equal service dates.|
|EC-13|A driver license expires.|Display it in the expiring list when within 30 days; prevent assignment to new schedules once expired under BR-13.|Existing future schedules and date-window boundary behavior.|
|EC-14|A fuel report is requested for a date range.|Display the bus fuel expenditure and calculated fuel quantity for that range.|Actual-consumption calculation method and date-range inclusivity.|
|EC-15|Fuel purchase data has an inconsistent odometer reading.|No validation outcome has been agreed.|Whether readings must be monotonic and how corrections are handled.|

## 

## 12\. Acceptance Criteria

* **AC-01 — Bus fields:** Given an Admin is creating a bus record, when it is saved, then it can store bus number, number of seats, status, route, and driver. The route/driver data model needs validation.
* **AC-02 — Bus statuses:** Given a bus status is saved, then it is Active, Inactive, or Under Maintenance.
* **AC-03 — Driver/route statuses:** Given a driver or route status is saved, then it belongs to that entity’s agreed status list.
* **AC-04 — Ineligible bus:** Given a bus is Inactive or Under Maintenance, when assignment to a route is attempted, then the system prevents it.
* **AC-05 — Ineligible driver:** Given a driver is On Leave or Absent, when assignment is attempted, then the system prevents that driver’s assignment.
* **AC-06 — Blocked route:** Given a route is Blocked, when a bus assignment is attempted, then the system prevents it.
* **AC-07 — Schedule fields:** Given a schedule is saved, then it contains departure time, arrival time, travel date, assigned bus, assigned driver, and route.
* **AC-08 — Clash alert (conditional):** Given two schedules satisfy the client-approved clash definition, when validated, then the Admin receives the approved alert. This cannot be finalized until clash conditions and notification details are agreed.
* **AC-09 — Alternative driver:** Given clash resolution requires a replacement, when a driver is assigned, then that driver has Available status. Other eligibility checks remain open.
* **AC-10 — Registration/application:** Given a new driver, when they use the confirmed registration/application flow, then they can register and apply for a relevant post.
* **AC-11 — Interview scheduling:** Given an application exists, when the Admin reviews it, then the Admin can schedule an interview.
* **AC-12 — Interview decision:** Given an interview has taken place, when the Admin records the decision, then the applicant can be approved or rejected.
* **AC-13 — Reports (conditional):** Given report permissions and definitions are approved, then the system provides the agreed categories in Section 7.6. Passenger booking reporting is blocked until scope is decided.
* **AC-14 — Responsive access:** Given a supported desktop, tablet, or mobile device, when the application is accessed, then it supports that device category. OS versions remain to be specified.
* **AC-15 — Languages (conditional):** Given English or Urdu is selected, then the agreed interface content is available in that language. Translation scope and Urdu layout require validation.
* **AC-16 — Audit:** Given a change classified as critical occurs, then its audit entry identifies the actor and timestamp.
* **AC-17 — SMS fallback (conditional):** Given an in-scope SMS fails under the approved failure definition, then an in-app notification is provided.
* **AC-18 — Concurrent use (conditional):** Given an agreed test environment/workload, when 250 concurrent users are simulated, then the system supports that load. Response-time and workload definitions remain open.
* **AC-19 — Recovery (conditional):** Given an agreed outage scenario, when restoration is tested, then service is restored within four hours. Outage scope and data-loss target remain open.
* **AC-20 — Maintenance record:** Given the Admin records maintenance for a bus, when the entry is saved, then it stores service date, maintenance type, work description, service cost, and next scheduled service date.
* **AC-21 — Maintenance history order:** Given a bus has multiple maintenance entries, when its history is displayed, then entries appear in chronological order by service date.
* **AC-22 — Overdue maintenance:** Given a bus's next scheduled service date has passed, when maintenance status is reviewed, then the system identifies that bus as overdue for service.
* **AC-23 — License details and expiry list:** Given the Admin records or updates a driver's license, when saved, then the license number, category, and expiry date are stored; licenses expiring within the next 30 days appear in the expiry list. Boundary handling for the 30-day window requires confirmation.
* **AC-24 — Expired license assignment:** Given a driver's license expiry date is before the assignment date, when the driver is assigned to a new schedule, then the system prevents the assignment.
* **AC-25 — Fuel purchase record:** Given Administrative Staff record a fuel purchase for a bus, when saved, then the record stores purchase date, quantity in liters, total cost, and odometer reading.
* **AC-26 — Fuel date-range report:** Given a user selects a date range for a bus, when the fuel report is generated, then it displays total fuel quantity/consumption and total fuel expenditure for that range. The consumption calculation method must be confirmed before this criterion can be fully tested.



## 13\. Assumptions

No unresolved business decision is promoted to an assumption.

Context supported by the project material:

* The project is a Bus Management System.
* The Transportation Manager is the primary client stakeholder.
* The current problem includes scattered manual records and manual coordination.
* A centralized system was selected as the proposed solution.



The exclusions in Section 4 need explicit confirmation. No assumptions are made about clash algorithms, incomplete permissions, passenger booking, status effective dates, deletion behavior, security controls, or missing NFR thresholds.





## 14\. Open Questions / Unresolved Decisions

The critique log marks validation outcomes Pending. These questions remain open and must not be treated as approved requirements.

### Blockers — resolve before baseline

1. **D-01 Schedule clash:** What exact conditions define a clash? Same bus, same driver, route/slot conflicts, turnaround buffer, cross-date/overnight trips? What happens if unresolved?
2. **D-02 Roles and permissions:** What can Admin, Administrative Staff, Transportation Manager, Driver, Passenger, and Applicant do? Are Admin and Administrative Staff distinct? Who creates, edits, and cancels schedules?
3. **D-03 Passenger booking:** Is booking/cancellation in scope? If yes, define actions and data; if no, decide whether to remove the booking report and passenger role or limit passengers to another confirmed capability.

### Major decisions — resolve before design of affected features

4. **D-04 Assignment data model:** Does a bus record hold a default route and driver, or are these stored only in schedules?
5. **D-05 Status timing and future schedules:** When are statuses checked? Do they have effective dates? What happens to future schedules if a bus, driver, or route status changes?
6. **D-06 Alternative-driver eligibility:** Must the alternative have Available status and no overlapping schedule? Are route qualifications required? Who selects the alternative? What if no eligible driver exists?
7. **D-07 Driving test:** Is the driving test part of the system? If yes, when, who records it, and how does it affect approval? If no, is it handled outside the system?
8. **D-08 Driver/route records:** Required fields, maintainers, search, and filtering.
9. **D-09 Deletion/data integrity:** Permanent deletion or archival? Are bus numbers unique? What happens when records are referenced by schedules, reports, or audit entries?
10. **D-10 Notifications:** Events, recipients, channels, timing, failure definition, retries, language, and signed-out recipient behavior.
11. **D-11 Audit policy:** Which actions are critical? Who can view the log? Can entries be edited/deleted? Retention period?
12. **D-12 Measurable NFRs:** Performance, availability, recovery point, restoration scope, usability test, and test workload for 250 concurrent users.
13. **D-13 Security/privacy:** Authentication, authorization enforcement, session handling, personal-data protection, retention, and applicant-registration controls.
14. **D-14 Success metrics/priorities:** Agree 3–5 measurable outcomes and baselines; prioritize requirements for the first release.
15. **D-15 Urdu support:** Translation coverage for interface, SMS, and reports; right-to-left layout; date/number formats.
16. **D-16 Reports:** Viewing permissions, filters, export/print, and definitions of scheduled/completed/delayed/cancelled trips.
17. **D-17 Recruitment details:** Applicant fields, application statuses, multiple-post rule, outcome communication, account handling, and driver-record creation after approval/rejection.
18. **D-18 Devices:** Supported OS versions and typical driver/passenger devices.
19. **D-19 Maintenance history:** Can maintenance records be edited or deleted? How should same-date records be ordered, and how should overdue buses be surfaced (dashboard, report, or notification)?
20. **D-20 Driver licenses:** Are license numbers unique and format-validated? Is the 30-day expiry window inclusive of today and the 30th day? What happens to already-created future schedules when a license expires? Are license categories tied to bus/vehicle types?
21. **D-21 Fuel reporting:** Does “fuel consumption” mean the total liters purchased in the selected period, or must actual fuel consumed be calculated using additional fuel-level/full-tank data? Are date ranges inclusive, what currency is used, and what odometer validation/correction rules apply?
22. **D-22 Fuel and maintenance permissions:** Confirm the exact permissions of Admin versus Administrative Staff for recording, updating, viewing, and reporting maintenance and fuel data.

### Validation and baseline controls

23. Complete provenance checks V-01 through V-19 in the critique log as Confirmed or Changed with evidence.
24. Confirm whether the exclusions in Section 4 were explicitly agreed.
25. Add exact source-session citations only when source details are available; do not invent transcript timestamps or quotations.
26. Record sign-off from the Transportation Manager, Admin representative, PRD author/Business Analyst, technical lead, and QA/test lead as applicable.
27. Do not baseline until blockers are resolved; provenance checks are complete; each goal traces to requirements and acceptance criteria; NFRs are measurable; canonical rules are consistent; success metrics/priorities are agreed; and remaining open items have an owner and due date.

## Requirement Traceability Matrix

|Goal|Requirement IDs|Acceptance criteria|
|-|-|-|
|G-01 Centralize operational records|FR-BUS-01–05; FR-DRV-01; FR-ROUTE-01; FR-SCH-01–06|AC-01–03, AC-07|
|G-02 Enforce assignment eligibility|BR-01–03|AC-04–06|
|G-03 Detect/resolve clashes|FR-SCH-07–09; BR-04–05|AC-08–09 (conditional)|
|G-04 Support recruitment|FR-REC-01–05|AC-10–12|
|G-05 Provide reports|FR-REP-01–05|AC-13 (conditional)|
|G-06 Responsive access|FR-UI-01, FR-UI-03, NFR-01–02|AC-14|
|G-07 English and Urdu|FR-UI-02|AC-15 (conditional)|
|G-08 Audit and notification fallback|FR-AUD-01–03; FR-NOT-01–02; BR-09–10|AC-16–17 (conditional)|
|G-09 Concurrency and recovery|NFR-03–04|AC-18–19 (conditional)|
|G-10 Bus maintenance history and overdue service identification|FR-MNT-01–04; BR-12|AC-20–22|
|G-11 Driver license records and assignment eligibility|FR-LIC-01–03; BR-13|AC-23–24|
|G-12 Fuel purchase records and date-range reporting|FR-FUEL-01–02|AC-25–26 (consumption method conditional)|

## Revision Record

|Version|Date|Change|
|-|-|-|
|1.0|22 October 2026|Initial draft for validation.|
|1.1|22 October 2026|Revised using the critique and validation log: improved traceability and requirement wording, canonical business rules, conditional acceptance criteria, document control, and explicit blocker tracking. Pending decisions were not assumed resolved.|
|1.2|8 November 2026|Added bus maintenance history and overdue-service identification, driver license management and expiry-based assignment restriction, and fuel purchase recording and date-range reporting. Updated goals, glossary, functional requirements, business rules, flows, edge cases, acceptance criteria, open decisions, and traceability. New ambiguities remain explicitly open.|

**End of PRD.**

