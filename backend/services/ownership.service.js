/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · §10  OWNERSHIP & SUPER ADMIN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * The permanent Super Admin was already protected in five separate places, and
 * each of those places re-derived the address by hand:
 *
 *     const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "...").toLowerCase();
 *
 * That is five copies of the same security decision. It works today because all
 * five agree, and it will fail the day one of them is edited — the changed copy
 * becomes either a hole (protecting the wrong address) or a lockout
 * (protecting a stale one). A security rule that is correct by coincidence
 * rather than by construction is not a security rule.
 *
 * So the address and the decision now live here, once, and everywhere else
 * calls in.
 *
 * WHAT "PERMANENT" MEANS, PRECISELY
 * ─────────────────────────────────
 * Super Admin status is derived from an EMAIL CONSTANT, not from the `role`
 * field on the user document. That single choice is what makes the account
 * undemotable: there is no stored flag to flip. Demoting the platform role
 * from 'admin' to 'user' does not remove Super Admin authority, because
 * authority never came from the role field. The only way to lose it is to
 * change the account's email address, which no endpoint permits.
 *
 * The trade-off is deliberate. A role field is flexible and can be edited;
 * a constant is rigid and cannot. For a permanent owner we want rigid.
 *
 * §10 asks for three properties. Stated so they can be tested:
 *
 *   UNDELETABLE     no path deletes the account, removes it as a member,
 *                   or suspends it
 *   UNDEMOTABLE     no path lowers its authority — and because authority is
 *                   derived, there is nothing to lower
 *   UNTRANSFERABLE  no path grants Super Admin to anyone else; the constant
 *                   is the only grant, and it names one address
 *
 * INSTITUTIONAL EMAIL IS NOT OWNERSHIP
 * ────────────────────────────────────
 * A verified `@iitd.ac.in` address proves AFFILIATION — that a person is
 * associated with an institution. It does not prove they own the institution's
 * community, and treating it as proof would hand control of an official
 * community to anyone who has ever had a university mailbox. That is why
 * `isInstitutionOwned()` returns false unconditionally and exists only to make
 * the rule sayable in code: affiliation is a claim a user makes about
 * themselves, ownership is a fact the platform records.
 */

"use strict";

const DEFAULT_SUPER_ADMIN_EMAIL = "devanshsinghr00@gmail.com";

/**
 * The one and only definition of the permanent Super Admin address.
 *
 * The env override exists so a self-hosted deployment can name its own owner.
 * It is NOT a way to add a second Super Admin: the value is a single address,
 * and every grant in the system compares against it.
 */
const SUPER_ADMIN_EMAIL = String(
  process.env.SUPER_ADMIN_EMAIL || DEFAULT_SUPER_ADMIN_EMAIL
)
  .trim()
  .toLowerCase();

/** Case-insensitive comparison — an email's local part is technically case-sensitive. */
function isSuperAdminEmail(email) {
  return Boolean(email) && String(email).trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}

/**
 * Is this user the permanent Super Admin?
 * Accepts a user document, an email string, or nothing.
 */
function isSuperAdminUser(userOrEmail) {
  if (!userOrEmail) return false;
  if (typeof userOrEmail === "string") return isSuperAdminEmail(userOrEmail);
  return isSuperAdminEmail(userOrEmail.email);
}

/* ── Protected actions ─────────────────────────────────────────────────── */

/**
 * The actions §10 forbids against the Super Admin.
 *
 * Listed as data rather than scattered through `if` statements so the audit
 * can enumerate them and assert each one has a guard somewhere in the codebase.
 */
const PROTECTED_ACTIONS = Object.freeze({
  DELETE: "DELETE",
  DEMOTE: "DEMOTE",
  TRANSFER: "TRANSFER",
  SUSPEND: "SUSPEND",
  ROLE_CHANGE: "ROLE_CHANGE",
  REMOVE_MEMBERSHIP: "REMOVE_MEMBERSHIP",
});

const GUARD_MESSAGES = Object.freeze({
  [PROTECTED_ACTIONS.DELETE]: "The Super Admin account cannot be deleted",
  [PROTECTED_ACTIONS.DEMOTE]: "The Super Admin cannot be demoted",
  [PROTECTED_ACTIONS.TRANSFER]: "Super Admin status cannot be transferred",
  [PROTECTED_ACTIONS.SUSPEND]: "The Super Admin cannot be suspended",
  [PROTECTED_ACTIONS.ROLE_CHANGE]: "The Super Admin's role cannot be changed",
  [PROTECTED_ACTIONS.REMOVE_MEMBERSHIP]: "The Super Admin cannot be removed",
});

/**
 * The guard every protected path must call before acting on a target user.
 *
 * @param {object|string} target  user document or email
 * @param {string} action         one of PROTECTED_ACTIONS
 * @returns {{allowed: boolean, reason?: string}}
 *
 * Deliberately returns a result rather than throwing: the callers are
 * controllers that need to answer 403 with a specific message, and a thrown
 * error would either be caught by a generic handler (losing the message) or
 * escape as a 500 (which is a worse outcome than the thing being guarded).
 */
function guardSuperAdmin(target, action) {
  if (!isSuperAdminUser(target)) return { allowed: true };
  return {
    allowed: false,
    reason: GUARD_MESSAGES[action] || "This action is not permitted on the Super Admin",
  };
}

/**
 * True when the actor is the Super Admin acting on ITSELF.
 *
 * Needed because one exception exists: the owner may do things to their own
 * account that nobody may do to it — for example, transfer away a community
 * they created. Refusing self-action would lock the owner out of their own
 * property, which is the opposite of what §10 is protecting.
 */
function isSelfAction(actor, target) {
  if (!actor || !target) return false;
  if (typeof actor === "string" || typeof target === "string") {
    return String(actor) === String(target);
  }
  const a = actor._id || actor.id;
  const t = target._id || target.id;
  return Boolean(a && t && String(a) === String(t));
}

/* ── Institutional affiliation ─────────────────────────────────────────── */

/**
 * The domain part of an address, or null for a malformed one.
 * This is AFFILIATION ONLY — see the file header.
 */
function institutionalDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  if (at <= 0) return null;
  const domain = String(email).slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Does an institutional email confer ownership? NO. Never.
 *
 * Present so the rule can be stated in code and asserted by a test, rather
 * than living as a convention that a future contributor has no way to
 * discover. Ownership is a fact the platform records (a `createdBy` field, an
 * admin membership row); an email domain is a claim a user makes about
 * themselves. Conflating them would let anyone with a university mailbox take
 * an official community.
 */
function isInstitutionOwned() {
  return false;
}

/**
 * The platform's answer to "who owns this?": the recorded creator, or an
 * active admin member. Domain never enters into it.
 */
function resolveOwner(community, adminMembers = []) {
  if (!community) return null;
  if (community.createdBy) return community.createdBy;
  const first = adminMembers.find(
    (m) => m.role === "admin" && m.status === "active"
  );
  return first ? first.user : null;
}

module.exports = {
  SUPER_ADMIN_EMAIL,
  DEFAULT_SUPER_ADMIN_EMAIL,
  isSuperAdminEmail,
  isSuperAdminUser,
  PROTECTED_ACTIONS,
  GUARD_MESSAGES,
  guardSuperAdmin,
  isSelfAction,
  institutionalDomain,
  isInstitutionOwned,
  resolveOwner,
};
