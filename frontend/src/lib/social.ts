/** Display handle for users without a formal username field yet. */
export function handleOf(
  user: { username?: string; firstName?: string; lastName?: string; email?: string } | null | undefined
): string {
  if (!user) return "someone";
  // Real @username (Part 3) takes priority — never leak email-derived handles
  if (user.username) return user.username;
  const name = `${user.firstName || ""}${user.lastName || ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return name || "builder";
}

/** Stable profile path for a user — prefers the @username URL, falls back to id. */
export function profilePathOf(user: { _id?: string; username?: string } | null | undefined): string {
  if (!user) return "/explore";
  return `/profile/${user.username || user._id}`;
}

/** Compact relative time: 30s, 5m, 3h, 2d, then date. */
export function timeAgo(date: string | Date): string {
  const then = new Date(date).getTime();
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return `${Math.max(1, secs)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`;
  return `${Math.round(n / 100000) / 10}M`;
}
