'use client';
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { jwtDecode } from "jwt-decode";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export default function OAuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      router.push("/auth/login?error=no_token");
      return;
    }

    try {
      const decoded: DecodedToken = jwtDecode(token);
      const userRole = decoded.role.toLowerCase();

      localStorage.setItem("token", token);
      localStorage.setItem("role", userRole);
      localStorage.setItem(
        "user",
        JSON.stringify({
          email: decoded.email || '',
          firstName: decoded.firstName || '',
          lastName: decoded.lastName || ''
        })
      );

      if (userRole === "admin") {
        router.push("/admin/dashboard");
      } else {
        router.push("/user/profile");
      }

    } catch (err) {
      console.error("OAuth callback error:", err);
      router.push("/auth/login?error=oauth_failed");
    }
  }, [token, router]);

  return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="text-center">
        <p className="text-lg">Signing you in...</p>
        <div className="mt-4 animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    </div>
  );
}
