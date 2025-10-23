"use client";
import { Suspense } from "react";
import OAuthCallback from "./OAuthCallback";

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OAuthCallback />
    </Suspense>
  );
}
