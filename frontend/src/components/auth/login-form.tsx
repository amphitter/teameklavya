"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import { Eye, EyeOff, Loader2, Lock, Mail, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { api, API_ORIGIN } from "@/utils/api";
import { AuthSplit, GRADIENT_BTN, FIELD_CLS } from "@/components/auth/auth-split";
import { hasPlatformAdminAccess } from "@/lib/superAdmin";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/user/profile";
  const justRegistered = searchParams.get("registered") === "1";

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
          : hasPlatformAdminAccess(role, user)
            ? "/admin/dashboard"
            : "/user/profile";
      router.push(redirect);
    } catch (err: any) {
      setError(err.response?.data?.message || "Login failed — check credentials.");
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
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Welcome back</h1>
        <p className="mt-1 text-[13px] text-[#71717a]">Sign in to continue your journey.</p>
      </div>

      {justRegistered && (
        <div className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-4 py-3 text-[13px] text-[#93c5fd]">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Account created!</strong> Check your email to verify, then log in.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-[12px] font-medium text-[#a1a1aa]">Email address</label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#71717a]">
              <Mail className="h-4 w-4" />
            </div>
            <input id="email" type="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className={FIELD_CLS} />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="block text-[12px] font-medium text-[#a1a1aa]">Password</label>
            <Link href="/auth/forgot-password" className="text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa]">Forgot password?</Link>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#71717a]">
              <Lock className="h-4 w-4" />
            </div>
            <input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className={FIELD_CLS + " pr-11"} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#71717a] hover:text-white">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && <p className="rounded-[10px] border border-[#ef4444]/20 bg-[#ef4444]/10 px-4 py-3 text-[13px] text-[#fca5a5]">{error}</p>}

        <button type="submit" disabled={loading} className={`mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] px-6 text-[13px] font-medium ${GRADIENT_BTN} disabled:opacity-70`}>
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</> : "Sign In →"}
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
