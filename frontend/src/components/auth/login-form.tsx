"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import { Eye, EyeOff, Loader2, Lock, Mail, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { api, API_ORIGIN } from "@/utils/api";
import { AuthSplit, GRADIENT_BTN, FIELD_CLS } from "@/components/auth/auth-split";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
}

/**
 * Login page — reference design (illustration left, form right;
 * on mobile: illustration + Google/mail choice, form appears on tap).
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/user/profile";
  const justRegistered = searchParams.get("registered") === "1";

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Already logged in → redirect
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) router.replace(returnUrl);
  }, [returnUrl, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post("/auth/login", form);
      const { token, user } = res.data;
      if (!token) throw new Error("Token not received");

      const decoded: DecodedToken = jwtDecode(token);
      const role = (decoded.role || "user").toLowerCase();

      localStorage.setItem("token", token);
      localStorage.setItem("role", role);
      if (user) localStorage.setItem("user", JSON.stringify(user));

      toast.success(`Welcome back${user?.firstName ? `, ${user.firstName}` : ""}!`);

      const redirect =
        returnUrl !== "/user/profile"
          ? returnUrl
          : role === "admin"
            ? "/admin/dashboard"
            : "/user/profile";
      router.push(redirect);
    } catch (err: any) {
      setError(err.response?.data?.message || "Login failed — check your credentials and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${API_ORIGIN}/api/auth/google`;
  };

  return (
    <AuthSplit mode="login" onGoogle={handleGoogleLogin}>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          Welcome back
        </h1>
        <p className="mt-1.5 text-sm font-normal text-[#64709A]">Sign in to continue your journey.</p>
      </div>

      {justRegistered && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl bg-[#EFF6FF] px-4 py-3 text-sm text-[#2563FF]">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Account created!</strong> Check your email to verify, then log in.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-slate-700">
            Email address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#64709A]">
              <Mail className="h-4 w-4" />
            </div>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              className={FIELD_CLS}
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="block text-xs font-semibold text-slate-700">
              Password
            </label>
            <Link href="/auth/forgot-password" className="text-xs font-semibold text-[#2563FF] transition-colors hover:text-[#6C35FF]">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#64709A]">
              <Lock className="h-4 w-4" />
            </div>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              className={FIELD_CLS + " pr-11"}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#64709A] hover:text-slate-700"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#ba1a1a]">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={`mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold transition-all ${GRADIENT_BTN} disabled:opacity-70`}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
            </>
          ) : (
            "Sign In →"
          )}
        </button>
      </form>
    </AuthSplit>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
