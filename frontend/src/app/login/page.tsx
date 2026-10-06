import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to EventHub to discover and manage your events.",
  alternates: { canonical: "/login" },
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
