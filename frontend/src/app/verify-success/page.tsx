"use client";
import React from "react";

export default function VerifySuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-2xl shadow-md text-center">
        <h1 className="text-2xl font-bold mb-4">Email Verified ✅</h1>
        <p>Your account has been verified. You can now log in.</p>
        <a href="/login" className="mt-4 inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          Go to Login
        </a>
      </div>
    </div>
  );
}
