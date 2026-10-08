"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/utils/api";

/**
 * Debounced people search (Part 13 §9–§11, §14, §24).
 *
 * The same search backs the composer's tag picker, the share sheet and the
 * Discover People surface. It is deliberately thin: the server already exposes
 * `GET /api/search?type=people` with a projection of the fields a row needs
 * (name, username, avatar, institution), so nothing here builds a second index
 * or fetches whole profiles.
 *
 * Behaviour that is required rather than nice to have:
 *  · one request per pause in typing, not per keystroke (§24 — 300ms, inside
 *    the 250–400ms the brief specifies);
 *  · a newer query always wins — the previous request is aborted, so a slow
 *    response can never overwrite fresher results;
 *  · loading, empty and error are distinct states, because "no results" and
 *    "the request failed" are different things to say to a user;
 *  · under two characters nothing is requested at all (the API's own floor).
 */

export interface PersonResult {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  /* The shape `UserAvatar` consumes: optional, never null, so a person with no
     profile object renders the initials fallback instead of crashing a row. */
  profile?: { avatar?: string; avatarVersion?: number; institution?: string; bio?: string };
  verified?: boolean;
  /** Mutual connections, when the viewer is signed in (server-computed). */
  mutuals?: number;
}

export function displayNameOf(p: Pick<PersonResult, "firstName" | "lastName" | "username">) {
  const name = `${p.firstName || ""} ${p.lastName || ""}`.trim();
  return name || p.username || "EventHub user";
}

export function usePeopleSearch(
  query: string,
  {
    enabled = true,
    limit = 12,
    delay = 300,
    excludeIds = [],
  }: { enabled?: boolean; limit?: number; delay?: number; excludeIds?: string[] } = {}
) {
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);

  // Kept in a ref so changing the exclusion list never restarts the debounce
  // or triggers a request on its own.
  const excludeRef = useRef(excludeIds);
  excludeRef.current = excludeIds;

  const q = query.trim();

  useEffect(() => {
    if (!enabled || q.length < 2) {
      setResults([]);
      setError(false);
      setLoading(false);
      setSearched(false);
      return;
    }

    setLoading(true);
    setError(false);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get("/search", {
          params: { q, type: "people", limit },
          signal: controller.signal,
        })
        .then((res) => {
          const people: PersonResult[] = res.data?.people || [];
          const excluded = new Set(excludeRef.current);
          setResults(people.filter((p) => !excluded.has(p._id)));
          setSearched(true);
        })
        .catch((e: any) => {
          // A cancelled request is not a failure — silence it.
          if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED" || e?.name === "AbortError") return;
          setError(true);
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, enabled, limit, delay]);

  return { results, loading, error, searched, query: q };
}
