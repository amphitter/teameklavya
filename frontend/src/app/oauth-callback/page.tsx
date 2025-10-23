"use client";

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
    if (token) {
      try {
        // Decode the token to get user role
        const decoded: DecodedToken = jwtDecode(token);
        const userRole = decoded.role.toLowerCase();

        // Store both token and role in localStorage
        localStorage.setItem("token", token);
        localStorage.setItem("role", userRole);

        // Optional: Store basic user info if available in token
        // You might need to adjust this based on your token structure
        const userData = {
          email: decoded.email || '',
          firstName: decoded.firstName || '',
          lastName: decoded.lastName || ''
        };
        localStorage.setItem("user", JSON.stringify(userData));

        console.log("OAuth login successful, role:", userRole);

        // Redirect based on role
        if (userRole === "admin") {
          router.push("/admin/dashboard");
        } else {
          router.push("/user/dashboard");
        }

      } catch (error) {
        console.error("Error processing OAuth callback:", error);
        router.push("/auth/login?error=oauth_failed");
      }
    } else {
      console.error("No token received in OAuth callback");
      router.push("/auth/login?error=no_token");
    }
  }, [token, router]);

  return <div className="flex justify-center items-center min-h-screen">
    <div className="text-center">
      <p className="text-lg">Signing you in...</p>
      <div className="mt-4 animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
    </div>
  </div>;
}