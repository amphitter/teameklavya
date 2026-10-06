"use client";

/**
 * Waiting-room participant bubbles (Part 4, Phase 2 — spec §9, §10).
 * Framer Motion: bubbles animate into the cluster on join and fade out on
 * leave. Positions are DETERMINISTIC (index-based golden-angle spiral) —
 * no uncontrolled re-shuffles, no random jitter on every render.
 * Visible bubbles are capped (32) with a "+N" overflow chip — animating
 * hundreds of DOM nodes is never allowed (§9).
 */
import { AnimatePresence, motion } from "framer-motion";
import { UserAvatar } from "@/components/user-avatar";
import type { LiveParticipant } from "@/lib/live-protocol";

const MAX_VISIBLE = 32;

/** Deterministic position: golden-angle spiral inside a soft disc. */
function positionOf(index: number) {
  const GOLDEN = 2.399963; // radians
  const radius = 8 + Math.sqrt(index + 0.5) * 13;
  const angle = index * GOLDEN;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius * 0.72),
    scale: 1 - Math.min(0.35, index * 0.02),
  };
}

export function ParticipantBubbles({
  participants,
  meUserId,
}: {
  participants: LiveParticipant[];
  meUserId?: string;
}) {
  const visible = participants.slice(-MAX_VISIBLE);
  const overflow = Math.max(0, participants.length - visible.length);

  return (
    <div className="relative mx-auto flex h-64 w-full max-w-md items-center justify-center" aria-label="Participants in the room">
      {/* soft room disc */}
      <div className="absolute h-56 w-56 rounded-full bg-brand-light/60 blur-2xl" />
      <AnimatePresence>
        {visible.map((p, i) => {
          const pos = positionOf(i);
          const isMe = p.userId === meUserId;
          return (
            <motion.div
              key={p.userId}
              initial={{ opacity: 0, scale: 0.2, x: 0, y: 40 }}
              animate={{ opacity: 1, scale: pos.scale, x: pos.x, y: pos.y }}
              exit={{ opacity: 0, scale: 0.2, transition: { duration: 0.25 } }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              className="absolute z-10"
              title={`${p.displayName}${p.username ? ` (@${p.username})` : ""}${isMe ? " — you" : ""}`}
            >
              <div
                className={
                  isMe
                    ? "rounded-full ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "rounded-full"
                }
              >
                <UserAvatar user={{ _id: p.userId, firstName: p.displayName.split(" ")[0], lastName: p.displayName.split(" ").slice(1).join(" "), profile: p.avatar ? { avatar: p.avatar } : undefined, username: p.username }} size={44} />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {overflow > 0 && (
        <div className="absolute bottom-0 right-4 z-20 flex h-9 items-center rounded-full bg-muted px-3 text-xs font-bold text-muted-foreground">
          +{overflow} more
        </div>
      )}
      {participants.length === 0 && (
        <p className="relative z-10 text-sm text-muted-foreground">Waiting for the first participants…</p>
      )}
    </div>
  );
}
