import AppShell from "@/components/shell/app-shell";

/**
 * Participant application routes.
 * Everything here lives inside the EventHub social shell
 * (sidebar + search bar on desktop, bottom navigation on mobile).
 * Auth screens, OAuth callbacks and the /admin organizer area
 * intentionally live outside this group.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
