import type { Metadata } from "next";
import { Suspense } from "react";
import VerifyEmailClient from "@/components/auth/verify-email-client";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Verify your EventHub email address.",
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailClient />
    </Suspense>
  );
}
