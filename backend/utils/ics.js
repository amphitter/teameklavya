/**
 * Minimal .ics generator for EventHub events.
 * No external dependency — pure string building per RFC 5545.
 */

function formatDateUTC(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(str = "") {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .slice(0, 1000);
}

function generateEventICS(event) {
  const now = formatDateUTC(new Date());
  const start = formatDateUTC(event.startDate);
  const end = event.endDate ? formatDateUTC(event.endDate) : formatDateUTC(new Date(new Date(event.startDate).getTime() + 2 * 3600 * 1000));
  const uid = `${event._id || event.slug}@eventhub.local`;
  const title = escapeText(event.title || "EventHub Event");
  const description = escapeText(event.description || "");
  const location = escapeText(event.venue || (event.eventType === "online" ? "Online" : ""));
  const url = event.slug ? `https://eventhub.app/events/${event.slug}` : "";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventHub//Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    description ? `DESCRIPTION:${description}` : null,
    location ? `LOCATION:${location}` : null,
    url ? `URL:${url}` : null,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n");
}

module.exports = { generateEventICS };
