"use client";

import { useQuery } from "@/lib/query";
import { useSessionUser } from "@/components/shell/use-session-user";

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
  settled: boolean;
}

export function useFeedDiscovery(): FeedDiscovery {
  const { user, ready } = useSessionUser();

  const people = useQuery<{ users?: DiscoveryPerson[] }>(
    ["feed-discovery-people", user?._id || "anon"],
    ready && user ? "/users/suggested?limit=6" : null,
    { staleTime: 300_000 }
  );

  // Master refactor: Organizations (Institutions/Clubs) are primary discovery, communities backend preserved but not in main feed
  const orgs = useQuery<{ organizations?: any[] }>(
    ["feed-discovery-organizations"],
    "/organizations?limit=6",
    { staleTime: 300_000 }
  );

  const events = useQuery<{ events?: DiscoveryEvent[] }>(
    ["feed-discovery-events"],
    "/events?status=upcoming&limit=6",
    { staleTime: 300_000 }
  );

  const communitiesMapped: DiscoveryCommunity[] = (orgs.data?.organizations || []).map((o: any) => ({
    _id: o._id,
    name: o.name,
    slug: o.slug,
    logoUrl: o.logo || o.logoUrl,
    description: o.description,
    memberCount: o.followerCount,
  })).filter((c) => c?._id);

  return {
    people: (people.data?.users || []).filter((u) => u?._id),
    communities: communitiesMapped,
    events: (events.data?.events || []).filter((e) => e?._id),
    settled: !people.isLoading && !orgs.isLoading && !events.isLoading,
  };
}
