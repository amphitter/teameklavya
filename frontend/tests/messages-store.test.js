const S = require('./out/store.js');

let pass = 0, fail = 0;
const ok = (c, l, d = "") => { if (c) { pass++; console.log(`  ✅ ${l}`); } else { fail++; console.log(`  ❌ ${l}${d ? ` — ${d}` : ""}`); } };
const sec = (t) => console.log(`\n── ${t} ──`);
const msg = (id, mid, ts, extra = {}) => ({
  _id: id, sender: { _id: mid }, content: `c${id}`, createdAt: new Date(ts).toISOString(), ...extra,
});
const T = (s) => new Date(`2026-10-07T10:00:${String(s).padStart(2,"0")}.000Z`).toISOString();

S.threads.set('t1', { ...S.threads.get('t1'), messages: [], loading: false });

sec('§11 — dedupe: REST response + socket echo of the same message');
S.threads.append('t1', msg('m1','me',T(0)));
ok(S.threads.get('t1').messages.length === 1, 'first append lands');
S.threads.append('t1', msg('m1','me',T(0)));
ok(S.threads.get('t1').messages.length === 1, 'a repeat of the SAME server id does not duplicate');

sec('§11 — dedupe: optimistic row reconciled by clientMessageId');
S.threads.set('t2', { ...S.threads.get('t2'), messages: [], loading: false });
S.threads.append('t2', { ...msg('tmp:abc','me',T(5)), pending: true, clientMessageId: 'abc' });
ok(S.threads.get('t2').messages.length === 1, 'optimistic row shows immediately');
S.threads.append('t2', { ...msg('srv9','me',T(5)), clientMessageId: 'abc' });
const t2 = S.threads.get('t2').messages;
ok(t2.length === 1, 'the server row REPLACES the optimistic row (not a second bubble)', `got ${t2.length}`);
ok(t2[0]._id === 'srv9', 'the row now carries the server id');
ok(t2[0].pending === false, 'pending clears on reconcile');

sec('§12 — out-of-order delivery must NOT lose a message (regression)');
S.threads.set('t3', { ...S.threads.get('t3'), messages: [], loading: false });
S.threads.append('t3', msg('peer','them',T(10)));            // peer sent first
S.threads.append('t3', { ...msg('tmp:z','me',T(12)), pending: true, clientMessageId: 'z' }); // I reply 2s later, optimistically
S.threads.append('t3', msg('mine','me',T(12)));              // my server echo
S.threads.append('t3', msg('late','them',T(11)));            // a peer message that arrives late, timestamped between
const t3 = S.threads.get('t3').messages.map((m) => m._id);
ok(t3.includes('late'), 'a late-arriving message is inserted, not dropped', t3.join(','));
ok(t3.indexOf('peer') < t3.indexOf('late'), 'and it lands in timestamp order (peer → late)');
ok(t3.indexOf('late') < t3.indexOf('mine'), 'and before the later message');

sec('§5 — prepend dedupes against what is already held');
S.threads.set('t4', { ...S.threads.get('t4'), messages: [], loading: false });
S.threads.append('t4', msg('n3','them',T(3)));
S.threads.prepend('t4', [msg('n1','them',T(1)), msg('n2','them',T(2)), msg('n3','them',T(3))]);
const t4 = S.threads.get('t4').messages.map((m) => m._id);
ok(t4.length === 3, 'overlapping older page does not duplicate', t4.join(','));
ok(t4[0] === 'n1', 'older messages go to the FRONT');

sec('§10 — a refetch must not drop an in-flight optimistic message');
S.threads.set('t5', { ...S.threads.get('t5'), messages: [], loading: false });
S.threads.append('t5', { ...msg('tmp:p','me',T(20)), pending: true, clientMessageId: 'p' });
S.threads.replace('t5', [msg('s1','them',T(1))], { loading: false });
const t5 = S.threads.get('t5').messages.map((m) => m._id);
ok(t5.includes('tmp:p'), 'the pending row survives a refetch (the old poll lost it)', t5.join(','));

sec('§10 — a refetch DOES drop a pending row once the server has it');
S.threads.set('t6', { ...S.threads.get('t6'), messages: [], loading: false });
S.threads.append('t6', { ...msg('tmp:q','me',T(21)), pending: true, clientMessageId: 'q' });
S.threads.replace('t6', [{ ...msg('s7','me',T(21)), clientMessageId: 'q' }], {});
ok(S.threads.get('t6').messages.length === 1, 'only the server row remains', `got ${S.threads.get('t6').messages.length}`);
ok(S.threads.get('t6').messages[0]._id === 's7', 'and it is the server one');

sec('§12 — slices are replaced per key, so an unrelated write cannot wake a thread');
let woke = 0;
const unsub = S.subscribeSlice(S.threads.key('t4'), () => { woke++; });
S.threads.append('t5', msg('other','them',T(30)));
ok(woke === 0, 'writing thread t5 does NOT notify a t4 subscriber');
S.threads.append('t4', msg('n4','them',T(4)));
ok(woke === 1, 'writing t4 notifies it once');
unsub();

sec('§24 — archive moves a row between views');
S.inbox.merge(false, [{ _id: 'c1', other: { _id: 'u' }, lastMessage: null, updatedAt: T(1), unreadCount: 0, archived: false }], false);
S.inbox.move('c1', true);
ok(S.inbox.get(false).length === 0, 'the row left the inbox');
ok(S.inbox.get(true).length === 1 && S.inbox.get(true)[0].archived === true, 'and arrived in the archive');

sec('§24 — unread counts are tracked separately per view');
S.unread.set({ inbox: 0, archived: 0 });
S.unread.bump(true, 3);
ok(S.unread.get().archived === 3, 'archived unread increments');
ok(S.unread.get().inbox === 0, 'and the inbox badge is untouched');
S.unread.bump(false, 2);
ok(S.unread.get().inbox === 2, 'inbox unread increments');
S.unread.clear(true);
ok(S.unread.get().archived === 0 && S.unread.get().inbox === 2, 'clearing the archive leaves inbox intact');

sec('§10 — patchMessage never invents a row');
S.threads.patchMessage('t4', 'ghost', { content: 'x' });
ok(S.threads.get('t4').messages.every((m) => m._id !== 'ghost'), 'patching an unknown id is a no-op');

sec('Part 11 §4 — presence is per user, and an unchanged state does not churn');
S.presence.set('u1', { online: true, lastSeenAt: null });
ok(S.presence.get('u1').online === true, 'a user can be marked active');
const before = S.presence.get('u1');
S.presence.set('u1', { online: true, lastSeenAt: null });
ok(S.presence.get('u1') === before, 'repeating the SAME state keeps the slice reference (no re-render)');
S.presence.set('u1', { online: false, lastSeenAt: T(30) });
ok(S.presence.get('u1').online === false && S.presence.get('u1').lastSeenAt === T(30), 'going offline records the last-seen moment');
ok(S.presence.get('u2') === null, 'another user is untouched by it');

sec('Part 11 §4 — a conversation list seeds presence, teams have none');
S.presence.seed([
  { _id: 'c9', other: { _id: 'u3' }, presence: { online: true, lastSeenAt: null }, lastMessage: null, updatedAt: T(0), unreadCount: 0 },
  { _id: 'c10', type: 'team', other: null, presence: { online: true, lastSeenAt: null }, lastMessage: null, updatedAt: T(0), unreadCount: 0 },
]);
ok(S.presence.get('u3')?.online === true, 'a direct row seeds its peer');
ok(S.presence.get('undefined') === null, 'a team row seeds nobody (presence is meaningless for a roster)');

sec('Part 11 §3 — typing is tracked per user, so a team can show several at once');
S.threads.set('t9', { ...S.threads.get('t9'), messages: [], typing: {} });
S.threads.typing('t9', 'a', 500);
ok(S.threads.get('t9').typing.a === 500, 'the first peer is recorded');
S.threads.typing('t9', 'b', 600);
ok(Object.keys(S.threads.get('t9').typing).length === 2, 'a second peer is recorded alongside, not instead');
S.threads.typing('t9', 'a', 0);
ok(S.threads.get('t9').typing.a === undefined, 'one peer stopping removes only their entry');
ok(S.threads.get('t9').typing.b === 600, 'the other peer is STILL typing (regression: a shared timer cancelled it)');
const typingRef = S.threads.get('t9').typing;
S.threads.typing('t9', 'zz', 0);
ok(S.threads.get('t9').typing === typingRef, 'clearing someone who was never typing does not touch the slice');

sec('Part 11 §5 — teams are rows like any other, and leaving drops the row');
S.inbox.set(false, [
  { _id: 'd1', type: 'direct', other: { _id: 'p1' }, lastMessage: null, updatedAt: T(0), unreadCount: 0 },
  { _id: 'tm1', type: 'team', name: 'Robotics', memberCount: 4, other: null, lastMessage: { text: 'hi', at: T(1), mine: false, senderName: 'Ben' }, updatedAt: T(1), unreadCount: 0 },
]);
ok(S.inbox.get(false).filter((r) => r.type === 'team').length === 1, 'a team lives in the same list as a direct chat');
ok(S.inbox.get(false)[1].lastMessage.senderName === 'Ben', 'a team row carries WHO spoke');
S.inbox.remove('tm1');
ok(S.inbox.get(false).length === 1 && S.inbox.get(false)[0]._id === 'd1', 'leaving a team removes exactly that row');
S.inbox.remove('tm1');
ok(S.inbox.get(false).length === 1, 'removing it twice is a no-op');

console.log(`\n${"═".repeat(52)}\n  MESSAGES STORE: ${pass} passed, ${fail} failed\n${"═".repeat(52)}`);
process.exit(fail ? 1 : 0);
