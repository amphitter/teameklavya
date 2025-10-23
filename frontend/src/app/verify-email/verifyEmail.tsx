"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
export const dynamic = 'force-dynamic';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const email = searchParams.get("email");

  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    if (token && email) {
      // ✅ Instead of Axios, just redirect the user to backend verify route
      const backendUrl = `http://localhost:5000/api/auth/verify-email?token=${token}&email=${email}`;
      window.location.href = backendUrl;
    } else {
      setStatus("error");
      setMessage("Invalid verification link.");
    }
  }, [token, email]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <div className="bg-white shadow-md rounded-2xl p-8 max-w-md text-center">
        <h1 className="text-2xl font-semibold mb-4">Email Verification</h1>
        {status === "loading" && <p className="text-gray-500">{message}</p>}
        {status === "error" && <p className="text-red-600">{message}</p>}
      </div>
    </div>
  );
}
