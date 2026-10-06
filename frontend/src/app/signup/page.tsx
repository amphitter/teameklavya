import type { Metadata } from "next";
import SignupForm from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Join EventHub — discover events, register in seconds, build your event identity.",
  alternates: { canonical: "/signup" },
};

export default function Page() {
  return <SignupForm />;
}
