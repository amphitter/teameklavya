"use client";

/**
 * Create a team (Part 11 §5)
 * ──────────────────────────
 * "GROUPS NHI, TEAMS HONGI" — a team is a named conversation with a roster
 * you build from your followers, the people you follow, or anyone on the app.
 * Every label in here says team; nothing says group.
 *
 * Flow (one screen, phone-first):
 *   1. name it
 *   2. pick members (default: the people who follow you — the most likely set)
 *   3. create → land straight in the new thread
 *
 * The API is the only source of truth: the row we insert into the inbox comes
 * from the create response, not from a guess about what the server would say.
 */

import { useCallback, useMemo, useState } from "react";
import { Loader2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useSessionUser } from "@/components/shell/use-session-user";
import { MemberPicker } from "@/components/messages/member-picker";
import { createTeam, seedTeamRow } from "@/lib/messages/teams";
import { SHEET_FOOTER_PADDING, useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";

const NAME_MAX = 80;

interface PickedUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string };
}

export interface TeamCreateSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new conversation id so the caller can navigate into it. */
  onCreated: (conversationId: string) => void;
}

export function TeamCreateSheet({ open, onClose, onCreated }: TeamCreateSheetProps) {
  const { user } = useSessionUser();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<PickedUser[]>([]);
  const [busy, setBusy] = useState(false);
  /* Keeps "Create team" above the phone keyboard instead of under it.
     The ref is the sheet ROOT — see the note there. */
  const panelRef = useKeyboardInset<HTMLDivElement>();

  const reset = useCallback(() => {
    setName("");
    setSelected([]);
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, onClose, reset]);

  const trimmed = name.trim();
  const canCreate = trimmed.length > 0 && selected.length >= 1 && !busy;

  const memberIds = useMemo(() => selected.map((u) => String(u._id)), [selected]);

  const submit = useCallback(async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const { conversationId, team } = await createTeam(trimmed, memberIds);
      // Paint the row immediately from the server's own summary, so the inbox
      // behind the sheet is already correct when it closes.
      seedTeamRow(conversationId, team);
      toast.success(`${team.name} created`);
      reset();
      onCreated(conversationId);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Couldn't create the team";
      toast.error(msg);
      setBusy(false);
    }
  }, [canCreate, memberIds, onCreated, reset, trimmed]);

  if (!open) return null;

  return (
    /* The keyboard/safe-area inset goes on the ROOT, not the footer. Padding
       the footer does nothing: the panel is `h-full` of a full-viewport
       overlay, so it still extends under the keyboard and the footer still
       sits behind it. Padding the root shrinks the content box the panel
       measures itself against, which is what actually lifts the footer. */
    <div
      ref={panelRef}
      style={{ paddingBottom: SHEET_FOOTER_PADDING }}
      className="fixed inset-0 z-[80] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Create a team"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(11,18,53,0.45)] backdrop-blur-[6px] animate-fade-in"
        onClick={close}
        aria-label="Close"
      />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface-container-lowest elevation-float animate-sheet-up sm:rounded-l-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-light text-primary">
            <Users className="h-4.5 w-4.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold leading-tight text-on-surface">New team</h2>
            <p className="truncate text-[11px] leading-tight text-on-surface-variant">
              Add people you follow, your followers, or anyone on EventHub
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Name */}
        <div className="shrink-0 border-b border-outline-variant px-4 py-3">
          <label htmlFor="team-name" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Team name
          </label>
          <input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
            placeholder="e.g. Robotics Club Core"
            autoComplete="off"
            enterKeyHint="done"
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container px-3 text-base outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary sm:text-[15px]"
          />
          {!trimmed ? (
            <p className="mt-1 text-[11px] text-on-surface-variant">A name is required.</p>
          ) : selected.length === 0 ? (
            <p className="mt-1 text-[11px] text-on-surface-variant">Add at least one person.</p>
          ) : (
            <p className="mt-1 text-[11px] text-on-surface-variant">
              {selected.length + 1} in this team once you create it.
            </p>
          )}
        </div>

        {/* Members */}
        <MemberPicker meId={user?._id} selected={selected} onChange={setSelected} busy={busy} />

        {/* Footer — the one primary action, and it stays above the keyboard. */}
        <div className="shrink-0 border-t border-outline-variant px-4 py-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canCreate}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold text-white transition-opacity",
              canCreate ? "bg-primary active:opacity-90" : "bg-primary/40"
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "Creating team…" : "Create team"}
          </button>
        </div>
      </div>
    </div>
  );
}
