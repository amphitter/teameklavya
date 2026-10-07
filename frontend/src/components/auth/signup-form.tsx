"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail, User } from "lucide-react";
import { toast } from "sonner";
import { api, API_ORIGIN } from "@/utils/api";
import { AuthSplit, GRADIENT_BTN, FIELD_CLS } from "@/components/auth/auth-split";
import { cn } from "@/lib/utils";

const PASSWORD_RULES = [
  { label: "8+ characters", test: (p: string) => p.length >= 8 },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /[0-9]/.test(p) },
];

/**
 * Signup page — reference design (illustration left, form right;
 * on mobile: illustration + Google/email choice, form appears on tap).
 */
export default function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    acceptTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const set = (key: string, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.acceptTerms) {
      setError("Please accept the Terms & Privacy Policy to continue.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/auth/signup", form);
      if (res.status === 201) {
        toast.success("Account created! Check your email to verify.");
        router.push("/login?registered=1");
      }
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (Array.isArray(err.response?.data?.errors) && err.response.data.errors.length) {
        setError(err.response.data.errors[0].msg || "Please check the form and try again.");
      } else {
        setError(msg || "Signup failed — please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    window.location.href = `${API_ORIGIN}/api/auth/google`;
  };

  return (
    <AuthSplit mode="signup" onGoogle={handleGoogleSignup}>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
          Join EventHub
        </h1>
        <p className="mt-1.5 text-sm font-normal text-[#64709A]">Discover opportunities and build together.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="mb-1.5 block text-xs font-semibold text-slate-700">
              First name
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#64709A]">
                <User className="h-4 w-4" />
              </div>
              <input
                id="firstName"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                placeholder="Devansh"
                required
                autoComplete="given-name"
                className={FIELD_CLS}
              />
            </div>
          </div>
          <div>
            <label htmlFor="lastName" className="mb-1.5 block text-xs font-semibold text-slate-700">
              Last name
            </label>
            <input
              id="lastName"
              value={form.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              placeholder="Singh"
              required
              autoComplete="family-name"
              className="h-12 w-full rounded-xl border border-[#E4E9F4] bg-slate-50/50 px-4 text-sm text-[#0B1235] placeholder-[#64709A]/70 outline-none transition-all focus:border-[#2563FF] focus:bg-white focus:ring-[3px] focus:ring-[#2563FF]/12"
            />
          </div>
        </div>

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
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@example.com"
              required
              autoComplete="email"
              className={FIELD_CLS}
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-slate-700">
            Password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#64709A]">
              <Lock className="h-4 w-4" />
            </div>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="Create a strong password"
              required
              autoComplete="new-password"
              className={FIELD_CLS + " pr-11"}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#64709A] hover:text-slate-700"
              aria-label="Toggle password visibility"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {/* Live password rules */}
          {form.password.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(form.password);
                return (
                  <span
                    key={rule.label}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      ok ? "bg-[#EFF6FF] text-[#2563FF]" : "bg-slate-100 text-[#64709A]"
                    )}
                  >
                    {ok ? "✓" : "•"} {rule.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1.5 block text-xs font-semibold text-slate-700">
            Confirm password
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#64709A]">
              <Lock className="h-4 w-4" />
            </div>
            <input
              id="confirmPassword"
              type={showConfirm ? "text" : "password"}
              value={form.confirmPassword}
              onChange={(e) => set("confirmPassword", e.target.value)}
              placeholder="Repeat your password"
              required
              autoComplete="new-password"
              className={FIELD_CLS + " pr-11"}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((s) => !s)}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#64709A] hover:text-slate-700"
              aria-label="Toggle password visibility"
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#E4E9F4] bg-slate-50/50 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={form.acceptTerms}
            onChange={(e) => set("acceptTerms", e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded accent-[#2563FF]"
          />
          <span className="text-[#64709A]">
            I agree to the <span className="font-medium text-[#0B1235]">Terms of Service</span> and{" "}
            <span className="font-medium text-[#0B1235]">Privacy Policy</span>.
          </span>
        </label>

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
              <Loader2 className="h-4 w-4 animate-spin" /> Creating account…
            </>
          ) : (
            "Create Account →"
          )}
        </button>
      </form>
    </AuthSplit>
  );
}
