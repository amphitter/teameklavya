"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  MapPin,
  Globe,
  Mail,
  Phone,
  Pencil,
  Link2,
  UsersRound,
  CheckCircle,
  Home as HomeIcon,
  Info,
  ArrowUpRight,
  Share2,
  Instagram,
  Linkedin,
  Facebook,
  Twitter,
  Youtube,
  Github,
  ExternalLink,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { EventCard, type EventCardData } from "@/components/event-card";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/shell/use-session-user";
import { safeExternalUrl } from "@/utils/safe-url";
import { isSuperAdminHint } from "@/lib/superAdmin";

interface OrgPerson {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string };
}

interface OrganizationLinkData {
  _id: string;
  name: string;
  handle?: string;
  slug: string;
  category?: string;
  description?: string;
  logo?: string;
  logoUrl?: string;
  cover?: string;
  coverUrl?: string;
  city?: string;
  state?: string;
  country?: string;
  isVerified?: boolean;
  affiliationStatus?: string;
  followerCount?: number;
}

interface OrgProfile {
  _id: string;
  name: string;
  handle?: string;
  slug: string;
  category?: string;
  description?: string;
  logo?: string;
  cover?: string;
  logoUrl?: string;
  coverUrl?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  mapUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
  email?: string;
  phone?: string;
  socialLinks?: Record<string, string>;
  parentOrganizationId?: string | null;
  parentOrganization?: OrganizationLinkData | null;
  supportsChildOrganizations?: boolean;
  affiliationStatus?: string;
  affiliationApprovedAt?: string | null;
  followerCount: number;
  upcomingEventCount: number;
  pastEventCount: number;
  following: boolean;
  isVerified?: boolean;
  managers?: OrgPerson[];
  followersPreview?: OrgPerson[];
  canManage?: boolean;
  canManageMembers?: boolean;
  canManageEvents?: boolean;
  createdAt?: string;
}

type Tab = "home" | "events" | "clubs" | "about";

function isInstitutionCategory(cat?: string) {
  return ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"].includes(String(cat || "").toUpperCase());
}

function isClubCategory(cat?: string) {
  return ["STUDENT_CLUB", "COLLEGE_CLUB", "CULTURAL_CLUB", "SPORTS_CLUB", "TECH_COMMUNITY", "COLLEGE_COMMUNITY", "UNIVERSITY_COMMUNITY"].includes(
    String(cat || "").toUpperCase()
  );
}

function categoryLabel(v?: string) {
  if (!v) return "Organization";
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
  };
  return map[v.toUpperCase()] || v.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
}

function locationLabel(org: OrgProfile | OrganizationLinkData) {
  return [org.city, org.state].filter(Boolean).join(", ");
}

function SocialIcon({ platform, className }: { platform: string; className?: string }) {
  const p = String(platform || "").toLowerCase();
  if (p.includes("instagram")) return <Instagram className={className} />;
  if (p.includes("linkedin")) return <Linkedin className={className} />;
  if (p.includes("facebook") || p === "fb") return <Facebook className={className} />;
  if (p.includes("twitter") || p === "x") return <Twitter className={className} />;
  if (p.includes("youtube") || p === "yt") return <Youtube className={className} />;
  if (p.includes("github")) return <Github className={className} />;
  if (p.includes("website") || p.includes("web") || p.includes("globe")) return <Globe className={className} />;
  return <Link2 className={className} />;
}

function prettyPlatformLabel(platform: string) {
  const p = String(platform || "").toLowerCase();
  if (p === "website" || p === "web") return "Website";
  if (p === "x") return "X";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export default function OrganizationProfilePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { user: me } = useSessionUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [upcoming, setUpcoming] = useState<EventCardData[]>([]);
  const [past, setPast] = useState<EventCardData[]>([]);
  const [children, setChildren] = useState<OrganizationLinkData[]>([]);
  const [tab, setTab] = useState<Tab>("home");
  const [followBusy, setFollowBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/organizations/${slug}`).catch(() => null),
      api.get(`/organizations/${slug}/events`, { params: { scope: "upcoming", limit: 9 } }).catch(() => null),
      api.get(`/organizations/${slug}/events`, { params: { scope: "past", limit: 6 } }).catch(() => null),
      api.get(`/organizations/${slug}/children`, { params: { limit: 12 } }).catch(() => null),
    ]).then(([orgRes, upcomingRes, pastRes, childrenRes]) => {
      if (orgRes?.data?.organization) {
        const o = orgRes.data.organization as OrgProfile;
        setOrg(o);
        setUpcoming(upcomingRes?.data?.upcoming || upcomingRes?.data?.events || []);
        setPast(pastRes?.data?.past || []);
        setChildren(childrenRes?.data?.children || []);
      } else {
        setError("Organization not found.");
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const toggleFollow = async () => {
    if (!org) return;
    if (!me) {
      router.push(`/login?returnUrl=${encodeURIComponent(`/organizations/${slug}`)}`);
      return;
    }
    setFollowBusy(true);
    try {
      const res = await api.post(`/organizations/${org._id}/follow`);
      if (res.data?.success) {
        setOrg((o) =>
          o ? { ...o, following: res.data.following, followerCount: o.followerCount + (res.data.following ? 1 : -1) } : o
        );
        toast.success(res.data.following ? `Following ${org.name}` : "Unfollowed");
      }
    } catch {
      toast.error("Couldn't update follow");
    } finally {
      setFollowBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied");
    } catch {
      toast.info(window.location.href);
    }
  };

  if (loading) return <PageLoader label="Loading organization…" />;
  if (error || !org)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState title="Couldn't load organization" description={error || "Unknown error"} onRetry={load} />
      </div>
    );

  const meSuperAdmin = isSuperAdminHint(me);
  const isInst = isInstitutionCategory(org.category);
  const isClub = isClubCategory(org.category);
  const logoImage = org.logo || org.logoUrl;
  const coverImage = org.cover || org.coverUrl;
  const loc = locationLabel(org);
  const safeWebsite = safeExternalUrl(org.website);
  const socialEntries = Object.entries(org.socialLinks || {}).filter(([_, v]) => Boolean(safeExternalUrl(v)));
  const clubsCount = children.length;
  const totalEvents = org.upcomingEventCount + org.pastEventCount;

  // Combine website + social for header right side – single source, no duplication
  const headerLinks: { key: string; platform: string; url: string; label: string }[] = [];
  if (safeWebsite) {
    headerLinks.push({ key: "website", platform: "website", url: safeWebsite, label: org.website ? new URL(safeWebsite).hostname.replace(/^www\./, "") : "Website" });
  }
  socialEntries.forEach(([platform, url]) => {
    const href = safeExternalUrl(url);
    if (!href) return;
    headerLinks.push({ key: platform, platform, url: href, label: prettyPlatformLabel(platform) });
  });

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#0a0a0c] pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0">
      {/* Hero – banner + new two-sided header */}
      <div className="relative w-full overflow-hidden">
        {/* Cover image */}
        <div className="relative h-[300px] w-full overflow-hidden sm:h-[360px] lg:h-[420px]">
          {coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverImage}
              alt=""
              className="h-full w-full object-cover object-center"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          ) : null}
          {/* Fallback */}
          <div className={cn("absolute inset-0", coverImage ? "hidden" : "block", "bg-gradient-to-br from-slate-200 via-slate-100 to-slate-50 dark:from-[#1a1a1e] dark:via-[#141417] dark:to-[#0a0a0c]")} />
          <div className={cn("absolute inset-0 opacity-40", coverImage ? "hidden" : "block", "bg-[radial-gradient(#3a3a42_1px,transparent_1px)] [background-size:20px_20px] dark:opacity-20")} />
          
          {/* Dark overlay – premium dark */}
          <div className="absolute inset-0 hidden dark:block bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/85 to-[#0a0a0c]/20" />
          <div className="absolute inset-0 hidden dark:block bg-gradient-to-r from-[#0a0a0c]/70 via-transparent to-transparent" />
          {/* Light overlay – readable over bright/dark images */}
          <div className="absolute inset-0 block dark:hidden bg-gradient-to-t from-white/95 via-white/75 to-white/20" />
          <div className="absolute inset-0 block dark:hidden bg-gradient-to-r from-white/85 via-white/45 to-transparent" />

          {/* Top-right actions – theme-aware, readable in light & dark */}
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex items-center gap-1.5 sm:gap-2 max-w-[60%] sm:max-w-none">
            <Button
              size="sm"
              onClick={toggleFollow}
              disabled={followBusy}
              className={cn(
                "h-8 sm:h-9 rounded-full px-3.5 sm:px-5 text-[12px] sm:text-[13px] font-semibold shadow-lg border shrink-0",
                org.following
                  ? "bg-white/90 dark:bg-white/10 text-slate-900 dark:text-white border-slate-200 dark:border-white/20 hover:bg-white dark:hover:bg-white/20"
                  : "bg-slate-900 dark:bg-white text-white dark:text-black border-slate-900 dark:border-white hover:bg-black dark:hover:bg-white/90"
              )}
            >
              {org.following ? "Following" : "Follow"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyLink}
              className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-white/90 dark:bg-white/10 p-0 text-slate-700 dark:text-white hover:bg-white dark:hover:bg-white/20 border border-slate-200/70 dark:border-white/10 shadow-lg shrink-0"
              aria-label="Share organization"
              title="Share"
            >
              <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            {(org.canManage || meSuperAdmin) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => router.push(`/organizations/${encodeURIComponent(org.handle || org.slug)}/edit`)}
                className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-white/90 dark:bg-white/10 border border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-white hover:bg-white dark:hover:bg-white/20 shadow-lg shrink-0"
                aria-label="Edit organization"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Header content – new two-sided layout */}
        <div className="absolute inset-x-0 bottom-0 z-10">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-6 pb-4 sm:pb-6">
            {/* Primary row: identity left + social right – extra top margin on mobile for better spacing */}
            <div className="mt-6 sm:mt-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-6 min-w-0">
              {/* Left: logo + name/badge – cohesive group, extra top margin on mobile */}
              <div className="mt-2 sm:mt-0 flex gap-3 sm:gap-4 min-w-0 flex-1">
                {/* Logo – consistent intentional size, preserve aspect & transparency, no white bg, 3rem top margin on mobile */}
                <div className="mt-12 sm:mt-0 h-[72px] w-[72px] sm:h-[88px] sm:w-[88px] lg:h-[96px] lg:w-[96px] shrink-0 overflow-hidden rounded-[16px] border border-white/20 bg-white/95 dark:bg-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                  {logoImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoImage} alt={org.name} className="h-full w-full object-contain p-1.5" />
                  ) : (
                    <div className="grid h-full w-full place-items-center bg-slate-100 dark:bg-[#1f1f23] text-slate-700 dark:text-white">
                      <Building2 className="h-8 w-8" />
                    </div>
                  )}
                </div>

                <div className="mt-10 sm:mt-0 min-w-0 flex-1 pt-0.5 sm:pt-1">
                  {/* Verification badge – readable, correctly positioned, not overlapping */}
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    {org.isVerified && (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium mt-[2px] bg-blue-50 dark:bg-[#1e40af]/50 border-blue-200 dark:border-[#3b82f6]/20 text-blue-800 dark:text-[#93c5fd]">
                        <BadgeCheck className="h-3.5 w-3.5" /> Verified Institution
                      </span>
                    )}
                    {isClub && org.affiliationStatus === "APPROVED" && org.parentOrganization && (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium mt-[2px] bg-emerald-50 dark:bg-[#052e1f]/80 border-emerald-200 dark:border-[#065f46]/20 text-emerald-800 dark:text-[#6ee7b7]">
                        <CheckCircle className="h-3 w-3" /> Affiliated
                      </span>
                    )}
                  </div>

                  {/* Full org name – wraps naturally, never cropped, no overlap, max-w prevents excessive height */}
                  <h1 className="max-w-[22ch] sm:max-w-[28ch] lg:max-w-[36ch] xl:max-w-[44ch] break-words text-[20px] sm:text-[24px] lg:text-[28px] font-bold leading-[1.1] tracking-tight text-slate-900 dark:text-white">
                    {org.name}
                  </h1>
                  {/* Desktop-only description snippet – fills empty feeling without bloating mobile */}
                  {org.description && (
                    <p className="mt-1.5 hidden lg:block max-w-[52ch] break-words text-[13px] leading-5 text-slate-600 dark:text-white/70 line-clamp-2">
                      {org.description}
                    </p>
                  )}
                  {/* Location, Since removed from header per spec – preserved in About */}
                </div>
              </div>

              {/* Right: website + social links – uses wasted desktop space, aligned right, vertically aligned with identity */}
              {headerLinks.length > 0 && (
                <div className="hidden sm:flex shrink-0 flex-col items-end gap-2 min-w-0 max-w-[45%] lg:max-w-[380px] lg:ml-6">
                  {headerLinks.length === 1 ? (
                    // Single link – compact, properly aligned
                    <a
                      href={headerLinks[0].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={headerLinks[0].label}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border bg-white/90 dark:bg-white/10 border-slate-200/70 dark:border-white/10 px-3.5 py-2 text-[12px] font-medium text-slate-700 dark:text-white/85 hover:bg-white dark:hover:bg-white/20 hover:text-slate-900 dark:hover:text-white transition-colors shadow-sm"
                    >
                      <SocialIcon platform={headerLinks[0].platform} className="h-4 w-4 shrink-0" />
                      <span className="truncate max-w-[20ch]">{headerLinks[0].label}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                    </a>
                  ) : (
                    // Multiple – clean vertical list or compact grid depending on space
                    <div className="flex flex-wrap justify-end gap-2 max-w-full">
                      {headerLinks.map((link) => (
                        <a
                          key={link.key}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${prettyPlatformLabel(link.platform)} – ${link.url}`}
                          title={`${prettyPlatformLabel(link.platform)}: ${link.url}`}
                          className="group inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 border-slate-200/70 dark:border-white/10 px-3 py-1.5 text-[12px] font-medium text-slate-700 dark:text-white/80 hover:bg-white dark:hover:bg-white/20 hover:text-slate-900 dark:hover:text-white transition-colors shadow-sm max-w-[18ch] truncate"
                        >
                          <SocialIcon platform={link.platform} className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate hidden lg:inline">{link.label}</span>
                          <span className="truncate lg:hidden">{prettyPlatformLabel(link.platform)[0]}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mobile social – compact icon arrangement, not squeezing name, not covering logo, within viewport */}
            {headerLinks.length > 0 && (
              <div className="mt-3 flex sm:hidden flex-wrap gap-2">
                {headerLinks.map((link) => (
                  <a
                    key={link.key}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.label}
                    title={link.label}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white/90 dark:bg-white/10 border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-white/80 hover:bg-white dark:hover:bg-white/20 shadow-sm"
                  >
                    <SocialIcon platform={link.platform} className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}

            {/* Stats row – 3 balanced columns, below identity/links, subtle divider, spans full width */}
            <div className="mt-4 grid w-full grid-cols-3 gap-2 sm:gap-6 border-t border-slate-200/60 dark:border-white/10 pt-4">
              <div className="min-w-0 text-left sm:text-center">
                <div className="truncate text-[18px] sm:text-[20px] font-bold leading-none text-slate-900 dark:text-white">
                  {clubsCount >= 1000 ? `${(clubsCount / 1000).toFixed(1)}K` : `${clubsCount}`}{clubsCount > 0 ? "+" : ""}
                </div>
                <div className="mt-1 text-[11px] sm:text-[12px] font-medium text-slate-600 dark:text-white/60">Clubs</div>
              </div>
              <div className="min-w-0 text-left sm:text-center">
                <div className="truncate text-[18px] sm:text-[20px] font-bold leading-none text-slate-900 dark:text-white">
                  {totalEvents >= 1000 ? `${(totalEvents / 1000).toFixed(1)}K` : `${totalEvents}`}{totalEvents > 0 ? "+" : ""}
                </div>
                <div className="mt-1 text-[11px] sm:text-[12px] font-medium text-slate-600 dark:text-white/60">Events</div>
              </div>
              <div className="min-w-0 text-left sm:text-center">
                <div className="truncate text-[18px] sm:text-[20px] font-bold leading-none text-slate-900 dark:text-white">
                  {org.followerCount >= 1000000
                    ? `${(org.followerCount / 1000000).toFixed(1)}M+`
                    : org.followerCount >= 1000
                    ? `${(org.followerCount / 1000).toFixed(1)}K+`
                    : `${org.followerCount}`}
                </div>
                <div className="mt-1 text-[11px] sm:text-[12px] font-medium text-slate-600 dark:text-white/60">Members</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs – non-sticky, normal block at original position, no scroll-with-page sticky */}
      <div className="block border-b border-slate-200 dark:border-[#1f1f23] bg-white dark:bg-[#0a0a0c]">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
          <nav className="flex justify-between sm:justify-start gap-1 sm:gap-6 overflow-x-auto no-scrollbar" aria-label="Organization sections">
            {[
              { id: "home" as Tab, label: "Home", icon: HomeIcon },
              { id: "events" as Tab, label: "Events", icon: CalendarDays, count: totalEvents },
              { id: "clubs" as Tab, label: "Clubs", icon: UsersRound, count: clubsCount, show: isInst },
              { id: "about" as Tab, label: "About", icon: Info },
            ]
              .filter((t: any) => t.show !== false)
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as Tab)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 border-b-2 py-3.5 text-[13px] font-medium transition-colors whitespace-nowrap",
                    tab === t.id
                      ? "border-[#3b82f6] text-[#3b82f6] dark:border-white dark:text-white"
                      : "border-transparent text-slate-500 hover:text-slate-700 dark:text-[#71717a] dark:hover:text-[#a1a1aa]"
                  )}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                  {typeof t.count === "number" && t.count > 0 && (
                    <span className="ml-1 text-[11px] text-slate-500 dark:text-[#71717a]">{t.count}</span>
                  )}
                </button>
              ))}
          </nav>
        </div>
      </div>

      {/* Content + Sidebar – fixed overflow: explicit grid-cols-1 with minmax(0,1fr) */}
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          {/* Main */}
          <div className="min-w-0 w-full overflow-hidden">
            {tab === "home" && (
              <div className="space-y-10 min-w-0 w-full">
                {/* Featured Events – fixed overflow with min-w-0 and w-full */}
                <section className="min-w-0 w-full">
                  <div className="flex items-center justify-between min-w-0 w-full">
                    <h2 className="flex items-center gap-2 text-[14px] font-semibold text-slate-900 dark:text-white min-w-0">
                      <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-slate-100 dark:bg-[#1f1f23] text-[#3b82f6] shrink-0">
                        <CalendarDays className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">Featured Events</span>
                    </h2>
                    <button
                      onClick={() => setTab("events")}
                      className="flex items-center gap-1 text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa] shrink-0 ml-2"
                    >
                      View all <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>

                  {upcoming.length === 0 ? (
                    <div className="mt-4 rounded-[12px] border border-dashed border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-8 text-center">
                      <p className="text-[13px] text-slate-600 dark:text-[#a1a1aa]">No upcoming events.</p>
                      {org.canManageEvents && (
                        <Button asChild size="sm" variant="outline" className="mt-3 h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-100 dark:bg-[#1f1f23]">
                          <Link href={`/organizations/${encodeURIComponent(org.handle || org.slug)}/events/new`}>Create event</Link>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 flex gap-4 overflow-x-auto no-scrollbar pb-2 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:overflow-visible sm:pb-0 w-full min-w-0">
                      {upcoming.slice(0, 3).map((e) => (
                        <div key={e._id} className="min-w-[280px] sm:min-w-0 flex-1 shrink-0 sm:shrink">
                          <EventCard event={e} />
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Affiliated Clubs – fixed overflow */}
                {isInst && (
                  <section className="min-w-0 w-full">
                    <div className="flex items-center justify-between min-w-0 w-full">
                      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-slate-900 dark:text-white min-w-0">
                        <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-slate-100 dark:bg-[#1f1f23] text-[#3b82f6] shrink-0">
                          <UsersRound className="h-3.5 w-3.5" />
                        </span>
                        <span className="truncate">Affiliated Clubs</span>
                      </h2>
                      <button
                        onClick={() => setTab("clubs")}
                        className="flex items-center gap-1 text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa] shrink-0 ml-2"
                      >
                        View all <ArrowUpRight className="h-3 w-3" />
                      </button>
                    </div>

                    {children.length === 0 ? (
                      <div className="mt-4 rounded-[12px] border border-dashed border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-8 text-center">
                        <p className="text-[13px] text-slate-600 dark:text-[#a1a1aa]">No affiliated clubs yet.</p>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 w-full min-w-0">
                        {children.slice(0, 4).map((child) => (
                          <Link
                            key={child._id}
                            href={`/organizations/${encodeURIComponent(child.handle || child.slug)}`}
                            className="group flex flex-col overflow-hidden rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] transition-colors hover:border-[#2a2a30] hover:bg-[#1a1a1e]"
                          >
                            <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-[#1f1f23]">
                              {child.cover || (child as any).coverUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={child.cover || (child as any).coverUrl} alt="" className="h-full w-full object-cover object-center" />
                              ) : (
                                <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-100 dark:from-[#1f1f23] dark:to-[#141417]" />
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-12 overflow-hidden rounded-[12px] border border-white/20 bg-white/10 shadow-lg">
                                {child.logo || child.logoUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={child.logo || child.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                                ) : (
                                  <div className="grid h-full w-full place-items-center text-[#0a0a0c]">
                                    <Building2 className="h-5 w-5" />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="p-3">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-white group-hover:text-[#e4e4e7]">
                                  {child.name}
                                </div>
                                <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-[#71717a]">
                                  {categoryLabel(child.category)}
                                </div>
                                {child.followerCount ? (
                                  <div className="mt-1 text-[11px] text-slate-500 dark:text-[#71717a]">{child.followerCount} members</div>
                                ) : null}
                              </div>
                              <button className="mt-2 w-full rounded-[8px] bg-[#3b82f6] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#2563eb] transition-colors">
                                Follow
                              </button>
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {!isInst && (
                  <section>
                    <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">Upcoming Events</h2>
                    {upcoming.length === 0 ? (
                      <p className="mt-3 text-[13px] text-slate-600 dark:text-[#a1a1aa]">No upcoming events.</p>
                    ) : (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        {upcoming.map((e) => (
                          <EventCard key={e._id} event={e} />
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}

            {tab === "events" && (
              <div className="space-y-8">
                <section>
                  <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">Upcoming · {org.upcomingEventCount}</h2>
                  {upcoming.length === 0 ? (
                    <p className="mt-4 text-[13px] text-slate-600 dark:text-[#a1a1aa]">No upcoming events.</p>
                  ) : (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      {upcoming.map((e) => (
                        <EventCard key={e._id} event={e} />
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">Past · {org.pastEventCount}</h2>
                  {past.length === 0 ? (
                    <p className="mt-4 text-[13px] text-slate-600 dark:text-[#a1a1aa]">No past events.</p>
                  ) : (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      {past.map((e) => (
                        <EventCard key={e._id} event={e} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {tab === "clubs" && isInst && (
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">Affiliated Clubs · {children.length}</h2>
                {children.length === 0 ? (
                  <EmptyState icon={UsersRound} title="No affiliated clubs" description="Clubs linked to this institution will appear here." />
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {children.map((child) => (
                      <Link
                        key={child._id}
                        href={`/organizations/${encodeURIComponent(child.handle || child.slug)}`}
                        className="flex items-center gap-3 rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-3.5 hover:bg-[#1a1a1e] hover:border-[#2a2a30] transition-colors"
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[8px] border border-slate-200 dark:border-[#232326] bg-transparent dark:bg-white/5 flex items-center justify-center">
                          {child.logo || child.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={child.logo || child.logoUrl} alt="" className="h-full w-full object-contain p-1" />
                          ) : (
                            <div className="grid h-full w-full place-items-center">
                              <Building2 className="h-4 w-4 text-slate-500 dark:text-[#71717a]" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-slate-900 dark:text-white">{child.name}</div>
                          <div className="truncate text-[11px] text-slate-500 dark:text-[#71717a]">{categoryLabel(child.category)}</div>
                        </div>
                        <span className="rounded-[8px] bg-slate-100 dark:bg-[#1f1f23] px-2.5 py-1 text-[11px] text-slate-600 dark:text-[#a1a1aa]">View</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "about" && (
              <div className="space-y-6">
                <div className="rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-5">
                  <h2 className="text-[14px] font-semibold text-slate-900 dark:text-white">About</h2>
                  <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-600 dark:text-[#a1a1aa]">
                    {org.description || "No description."}
                  </p>
                  {(org.address || loc || org.postalCode || org.mapUrl) && (
                    <div className="mt-5 border-t border-slate-200 dark:border-[#1f1f23] pt-5">
                      <h3 className="text-[11px] font-medium uppercase tracking-widest text-slate-500 dark:text-[#71717a]">Location</h3>
                      <div className="mt-2 text-[13px] text-slate-700 dark:text-[#e4e4e7]">
                        {org.address && <div className="break-words">{org.address}</div>}
                        {loc && <div className="text-slate-600 dark:text-[#a1a1aa] break-words">{loc}</div>}
                        {org.postalCode && <div className="text-slate-600 dark:text-[#a1a1aa]">{org.postalCode}</div>}
                        {org.mapUrl && (
                          <a href={safeExternalUrl(org.mapUrl) || "#"} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] text-[#3b82f6] hover:text-[#2563eb] dark:hover:text-[#60a5fa]">
                            <MapPin className="h-3 w-3" /> View on map
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {org.parentOrganization && (
                  <div className="rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-5">
                    <h3 className="text-[14px] font-semibold text-slate-900 dark:text-white">Parent Institution</h3>
                    <Link
                      href={`/organizations/${encodeURIComponent(org.parentOrganization.handle || org.parentOrganization.slug)}`}
                      className="mt-3 flex items-center gap-3 rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b] p-3 hover:bg-slate-100 dark:hover:bg-[#1f1f23] transition-colors"
                    >
                      <div className="h-10 w-10 overflow-hidden rounded-[8px] border border-slate-200 dark:border-[#232326] bg-slate-100 dark:bg-[#1f1f23]">
                        {org.parentOrganization.logo || org.parentOrganization.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={org.parentOrganization.logo || org.parentOrganization.logoUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center">
                            <Building2 className="h-4 w-4 text-slate-500 dark:text-[#71717a]" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-slate-900 dark:text-white">{org.parentOrganization.name}</div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-[#71717a]">
                          {categoryLabel(org.parentOrganization.category)} · {locationLabel(org.parentOrganization)}
                        </div>
                      </div>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <div className="rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-5">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-white">
                <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-slate-100 dark:bg-[#1f1f23]">
                  <Info className="h-3.5 w-3.5 text-slate-500 dark:text-[#71717a]" />
                </span>
                About
              </h3>
              <p className="mt-3 line-clamp-4 break-words text-[13px] leading-5 text-slate-600 dark:text-[#a1a1aa]">
                {org.description || "No description provided."}
              </p>
              {org.description && org.description.length > 120 && (
                <button
                  onClick={() => setTab("about")}
                  className="mt-2 text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa]"
                >
                  Read more
                </button>
              )}
              <div className="mt-4 space-y-2.5 border-t border-slate-200 dark:border-[#1f1f23] pt-4 text-[12px]">
                {loc && (
                  <div className="flex items-center gap-2 text-slate-600 dark:text-[#a1a1aa] min-w-0">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-[#71717a]" /> <span className="truncate">{loc}</span>
                  </div>
                )}
                {safeWebsite && (
                  <a
                    href={safeWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-slate-600 dark:text-[#a1a1aa] hover:text-slate-900 dark:hover:text-white transition-colors min-w-0"
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-[#71717a]" /> <span className="truncate">{org.website}</span>
                  </a>
                )}
                {org.email && (
                  <div className="flex items-center gap-2 text-slate-600 dark:text-[#a1a1aa] min-w-0">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-[#71717a]" /> <span className="truncate">{org.email}</span>
                  </div>
                )}
                {org.phone && (
                  <div className="flex items-center gap-2 text-slate-600 dark:text-[#a1a1aa]">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-[#71717a]" /> {org.phone}
                  </div>
                )}
                {socialEntries.length > 0 && (
                  <div className="pt-2">
                    <div className="text-[11px] font-medium uppercase tracking-widest text-slate-500 dark:text-[#71717a] mb-2">Social</div>
                    <div className="flex flex-wrap gap-2">
                      {socialEntries.map(([platform, url]) => {
                        const href = safeExternalUrl(url);
                        if (!href) return null;
                        return (
                          <a
                            key={platform}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#1f1f23] px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-[#a1a1aa] hover:bg-slate-100 dark:hover:bg-[#27272a] hover:text-slate-900 dark:hover:text-white transition-colors"
                          >
                            <span className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-slate-200 dark:bg-[#27272a] text-[10px]"><SocialIcon platform={platform} className="h-3 w-3" /></span>
                            <span className="capitalize">{platform}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {org.managers && org.managers.length > 0 && (
              <div className="rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-slate-900 dark:text-white">Institution Admins</h3>
                  <button className="text-[11px] text-[#3b82f6] hover:text-[#60a5fa]">View all</button>
                </div>
                <div className="mt-4 space-y-3">
                  {org.managers.map((m) => (
                    <Link
                      key={m._id}
                      href={`/profile/${m.username || m._id}`}
                      className="flex items-center gap-3 rounded-[10px] p-1.5 hover:bg-slate-100 dark:hover:bg-[#1f1f23] transition-colors"
                    >
                      <UserAvatar user={m} size={32} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-slate-900 dark:text-white">
                          {m.firstName} {m.lastName}
                        </div>
                        <div className="truncate text-[11px] text-slate-500 dark:text-[#71717a]">@{m.username}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {(loc || org.address || org.mapUrl || (org.latitude != null && org.longitude != null)) && (
              <div className="rounded-[12px] border border-slate-200 dark:border-[#232326] bg-white dark:bg-[#141417] p-5">
                <h3 className="text-[13px] font-semibold text-slate-900 dark:text-white">Location</h3>
                <div className="mt-3 overflow-hidden rounded-[10px] border border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#18181b]">
                  {org.mapUrl && safeExternalUrl(org.mapUrl) && (safeExternalUrl(org.mapUrl)?.includes("google.com/maps") || safeExternalUrl(org.mapUrl)?.includes("maps.google")) ? (
                    <div className="h-[160px] w-full bg-slate-100 dark:bg-[#1f1f23] relative">
                      <iframe
                        src={safeExternalUrl(org.mapUrl)!.replace("/maps/", "/maps/embed?pb=")}
                        title="Map"
                        className="h-full w-full border-0"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        style={{ display: safeExternalUrl(org.mapUrl)?.startsWith("https://www.google.com/maps/embed") ? "block" : "none" }}
                      />
                      <div className="absolute inset-0 grid place-items-center" style={{ display: safeExternalUrl(org.mapUrl)?.startsWith("https://www.google.com/maps/embed") ? "none" : "grid" }}>
                        <MapPin className="h-6 w-6 text-[#3b82f6]" />
                        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#3a3a42_1px,transparent_1px)] [background-size:16px_16px]" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-[120px] w-full bg-slate-100 dark:bg-[#1f1f23] relative">
                      <div className="absolute inset-0 grid place-items-center">
                        <MapPin className="h-6 w-6 text-[#3b82f6]" />
                      </div>
                      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#3a3a42_1px,transparent_1px)] [background-size:16px_16px]" />
                    </div>
                  )}
                </div>
                <div className="mt-3 text-[12px] text-slate-600 dark:text-[#a1a1aa] break-words">{org.address ? `${org.address}, ` : ""}{loc || ""}{org.postalCode ? ` ${org.postalCode}` : ""}</div>
                <div className="mt-3 flex gap-2">
                  {org.mapUrl && safeExternalUrl(org.mapUrl) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#1f1f23] text-[12px]"
                      onClick={() => window.open(safeExternalUrl(org.mapUrl)!, "_blank")}
                    >
                      Open Map Link
                    </Button>
                  )}
                  {loc && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 rounded-[8px] border-slate-200 dark:border-[#232326] bg-slate-50 dark:bg-[#1f1f23] text-[12px]"
                      onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(org.address ? `${org.address} ${loc}` : loc)}`, "_blank")}
                    >
                      View on Maps
                    </Button>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
