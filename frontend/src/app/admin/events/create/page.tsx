"use client";

import Link from "next/link";
import EventForm from "@/components/admin/event-form";
import { ChevronLeft } from "lucide-react";

export default function CreateEventPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Back to events
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Create a new event</h1>
        <p className="text-sm text-muted-foreground">
          Fill in the details below — you can always edit them later. It takes about 3 minutes.
        </p>
      </div>

      <EventForm mode="create" />
    </div>
  );
}
