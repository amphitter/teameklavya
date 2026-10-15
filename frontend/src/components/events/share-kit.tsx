"use client";

import { useState } from "react";
import { Link as LinkIcon, QrCode, Download, Share2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface ShareKitProps {
  event: {
    _id: string;
    slug?: string;
    title: string;
    bannerUrl?: string;
    startDate?: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareKit({ event, open, onOpenChange }: ShareKitProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const url = typeof window !== "undefined" ? `${window.location.origin}/events/${event.slug}` : `https://eventhub.app/events/${event.slug}`;
  const icsUrl = `${process.env.NEXT_PUBLIC_API_URL || "https://api.teameklavya.xyz"}/api/events/${event._id}/ics`;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" /> Share kit — {event.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Event link</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 truncate rounded-lg border border-input bg-card px-3 py-2 text-sm">
                {url}
              </div>
              <Button size="sm" variant="outline" onClick={() => copy(url, "url")}>
                {copied === "url" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <a
              href={icsUrl}
              target="_blank"
              rel="noopener"
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-semibold">Calendar .ics</span>
              <span className="text-xs text-muted-foreground">Add to calendar</span>
            </a>
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: event.title, url }).catch(() => {});
                } else {
                  copy(url, "share");
                }
              }}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10">
                <LinkIcon className="h-5 w-5 text-violet-600" />
              </div>
              <span className="text-sm font-semibold">Share link</span>
              <span className="text-xs text-muted-foreground">WhatsApp / Social</span>
            </button>
          </div>

          {event.bannerUrl && (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Poster</p>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.bannerUrl} alt="" className="h-16 w-24 rounded-lg object-cover" />
                <div className="flex-1">
                  <p className="text-sm font-medium truncate">{event.title}</p>
                  <p className="text-xs text-muted-foreground">Use for Instagram / WhatsApp story</p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href={event.bannerUrl} target="_blank" download>
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-primary/5 border border-primary/10 p-3">
            <p className="text-xs font-semibold text-primary mb-1">Organizer tip</p>
            <p className="text-xs text-muted-foreground">
              Share the link + QR + poster to your college groups. One campus with 20+ active organizers beats ten polished features.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
