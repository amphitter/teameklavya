import { NextResponse } from "next/server";
import { api } from "@/utils/api";

interface EventItem {
  slug: string;
  updatedAt?: string;
  startDate?: string;
}

interface SitemapUrl {
  loc: string;
  priority: number;
  lastmod?: string;
}

export async function GET() {
  const baseUrl = "https://www.teameklavya.xyz";

  let events: EventItem[] = [];

  try {
    const res = await api.get("/events");
    const data = res?.data;

    // Handle both possible shapes
    if (Array.isArray(data)) {
      events = data;
    } else if (Array.isArray(data?.events)) {
      events = data.events;
    } else {
      console.warn("Unexpected events API format:", data);
      events = [];
    }
  } catch (error) {
    console.error("Error fetching events for sitemap:", error);
  }

  const staticUrls: SitemapUrl[] = [
    { loc: `${baseUrl}/`, priority: 1.0 },
    { loc: `${baseUrl}/about`, priority: 0.8 },
    { loc: `${baseUrl}/events`, priority: 0.8 },
    { loc: `${baseUrl}/contact`, priority: 0.7 },
  ];

  const eventUrls: SitemapUrl[] = events
    .filter((event) => event.slug)
    .map((event) => ({
      loc: `${baseUrl}/events/${event.slug}`,
      priority: 0.9,
      lastmod: event.updatedAt || event.startDate || new Date().toISOString(),
    }));

  const allUrls = [...staticUrls, ...eventUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${allUrls
      .map(
        (url) => `
      <url>
        <loc>${url.loc}</loc>
        ${
          url.lastmod
            ? `<lastmod>${new Date(url.lastmod).toISOString()}</lastmod>`
            : ""
        }
        <priority>${url.priority}</priority>
      </url>`
      )
      .join("")}
  </urlset>`;

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
