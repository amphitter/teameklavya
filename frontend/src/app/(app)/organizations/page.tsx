"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  MapPin,
  Search,
  Users,
  GraduationCap,
  UsersRound,
} from "lucide-react";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { Button } from "@/components/ui/button";
import { ErrorState, PageLoader, EmptyState } from "@/components/states";

interface CategoryOption {
  value: string;
  label: string;
}

interface OrgData {
  _id: string;
  name: string;
  handle?: string;
  slug: string;
  category?: string;
  description?: string;
  logo?: string;
  logoUrl?: string;
  city?: string;
  state?: string;
  followerCount: number;
  upcomingEventCount: number;
  isVerified?: boolean;
  affiliationStatus?: string;
}

const PAGE_SIZE = 24;

function locationLabel(org: OrgData) {
  return [org.city, org.state].filter(Boolean).join(", ");
}

function isInstitutionCategory(cat?: string) {
  return ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"].includes(String(cat || "").toUpperCase());
}

function isClubCategory(cat?: string) {
  return ["STUDENT_CLUB", "COLLEGE_CLUB", "CULTURAL_CLUB", "SPORTS_CLUB", "TECH_COMMUNITY", "COLLEGE_COMMUNITY", "UNIVERSITY_COMMUNITY"].includes(
    String(cat || "").toUpperCase()
  );
}

function categoryLabel(value?: string) {
  if (!value) return "Organization";
  const map: Record<string, string> = {
    COLLEGE: "College",
    UNIVERSITY: "University",
    SCHOOL: "School",
    INSTITUTE: "Institute",
    STUDENT_CLUB: "Student Club",
    COLLEGE_CLUB: "College Club",
    CULTURAL_CLUB: "Cultural Club",
    SPORTS_CLUB: "Sports Club",
    TECH_COMMUNITY: "Tech Community",
    COMMUNITY: "Community",
  };
  return map[value.toUpperCase()] || value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default function OrganizationsPage() {
  const { user } = useSessionUser();
  const [organizations, setOrganizations] = useState<OrgData[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [city, setCity] = useState("");
  const [debouncedCity, setDebouncedCity] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "INSTITUTION" | "CLUB">("ALL");
  const [category, setCategory] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCity(city.trim()), 300);
    return () => clearTimeout(t);
  }, [city]);

  useEffect(() => {
    api
      .get("/organizations/categories")
      .then((res) => setCategories(res.data?.categories || []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    let active = true;
    const params: Record<string, string | number> = { limit: PAGE_SIZE };
    if (debouncedQuery) params.q = debouncedQuery;
    if (debouncedCity) params.city = debouncedCity;
    if (category) params.category = category;

    setLoading(true);
    setError(false);
    setOrganizations([]);
    setNextCursor(null);
    setHasMore(false);

    api
      .get("/organizations", { params })
      .then((res) => {
        if (!active) return;
        let orgs: OrgData[] = res.data?.organizations || [];
        if (typeFilter !== "ALL") {
          orgs = orgs.filter((o) =>
            typeFilter === "INSTITUTION" ? isInstitutionCategory(o.category) : isClubCategory(o.category)
          );
        }
        setOrganizations(orgs);
        setNextCursor(res.data?.nextCursor || null);
        setHasMore(Boolean(res.data?.hasMore));
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [debouncedQuery, debouncedCity, category, retryToken, typeFilter]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const params: Record<string, string | number> = { limit: PAGE_SIZE, cursor: nextCursor };
    if (debouncedQuery) params.q = debouncedQuery;
    if (debouncedCity) params.city = debouncedCity;
    if (category) params.category = category;

    try {
      const res = await api.get("/organizations", { params });
      let page: OrgData[] = res.data?.organizations || [];
      if (typeFilter !== "ALL") {
        page = page.filter((o) =>
          typeFilter === "INSTITUTION" ? isInstitutionCategory(o.category) : isClubCategory(o.category)
        );
      }
      setOrganizations((cur) => {
        const ids = new Set(cur.map((org) => org._id));
        return [...cur, ...page.filter((org) => !ids.has(org._id))];
      });
      setNextCursor(res.data?.nextCursor || null);
      setHasMore(Boolean(res.data?.hasMore));
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setQuery("");
    setCity("");
    setCategory("");
    setTypeFilter("ALL");
  };

  const hasActiveFilters = Boolean(query || city || category || typeFilter !== "ALL");

  if (loading && organizations.length === 0) return <PageLoader label="Finding organizations…" />;
  if (error && organizations.length === 0) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-8">
        <ErrorState
          title="Organizations couldn't load"
          description="Check your connection and try again."
          onRetry={() => setRetryToken((v) => v + 1)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#0a0a0c]">
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-slate-900 dark:text-white">Organizations</h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-[#a1a1aa]">
              Discover institutions and affiliated clubs. Verified institutions can approve club events.
            </p>
          </div>
          <Button asChild className="h-9 rounded-[10px] bg-[#3b82f6] text-white hover:bg-[#2563eb] text-[13px] font-medium dark:bg-white dark:text-black dark:hover:bg-[#e4e4e7]">
            <Link href="/organizations/register">Register organization</Link>
          </Button>
        </div>

        {/* Type toggle + filters */}
        <div className="mt-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[10px] border border-slate-200 bg-white p-1 shadow-sm dark:border-[#1f1f23] dark:bg-[#121214]">
              {[
                { id: "ALL", label: "All", icon: Building2 },
                { id: "INSTITUTION", label: "Institutions", icon: GraduationCap },
                { id: "CLUB", label: "Clubs", icon: UsersRound },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setTypeFilter(tab.id as any)}
                  className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    typeFilter === tab.id
                      ? "bg-slate-900 text-white shadow-sm dark:bg-[#1f1f23] dark:text-white dark:border dark:border-[#232326]"
                      : "text-slate-600 hover:text-slate-900 dark:text-[#71717a] dark:hover:text-white"
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-[12px] text-slate-500 hover:text-slate-900 dark:text-[#71717a] dark:hover:text-white">
                Clear filters
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-[12px] border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center dark:border-[#1f1f23] dark:bg-[#121214]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#71717a]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search organizations"
                className="h-9 w-full rounded-[10px] border border-slate-200 bg-slate-50 pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-[#3b82f6]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/10 dark:border-[#232326] dark:bg-[#18181b] dark:text-white dark:placeholder:text-[#71717a] dark:focus:border-[#3b82f6]/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <MapPin className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-[#71717a]" />
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City"
                  className="h-9 w-32 rounded-[10px] border border-slate-200 bg-slate-50 pl-7 pr-2 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-[#3b82f6]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/10 dark:border-[#232326] dark:bg-[#18181b] dark:text-white dark:placeholder:text-[#71717a] sm:w-36"
                />
              </div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 rounded-[10px] border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-900 focus:border-[#3b82f6]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/10 dark:border-[#232326] dark:bg-[#18181b] dark:text-white"
              >
                <option value="">All categories</option>
                {categories.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 text-[12px] text-slate-500 dark:text-[#71717a]">
          {loading ? "Updating…" : `${organizations.length}${hasMore ? "+" : ""} organizations`}
        </div>

        {!loading && organizations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={hasActiveFilters ? "No matching organizations" : "No organizations yet"}
            description={hasActiveFilters ? "Try adjusting filters." : "Organizations will appear here."}
            actionLabel={hasActiveFilters ? "Clear filters" : "Register organization"}
            onAction={hasActiveFilters ? clearFilters : undefined}
          />
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {organizations.map((org) => {
              const identifier = org.handle || org.slug;
              const logo = org.logo || org.logoUrl;
              const loc = locationLabel(org);
              const isInst = isInstitutionCategory(org.category);
              const isClub = isClubCategory(org.category);
              return (
                <Link
                  key={org._id}
                  href={`/organizations/${encodeURIComponent(identifier)}`}
                  className="group flex gap-3 rounded-[12px] border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow-md dark:border-[#1f1f23] dark:bg-[#121214] dark:hover:border-[#232326] dark:hover:bg-[#18181b]"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50 dark:border-[#232326] dark:bg-[#1f1f23]">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-slate-400 dark:text-[#71717a]">
                        <Building2 className="h-5 w-5" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5">
                      <h3 className="truncate text-[13px] font-semibold leading-5 text-slate-900 group-hover:text-slate-700 dark:text-white dark:group-hover:text-[#e4e4e7]">
                        {org.name}
                      </h3>
                      {org.isVerified && <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3b82f6]" />}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                          isInst
                            ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-[#3b82f6]/10 dark:text-[#93c5fd] dark:border-[#3b82f6]/20"
                            : isClub
                            ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-[#f59e0b]/10 dark:text-[#fcd34d] dark:border-[#f59e0b]/20"
                            : "bg-slate-50 text-slate-600 border-slate-200 dark:bg-[#1f1f23] dark:text-[#71717a] dark:border-[#232326]"
                        }`}
                      >
                        {isInst ? "Institution" : isClub ? "Club" : categoryLabel(org.category)}
                      </span>
                      {org.affiliationStatus === "APPROVED" && isClub && (
                        <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-[#052e1f]/80 dark:border-[#065f46]/20 dark:text-[#6ee7b7]">
                          Affiliated
                        </span>
                      )}
                    </div>

                    {org.description && (
                      <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-[#71717a]">{org.description}</p>
                    )}

                    <div className="mt-2.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-[#71717a]">
                      {loc && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {loc}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> {org.followerCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" /> {org.upcomingEventCount}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="flex justify-center pt-6">
            <Button
              variant="outline"
              onClick={loadMore}
              disabled={loadingMore}
              className="h-9 rounded-[10px] border-slate-200 bg-white text-[13px] dark:border-[#232326] dark:bg-[#121214]"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
