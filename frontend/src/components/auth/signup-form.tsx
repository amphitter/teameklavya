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
  { label: "Uppercase", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /[0-9]/.test(p) },
];

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

  const setVal = (key: string, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.acceptTerms) {
      setError("Please accept the Terms & Privacy Policy.");
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
        setError(err.response.data.errors[0].msg || "Check form.");
      } else {
        setError(msg || "Signup failed.");
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
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Join EventHub</h1>
        <p className="mt-1 text-[13px] text-[#71717a]">Discover opportunities and build together.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[#a1a1aa]">First name</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#71717a]">
                <User className="h-4 w-4" />
              </div>
              <input value={form.firstName} onChange={(e) => setVal("firstName", e.target.value)} placeholder="Devansh" required autoComplete="given-name" className={FIELD_CLS} />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[#a1a1aa]">Last name</label>
            <input value={form.lastName} onChange={(e) => setVal("lastName", e.target.value)} placeholder="Singh" required autoComplete="family-name" className="h-11 w-full rounded-[10px] border border-[#232326] bg-[#18181b] px-4 text-[13px] text-white placeholder:text-[#71717a] outline-none focus:border-[#3b82f6]/50" />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[#a1a1aa]">Email</label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#71717a]">
              <Mail className="h-4 w-4" />
            </div>
            <input type="email" value={form.email} onChange={(e) => setVal("email", e.target.value)} placeholder="name@example.com" required autoComplete="email" className={FIELD_CLS} />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[#a1a1aa]">Password</label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#71717a]">
              <Lock className="h-4 w-4" />
            </div>
            <input type={showPassword ? "text" : "password"} value={form.password} onChange={(e) => setVal("password", e.target.value)} placeholder="Create a strong password" required autoComplete="new-password" className={FIELD_CLS + " pr-11"} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#71717a] hover:text-white">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.password.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-2">
              {PASSWORD_RULES.map((rule) => {
                const ok = rule.test(form.password);
                return (
                  <span key={rule.label} className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", ok ? "bg-[#3b82f6]/15 text-[#93c5fd]" : "bg-[#1f1f23] text-[#71717a]")}>
                    {ok ? "✓" : "•"} {rule.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[#a1a1aa]">Confirm password</label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#71717a]">
              <Lock className="h-4 w-4" />
            </div>
            <input type={showConfirm ? "text" : "password"} value={form.confirmPassword} onChange={(e) => setVal("confirmPassword", e.target.value)} placeholder="Repeat password" required autoComplete="new-password" className={FIELD_CLS + " pr-11"} />
            <button type="button" onClick={() => setShowConfirm((s) => !s)} className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#71717a] hover:text-white">
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[#232326] bg-[#18181b] px-4 py-3 text-[13px]">
          <input type="checkbox" checked={form.acceptTerms} onChange={(e) => setVal("acceptTerms", e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-[#3b82f6]" />
          <span className="text-[#71717a]">I agree to the <span className="font-medium text-white">Terms</span> and <span className="font-medium text-white">Privacy Policy</span>.</span>
        </label>

        {error && <p className="rounded-[10px] border border-[#ef4444]/20 bg-[#ef4444]/10 px-4 py-3 text-[13px] text-[#fca5a5]">{error}</p>}

        <button type="submit" disabled={loading} className={`mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] px-6 text-[13px] font-medium ${GRADIENT_BTN} disabled:opacity-70`}>
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : "Create Account →"}
        </button>
      </form>
    </AuthSplit>
  );
}
