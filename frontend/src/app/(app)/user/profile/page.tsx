import type { Metadata } from "next";
import ProfileView from "@/components/profile-view";

export const metadata: Metadata = {
  title: "My profile",
  description: "Your EventHub profile — events, tickets and details.",
};

export default function Page() {
  return <ProfileView />;
}
