"use client";

/**
 * Full search page (Part 3, Phase 11) — ?q= deep-linkable, tabbed results.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Loader2, MessageSquare, Search, Users } from "lucide-react";
import { api } from "@/utils/api";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

type Tab = "events" | "communities" | "people" | "posts";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "communities", label: "Communities", icon: Users },
  { id: "people", label: "People", icon: Users },
  { id: "posts", label: "Posts", icon: MessageSquare },
];

interface EventR {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  venue?: string;
  startDate?: string;
  category?: string;
  price?: number;
}
interface CommunityR {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  category?: string;
}
interface PersonR {
  _id: string;
  firstName: string;
  lastName: string;
  username?: string;
  profile?: any;
  verified?: boolean;
}
interface PostR {
  _id: string;
  content: string;
  author?: { _id?: string; firstName: string; lastName: string; username?: string; profile?: any } | null;
  createdAt?: string;
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-3 py-10"><Skeleton className="h-24" /></div>}>
      <SearchView />
    </Suspense>
  );
}

function SearchView() {
  const params = useSearchParams();
  const q = (params.get("q") || "").trim();

  const [input, setInput] = useState(q);
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<EventR[]>([]);
  const [communities, setCommunities] = useState<CommunityR[]>([]);
  const [people, setPeople] = useState<PersonR[]>([]);
  const [posts, setPosts] = useState<PostR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => setInput(q), [q]);

  const run = useCallback(() => {
    if (q.length < 2) {
      setEvents([]);
      setCommunities([]);
      setPeople([]);
      setPosts([]);
      return;
    }
    setLoading(true);
    setError(false);
    api
      .get("/search", { params: { q, type: tab } })
      .then((r) => {
        setEvents(r.data?.events || []);
        setCommunities(r.data?.communities || []);
        setPeople(r.data?.people || []);
        setPosts(r.data?.posts || []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [q, tab]);

  useEffect(() => {
    run();
  }, [run]);

  const counts: Record<Tab, number> = {
    events: events.length,
    communities: communities.length,
    people: people.length,
    posts: posts.length,
  };
  const emptyForTab = q.length >= 2 && !loading && !error && counts[tab] === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-6 sm:py-7">
      <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
        <Search className="h-6 w-6 text-primary" /> Search
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.trim();
          window.location.href = value ? `/search?q=${encodeURIComponent(value)}` : "/search";
        }}
        className="mt-4"
      >
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search events, communities, people, posts…"
            aria-label="Search"
            className="h-11 w-full rounded-full border border-input bg-muted/60 pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background focus:ring-4 focus:ring-primary/10"
          />
        </div>
      </form>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {q.length < 2 ? (
          <EmptyState icon={Search} title="Type at least 2 characters" description="Search across events, communities, people and posts." />
        ) : error ? (
          <ErrorState title="Search failed" description="Give it another try." onRetry={run} />
        ) : loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : emptyForTab ? (
          <EmptyState icon={Search} title={`No ${tab} found`} description={`Nothing matches “${q}”. Try another tab or different words.`} />
        ) : (
          <>
            {tab === "events" &&
              events.map((e) => (
                <Link
                  key={e._id}
                  href={`/events/${e.slug}`}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <span className="rounded-xl bg-brand-light p-2 text-primary">
                    <CalendarDays className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-foreground">{e.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[e.venue, e.category, e.startDate ? new Date(e.startDate).toLocaleDateString("en-IN") : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {e.description ? (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{e.description}</span>
                    ) : null}
                  </span>
                </Link>
              ))}

            {tab === "communities" &&
              communities.map((c) => (
                <Link
                  key={c._id}
                  href={`/communities/${c.slug}`}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <span className="rounded-xl bg-purple-light p-2 text-purple">
                    <Users className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-foreground">{c.name}</span>
                    {c.description ? (
                      <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{c.description}</span>
                    ) : null}
                  </span>
                </Link>
              ))}

            {tab === "people" &&
              people.map((p) => (
                <Link
                  key={p._id}
                  href={`/profile/${p._id}`}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <UserAvatar user={p} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-foreground">
                      {p.firstName} {p.lastName}
                      {p.verified ? <span className="ml-1.5 text-primary">✓</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      @{p.username || ""}
                      {p.profile?.institution ? ` · ${p.profile.institution}` : ""}
                    </span>
                  </span>
                </Link>
              ))}

            {tab === "posts" &&
              posts.map((p) => (
                <Link
                  key={p._id}
                  href={`/post/${p._id}`}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <UserAvatar user={p.author} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{p.content}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {p.author ? `${p.author.firstName} ${p.author.lastName}` : "Unknown"}
                      {p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString("en-IN")}` : ""}
                    </span>
                  </span>
                </Link>
              ))}
          </>
        )}
      </div>

      {loading && q.length >= 2 && (
        <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
        </p>
      )}
    </div>
  );
}
