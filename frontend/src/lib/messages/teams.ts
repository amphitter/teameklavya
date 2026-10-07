"use client";

/**
 * Teams (Part 11 §5) — the API surface, in one place.
 *
 * "Team", never "group": the product has no group concept anywhere the user
 * can see or read. These are the five endpoints the backend exposes, and
 * every one of them re-validates membership server-side — nothing here is
 * trusted, so these functions stay thin on purpose.
 *
 *   POST   /messages/teams                    create
 *   GET    /messages/teams/:id/members        roster + my role
 *   POST   /messages/teams/:id/members        add
 *   DELETE /messages/teams/:id/members/:user  remove (self = leave)
 *   PATCH  /messages/teams/:id                rename / avatar
 */

import { api } from "@/utils/api";
import { inbox, threads, type ConversationRow, type TeamMember } from "./store";

export interface TeamSummary {
  _id: string;
  name: string;
  avatar?: string | null;
  type: "team";
  memberCount: number;
  myRole: "owner" | "admin" | "member";
}

export interface TeamRoster {
  members: TeamMember[];
  myRole: "owner" | "admin" | "member";
}

/** Create a team. The creator is always the owner. */
export async function createTeam(name: string, memberIds: string[]) {
  const r = await api.post("/messages/teams", { name, memberIds });
  const team = r.data?.team as TeamSummary | undefined;
  const conversationId = r.data?.conversationId as string | undefined;
  if (!conversationId || !team) throw new Error("Team was not created");
  return { conversationId, team };
}

export async function fetchTeamRoster(conversationId: string): Promise<TeamRoster> {
  const r = await api.get(`/messages/teams/${conversationId}/members`);
  return {
    members: (r.data?.members || []) as TeamMember[],
    myRole: (r.data?.myRole || "member") as TeamRoster["myRole"],
  };
}

export async function addTeamMembers(conversationId: string, userIds: string[]) {
  const r = await api.post(`/messages/teams/${conversationId}/members`, { userIds });
  return { added: Number(r.data?.added || 0), members: (r.data?.members || []) as TeamMember[] };
}

/** Leaving is removing yourself; the server allows that for every member. */
export async function removeTeamMember(conversationId: string, userId: string) {
  const r = await api.delete(`/messages/teams/${conversationId}/members/${userId}`);
  return { left: Boolean(r.data?.left) };
}

export async function renameTeam(conversationId: string, name: string) {
  const r = await api.patch(`/messages/teams/${conversationId}`, { name });
  return r.data?.team as TeamSummary | undefined;
}

/**
 * After creating (or being added to) a team, put it in the inbox straight
 * away so the list and the header are consistent before the next fetch —
 * and never with invented data: every field comes from the server response.
 */
export function seedTeamRow(
  conversationId: string,
  team: { name: string; memberCount?: number; avatar?: string | null },
  members?: TeamMember[]
) {
  const existing = inbox.get(false).find((r) => r._id === conversationId);
  if (existing) {
    inbox.patch(conversationId, {
      type: "team",
      name: team.name,
      memberCount: team.memberCount ?? existing.memberCount ?? null,
    });
    return;
  }
  const row: ConversationRow = {
    _id: conversationId,
    type: "team",
    other: null,
    name: team.name,
    avatar: team.avatar ?? null,
    memberCount: team.memberCount ?? (members ? members.length : null),
    presence: null,
    lastMessage: null,
    updatedAt: new Date().toISOString(),
    unreadCount: 0,
  };
  inbox.upsert(false, row);
}

/** Keep the open thread's roster in step after any membership change. */
export function syncThreadRoster(
  conversationId: string,
  members: TeamMember[],
  myRole?: TeamRoster["myRole"]
) {
  const patch: Record<string, unknown> = { members };
  if (myRole) patch.myRole = myRole;
  threads.update(conversationId, patch);
}
