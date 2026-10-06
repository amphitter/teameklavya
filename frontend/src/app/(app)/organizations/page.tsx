"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Globe, Search, Users,
  BadgeCheck,
} from "lucide-react";
import { api } from "@/utils/api";
import { ErrorState, PageLoader, EmptyState } from "@/components/states";
import { UserAvatar } from "@/components/user-avatar";
import { cloudinaryUrl } from "@/utils/image";

interface OrgData {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  website?: string;
  followerCount: number;
  upcomingEventCount: number;
  isVerified?: boolean;
}

/** Organizations directory — real organizations with real counts. */
export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get("/organizations", { params: q ? { q } : {} })
      .then((res) => !cancelled && setOrgs(res.data?.organizations || []))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [q]);

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-6 sm:py-7">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Communities</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Colleges, clubs and communities hosting events on EventHub.
      </p>

      <div className="relative mt-4">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search organizations…"
          aria-label="Search organizations"
          className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-4 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
        />
      </div>

      <div className="mt-6">
        {loading ? (
          <PageLoader label="Loading communities…" />
        ) : error ? (
          <ErrorState
            title="Something went wrong"
            description="Communities couldn't load right now."
            onRetry={() => setQ(Math.random().toString())}
          />
        ) : orgs.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={q ? "No matches" : "No communities yet"}
            description={
              q
                ? `No organizations match "${q}".`
                : "When organizations join EventHub, they'll appear here."
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {orgs.map((org) => (
              <Link
                key={org._id}
                href={`/organizations/${org.slug}`}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start gap-3.5">
                  {org.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cloudinaryUrl(org.logoUrl, { w: 96, h: 96 })}
                      alt={org.name}
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-light text-primary">
                      <Building2 className="h-6 w-6" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="flex items-center gap-1 truncate text-base font-bold text-foreground group-hover:text-primary">
                      <span className="truncate">{org.name}</span>
                      {org.isVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-success" aria-label="Verified" />}
                    </h2>
                    {org.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{org.description}</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> {org.followerCount} followers
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" /> {org.upcomingEventCount} upcoming
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
