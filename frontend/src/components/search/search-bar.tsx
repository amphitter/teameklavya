"use client";

/**
 * Global search bar with live results dropdown (Part 3, Phase 11).
 * Debounced (350ms) queries against GET /api/search?type=all; Enter
 * (or "See all results") opens the full /search page.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  Loader2,
  MessageSquare,
  Search,
  SearchIcon,
  Users,
} from "lucide-react";
import { api } from "@/utils/api";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

interface SearchResults {
  events: { _id: string; title: string; slug: string; venue?: string; startDate?: string; category?: string }[];
  communities: { _id: string; name: string; slug: string; description?: string }[];
  people: { _id: string; firstName: string; lastName: string; username?: string; profile?: any; verified?: boolean }[];
  posts: { _id: string; content: string; author?: { firstName: string; lastName: string; username?: string } | null }[];
}

const EMPTY: SearchResults = { events: [], communities: [], people: [], posts: [] };

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Clear the search when the user navigates (owned here — the query
     state lives in this component, not in the shell) */
  useEffect(() => {
    setQuery("");
    setOpen(false);
  }, [pathname]);

  /* Debounced live search */
  useEffect(() => {
    const q = query.trim();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      api
        .get("/search", { params: { q, type: "all" } })
        .then((r) => setResults(r.data ? { events: r.data.events || [], communities: r.data.communities || [], people: r.data.people || [], posts: r.data.posts || [] } : EMPTY))
        .catch(() => setResults(EMPTY))
        .finally(() => setLoading(false));
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  /* Close on outside click / Escape */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (q: string) => {
    setOpen(false);
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    go(query.trim());
  };

  const hasAny =
    results.events.length + results.communities.length + results.people.length + results.posts.length > 0;
  const q = query.trim();

  return (
    <div ref={boxRef} className="relative mx-auto hidden w-full max-w-xl sm:block">
      <form onSubmit={submit}>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search events, people, or topics..."
            aria-label="Search EventHub"
            className="h-10 w-full rounded-full border border-input bg-muted/60 pl-10 pr-4 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background focus:ring-4 focus:ring-primary/10"
          />
          {loading && (
            <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </form>

      {open && q.length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          {!loading && !hasAny ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results for &ldquo;{q}&rdquo;
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto p-2">
              {results.events.length > 0 && (
                <SearchGroup icon={CalendarDays} label="Events">
                  {results.events.map((e) => (
                    <SearchItem key={e._id} href={`/events/${e.slug}`} onGo={() => setOpen(false)}>
                      <span className="rounded-lg bg-brand-light p-1.5 text-primary">
                        <CalendarDays className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-foreground">{e.title}</span>
                        {e.venue ? <span className="block truncate text-xs text-muted-foreground">{e.venue}</span> : null}
                      </span>
                    </SearchItem>
                  ))}
                </SearchGroup>
              )}
              {results.communities.length > 0 && (
                <SearchGroup icon={Users} label="Communities">
                  {results.communities.map((c) => (
                    <SearchItem key={c._id} href={`/communities/${c.slug}`} onGo={() => setOpen(false)}>
                      <span className="rounded-lg bg-purple-light p-1.5 text-purple">
                        <Users className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-foreground">{c.name}</span>
                        {c.description ? (
                          <span className="block truncate text-xs text-muted-foreground">{c.description}</span>
                        ) : null}
                      </span>
                    </SearchItem>
                  ))}
                </SearchGroup>
              )}
              {results.people.length > 0 && (
                <SearchGroup icon={Users} label="People">
                  {results.people.map((p) => (
                    <SearchItem key={p._id} href={`/profile/${p._id}`} onGo={() => setOpen(false)}>
                      <UserAvatar user={p} size={30} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-foreground">
                          {p.firstName} {p.lastName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">@{p.username || ""}</span>
                      </span>
                    </SearchItem>
                  ))}
                </SearchGroup>
              )}
              {results.posts.length > 0 && (
                <SearchGroup icon={MessageSquare} label="Posts">
                  {results.posts.map((p) => (
                    <SearchItem key={p._id} href={`/post/${p._id}`} onGo={() => setOpen(false)}>
                      <span className="rounded-lg bg-muted p-1.5 text-muted-foreground">
                        <MessageSquare className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-foreground">{p.content}</span>
                        {p.author ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.author.firstName} {p.author.lastName}
                          </span>
                        ) : null}
                      </span>
                    </SearchItem>
                  ))}
                </SearchGroup>
              )}
              <button
                type="button"
                onClick={() => go(q)}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold text-primary transition-colors hover:bg-brand-light"
              >
                <SearchIcon className="h-3.5 w-3.5" /> See all results for &ldquo;{q}&rdquo;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      {children}
    </div>
  );
}

function SearchItem({ href, onGo, children }: { href: string; onGo: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onGo}
      className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-muted")}
    >
      {children}
    </Link>
  );
}
