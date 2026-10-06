"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Logo } from "@/components/logo";
import { GoogleMark } from "@/components/auth/auth-card";
import { cn } from "@/lib/utils";

/**
 * Reference auth layout ("EventHub Authentication Workflow Mockup"):
 * — Desktop: illustration LEFT · auth card RIGHT (parallel 7/5 split)
 * — Mobile: illustration on top, then two buttons —
 *   "Login with Google" and "Login with mail" — the mail form
 *   appears when the user taps the mail button.
 * Palette & shapes per DESIGN.md (Vibrant Pulse).
 */

/** Shared brand styles (DESIGN.md — Vibrant Pulse) */
export const GRADIENT_BTN =
  "bg-[linear-gradient(135deg,#2563FF_0%,#6C35FF_52%,#D946EF_100%)] text-white shadow-[0_8px_24px_-4px_rgba(79,70,229,0.4)] hover:shadow-[0_10px_28px_-4px_rgba(108,53,255,0.5)] hover:brightness-105 active:scale-[0.99]";

/** Text field per DESIGN.md: 48px, 12px radius, focus ring */
export const FIELD_CLS =
  "h-12 w-full rounded-xl border border-[#E4E9F4] bg-slate-50/50 pl-11 pr-4 text-sm text-[#0B1235] placeholder-[#64709A]/70 outline-none transition-all focus:border-[#2563FF] focus:bg-white focus:ring-[3px] focus:ring-[#2563FF]/12";

const SOCIAL_BTN =
  "flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-[#E4E9F4] bg-white text-sm font-semibold text-[#0B1235] transition-all hover:border-[#2563FF]/40 hover:bg-[#EFF6FF] active:scale-[0.99]";

export function AuthSplit({
  mode,
  onGoogle,
  children,
}: {
  mode: "login" | "signup";
  onGoogle: () => void;
  children: React.ReactNode;
}) {
  const isLogin = mode === "login";
  // Mobile choice screen state: buttons first, form appears on tap
  const [revealed, setRevealed] = useState(false);

  const mailLabel = isLogin ? "Login with mail" : "Sign up with email";
  const googleLabel = isLogin ? "Login with Google" : "Sign up with Google";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F8FAFF] text-[#0B1235]">
      {/* Ambient glow orbs (per reference) */}
      <div className="pointer-events-none absolute -top-24 left-4 z-0 h-80 w-80 rounded-full bg-blue-300 opacity-60 blur-[80px]" />
      <div className="pointer-events-none absolute right-0 top-32 z-0 h-[28rem] w-[28rem] rounded-full bg-purple-300 opacity-60 blur-[80px]" />
      <div className="pointer-events-none absolute bottom-8 left-1/3 z-0 h-72 w-72 rounded-full bg-fuchsia-200 opacity-50 blur-[80px]" />
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60" aria-hidden />

      {/* ── Header ─────────────────────────────────────── */}
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="EventHub home" className="transition-opacity hover:opacity-90">
          <Logo size={38} />
        </Link>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="hidden text-[#64709A] sm:inline">{isLogin ? "New to EventHub?" : "Already have an account?"}</span>
          <Link
            href={isLogin ? "/signup" : "/login"}
            className="font-semibold text-[#2563FF] transition-colors hover:text-[#6C35FF]"
          >
            {isLogin ? "Create an account" : "Log in"}
          </Link>
        </div>
      </header>

      {/* ── Main split ─────────────────────────────────── */}
      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6">
        <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
          {/* LEFT — illustration (desktop) / top (mobile choice screen only) */}
          <div className={cn("relative lg:col-span-7", revealed && "hidden lg:block")}>
            {/* Desktop illustration — transparent art, floats directly on
                the page (no background, no border, no card) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/auth-hero.webp"
              alt="EventHub — People, Events, Progress"
              className="hidden h-auto w-full object-contain lg:block"
            />
            {/* Mobile illustration (portrait) — shrunk so it is fully
                visible on the choice screen; hidden entirely once the
                email form opens (the form then covers the page) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/auth-mobile.webp"
              alt="EventHub — Discover, Participate, Learn, Build"
              className={cn(
                "mx-auto rounded-2xl object-contain lg:hidden",
                revealed ? "hidden" : "max-h-[40vh] w-auto"
              )}
            />
          </div>

          {/* RIGHT — auth card */}
          <div className="relative lg:col-span-5">
            <div className="relative z-10 rounded-[28px] border border-[#E4E9F4]/80 bg-white/95 p-6 shadow-[0_10px_40px_rgba(24,39,75,0.08)] backdrop-blur-xl sm:p-9">
              {/* Mobile: choice screen (before reveal) */}
              <div className={cn("space-y-3 lg:hidden", revealed && "hidden")}>
                <div className="mb-2 flex justify-center lg:hidden">
                  <Logo size={44} />
                </div>
                <button type="button" className={SOCIAL_BTN} onClick={onGoogle}>
                  <GoogleMark /> {googleLabel}
                </button>
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:brightness-105 active:scale-[0.99] bg-[linear-gradient(135deg,#2563FF_0%,#6C35FF_52%,#D946EF_100%)] shadow-[0_8px_24px_-4px_rgba(79,70,229,0.4)]"
                  onClick={() => setRevealed(true)}
                >
                  <Mail className="h-[18px] w-[18px]" /> {mailLabel}
                </button>
                <p className="pt-1.5 text-center text-[11px] leading-relaxed text-[#64709A]">
                  By continuing, you agree to our Terms of Service and Privacy Policy.
                </p>
              </div>

              {/* The form (always visible on desktop; revealed on mobile) */}
              <div className={cn(!revealed && "hidden lg:block")}>
                {/* Mobile back-to-choices */}
                <button
                  type="button"
                  onClick={() => setRevealed(false)}
                  className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-[#64709A] transition-colors hover:text-[#0B1235] lg:hidden"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                {children}

                {/* Divider + Google (desktop card layout per reference) */}
                <div className="relative my-6 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[#E4E9F4]" />
                  </div>
                  <span className="relative bg-white px-3 text-xs font-medium tracking-wide text-[#64709A]">or continue with</span>
                </div>
                <button type="button" className={SOCIAL_BTN} onClick={onGoogle}>
                  <GoogleMark /> {googleLabel}
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

    </div>
  );
}
