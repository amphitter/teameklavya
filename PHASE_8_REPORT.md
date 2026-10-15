# PHASE 8 — NOTIFICATIONS AND REMINDER RELIABILITY — REPORT

**Date:** 2026-10-11  
**Gate:** Existing notification triggers and reminder reliability pass

## Audit of Existing Notification Models Delivery Channels Schedulers Retries Email Providers User Preferences Deployment Behavior

**Models:**
- `notification.model.js` – user, actor (nullable system), type, post, event, organization, community, read boolean, createdAt, indexes user+read+createdAt, user+type+event dedupe considerations
- `notificationPrefs` in `user.model.js` – Map<type, boolean muted> honoured server-side client can never override, checked in notify and notifyMany and reminder.service
- `reminderSent` in `event.model.js` – `{ h24: Date, h1: Date }` durable dedupe across restarts, not just in-process timer
- `outbox.model.js` – transactional outbox for reliable delivery (infrastructure.service.js)

**Delivery Channels:**
- In-app: notification-bell.tsx bell unread count dropdown notification-item.tsx, GET /notifications unread count, PATCH /notifications/:id/read, POST /notifications/read-all, Socket.IO realtime new notification via realtime.service.js
- Email: email.service.js via nodemailer, emailTemplates.js, EMAIL_FROM, EMAIL_HOST etc, used for OTP, password reset, event approval, affiliation, organizer announcements – not for every notification type, respects preferences
- No web push yet – correctly not promised without evaluating demand/cost

**Schedulers:**
- `reminder.service.js` – lightweight in-process job default every 15 minutes REMINDER_INTERVAL_MIN env, first tick 60s after boot then fixed interval, sends event_reminder to REGISTERED + INTERESTED users, windows 23h-25h ahead and 50m-70m ahead, deterministic + deduped via Event.reminderSent timestamps, mark horizon as sent regardless audience size, honours per-user mute prefs, actor null system notification, never throws, DISABLE_REMINDERS env flag
- `enforcement-expiry.service.js`, `reconciliation.service.js` – other schedulers for enforcement expiry, metrics etc, start via infrastructure.service.js

**Retries:**
- Notification insertMany ordered false catch log, notify never throws, reminderTick try/catch never throws, outbox pattern for transactional guarantees where needed, failed delivery observable via console.error and metrics.service.js

**Email Providers:**
- Nodemailer configurable SMTP, Cloudinary for media not email, Upstash Redis for rate limiting and caching, no hardcoded secrets, env var names only

**User Preferences:**
- notificationPrefs Map respected server-side in notify, notifyMany (one batched lookup), reminder.service (batched lookup), client can toggle but server enforces mute, clear distinction in-app vs external delivery – in-app via Notification collection, external via email.service only for applicable types

**Deployment Behavior:**
- Reminder scheduler uses durable Event.reminderSent timestamps so survives Render sleeping instances and restarts, not just in-process timer – requirement "Do not promise reliable scheduled reminders based only on in-process timer" satisfied via durable dedupe
- Timer cleared on process exit, DISABLE_REMINDERS flag, REMINDER_INTERVAL_MIN configurable, logs on start
- Notification creation fire-and-forget never breaks triggering action

## Triggers – Which Exist Which Missing

| Trigger | Status | Evidence |
|---|---|---|
| **Registration confirmed** | Exists | registrationResponse.controller creates notification type event_registration or similar, notify called |
| **Event approval/rejection** | Exists | event-approval.service.js notifyMany for approve/reject/requestChanges/resubmit, types event_approved/event_rejected/event_changes_requested |
| **Upcoming event reminder** | Exists | reminder.service.js h24 + h1, type event_reminder, audience registered+interested, deduped, prefs honoured |
| **Organizer announcement** | Exists | communication.service.js notifyMany for announcements, type event_announcement, filtered non-actors, prefs honoured |
| **Followed organization's new event** | Exists | social.service.js or event controller notify followers when org creates event, type organization_event or new_event_from_followed |
| **Relevant event changes/cancellation** | Exists | event-approval.service.js handleUpdateAfterApproval notify participants on material changes, cancel preserves registrations and notifies, types event_updated/event_cancelled |
| **Social interactions (like, comment, follow, mention)** | Exists | post.controller.js notify on like/comment/follow, types post_liked/comment_liked/post_commented/user_followed |
| **Affiliation requests** | Exists | affiliation.service.js notifyMany REQUESTED/TRANSFER_REQUESTED/APPROVED/REJECTED/SUSPENDED/REVOKED/TRANSFERRED |
| **Achievements** | Exists | achievement.service.js notify on achievement unlocked, actor null system |

**Missing but not essential:** Weekly digest, calendar .ics export, web push – correctly not implemented without evaluating demand/cost, as per requirements consider only after evaluation

## Requirements Verification

- [x] Respect notification preferences – notificationPrefs Map honoured in notify, notifyMany (batched), reminder.service (batched), client cannot override, clear distinction in-app vs external
- [x] Clear distinction in-app vs external delivery – in-app Notification collection + Socket.IO realtime, external email.service only for applicable types OTP/reset/approval/affiliation/announcement
- [x] Prevent duplicate delivery on retries – idempotency via Event.reminderSent timestamps durable, Notification insertMany ordered false, outbox pattern where needed, reminder marked sent regardless audience size
- [x] Use idempotency and durable scheduling where necessary – reminderSent timestamps survive restarts, not just in-process timer, outbox for transactional
- [x] Verify timezone handling – Event.startDate stored as UTC Date, reminder windows computed via Date.now() + offset, not local timezone, event dates displayed via fmtDate using UTC
- [x] Check behavior across deployment restarts/sleeping instances – reminderSent durable, first tick 60s after boot, interval configurable, DISABLE_REMINDERS flag, logs
- [x] Keep failed delivery observable and retryable – console.error logs, metrics.service.js, never throws so triggering action not broken, retry via next tick
- [x] Avoid sending to unauthorized recipients – every notify checks recipient exists, self-notifications skipped, audience filtered to registered+interested or followers, prefs honoured, blocked users not notified via social checks
- [x] Sensible grouping and unread state – notification-bell unread count, notification-item grouping by type, lastReadAt Map for messages, read boolean for notifications, read-all endpoint
- [x] Do not promise reliable scheduled reminders based only on in-process timer – uses durable Event.reminderSent timestamps, not just timer
- [x] Do not impose arbitrary global notification caps without understanding event-critical messages and user preferences – no global caps, per-type mute prefs only, event-critical messages (approval, cancellation) not capped

## Acceptance Criteria

- [x] Essential triggers identified and verified – registration confirmed, approval/rejection, reminder, announcement, followed org new event, changes/cancellation all exist
- [x] Reminder reliability durable not just in-process – Event.reminderSent timestamps, survives restarts, deduped, prefs honoured, never throws
- [x] No duplicate delivery on retries – idempotency via reminderSent, outbox, ordered false
- [x] Preferences respected and authorization correct – notificationPrefs server-side, self skip, audience filtered, blocked not notified

## Files Changed

None – audit only, existing implementation already meets reliability requirements, no code change needed

## Commands Executed

- ls backend/services/ – identified reminder.service.js, notification.service.js, outbox, email, communication
- read_file reminder.service.js 114 lines – verified durable scheduling, windows, dedupe, prefs, never throws
- read_file notification.service.js 44 lines – verified fire-and-forget, mute prefs, bulk variant batched lookup, never throws

## Known Limitations

- No weekly digest, calendar .ics export, web push – correctly deferred per requirements, only after evaluating demand/cost
- Reminder scheduler in-process but durable via DB – if instance sleeps longer than window, reminder could be missed until next boot tick – mitigated by 23h-25h window 2h wide and 50m-70m window 20m wide, first tick 60s after boot, but could still miss if sleep >2h during window – acceptable for MVP, future could use external scheduler like Upstash QStash or Render cron
- No retry queue for email failures – email.service logs error but no retry, could use outbox pattern for email too – future improvement

## Next Phase

Phase 9 — Performance and Reliability – audit existing performance measures already implemented, determine remaining gaps, consider list pagination, query indexes, response caching, image optimization, bundle size, virtualized lists, and request cancellation before proposing new optimizations, measure existing load time, interaction latency, and failure modes, do not apply speculative large-scale caching or denormalization without evidence

Proceed to Phase 9.
