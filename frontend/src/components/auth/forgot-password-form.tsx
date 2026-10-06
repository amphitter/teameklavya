"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function ForgotPasswordForm() {
  const [step, setStep] = useState<"request" | "verify" | "reset" | "done">("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Step 1 — request OTP
  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/password/forgot", { email });
      setStep("verify");
      setCountdown(60);
      toast.success("If that email exists, we've sent a 6-digit code.");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/auth/password/verify-otp", { email, otp: otp.trim() });
      if (!res.data?.tempToken) throw new Error("Verification failed");
      setTempToken(res.data.tempToken);
      setStep("reset");
    } catch (err: any) {
      setError(err.response?.data?.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  // Step 3 — set new password
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.post("/auth/password/reset", {
        email,
        tempToken: tempToken.trim(),
        newPassword,
        confirmPassword,
      });
      setStep("done");
      toast.success("Password updated — you can log in now.");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    try {
      await api.post("/auth/password/forgot", { email });
      setCountdown(60);
      toast.success("New code sent");
    } catch {
      toast.error("Failed to resend code");
    }
  };

  // ── Done state ─────────────────────────────────────
  if (step === "done") {
    return (
      <AuthCard title="Password updated">
        <div className="flex flex-col items-center py-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-light">
            <CheckCircle2 className="h-9 w-9 text-success" />
          </div>
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            Your password has been reset successfully. Log in with your new password.
          </p>
          <Button asChild className="mt-6 w-full py-2.5 font-semibold">
            <Link href="/login">Go to login</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={step === "request" ? "Reset your password" : step === "verify" ? "Enter your code" : "Set a new password"}
      subtitle={
        step === "request"
          ? "We'll email you a 6-digit reset code"
          : step === "verify"
            ? `Code sent to ${email}`
            : "Choose a strong password you don't use elsewhere"
      }
      backHref="/login"
      backLabel="Back to login"
    >
      {/* Step indicator */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {["request", "verify", "reset"].map((s, i) => {
          const order = ["request", "verify", "reset"];
          const active = order.indexOf(step) >= i;
          return (
            <span
              key={s}
              className={cn("h-1.5 w-10 rounded-full transition-colors", active ? "bg-primary" : "bg-border")}
            />
          );
        })}
      </div>

      {step === "request" && (
        <form onSubmit={handleRequest} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" className="w-full py-2.5 font-semibold" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Send reset code"}
          </Button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div className="flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light">
              <MailCheck className="h-6 w-6 text-primary" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="otp" className="text-center">
              6-digit code
            </Label>
            <Input
              id="otp"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="h-14 text-center text-2xl font-bold tracking-[0.5em]"
              required
              autoFocus
            />
          </div>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" className="w-full py-2.5 font-semibold" disabled={loading || otp.length !== 6}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Verify code"}
          </Button>
          <button
            type="button"
            onClick={handleResend}
            disabled={countdown > 0}
            className="w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            {countdown > 0 ? `Resend code in ${countdown}s` : "Didn't get the code? Resend"}
          </button>
        </form>
      )}

      {step === "reset" && (
        <form onSubmit={handleReset} className="space-y-4">
          <div className="flex flex-col items-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-light">
              <ShieldCheck className="h-6 w-6 text-success" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your new password"
              required
              autoComplete="new-password"
            />
          </div>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" className="w-full py-2.5 font-semibold" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Update password"}
          </Button>
        </form>
      )}

      <div className="mt-5 text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to login
        </Link>
      </div>
    </AuthCard>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
      {message}
    </p>
  );
}
