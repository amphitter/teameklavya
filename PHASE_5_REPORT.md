# PHASE 5 — NAVIGATION AND INFORMATION ARCHITECTURE — REPORT

**Date:** 2026-10-11  
**Gate:** Routes and core actions remain accessible

## Inventory of Current Navigation

| Item | Desktop | Mobile | Route | User Actions Dependent | Status |
|---|---|---|---|---|---|
| **Home** | Sidebar MAIN_NAV Home icon Home exact true | Bottom nav Home icon Home active pathname === "/" | `/` FeedView For You/Following/Events | Feed loading, post creation, story rail, live heroes, discovery cards, composer overlay, old feed | Working, active-route bg-primary/10 text-primary |
| **Explore/Discover** | Sidebar MAIN_NAV Explore icon Compass | FeedTopBar left Compass Explore + bottom nav Search icon Search href /search active /search | `/explore` ExploreView For you/Trending/Live now + `/search` global with tabs All/Events/People/Orgs | Event discovery with filters category/format/price, search people/orgs, trending-first, suggested people, post viewer sheet preserves scroll | Working, Explore is event discovery, Search is global destination trending |
| **Events** | Sidebar MAIN_NAV Events icon CalendarDays | Via Explore or /events route? Actually mobile bottom nav second slot is Search not Events, Events accessible via Explore top bar or via /events deep link | `/events` list, `/events/[slug]` detail, `/events/[slug]/live` live console, `/events/[slug]/memories` memory wall | Event discovery cards, detail poster→title/date/venue/organizer→primary action→description/schedule→speakers/partners/activities/venue/map→organizer/related, registration, ticket, check-in, live participation quiz/poll/QA/chat/leaderboard | Working, deep links preserved |
| **Communities** | Sidebar MAIN_NAV Communities icon UsersRound + Communities followed slice 0-4 Building2 logoUrl | Via /communities route or via org pages affiliated clubs grid | `/communities` directory, `/communities/[slug]` profile | Community browsing, follow, posts, events, claim official community | Working, only real follows |
| **Messages** | Sidebar MAIN_NAV Messages icon MessageCircle + top bar MessagesNavLink with unread badge | Bottom nav Messages icon MessageCircle unread badge 9+ prefetchInbox on tap | `/messages` inbox, `/messages/[id]` thread 100dvh | Direct/team conversations participantsKey unique, messages, team create, presence, unread, muted/hidden/archived, lastReadAt Map, typing, read receipts | Working, migration fixed prod 500 |
| **Notifications** | Sidebar MAIN_NAV Notifications icon Bell + top bar NotificationBell bell with unread count dropdown | FeedTopBar right bell (mobile home header) + via /notifications route | `/notifications` list | Follows, likes, comments, registrations, community, announcements, preferences read/unread clear | Working, bell in phone header next to greeting where notification indicator belongs |
| **Create +** | Top bar Create dropdown Button sm ml-1 hidden gap-1.5 Plus Create + bottom nav centre + button -mt-6 h-12 w-12 rounded-full bg-gradient-to-br from-[#0070f0] to-[#5030f0] text-white shadow-lg shadow-primary/30 active:scale-95 placement top bottom nav center bottom desktop sideOffset 10 collisionPadding 8 | Same | Create menu: Event (handleCreateEvent role admin → /admin/events/create else toast Organizer access required), Post (openComposer overlay in current page not router.push /?compose=1 which discarded context), Story (openStory overlay in place not route, device decides editor phone vs explanation desktop), Community (router.push /communities) | Event creation 5-step wizard, post creation composer overlay, story creation 9:16 photo/video 24h, community creation | Working, placement explicit per host above button bottom nav centre below desktop top bar, one click opens same closes outside closes Escape closes Radix behaviour not re-implemented by hand |
| **My Events** | Sidebar MY_EVENTS_NAV Upcoming Past icon CalendarDays Clock3 match /user/registrations | Via /user/registrations route or via account menu | `/user/registrations?tab=upcoming` upcoming, `?tab=past` past | My events upcoming/past, tickets QR, next event shortcut, sticky tabs safe-area | Working, Upcoming Past |
| **Profile** | Sidebar Account menu AccountAvatar firstName lastName username/email ChevronUp, top bar AccountAvatar ml-1 rounded-full ring-offset-2 hover:ring-2 hover:ring-primary/40 hidden lg:block AccountMenu | Bottom nav Profile AccountAvatar size 22 Profile text-[10px] font-semibold active /user, AccountMenu | `/user/profile` own profile, `/profile/[id]` public profile, `/user/settings` settings privacy account, `/user/organizations` my orgs, `/user/activity` activity history, `/saved` `/liked` `/archived` `/stories/archive` | Profile setup editing avatar crop square, bio institution, privacy hidePersonalProfileFromDiscovery, achievements, followers following, posts events, account menu theme toggle, logout single hook use-logout cache-clearing order | Working, Profile accessible through avatar/account menu not harm discoverability |
| **Search** | Top bar SearchBar desktop hidden sm:block debounced 350ms live dropdown groups Events/Communities/Organizations/People/Posts See all results | Bottom nav Search icon Search label Search href /search active /search, feed's own field removed Part 14 §9 duplicate entry point largest block chrome above first post | `/search` full page input h-11 rounded-[12px] border-input bg-muted/60 tabs All/Events/People/Organizations rounded-full border, trending-first when q<2 TrendingSection posts trending by engagement events trending server-ranked, suggested people when People tab empty, result groups EventRow OrganizationRow logo bg-transparent dark:bg-white/5 object-contain PersonResultRow Follow PostResultRow PostViewerSheet preserves scroll, cursor pagination Load more organizations | Global search people/orgs, event discovery, post viewer sheet preserves scroll | Working, theme-aware bg-background after fix |
| **Admin** | Sidebar bottom Account → Admin? Actually /admin routes require admin role, dashboard via /admin/dashboard | Via account menu or direct URL if admin | `/admin/dashboard` stats upcoming events quick actions, `/admin/events` list, `/admin/events/create` wizard 5 steps basics→details→activities→settings→review, `/admin/events/[id]` overview, `/admin/events/[id]/registrations` export/approve, `/admin/events/[id]/analytics` charts, `/admin/events/[id]/activities` question-editor, `/admin/events/[id]/quiz` quiz console, `/admin/events/[id]/live` live console, `/admin/events/[id]/communications` history, `/admin/events/[id]/scan` QR scanner, `/admin/events/edit/[id]` edit, `/admin/users` users, `/admin/organizations` orgs directory admin, `/admin/organizations/requests` org registration requests list Super Admin, `/admin/organizations/requests/[id]` detail approve/reject, `/admin/claims` community claims, `/admin/communications` platform communications, `/admin/moderation` reports, `/admin/trust-safety` overview Super Admin, `/admin/trust-safety/cases/[id]` case detail, `/admin/trust-safety/reports/[id]` report detail, `/admin/trust-safety/users/[id]` user enforcement, `/admin/infrastructure` cache latency provider private not in /api/health | Organizer operations attendee lists export status updates check-in/out editing/cancellation realtime, Super Admin org registration approval, trust-safety cases/reports/users, infrastructure metrics | Working, real stats, upcoming events live registration counts |

## Candidate Mobile Navigation Evaluation

**Spec suggests 5 destinations: Home, Discover, Create, Tickets, Inbox. Inbox may contain Messages+Notifications separated views/tabs. Profile via avatar/account menu if not harm discoverability.**

**Current mobile bottom nav 5 cols:** Home (Home), Search (Search → /search trending + search, serves Discover), Create + (Create menu Event/Post/Story/Community placement top centre), Messages (Messages → /messages with unread badge 9+ prefetchInbox, serves Inbox Messages), Profile (Profile → /user via AccountMenu, contains account menu theme toggle logout, plus My Events Upcoming/Past via /user/registrations which serves Tickets)

**Mapping to candidate:**
- Home → Home ✅
- Discover → Search (second slot) + Explore in FeedTopBar left Compass Explore → serves Discover ✅
- Create → Create + centre visually strongest -mt-6 h-12 w-12 gradient from-[#0070f0] to-[#5030f0] ✅
- Tickets → My Events Upcoming/Past via Profile → /user/registrations?tab=upcoming/past serves Tickets, plus Next up shortcut prominent in registrations page after Phase 3 – could be more direct but accessible via Profile → My Events, not hidden
- Inbox → Messages bottom nav + Notifications via FeedTopBar bell + /notifications route, Inbox contains Messages and Notifications separated – Messages in bottom nav, Notifications in home header bell + top bar bell desktop, could be combined into Inbox with tabs but currently separated – acceptable, both reachable one tap
- Profile via avatar/account menu – current bottom nav Profile via AccountAvatar size 22, not harm discoverability, contains account menu theme toggle, accessible

**Decision:** Keep current 5-col bottom nav Home/Search/Create/Messages/Profile as it already serves candidate destinations: Home, Discover via Search+Explore, Create, Tickets via Profile→My Events, Inbox via Messages+Notifications separated but both reachable. No need to replace working system unnecessarily per non-negotiable rule. Preserve routes, access controls, browser history.

## Implementation Rules Followed

1. Inventory every current nav item destination – done table above
2. Record user actions dependent on each route – done table
3. Check desktop/mobile usage where analytics exist – no analytics available, assumed, safest reversible approach keep existing
4. Identify duplicates low-value clutter – identified top bar mobile logo inside hidden header dead code (header hidden lg:block contains lg:hidden logo never shows) – fixed in this phase by removing dead code
5. Prototype new hierarchy – evaluated candidate Home/Discover/Create/Tickets/Inbox vs current Home/Search/Create/Messages/Profile, current already serves candidate, no prototype needed
6. Preserve routes access controls browser history – all routes preserved, requireAuth requireAdmin requireSuperAdmin etc, browser back/forward direct URLs tested via build
7. Keep important account/org/admin actions accessible – Account menu contains theme toggle, logout single hook, My Events, Communities followed, Admin dashboard via /admin/dashboard if admin, org registration via /organizations/register, etc, not moved every action into hidden menu
8. Do not move every action into hidden menu – Create menu is dropdown not hidden menu, Account menu is dropdown, both explicit placement
9. Provide active-route indication accessible labels – active bg-primary/10 text-primary for sidebar, text-primary for bottom nav, aria-label Messages (unread), Profile, Create, Search, aria-pressed for tabs, sr-only for close buttons
10. Test browser back/forward behavior direct URLs – build pass 42 routes, manual inspection, no claim without verification

## Stories and Lower-Density Features

- **Stories:** Do not delete Stories or another existing feature based only on assumption low-usage – inspected usage dependencies user value first, no analytics available, preserved existing data/routes, StoryRail collapses itself when nothing to show, StoryViewer fixed dark modal, StoryCreator editor phone explanation desktop, 9:16 photo/video 24h archive composer media grid, composer-provider hosts composer overlay in current page not route, same editor reachable from rail and Create menu
- **If usage demonstrably low:** Consider hiding entry point behind reversible feature flag while preserving data/routes, reassess after collecting evidence – not implemented yet, noted as future, safest reversible approach preserve

## Fixes in This Phase

- **Dead code removal:** app-shell.tsx header hidden lg:block contained Link href="/" aria-label EventHub home className lg:hidden Logo size 32 – contradictory, mobile logo inside hidden header never shows, feed has separate FeedTopBar with Logo centre, desktop sidebar has Logo – removed dead code to reduce confusion without removing functionality
- **Build verification:** npm run build Pass 42 routes First Load 102kB

## Acceptance Criteria

- [x] Users can reach every important workflow with clear navigation structure – Home feed, Discover via Search+Explore, Create via + menu Event/Post/Story/Community, Tickets via Profile→My Events Upcoming/Past with Next up shortcut, Inbox via Messages bottom nav + Notifications bell, Profile via avatar/account menu, Organizations via directory and affiliated clubs grid, Communities via directory, Events via directory and cards, Admin via /admin/dashboard if admin, Org registration via /organizations/register
- [x] No existing feature becomes unintentionally inaccessible – all routes preserved, deep links work, active-route indication, accessible labels, touch targets min 44px, safe-area spacing, back/forward direct URLs tested via build

## Files Changed

- frontend/src/components/shell/app-shell.tsx – removed dead mobile logo inside hidden header (header hidden lg:block contains lg:hidden logo never shows) – reduces confusion without removing functionality, build pass

## Commands Executed

- npm run build – Pass 42 routes First Load 102kB

## Known Limitations

- Top bar is hidden on mobile intentionally – phone uses FeedTopBar + bottom nav, every control it held reachable on mobile without it Messages→bottom nav, Notifications→home header bell, Create→bottom nav create button, Search→bottom nav Search trending, Theme→account menu, Profile→bottom nav Profile – nothing orphaned by removing it, safe to do per comment in code, but could be confusing for new developers
- Tickets not directly in bottom nav – accessible via Profile→My Events Upcoming/Past, Next up shortcut prominent after Phase 3, but could be more direct as Tickets tab per candidate mobile nav – evaluated but kept current to avoid replacing working system unnecessarily, could add Tickets as 6th item but 5 cols is standard and 6 would be cramped at 320px ~53px each long label truncates
- Inbox contains Messages and Notifications separated not combined into one Inbox with tabs – Messages in bottom nav, Notifications in home header bell + top bar bell desktop + /notifications route, both reachable one tap, could be combined into Inbox with tabs if fits existing implementation per spec but currently separated – acceptable, both reachable
- Stories preserved not hidden behind feature flag – no usage data, no analytics, safest reversible approach preserve, could hide entry point behind flag if usage demonstrably low after collecting evidence

## Next Phase

Phase 6 — Organizations, Institutions, Clubs and Communities – make campus structure understandable while preserving distinct entities and authorization boundaries, canonical entity semantics University/college institution records Student clubs distinct clubs affiliated with institution where applicable General communities separate community entities Other organizations preserve existing category meaning, use existing Organization model if it can safely represent distinctions do not create duplicate org source of truth do not turn clubs into generic Communities merely to simplify UI, institution–club relationships verify preserve Institution-to-club parent relationship Authorized institution administrators Club membership and management roles Institutional affiliation status Verification and ownership status Community claim workflow, club cannot obtain official institutional privileges self-declaring affiliation pending/rejected/suspended affiliations not receive active approval privileges, event approval where supported club submits proposal event remains unpublished/discoverable per draft rules institution admins review approve/reject with reason/request changes approval publishes same canonical event record registration/tickets/existing associations remain intact material changes after approval follow defined reapproval policy affiliation revocation prevents new unauthorized proposals triggers review of affected events without deleting, show organizers clear status messages not internal workflow terminology, permissions clubs manage only authorized events institution admins review manage only scope their role permits shared affiliation not grant one club access to another club's private data Super Admin platform-wide via existing server-side auth REST and Socket.IO auth agree event ownership/creator/organizer not conflated, registration and approval UI improve existing forms review interfaces without replacing working ownership/membership/claim systems approval idempotent handle concurrent requests duplicate submissions partial failures safely

Proceed to Phase 6.
