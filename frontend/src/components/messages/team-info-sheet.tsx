"use client";

/**
 * Team info (Part 11 §5)
 * ──────────────────────
 * The roster, and the three things a member can actually do with it:
 *   • add people  (owner / admin)  — from followers, following, anyone
 *   • remove people (owner / admin) — never the owner (the API enforces it)
 *   • leave        (anyone)
 *
 * The sheet reflects the SERVER's role (`myRole`) rather than guessing, and
 * every mutation re-reads the roster so the list cannot drift from reality.
 */

import { useCallback, useEffect, useState } from "react";
import { Crown, Loader2, LogOut, Shield, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useSessionUser } from "@/components/shell/use-session-user";
import { MemberPicker } from "@/components/messages/member-picker";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import {
  addTeamMembers,
  fetchTeamRoster,
  removeTeamMember,
  renameTeam,
  syncThreadRoster,
} from "@/lib/messages/teams";
import type { TeamMember } from "@/lib/messages/store";
import { SHEET_FOOTER_PADDING, useKeyboardInset } from "@/hooks/use-keyboard-inset";

interface PickedUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string };
}

export interface TeamInfoSheetProps {
  open: boolean;
  conversationId: string | null;
  name: string | null;
  onClose: () => void;
  /** Called after the user leaves, so the caller can return to the inbox. */
  onLeft: () => void;
}

export function TeamInfoSheet({ open, conversationId, name, onClose, onLeft }: TeamInfoSheetProps) {
  const { user } = useSessionUser();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myRole, setMyRole] = useState<"owner" | "admin" | "member">("member");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<PickedUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState(name || "");
  const [editingName, setEditingName] = useState(false);
  /* The add-people footer and the leave action must clear the phone keyboard
     and the home indicator, both of which sit over a full-height panel. */
  const panelRef = useKeyboardInset<HTMLDivElement>();

  const canManage = myRole === "owner" || myRole === "admin";

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const roster = await fetchTeamRoster(conversationId);
      setMembers(roster.members);
      setMyRole(roster.myRole);
      syncThreadRoster(conversationId, roster.members, roster.myRole);
    } catch {
      toast.error("Couldn't load this team");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) {
      setAdding(false);
      setPicked([]);
      return;
    }
    setTeamName(name || "");
    void load();
  }, [open, load, name]);

  const add = useCallback(async () => {
    if (!conversationId || !picked.length) return;
    setBusy(true);
    try {
      const { added } = await addTeamMembers(conversationId, picked.map((u) => String(u._id)));
      toast.success(added === 1 ? "1 person added" : `${added} people added`);
      setPicked([]);
      setAdding(false);
      await load();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Couldn't add them";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [conversationId, load, picked]);

  const remove = useCallback(
    async (userId: string) => {
      if (!conversationId) return;
      setBusy(true);
      try {
        await removeTeamMember(conversationId, userId);
        setMembers((prev) => prev.filter((m) => String(m._id) !== String(userId)));
        await load();
      } catch {
        toast.error("Couldn't remove them");
      } finally {
        setBusy(false);
      }
    },
    [conversationId, load]
  );

  const leave = useCallback(async () => {
    if (!conversationId || !user?._id) return;
    if (!window.confirm("Leave this team? You will stop receiving its messages.")) return;
    setBusy(true);
    try {
      await removeTeamMember(conversationId, String(user._id));
      toast.success("You left the team");
      onLeft();
    } catch {
      toast.error("Couldn't leave the team");
      setBusy(false);
    }
  }, [conversationId, onLeft, user?._id]);

  const saveName = useCallback(async () => {
    if (!conversationId) return;
    const next = teamName.trim();
    if (!next) return;
    setBusy(true);
    try {
      const team = await renameTeam(conversationId, next);
      if (team?.name) setTeamName(team.name);
      setEditingName(false);
      toast.success("Team renamed");
    } catch {
      toast.error("Couldn't rename the team");
    } finally {
      setBusy(false);
    }
  }, [conversationId, teamName]);

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
      aria-label="Team info"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(11,18,53,0.45)] backdrop-blur-[6px] animate-fade-in"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface-container-lowest elevation-float animate-sheet-up sm:rounded-l-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold leading-tight text-on-surface">Team info</h2>
            <p className="truncate text-[11px] leading-tight text-on-surface-variant">
              {members.length} {members.length === 1 ? "member" : "members"}
              {myRole === "owner" ? " · you own this team" : myRole === "admin" ? " · you're an admin" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Name */}
          <div className="border-b border-outline-variant px-4 py-3">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value.slice(0, 80))}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container px-3 text-base outline-none focus-visible:border-primary sm:text-[14px]"
                  aria-label="Team name"
                />
                <button
                  type="button"
                  onClick={() => void saveName()}
                  disabled={busy || !teamName.trim()}
                  className="h-10 shrink-0 rounded-full bg-primary px-4 text-[13px] font-semibold text-white disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!canManage}
                onClick={() => canManage && setEditingName(true)}
                className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
              >
                <span className="truncate text-[15px] font-semibold text-on-surface">{teamName || "Team"}</span>
                {canManage ? <span className="shrink-0 text-[12px] font-semibold text-primary">Rename</span> : null}
              </button>
            )}
          </div>

          {/* Members */}
          <div className="px-2 py-2">
            <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Members
            </p>
            {loading && !members.length ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-on-surface-variant">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
              </div>
            ) : !members.length ? (
              <p className="px-3 py-4 text-[13px] text-on-surface-variant">No members to show.</p>
            ) : (
              <ul>
                {members.map((m) => {
                  const isMe = String(m._id) === String(user?._id);
                  const role = roleOf(m);
                  return (
                    <li key={m._id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                      <UserAvatar user={m} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold text-on-surface">
                          <span className="truncate">{`${m.firstName || ""} ${m.lastName || ""}`.trim() || "Member"}</span>
                          {role === "owner" ? (
                            <Crown className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Owner" />
                          ) : role === "admin" ? (
                            <Shield className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Admin" />
                          ) : null}
                          {isMe ? <span className="shrink-0 text-[11px] font-normal text-on-surface-variant">· you</span> : null}
                        </p>
                        {m.username ? (
                          <Link href={`/profile/${m.username}`} className="block truncate text-[12px] text-on-surface-variant">
                            @{m.username}
                          </Link>
                        ) : null}
                      </div>
                      {canManage && !isMe && role !== "owner" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(m._id)}
                          className="shrink-0 rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Add people */}
          {canManage ? (
            adding ? (
              <div className="flex min-h-0 flex-col border-t border-outline-variant">
                <MemberPicker
                  meId={user?._id}
                  lockedIds={members.map((m) => String(m._id))}
                  selected={picked}
                  onChange={setPicked}
                  busy={busy}
                />
                <div className="flex shrink-0 gap-2 border-t border-outline-variant px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setPicked([]);
                    }}
                    className="h-11 flex-1 rounded-full border border-outline-variant text-[14px] font-semibold text-on-surface"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void add()}
                    disabled={!picked.length || busy}
                    className={cn(
                      "flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-semibold text-white",
                      picked.length && !busy ? "bg-primary" : "bg-primary/40"
                    )}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Add {picked.length || ""}
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-outline-variant px-4 py-3">
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-outline-variant text-[14px] font-semibold text-on-surface active:bg-surface-container"
                >
                  <UserPlus className="h-4 w-4" aria-hidden /> Add people
                </button>
              </div>
            )
          ) : null}

          {/* Leave */}
          <div className="border-t border-outline-variant px-4 py-3">
            <button
              type="button"
              onClick={() => void leave()}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-semibold text-destructive active:bg-destructive/10 disabled:opacity-40"
            >
              <LogOut className="h-4 w-4" aria-hidden /> Leave team
            </button>
            <p className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-on-surface-variant">
              <Users className="h-3 w-3" aria-hidden /> Messages you already sent stay in the team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The role comes from the API, which marks every member. Never inferred from
 * list position: sorting is a display concern and a badge that depends on it
 * would be wrong the first time the order changed.
 */
function roleOf(m: TeamMember): "owner" | "admin" | "member" {
  return m.role === "owner" || m.role === "admin" ? m.role : "member";
}
