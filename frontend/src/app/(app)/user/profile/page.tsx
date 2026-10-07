"use client";

import { ProfileScreen } from "@/components/profile/profile-screen";

/**
 * /user/profile — your own profile, and the default landing page after signing
 * in.
 *
 * This used to be a separate, older implementation: its own header (initials,
 * not your photo), its own tab set, and a read-only post grid. So the first
 * screen a member saw, and the one every "Profile" link pointed at, was not the
 * rebuilt profile at all. It now renders the same screen as /profile/<handle>,
 * with the id resolved from the session.
 */
export default function MyProfilePage() {
  return <ProfileScreen />;
}
