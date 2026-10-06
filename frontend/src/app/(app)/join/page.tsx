"use client";

/**
 * Join by code (Part 4, Phase 2 — spec §5).
 * The code only RESOLVES to the event; eligibility is validated by the
 * realtime engine when the participant actually joins.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, Radio } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";
import { useSessionUser } from "@/components/shell/use-session-user";

export default function JoinByCodePage() {
  const router = useRouter();
  const { user, ready } = useSessionUser();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.post("/events/join-by-code", { code });
      if (res.data?.success && res.data.event?.slug) {
        router.push(`/events/${res.data.event.slug}/live`);
      } else {
        toast.error(res.data?.message || "Couldn't resolve code");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't resolve code");
    } finally {
      setBusy(false);
    }
  };

  if (ready && !user) {
    return (
      <div className="mx-auto max-w-md px-3 py-16">
        <EmptyState icon={Radio} title="Sign in to join" description="Enter your event's join code after signing in." />
        <div className="mt-4 flex justify-center">
          <Button asChild>
            <Link href="/login?returnUrl=%2Fjoin">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-3 py-14 sm:py-20">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-light">
          <Radio className="h-6 w-6 text-primary" />
        </div>
        <h1 className="mt-4 text-xl font-extrabold tracking-tight text-foreground">Join a live event</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the join code shown on the event screen.</p>
      </div>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="HCF30"
          maxLength={12}
          aria-label="Join code"
          className="h-14 w-full rounded-2xl border border-input bg-background px-4 text-center font-mono text-2xl font-extrabold tracking-[0.3em] uppercase outline-none placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
        />
        <Button type="submit" size="lg" disabled={code.trim().length < 4 || busy} className="w-full gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Join event
        </Button>
      </form>
    </div>
  );
}
