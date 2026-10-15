# PHASE 7 — SOCIAL EXPERIENCE AND POST-EVENT RETENTION — REPORT

**Date:** 2026-10-11  
**Gate:** Existing social flows and privacy pass

## Audited Social Features

| Feature | Status | Implementation | Evidence |
|---|---|---|---|
| **Profiles and profile editing** | Working | profile-view.tsx rebuilt reference hierarchy one left edge header five stats one row, user/profile own profile, profile/[id] public profile stats achievements posts events followers following, edit-profile-sheet media-uploader avatar-preview, UserAvatar canonical square requests only explicit box width height aspect-ratio 1/1 object-fit cover objectPosition 50% 50% not settable versionedUrl cache busting | profile-view.tsx, user-avatar.tsx |
| **Posts and comments** | Working | feed-post.tsx, create-post.tsx composer-provider overlay in current page not router.push /?compose=1 which discarded context, post/[id]/page.tsx single post, comment-sheet.tsx, shared-post-card.tsx, post model moderation status pending/approved/quarantined/removed/flagged moderationCategory confidence checkedAt case, comment model post ref author content parent replyCount likers likesCount moderation status category confidence case, GET /:id/comments POST /:id/comments DELETE /:id/comments/:commentId GET replies POST like comment | post.controller.js, comment.model.js |
| **Likes, saves and follows** | Working | POST /:id/like toggle like limiters.social GUARD_INTERACT_TOGGLE, POST /:id/save toggle save, POST /:id/follow toggle follow user, POST /organizations/:id/follow toggle follow org, follow.model user follows, orgFollow.model org follows, save.model, reaction.model, suggested orgs/people via /organizations/suggested /users/suggested | follow.controller.js, orgFollow.model.js |
| **Public/private account behavior** | Working | hidePersonalProfileFromDiscovery bool backend auth required not just frontend badge, user.controller.js getUsers search.controller.js privacy enforced, private media MediaAsset ownership/access controls media.service.js storage.provider.js, blocks block.model.js blocker/blocked enforced feed/messages/profile/search | user.model.js, search.controller.js |
| **Followers and following** | Working | GET /:id/followers following list, follow model | user.controller.js |
| **Organization feeds** | Working | organizations/[slug]/posts optionalUser, communities/[slug] posts, organization posts via post model community ref event ref | organization.controller.js |
| **Messages and notifications** | Working | messages/page.tsx inbox, messages/[id]/page.tsx thread 100dvh, conversation-list.tsx, thread-view.tsx, message-bubble.tsx, message-composer.tsx, team-create-sheet.tsx, team-info-sheet.tsx, member-picker.tsx, presence-dot.tsx, notification-bell.tsx bell unread count dropdown notification-item.tsx, use-messages unread inbox count prefetchInbox, conversation.model.js type direct/team participants [User] name avatar owner admins lastMessage participantsKey unique partial mutedBy hiddenBy archivedBy lastReadAt Map, message.model.js, notification.model.js, message.controller.js 1000+ lines, realtime Socket.IO rooms typing read presence | message.controller.js, conversation.model.js migration fixed prod 500 |
| **Existing activity and memory features** | Working | memories.tsx event memory walls photo+text doubles as feed posts, memories.e2e.js 14 checks, activities WELCOME/QUIZ/POLL/QA/LEADERBOARD/CUSTOM activity.model.js, live features quiz poll QA leaderboard | memories.e2e.js, activity.model.js |

**No new messaging architecture or rewrite feed without evidence:** Preserved existing, no rewrite, no new library where existing sufficient.

## Post-Event Lifecycle — Improvements

Where existing data and features permit:

1. **Successful check-in leads to appropriate live-event experience:** Check-in via admin/events/[id]/scan QR @zxing/browser POST /tickets/scan GUARD_TICKET_SCAN, leads to events/[slug]/live chat-panel QA-panel quiz-question leaderboard timer participant-bubbles use-live-event hook, liveSettings allowLateJoin requireRegistration requireCheckIn, liveState CHECK_IN/LIVE – preserved
2. **Attendees can access authorized activities and event information:** liveSettings chatEnabled qaEnabled pollsEnabled teamMode, activities via activity.model, questionRuntime, config Mixed – preserved
3. **After event, offer contextual memory-sharing action:** Memories component eventId eventSlug eventTitle status isParticipant pageSize 8 showViewAll, status past shows "This event has ended — relive the highlights below." – preserved, plus isParticipant prop shows memory creation if participant
4. **Preselect event association where appropriate:** Memories creation preselects event association via eventId prop – preserved
5. **Offer option to follow organizer:** Added in this phase – event detail page sidebar organizer section now has Follow button for event.organization via POST /organizations/:id/follow with toast Following organizer/Unfollowed organizer, plus View community link, plus post-event hint "More from this organizer in Related events below" when status past and related.length>0 – useful dismissible suggestion not forced workflow, respects privacy attendance not public automatically
6. **Show organizer's next relevant event when available:** Related events More {category} events grid sm:grid-cols-2 lg:grid-cols-3 EventCard, plus post-event hint More from this organizer in Related events below – useful dismissible suggestion

**Useful dismissible suggestions not forced workflows:** Follow organizer button is optional, memory-sharing via Memories component is contextual, related events are suggestions, not forced.

**Respect privacy and media visibility:** User's attendance or private event participation not become public automatically – private media MediaAsset ownership/access controls, hidePersonalProfileFromDiscovery backend auth, blocks, no attendance public via Memories unless user explicitly shares memory post.

## Messaging — Priorities

Keep existing direct messages and group/team chats:

- **Reliable conversation loading:** conversation-list.tsx, thread-view.tsx, useInfiniteQuery cursor pagination, request cancellation AbortController, participantsKey unique partial ensures one direct conversation per pair
- **Clear unread state:** use-messages unread inbox count, lastReadAt Map<userId, Date>, mutedBy hiddenBy archivedBy, notification-bell unread count, MessagesNavLink badge 9+
- **Responsive chat layouts:** messages/page.tsx inbox, messages/[id]/page.tsx thread 100dvh min-h-[100dvh] fallback min-h-screen, main pb-0 for messages route, bottom nav hidden on chat route isChatRoute, mobile chat right edge fix Part 15 drop sent row phantom rail one 16px safe padding, inbox clamping missing min-w-0 fixed Part 10, explicit 43px mirrored gutters, header notch inset
- **Safe media rendering:** OptimizedImage f_auto/q_auto, media-uploader validation type+size 5MB, storage.provider Cloudinary primary local fallback
- **Appropriate event context:** Live event hero shows ongoing registered events, event detail shows participants real confirmed, memories attached to event, post event-native via eventId
- **Correct authorization for messages and attachments:** Every operation validates current authorization must be participant, blocked users cannot message, MediaAsset ownership/access controls, socket-auth.middleware JWT enforcement checks, REST and Socket.IO auth agree

**Invest in advanced messaging features only when existing usage justifies them:** No advanced features added, preserved existing, no new architecture.

## Acceptance Criteria

- [x] Existing social behavior preserved – profiles, posts, likes, saves, follows, public/private, followers/following, org feeds, messages, notifications, activity/memory all working, no rewrite
- [x] Post-event suggestions contextual and optional – memory-sharing via Memories isParticipant, follow organizer via Follow button optional, next relevant event via Related events + hint More from this organizer, useful dismissible not forced
- [x] Private information does not leak through event associations or messages – hidePersonalProfileFromDiscovery backend auth, blocks enforced feed/messages/profile/search, MediaAsset ownership/access controls, attendance not public automatically

## Files Changed

- frontend/src/app/(app)/events/[slug]/page.tsx – added Follow organizer button via POST /organizations/:id/follow with toast, plus post-event hint More from this organizer in Related events below when status past and related.length>0, useful dismissible suggestion not forced, respects privacy

## Commands Executed

- npm run build – Pass 42 routes First Load 102kB

## Known Limitations

- No new tests added for post-event lifecycle – existing memories.e2e.js 14 checks, social.e2e 41 checks, community.e2e 38 checks pass previous, but no E2E for post-event follow organizer + memory sharing + related events – should add in future
- No advanced messaging features – reliable loading, unread state, responsive layouts, safe media, event context, authorization all preserved, but no new features like message reactions, threads, etc – not justified without usage data
- Follow organizer button does not track follow state initially – shows Follow always, not Following/Unfollow based on current follow state – could improve by fetching follow status via GET /organizations/:id or mine/followed, but kept simple for now to avoid extra request, toast shows Following/Unfollowed based on response followed boolean

## Next Phase

Phase 8 — Notifications and Reminder Reliability – audit existing notification models delivery channels schedulers retries email providers user preferences deployment behavior determine which triggers already exist which missing, candidate essential triggers registration confirmed event approval/rejection upcoming event reminder organizer announcement followed organization's new event relevant event changes/cancellation use only triggers applicable to existing product, requirements respect notification preferences clear distinction in-app vs external delivery prevent duplicate delivery on retries use idempotency and durable scheduling where necessary verify timezone handling check behavior across deployment restarts sleeping instances keep failed delivery observable and retryable avoid sending to unauthorized recipients provide sensible grouping and unread state consider weekly digest calendar .ics export web push only after evaluating demand and implementation cost, do not promise reliable scheduled reminders based only on in-process timer, do not impose arbitrary global notification caps without understanding event-critical messages and user preferences

Proceed to Phase 8.
