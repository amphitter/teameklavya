"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  backHref = "/",
  backLabel = "Back to home",
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#0a0a0c] px-4 py-10">
      <div className="pointer-events-none absolute -top-24 left-1/4 h-96 w-96 rounded-full bg-[#3b82f6]/10 blur-[80px]" />
      <div className="relative w-full max-w-md">
        <Link
          href={backHref}
          className="mb-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#71717a] hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>

        <div className={cn("rounded-[16px] border border-[#1f1f23] bg-[#121214] p-7 shadow-[0_10px_40px_rgba(0,0,0,0.3)] sm:p-8", className)}>
          <div className="mb-6 flex flex-col items-center text-center">
            <Link href="/" aria-label="EventHub home">
              <Logo size={36} />
            </Link>
            <h1 className="mt-5 text-[18px] font-semibold tracking-tight text-white">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[13px] text-[#a1a1aa]">{subtitle}</p>}
          </div>
          {children}
        </div>

        {footer && <div className="mt-5 text-center text-[13px] text-[#71717a]">{footer}</div>}
      </div>
    </div>
  );
}

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-[18px] w-[18px]", className)} aria-hidden>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.16 7.16 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}
