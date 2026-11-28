# API — Slice 12: In-app notifications

Backend only. All routes are under `/api/v1/notifications`. Responses use the existing
convention: `{ "success": true, "data": ... }` or `{ "success": false, "code": "ERROR_CODE", "data": null }`.
Every route requires a signed-in session. The recipient is always the signed-in account;
no request field selects a recipient, and unknown query keys are rejected.

## Permissions

| Capability                 | Roles                                                                  |
| -------------------------- | ---------------------------------------------------------------------- |
| `view-own-notifications`   | admin, administrative_staff, transportation_manager, driver, applicant |
| `update-own-notifications` | admin, administrative_staff, transportation_manager, driver, applicant |

## Routes

| Method and path                   | Capability                      | Input                                                       | Success                              |
| --------------------------------- | ------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| `GET /notifications`              | view-own-notifications          | `unread=true\|false`, `page`, `limit` (default 25, max 100) | 200, `{ items, page, limit, total }` |
| `GET /notifications/unread-count` | view-own-notifications          | —                                                           | 200, `{ count }`                     |
| `POST /notifications/:id/read`    | update-own-notifications + CSRF | —                                                           | 200, the notification                |

Notification (newest first):

```json
{
  "id": "17",
  "eventType": "schedule.assigned",
  "title": "New trip assigned",
  "message": "Trip #9 has been assigned to you.",
  "entityType": "schedule",
  "entityId": "9",
  "isRead": false,
  "readAt": null,
  "createdAt": "2026-12-01T08:00:00.000Z"
}
```

`POST /:id/read` is idempotent and keeps the first read time. Another user's notification, or a
missing one, returns `404 NOTIFICATION_NOT_FOUND`.

## Errors

| Status | Codes                                                                          |
| ------ | ------------------------------------------------------------------------------ |
| 400    | `INVALID_NOTIFICATION_ID`, `INVALID_NOTIFICATION_FILTER`, `INVALID_PAGINATION` |
| 401    | `AUTHENTICATION_REQUIRED`, `ACCOUNT_INACTIVE`                                  |
| 403    | `INSUFFICIENT_PERMISSION`, `CSRF_VALIDATION_FAILED`                            |
| 404    | `NOTIFICATION_NOT_FOUND`                                                       |

## Events and recipients (fixed rules)

| Event type                                     | Trigger                                | Recipient                                        |
| ---------------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| `schedule.assigned`                            | schedule created                       | assigned driver                                  |
| `schedule.changed`                             | schedule edited (timing or assignment) | assigned driver                                  |
| `schedule.cancelled`                           | schedule cancelled                     | assigned driver                                  |
| `schedule.replacement_assigned`                | replacement driver saved               | newly assigned driver                            |
| `license.expiring` / `license.expired`         | alert check                            | active admin and transportation_manager accounts |
| `maintenance.upcoming` / `maintenance.overdue` | alert check                            | active admin and transportation_manager accounts |
| `application.status_changed`                   | recruitment status change              | the applicant's account                          |

A driver is a record, not an account. The recipient is the account linked through
`drivers_drivers.account_user_id`. A driver with no linked account has no recipient.

## Delivery guarantees

- Created after the originating transaction commits, outside it, on the pool. A failure is
  caught and logged (message only) and never fails or rolls back the business action.
- Alert check: runs at startup and every `NOTIFICATION_ALERT_INTERVAL_MINUTES` (default 60,
  1–1440). Dates use `BUSINESS_TIMEZONE`.
  - License: expired when expiry is before today; expiring when today ≤ expiry ≤ today + 30.
  - Maintenance: overdue when next service is before today; upcoming when today ≤ date ≤ today + 30.
  - Archived drivers, archived buses and archived records are skipped.
- Repeat safety: unique `(recipient_id, dedupe_key)` index plus `ON CONFLICT DO NOTHING`.
  Keys: `license:{driverId}:{state}:{expiryDate}`, `maintenance:{recordId}:{status}:{nextServiceDate}`,
  `application:{applicationId}:{status}`. A renewed license or new service date is a new alert.
  Schedule events are not deduplicated (each real change notifies).
- Retention: nothing is deleted. A trigger forbids delete, truncate and any edit except
  recording the first `read_at`.

## Migration

`server/src/database/migrations/016_notifications.sql` — run `npm run migrate`.

## Not included

No frontend, no email/SMS/WhatsApp, no mark-all-read, no Urdu text (D-15).
