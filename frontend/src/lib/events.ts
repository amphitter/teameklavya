"use client";

import { api } from "@/utils/api";
import type { EventCardData } from "@/components/event-card";

interface EventsResponse {
  success: boolean;
  events: EventCardData[];
  nextCursor?: string | null;
  hasMore?: boolean;
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    pages?: number;
    nextCursor?: string | null;
    hasMore?: boolean;
  };
}

/**
 * Fetch events with optional filters and attach live registration counts
 * (batched, counts only — the endpoint returns no personal data).
 */
export async function fetchEventsWithCounts(
  params: Record<string, string | number | undefined> = {}
): Promise<{
  events: EventCardData[];
  pagination?: EventsResponse["pagination"];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== "all")
  );

  const res = await api.get<EventsResponse>("/events", { params: clean });
  let events = res.data?.events ?? [];

  // Attach registration counts in one batch call
  const ids = events.map((e) => e._id).filter(Boolean);
  if (ids.length) {
    try {
      const countsRes = await api.post<{ success: boolean; counts: Record<string, number> }>(
        "/registration/responses/counts/batch",
        { eventIds: ids }
      );
      const counts = countsRes.data?.counts ?? {};
      events = events.map((e) => ({
        ...e,
        participantCount: counts[e._id] ?? undefined,
      }));
    } catch {
      // counts are a nice-to-have; never block the grid on them
    }
  }

  return {
    events,
    pagination: res.data?.pagination,
    nextCursor: res.data?.nextCursor ?? res.data?.pagination?.nextCursor ?? null,
    hasMore: Boolean(res.data?.hasMore ?? res.data?.pagination?.hasMore),
  };
}

/** Compute upcoming/ongoing/past from dates (mirrors backend logic). */
export function eventStatus(startDate?: string, endDate?: string): "upcoming" | "ongoing" | "past" {
  const now = new Date();
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  if (end && now > end) return "past";
  if (start && now < start) return "upcoming";
  return "ongoing";
}
