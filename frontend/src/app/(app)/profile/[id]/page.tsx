"use client";

import { useParams } from "next/navigation";
import { ProfileScreen } from "@/components/profile/profile-screen";

/**
 * /profile/<handle|id> — someone's profile. The screen itself lives in
 * `components/profile/profile-screen.tsx` so that /user/profile can render the
 * same one instead of keeping a second, older profile view.
 */
export default function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  return <ProfileScreen id={id} />;
}
