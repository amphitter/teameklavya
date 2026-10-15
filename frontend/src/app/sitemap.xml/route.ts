import { NextResponse } from "next/server";
import { api } from "@/utils/api";

interface EventItem {
  slug: string;
  updatedAt?: string;
  startDate?: string;
}

interface EventsPageResponse {
  events?: EventItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  let events: EventItem[] = [];

  try {
    let cursor: string | null = null;
    // Keep sitemap generation bounded while walking stable public-event pages.
    // 20 × 50 = up to 1,000 current event URLs; the API itself remains capped.
    for (let page = 0; page < 20; page += 1) {
      const response: { data: EventsPageResponse | EventItem[] } = await api.get("/events", {
        params: { limit: 50, cursor: cursor || undefined },
      });
      const data: EventsPageResponse | EventItem[] = response.data;
      const rows: EventItem[] = Array.isArray(data) ? data : data.events || [];
      events.push(...rows);
      cursor = Array.isArray(data) ? null : data.nextCursor || null;
      if (!cursor || Array.isArray(data) || !data.hasMore) break;
    }
  } catch (error) {
    console.error("Error fetching events for sitemap:", error);
  }

  const staticUrls = [
    { loc: `${baseUrl}/`, priority: 1.0 },
    { loc: `${baseUrl}/events`, priority: 0.9 },
    { loc: `${baseUrl}/login`, priority: 0.3 },
    { loc: `${baseUrl}/signup`, priority: 0.3 },
  ];

  const eventUrls = events
    .filter((e) => e.slug)
    .map((e) => ({
      loc: `${baseUrl}/events/${e.slug}`,
      priority: 0.8,
      ...(e.updatedAt ? { lastmod: e.updatedAt } : {}),
    }));

  const urls: Array<{ loc: string; priority: number; lastmod?: string }> = [
    ...staticUrls,
    ...eventUrls,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority>${
        u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ""
      }</url>`
  )
  .join("\n")}
</urlset>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml" },
  });
}
