# API — Slice 9: Applicant submission, review and driver registration

This file was empty in the supplied Slice 8 branch. This section documents the new API without redefining earlier contracts. All routes are under `/api/v1`. Existing JSON conventions remain unchanged: `{ "success": true, "data": ... }` on success; `{ "success": false, "code": "ERROR_CODE", "data": null }` for handled errors. A request with a valid login uses the existing HTTP-only session cookie. Obtain a CSRF token from `GET /auth/csrf`; include `X-CSRF-Token` on every mutation, including public applicant registration. `POST /auth/login` returns the regenerated session token. Never pass an applicant ID, role or actor in a mutation body.

## Permissions

| Capability           | Admin | Transportation Manager | Applicant            | Other roles |
| -------------------- | ----- | ---------------------- | -------------------- | ----------- |
| `view-recruitment`   | Yes   | Yes, read-only         | No                   | No          |
| `manage-recruitment` | Yes   | No                     | No                   | No          |
| `apply-recruitment`  | No    | No                     | Own application only | No          |

`POST /auth/register-applicant` is public with CSRF, and always assigns the existing `applicant` role. It does not log the user in. Use the existing `POST /auth/login` afterward.

## Routes and inputs

| Method and path                    | Capability                               | Body/query                                          | Success                           |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------------- | --------------------------------- |
| `POST /auth/register-applicant`    | Public + CSRF                            | `{email,password}`                                  | 201, `{user:{id,email,role}}`     |
| `GET /recruitment/own`             | apply-recruitment                        | —                                                   | 200, application array            |
| `POST /recruitment/own`            | apply-recruitment                        | `{fullName,experience}`                             | 201, application                  |
| `GET /recruitment/own/:id`         | apply-recruitment + ownership            | —                                                   | 200, application + history        |
| `POST /recruitment/own/:id/driver` | apply-recruitment + ownership + selected | `{licenseNumber,licenseCategory,licenseExpiryDate}` | 201, updated application          |
| `GET /recruitment`                 | view-recruitment                         | `q`, `status`, `page`, `limit` (optional)           | 200, `{items,page,limit,hasMore}` |
| `GET /recruitment/:id`             | view-recruitment                         | —                                                   | 200, application + history        |
| `PATCH /recruitment/:id/status`    | manage-recruitment                       | `{status,reason?}`                                  | 200, updated application          |
| `PUT /recruitment/:id/interview`   | manage-recruitment                       | `{date,notes?,outcome?}`                            | 200, updated application          |

IDs are positive decimal strings. The list defaults to page 1, limit 25 (maximum 100, maximum page 10000). `q` is a case-insensitive literal substring of name, email or ID, max 100 characters; status must be one of the five status keys. Applicant ownership comes solely from the authenticated identity. An attempt to access a different applicant's record returns 404, even when that record exists. Public registration normalizes email and requires a 12–128 character password, hashed using existing Argon2id logic. Unknown mutation fields are rejected.

Application example (the database-facing field names are returned as JSON keys, consistently across list and detail):

```json
{
  "id": "31",
  "applicant_id": "12",
  "applicant_email": "applicant@example.com",
  "full_name": "Ali Raza",
  "experience": "Five years driving heavy vehicles",
  "status": "test_interview",
  "interview_date": "2026-11-20",
  "interview_notes": "Interview completed",
  "interview_outcome": "passed",
  "decision_reason": null,
  "driver_id": null,
  "created_at": "2026-11-19T10:00:00.000Z",
  "updated_at": "2026-11-20T10:00:00.000Z"
}
```

Detail responses include `history`, an array of `{id,event,previous_status,new_status,details,created_at}` in chronological insertion order. Actor ID is persisted in history and actor ID/email in the Admin audit log; other actors' account identifiers are not included in the applicant-facing history. IDs in responses are strings, not JavaScript numbers. Email is the submission-time identity snapshot, not a live join into IAM.

## Workflow and validations

- `submitted` → `under_review` → `test_interview` → `selected` or `rejected`. A final decision requires a recorded interview outcome. Final states cannot be changed; driver registration is the only subsequent action for selected applications.
- Full name: nonempty, maximum 100 characters, contains at least one letter; experience/qualifications: required, maximum 255 characters. Control characters are rejected. One application per account, retained for history; no reapplication or multiple-post model in this baseline.
- Interview date: valid `YYYY-MM-DD` calendar date. To schedule an interview, send date with `outcome: null` (or empty string) and optional notes. To record an outcome, use `passed`, `failed` or `completed`, date not later than the current business date, and nonempty notes (max 255 characters). A recorded outcome cannot be reverted to pending. While the application remains at the interview stage, Admin may correct recorded interview information. Each update is audited. Outcome does not automatically select/reject; Admin makes the final decision. Optional final reason: max 255 characters.
- Registration uses the existing Drivers create service and validator. Full name comes from the selected application, not from the client. License fields use existing driver validation and license uniqueness. An existing linked driver account also blocks a second registration. Existing initial driver status defaults to `available`; a past license expiry is handled by existing eligibility rules. The new driver ID is stored on the application. A row lock, unique constraints, and one database transaction protect concurrent registrations and prevent partial creation. Account role and driver-login link are not automatically changed.
- Every successful submission, status transition, interview save and recruitment-to-Drivers registration writes a recruitment history entry and a strict audit record in the same transaction. Driver creation also writes the existing `driver.created` audit event.

## Errors

| HTTP status | Error codes / meaning                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400         | `INVALID_INPUT`, `INVALID_RECRUITMENT_INPUT`, `INVALID_EMAIL`, `INVALID_PASSWORD`, `INVALID_APPLICATION_ID`, `INVALID_PAGINATION`, existing driver input codes                        |
| 401         | `AUTHENTICATION_REQUIRED`, `ACCOUNT_INACTIVE`                                                                                                                                         |
| 403         | `INSUFFICIENT_PERMISSION`, `CSRF_VALIDATION_FAILED`                                                                                                                                   |
| 404         | `APPLICATION_NOT_FOUND` (also for a foreign application's ID)                                                                                                                         |
| 409         | `ACCOUNT_ALREADY_EXISTS`, `DUPLICATE_APPLICATION`, `INVALID_APPLICATION_TRANSITION`, `DRIVER_REGISTRATION_NOT_ELIGIBLE`, `DRIVER_ALREADY_REGISTERED`, `DRIVER_LICENSE_ALREADY_EXISTS` |

No external notification delivery is implemented: Notifications is a later Slice 12 feature. The audit/history records preserve the originating recruitment events.
