'use client';
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Google OAuth callback.
 * The backend redirects here with a SHORT-LIVED one-time ?code=...
 * We exchange it for the real session token via an authenticated POST —
 * the long-lived token never appears in the URL or browser history.
 */
export default function OAuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      router.replace("/login?error=oauth_failed");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/auth/google/exchange`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          }
        );
        const data = await res.json();

        if (!res.ok || !data.success || !data.token) {
          throw new Error(data.message || "Login failed");
        }

        localStorage.setItem("token", data.token);
        localStorage.setItem("role", (data.user?.role || "user").toLowerCase());
        localStorage.setItem(
          "user",
          JSON.stringify({
            id: data.user?.id || "",
            email: data.user?.email || "",
            firstName: data.user?.firstName || "",
            lastName: data.user?.lastName || "",
          })
        );

        router.replace(data.user?.role === "admin" ? "/admin/dashboard" : "/user/profile");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
        setTimeout(() => router.replace("/login?error=oauth_failed"), 1500);
      }
    })();
  }, [code, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-lg font-medium text-slate-900">Google sign-in failed</p>
            <p className="mt-1 text-sm text-slate-500">{error} — redirecting to login…</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium text-slate-900">Signing you in…</p>
            <div className="mx-auto mt-4 h-8 w-8 animate-spin rounded-full border-b-2 border-[#0070f0]" />
          </>
        )}
      </div>
    </div>
  );
}
