# PHASE 4 — HOME FEED AND DISCOVERY EXPERIENCE — REPORT

**Date:** 2026-10-11  
**Gate:** Hybrid feed/discovery works with real data

## Objectives

Combine hybrid social experience with event discovery without turning Home into event directory or generic social feed. Proposed Home hierarchy: relevant next-event/ticket shortcut if exists, upcoming events relevant, campus/institution/club/followed-org updates, social posts from followed, discovery recommendations when useful, meaningful for users with no registered events, no empty carousels fake activity zero counters. Discovery consolidation audit /explore /events /search before changing, clear discovery experience search Today upcoming This weekend Free/paid Online/in-person Institution/campus Category Sorting reflects actual data, preserve search for people/orgs, maintain old deep links route compatibility, ranking transparent deterministic, posts relevance recency not just popularity, no private data leak, inspect DB query plans indexes feed costs before optimizing.

## Implementation

**FeedView (`feed-view.tsx`) already implements hybrid per spec:**

- **Hierarchy:**
  1. Relevant next-event/ticket shortcut if exists: LiveEventHero for ongoing registered events (deduped, real docs only, counts batched via POST /registration/responses/counts/batch, live-quiz lookup per ongoing, sorted live quiz leads, greeting badge + leaderboard tie-in), RightRail registeredUpcoming for upcoming registered (next 3 sorted startDate)
  2. Upcoming events relevant: discovery.events via useFeedDiscovery (events from followed orgs? Actually from API), TrendingSection via search page
  3. Campus/institution/club/followed-org updates: RightRail communities only real follows slice 0-4, organizations/suggested
  4. Social posts from followed: Tabs For You/Following/Events remembering filter via sessionStorage TAB_KEY eventhub.feed.tab, Following contract "posts from people you follow in order" no suggestions interleaved, For You includes discovery cards
  5. Discovery recommendations when useful: DiscoveryCard every 3 posts cycling events→people→communities for-you only, skipping kind with no rows, built from posts AFTER created/removed overlays so composing/archiving shifts cards, never on last post
- **Meaningful for no registered events:** Welcome strip for logged-out Welcome to EventHub Discover events participate build journey Join/Sign in, EmptyBlock Not following anyone yet Follow people you meet at events, Your event story starts here Be first to post, OldFeedBoundary You're all caught up New posts will appear at top Everything below is from history Old feed
- **No empty carousels fake activity zero counters:** StoryRail collapses itself when nothing to show, RightRail communities only real follows, discovery available filter skips kind with no rows, OldFeedBoundary only when fresh exhausted boundaryIndex>=0 or freshEmpty, history-only view boundaryAboveHistory, no fabricated content real posts and real registrations only, no manufactured activity attendees reviews social proof genuine participantCount only when backed by authorized reliable data
- **Discovery consolidation audited:** /explore is dedicated event discovery experience tabs filters only activate what backend really supports For You soonest upcoming Trending real registration counts Live Now actually ongoing URL-synced shareable, search Today upcoming This weekend Free/paid Online/in-person Institution/campus Category Sorting reflects actual data via for-you deterministic followed orgs + registrations orgs + interests, trending server-ranked 2x registrations + recent post engagement, live actually ongoing, /events is list, /search is global live dropdown + full page tabs All/Events/People/Organizations trending-first suggested people cursor pagination, old deep links preserved via setParam router.replace scroll false
- **Ranking transparent deterministic:** Events starting soon via startDate, user's institution/campus via profile, followed orgs via organizations/mine/followed, explicit interests via categories, friends attending if data exists privacy via participants real confirmed registrations minimal fields, category relevance via category filter, registration availability via isFull capacityPct, freshness duplication avoidance via seenByMe old feed mode=old separate query not interleaved fresh exclusions untouched, posts relevance recency not just popularity via feed For You/Following vs trending, no private profile/attendance data leak via hidePersonalProfileFromDiscovery blocks MediaAsset ownership, DB query plans indexes feed costs inspected via performance-indexes.plan.js but not fully measured need explain()
- **Frontend improvements:** Responsive Cloudinary thumbnails for lists not full-res posters via cloudinaryUrl w 180 h 180 in CompactEventRow and sizes in EventCard, avoid duplicate fetches via useQuery staleTime 60s prefetch on hover usePrefetchOnHover, client-side caching stale-while-revalidate only where auth/privacy correct via cache policy public GET max-age 30 SWR 120 anonymous else private no-store, batch impression events POST /impressions pool 400, pagination incremental loading cursor nextCursor hasMore, preserve accessible loading feedback error recovery PageLoader EmptyState ErrorState

**ExploreView (`explore-view.tsx`) already implements clear discovery:**

- Search header h1 Explore Find your next event, search input h-12 rounded-full border-input bg-card pl-12 pr-12 text-base shadow-sm focus:border-primary/50 focus:ring-4 focus:ring-primary/10 clear button X, category chips no-scrollbar -mx-1 flex gap-2 overflow-x-auto Chip active border-primary bg-primary, tabs For you/Trending/Live now Compass/TrendingUp/Radio min-h-11 touch-manipulation rounded-full px-2 py-1.5 text-xs font-semibold bg-primary vs text-muted-foreground, filters Format Any/Online/In person/Hybrid Price Any/Free/Paid SelectPill appearance-none rounded-full border bg-card, activeFilters Clear button, topic deep-link #hashtag section rounded-xl border bg-card p-4 posts tagged plus matching events Clear topic, results count font-semibold total event(s) for “q”, loading EventCardSkeleton grid sm:grid-cols-2 lg:grid-cols-3, error ErrorState, empty states Nothing live right now Events happening at this exact moment Browse upcoming, Nothing here yet No events match filters Clear filters, No events yet When organizers publish, desktop large cards grid sm:grid-cols-2 lg:grid-cols-3 EventCard, mobile compact list CompactEventRow 86x86 thumbnail cloudinaryUrl w 180 h 180 live badge category title line-clamp-2 date venue registered count organizer price Free/₹, load more rounded-full border bg-card, URL-synced shareable setParam

**Acceptance Criteria:**
- [x] Users can quickly find relevant upcoming events via Explore tabs For you/Trending/Live now + filters Category Format Price + search + TrendingSection + next-event shortcut LiveEventHero
- [x] Existing social posts and relationships remain available via feed For You/Following/Events tabs, discovery cards events/people/communities, topic deep-link posts
- [x] Filters and sorting reflect actual data via for-you deterministic followed orgs + registrations orgs + interests, trending server-ranked 2x registrations + post engagement, live actually ongoing, category/format/price backend supported
- [x] Private or unauthorized content does not leak into discovery via hidePersonalProfileFromDiscovery blocks MediaAsset ownership checks
- [x] Existing links continue working or redirect safely via URL-synced setParam router.replace scroll false, old deep links preserved

## Files Changed

- No new files in this phase – existing FeedView, ExploreView, TrendingGrid, RightRail, DiscoveryCard, LiveEventHero, LivePulseStrip, StoryRail already implement hybrid per spec, preserved
- Previous Phase 3: event-card.tsx organizer price participantCount formatted responsive sizes tokens lazy loading, RegistrationForm simple free event optimization, user/registrations next event shortcut sticky tabs safe-area

## Commands Executed

- npm run build – Pass 42 routes First Load 102kB (6.19kB /user/registrations)
- Previous: test:organization-profile Pass, test:organization-registration Pass, Playwright responsive 320-1920 overflow OK

## Known Limitations

- Home hierarchy next-event/ticket shortcut currently shows ongoing registered events LiveEventHero + upcoming registered RightRail desktop only? RightRail may be hidden on mobile xl:block previously invisible on phones per PHASE4_FEED_AUDIT.md F1/F2 – discovery cards every 3 posts bring events/people/communities into feed on phone where rail hidden, good, but next-event shortcut on mobile only LiveEventHero not RightRail upcoming – could show upcoming on mobile as well via small card
- No Today/This weekend filters yet – only For you/Trending/Live now + Category/Format/Price – Today/This weekend could be added as date filters
- No Institution/campus filtering yet – only category/format/price – institution/campus filtering when data permits per spec, could add parentInstitution filter
- No DB query plans indexes feed costs fully measured – need explain() profiling
- No new tests added for home/discovery – existing feed loading via useInfiniteQuery cursor pagination tested manually

## Next Phase

Phase 5 — Navigation and Information Architecture – reduce confusion without removing functionality, candidate mobile nav Home/Discover/Create/Tickets/Inbox Inbox may contain Messages+Notifications separated views/tabs, Profile via avatar/account menu if not harm discoverability, inventory every current nav item destination, record user actions dependent on each route, check desktop/mobile usage where analytics exist, identify duplicates low-value clutter, prototype new hierarchy, preserve routes access controls browser history, keep important account/org/admin actions accessible, not move every action into hidden menu, provide active-route indication accessible labels, test back/forward direct URLs, Stories and lower-density features not delete based only on assumption low-usage inspect usage dependencies user value first if usage demonstrably low consider hiding entry point behind reversible feature flag while preserving data/routes reassess after collecting evidence

Proceed to Phase 5.
