"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api } from "@/utils/api";
import EventForm from "@/components/admin/event-form";
import { ErrorState, PageLoader } from "@/components/states";

interface OrganizationData {
  _id: string;
  name: string;
  slug: string;
  handle?: string;
  canManageEvents?: boolean;
}

export default function OrganizationCreateEventPage() {
  const { slug } = useParams<{ slug: string }>();
  const [organization, setOrganization] = useState<OrganizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/organizations/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (cancelled) return;
        const org = res.data?.organization;
        if (!org?._id) throw new Error("Organization not found");
        if (!org.canManageEvents) throw new Error("You can't create events for this organization");
        setOrganization(org);
      })
      .catch((err: any) => !cancelled && setError(err.response?.data?.message || err.message || "Failed to load organization"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) return <PageLoader label="Preparing event form…" />;
  if (error || !organization) return <ErrorState title="Event creation unavailable" description={error || "Organization not found"} />;

  const handle = organization.handle || organization.slug;
  const returnTo = `/organizations/${encodeURIComponent(handle)}/events/manage`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div>
        <Link href={returnTo} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to event management
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground">Create an event for {organization.name}</h1>
        <p className="text-sm text-muted-foreground">The owner will be set explicitly to this organization. Existing events are not transferred.</p>
      </div>
      <EventForm
        mode="create"
        ownerOrganization={{ _id: organization._id, name: organization.name, slug: handle }}
        returnTo={returnTo}
      />
    </div>
  );
}
