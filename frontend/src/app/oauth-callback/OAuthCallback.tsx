'use client';
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { API_ORIGIN } from "@/utils/api";
import { hasPlatformAdminAccess } from "@/lib/superAdmin";

function isSafeReturnUrl(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  if (url.includes("://")) return false;
  if (url.includes("\\")) return false;
  if (/^\s*javascript:/i.test(url)) return false;
  if (/[\0-\x1f\x7f]/.test(url)) return false;
  return true;
}

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
          `${API_ORIGIN}/api/auth/google/exchange`,
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
            role: data.user?.role || "user",
            isSuperAdmin: data.user?.isSuperAdmin === true,
          })
        );

        // Preserve returnUrl from OAuth flow — stored before redirect to Google
        let returnUrl: string | null = null;
        try {
          const stored = localStorage.getItem("oauth_returnUrl");
          if (stored && isSafeReturnUrl(stored)) {
            returnUrl = stored;
          }
          // Clear after use
          localStorage.removeItem("oauth_returnUrl");
        } catch {}

        // If returnUrl is an event page, keep it; otherwise admin check
        if (returnUrl && isSafeReturnUrl(returnUrl)) {
          router.replace(returnUrl);
        } else {
          router.replace(
            hasPlatformAdminAccess(data.user?.role, data.user)
              ? "/admin/dashboard"
              : "/user/profile"
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
        setTimeout(() => router.replace("/login?error=oauth_failed"), 1500);
      }
    })();
  }, [code, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-black">
      <div className="text-center">
        {error ? (
          <>
            <p className="text-lg font-medium text-white">Google sign-in failed</p>
            <p className="mt-1 text-sm text-[#a1a1aa]">{error} — redirecting to login…</p>
          </>
        ) : (
          <>
            <p className="text-lg font-medium text-white">Signing you in…</p>
            <div className="mx-auto mt-4 h-8 w-8 animate-spin rounded-full border-b-2 border-[#3b82f6]" />
          </>
        )}
      </div>
    </div>
  );
}
