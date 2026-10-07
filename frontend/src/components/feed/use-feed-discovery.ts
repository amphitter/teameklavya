"use client";

import { useQuery } from "@/lib/query";
import { useSessionUser } from "@/components/shell/use-session-user";

/**
 * The real data behind the feed's interleaved cards.
 *
 * Every row here comes from an endpoint the app already had — the desktop rail
 * has been rendering this content for months, to nobody, because the rail is
 * `hidden xl:block` and every phone is narrower than 1280px (see
 * `docs/PHASE4_FEED_AUDIT.md` F2). Nothing is invented: a kind with no rows is
 * skipped rather than padded, and the cards show no number the API did not
 * return.
 *
 * Cost: three cached requests per session, none of them on the critical path —
 * the feed's own first page does not wait for any of this, and a screen with no
 * discovery data renders exactly the feed it renders today.
 */

export interface DiscoveryPerson {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string; avatarVersion?: number; institution?: string };
}

export interface DiscoveryCommunity {
  _id: string;
  name: string;
  slug: string;
  iconUrl?: string;
  logoUrl?: string;
  description?: string;
  memberCount?: number;
}

export interface DiscoveryEvent {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  startDate?: string;
  endDate?: string;
  venue?: string;
  participantCount?: number;
}

export interface FeedDiscovery {
  people: DiscoveryPerson[];
  communities: DiscoveryCommunity[];
  events: DiscoveryEvent[];
  /** True once every kind has either answered or failed — the stream uses this
   *  to decide whether a "still looking" gap is worth showing (it is not). */
  settled: boolean;
}

export function useFeedDiscovery(): FeedDiscovery {
  const { user, ready } = useSessionUser();

  /* Suggested people need a viewer (there is no such thing as a suggestion to
     nobody). Signed out, the request is never made. */
  const people = useQuery<{ users?: DiscoveryPerson[] }>(
    ["feed-discovery-people", user?._id || "anon"],
    ready && user ? "/users/suggested?limit=6" : null,
    { staleTime: 300_000 }
  );

  /* Communities are public and are the one discovery kind a signed-out visitor
     can genuinely act on. */
  const communities = useQuery<{ communities?: DiscoveryCommunity[] }>(
    ["feed-discovery-communities"],
    "/communities?limit=6",
    { staleTime: 300_000 }
  );

  /* Upcoming events, public. `status=upcoming` is what the explore page and the
     logged-out rail already ask for. */
  const events = useQuery<{ events?: DiscoveryEvent[] }>(
    ["feed-discovery-events"],
    "/events?status=upcoming&limit=6",
    { staleTime: 300_000 }
  );

  return {
    people: (people.data?.users || []).filter((u) => u?._id),
    communities: (communities.data?.communities || []).filter((c) => c?._id),
    events: (events.data?.events || []).filter((e) => e?._id),
    settled:
      !people.isLoading && !communities.isLoading && !events.isLoading,
  };
}
