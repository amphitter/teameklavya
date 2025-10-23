"use client";
import { Suspense } from "react";
import OAuthCallback from "./OAuthCallback";

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OAuthCallback />
    </Suspense>
  );
}
