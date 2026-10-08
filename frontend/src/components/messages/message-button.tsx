"use client";

/**
 * MessageButton — THE way to start (or open) a direct conversation (§71–§75).
 *
 * Why this component exists
 * -------------------------
 * The old profile button navigated to `/messages?with=<id>` and left the
 * Messages page to create the conversation. Three things fell out of that:
 *
 *  1. the failure happened *after* navigation, on the inbox, so the profile
 *     looked like it had done nothing;
 *  2. the inbox discarded the resolver's error, so a genuine refusal (blocked,
 *     "doesn't accept messages", unknown user) was invisible;
 *  3. the button had no pending state, so an impatient second tap started a
 *     second request.
 *
 * Now the conversation is resolved here, before any navigation, through
 * `useStartConversation` — one request, collapsed duplicates, the server's own
 * message on failure, and a direct push to the thread on success.
 *
 * The pending label is part of the contract, not decoration: "Opening…" tells
 * the user the tap registered, which is exactly the feedback the old flow was
 * missing.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStartConversation } from "@/hooks/use-messages";
import { cn } from "@/lib/utils";

interface MessageButtonProps {
  /** The person to talk to. */
  userId?: string | null;
  /** Their display name, for the pending label and error copy. */
  name?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline";
  className?: string;
  /** Compact icon-only form (message search rows, sticky mobile actions). */
  iconOnly?: boolean;
  /** Where the inline error goes: under the button (default) or reported up. */
  onError?: (message: string) => void;
  /** Called instead of routing, when the caller wants to handle navigation. */
  onStarted?: (conversationId: string) => void;
}

export function MessageButton({
  userId,
  name,
  size = "sm",
  variant = "outline",
  className,
  iconOnly = false,
  onError,
  onStarted,
}: MessageButtonProps) {
  const router = useRouter();
  const { start, isPending, error, clearError } = useStartConversation();
  const pending = Boolean(userId) && isPending(String(userId));
  const failed = error && error.userId === String(userId);
  const label = name?.split(" ")[0] || "them";

  const onClick = async () => {
    if (!userId || pending) return;
    clearError();
    const id = await start(String(userId));
    if (!id) return; // the hook owns the error copy
    if (onStarted) onStarted(id);
  };

  /* Surface the real reason once, as a toast, AND keep it inline — a toast is
     easy to miss on a long profile page, and an inline line is easy to miss if
     the button is scrolled past. Both carry the server's own message, so a
     refusal ("this user doesn't accept messages") reads as a reason rather
     than as a broken button. */
  const message = failed ? error!.message : null;
  useEffect(() => {
    if (!message) return;
    if (typeof onError === "function") onError(message);
    else toast.error(message);
  }, [message, onError]);

  return (
    <span className={cn("inline-flex flex-col items-stretch gap-1", className)}>
      <Button
        size={size}
        variant={variant}
        onClick={onClick}
        disabled={!userId || pending}
        aria-busy={pending}
        aria-label={iconOnly ? `Message ${name || "this person"}` : undefined}
        className="gap-1.5"
        data-testid="message-button"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
        {!iconOnly && (pending ? "Opening…" : "Message")}
      </Button>
      {failed && (
        <span role="alert" className="max-w-[16rem] text-left text-[11px] leading-snug text-destructive">
          {error!.message}{" "}
          <button
            type="button"
            onClick={onClick}
            className="font-semibold underline underline-offset-2"
            data-testid="message-button-retry"
          >
            Try again
          </button>
        </span>
      )}
      {/* Kept out of the a11y tree: it only exists to read the peer's name. */}
      <span className="sr-only">{`Start a conversation with ${label}`}</span>
    </span>
  );
}

/** Convenience: open an existing conversation by id (notifications, rows). */
export function useOpenConversation() {
  const router = useRouter();
  return (conversationId: string) => router.push(`/messages/${conversationId}`);
}
