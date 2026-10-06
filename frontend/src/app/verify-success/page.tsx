import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Email verified",
  description: "Your EventHub email has been verified.",
};

export default function VerifySuccessPage() {
  return (
    <AuthCard title="Email verified!">
      <div className="flex flex-col items-center py-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-light">
          <CheckCircle2 className="h-9 w-9 text-success" />
        </div>
        <p className="mt-4 max-w-xs text-sm text-muted-foreground">
          Your email is verified and your account is active. Log in to start discovering events.
        </p>
        <Button asChild className="mt-6 w-full py-2.5 font-semibold">
          <Link href="/login">Log in to EventHub</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
