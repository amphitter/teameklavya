"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Logo } from "@/components/logo";
import { GoogleMark } from "@/components/auth/auth-card";
import { cn } from "@/lib/utils";

export const GRADIENT_BTN = "bg-[#3b82f6] text-white hover:bg-[#2563eb] active:bg-[#1d4ed8]";

export const FIELD_CLS =
  "h-11 w-full rounded-[10px] border border-[#232326] bg-[#18181b] pl-11 pr-4 text-[13px] text-white placeholder:text-[#71717a] outline-none transition-all focus:border-[#3b82f6]/50 focus:bg-[#1f1f23]";

const SOCIAL_BTN =
  "flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-[#232326] bg-[#18181b] text-[13px] font-medium text-[#e4e4e7] transition-all hover:border-[#2a2a30] hover:bg-[#1f1f23] active:scale-[0.99]";

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
  const [revealed, setRevealed] = useState(false);

  const mailLabel = isLogin ? "Login with mail" : "Sign up with email";
  const googleLabel = isLogin ? "Login with Google" : "Sign up with Google";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#0a0a0c] text-white">
      {/* Subtle glow */}
      <div className="pointer-events-none absolute -top-24 left-1/4 h-96 w-96 rounded-full bg-[#3b82f6]/10 blur-[80px]" />
      <div className="pointer-events-none absolute right-0 top-1/3 h-[32rem] w-[32rem] rounded-full bg-[#3b82f6]/5 blur-[100px]" />

      {/* Header */}
      <header className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link href="/" aria-label="EventHub home" className="shrink-0">
          <Logo size={32} />
        </Link>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="hidden text-[#71717a] sm:inline">
            {isLogin ? "New to EventHub?" : "Already have an account?"}
          </span>
          <Link
            href={isLogin ? "/signup" : "/login"}
            className="font-medium text-[#3b82f6] hover:text-[#60a5fa] transition-colors"
          >
            {isLogin ? "Create an account" : "Log in"}
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-6 sm:px-6 sm:pb-10">
        <section className="my-auto grid grid-cols-1 items-center gap-8 lg:my-0 lg:grid-cols-12 lg:gap-12">
          {/* Left illustration */}
          <div className={cn("relative lg:col-span-7", revealed && "hidden lg:block")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/auth-hero.webp"
              alt="EventHub"
              className="hidden h-auto w-full object-contain opacity-80 lg:block"
            />
            <div className={cn("flex justify-center lg:hidden", revealed ? "hidden" : "")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/auth-mobile-poster.webp"
                alt="EventHub"
                width={720}
                height={1080}
                className="h-auto max-h-[44vh] w-auto max-w-full opacity-80"
              />
            </div>
          </div>

          {/* Right card */}
          <div className="relative lg:col-span-5">
            <div className="relative z-10 rounded-[16px] border border-[#1f1f23] bg-[#121214] p-6 shadow-[0_10px_40px_rgba(0,0,0,0.3)] sm:p-8">
              {/* Mobile choice */}
              <div className={cn("space-y-3 lg:hidden", revealed && "hidden")}>
                <button type="button" className={SOCIAL_BTN} onClick={onGoogle}>
                  <GoogleMark /> {googleLabel}
                </button>
                <button
                  type="button"
                  className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#3b82f6] text-[13px] font-medium text-white hover:bg-[#2563eb] active:scale-[0.99]"
                  onClick={() => setRevealed(true)}
                >
                  <Mail className="h-4 w-4" /> {mailLabel}
                </button>
                <p className="pt-1.5 text-center text-[11px] leading-relaxed text-[#71717a]">
                  By continuing, you agree to our Terms and Privacy Policy.
                </p>
              </div>

              <div className={cn(!revealed && "hidden lg:block")}>
                <button
                  type="button"
                  onClick={() => setRevealed(false)}
                  className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-[#71717a] hover:text-white lg:hidden"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                {children}

                <div className="relative my-6 text-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[#1f1f23]" />
                  </div>
                  <span className="relative bg-[#121214] px-3 text-[11px] font-medium tracking-wide text-[#71717a]">
                    or continue with
                  </span>
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
