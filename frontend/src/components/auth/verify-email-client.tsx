"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";

export default function VerifyEmailClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token && email) {
      // The backend verifies the token and redirects to /verify-success
      const backend = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
      window.location.href = `${backend}/api/auth/verify-email?token=${encodeURIComponent(
        token
      )}&email=${encodeURIComponent(email)}`;
    } else {
      setError("Invalid verification link — token or email missing.");
    }
  }, [token, email]);

  return (
    <AuthCard title="Email verification">
      <div className="flex flex-col items-center py-6 text-center">
        {error ? (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <XCircle className="h-9 w-9 text-destructive" />
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Verifying your email…</p>
          </>
        )}
      </div>
    </AuthCard>
  );
}
