import { NextResponse } from "next/server";
import { api } from "@/utils/api";

interface EventItem {
  slug: string;
  updatedAt?: string;
  startDate?: string;
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  let events: EventItem[] = [];

  try {
    const res = await api.get("/events", { params: { limit: 100 } });
    const data = res?.data;
    if (Array.isArray(data)) {
      events = data;
    } else if (Array.isArray(data?.events)) {
      events = data.events;
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
