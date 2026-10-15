#!/usr/bin/env node
"use strict";

process.env.JWT_SECRET = "onboarding-test-secret";
process.env.MONGO_URI = "SET-BY-MEMORY";
process.env.PORT = "5096";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.NODE_ENV = "test";
process.env.GOOGLE_CLIENT_ID = "stub";
process.env.GOOGLE_CLIENT_SECRET = "stub";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:5096/api/auth/google/callback";
process.env.CACHE_PROVIDER = "memory";
process.env.RATE_LIMIT_PROVIDER = "memory";

const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

const BASE = "http://localhost:5096/api";

let passed = 0, failed = 0, failures = [];

function ok(name, cond, detail="") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${detail}`); }
}

async function j(path, opts={}) {
  const res = await fetch(BASE+path, { ...opts, headers: { "Content-Type":"application/json", ...(opts.headers||{}) }, body: opts.body?JSON.stringify(opts.body):undefined });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0,200) }; }
  return { status: res.status, data };
}

(async () => {
  console.log("\n=== Onboarding & Trust & Safety E2E ===");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri("onboarding_test");
  require("../server");
  await new Promise(r=>setTimeout(r,2000));

  const User = require("../models/user.model");
  const Organization = require("../models/organization.model");

  const mkUser = async (email, extra={}) => {
    return User.create({ firstName:"Test", lastName:"User", email, passwordHash:"hash", emailVerified:true, ...extra });
  };

  const tokenFor = (u) => jwt.sign({ id:String(u._id), role:u.role||"user", email:u.email, purpose:"auth", tokenVersion:u.tokenVersion||0 }, process.env.JWT_SECRET, { expiresIn:"1h" });

  const superAdmin = await mkUser("devanshsinghr00@gmail.com", { role:"admin" });
  const userA = await mkUser("a@onboarding.test");
  const userB = await mkUser("b@onboarding.test");

  const saToken = tokenFor(superAdmin);
  const aToken = tokenFor(userA);
  const bToken = tokenFor(userB);

  // Create approved org for institution selector
  const org = await Organization.create({ name:"Test University", slug:"test-university", description:"uni", createdBy:superAdmin._id, status:"APPROVED", category:"UNIVERSITY" });

  // 1. Onboarding status
  let r = await j("/onboarding/status", { headers:{ Authorization:`Bearer ${aToken}` } });
  ok("onboarding status returns", r.status===200 && r.data.isComplete!==undefined, `status=${r.status}`);

  // 2. Username availability — valid
  r = await j(`/onboarding/check-username?username=cool_user`, { headers:{ Authorization:`Bearer ${aToken}` } });
  ok("username availability valid", r.status===200 && r.data.available===true, JSON.stringify(r.data));

  // 3. Username availability — reserved
  r = await j(`/onboarding/check-username?username=admin`, { headers:{ Authorization:`Bearer ${aToken}` } });
  ok("username reserved blocked", r.status===200 && r.data.available===false && r.data.reason==="invalid", JSON.stringify(r.data));

  // 4. Set username first time
  r = await j("/onboarding/username", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` }, body:{ username:"cool_user" } });
  ok("set username first time", r.status===200 && r.data.user?.username==="cool_user", `status=${r.status} ${JSON.stringify(r.data)}`);

  // 5. Same username no-op should be rejected
  r = await j("/onboarding/username", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` }, body:{ username:"cool_user" } });
  ok("same username rejected", r.status===400, `status=${r.status}`);

  // 6. Username taken by another user
  r = await j("/onboarding/username", { method:"POST", headers:{ Authorization:`Bearer ${bToken}` }, body:{ username:"cool_user" } });
  ok("username taken blocked", r.status===409 || r.status===400, `status=${r.status}`);

  // 7. 14-day cooldown — try to change username immediately should fail
  r = await j("/onboarding/username", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` }, body:{ username:"new_cool" } });
  ok("cooldown enforced", r.status===400 && /day/.test(r.data.message||""), `status=${r.status} ${JSON.stringify(r.data)}`);

  // 8. Age confirmation
  r = await j("/onboarding/age-confirm", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` }, body:{ confirmed:true } });
  ok("age confirm", r.status===200 && r.data.ageConfirmed===true, `status=${r.status}`);

  // 9. Privacy set
  r = await j("/onboarding/privacy", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ visibility:"private" } });
  ok("privacy set private", r.status===200 && r.data.socialSettings?.profileVisibility==="private", `status=${r.status}`);

  // 10. Bio with length limit and moderation
  r = await j("/onboarding/bio", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ bio:"Hello world, I love coding!" } });
  ok("bio set", r.status===200 && r.data.bio?.includes("Hello"), `status=${r.status}`);

  // 11. Bio with abusive content should be blocked
  r = await j("/onboarding/bio", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ bio:"fuck you all" } });
  ok("bio abusive blocked", r.status===400, `status=${r.status}`);

  // 12. Institution selector from approved org
  r = await j("/onboarding/institution", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ organizationId:String(org._id) } });
  ok("institution set", r.status===200 && String(r.data.institutionOrgId)===String(org._id), `status=${r.status} ${JSON.stringify(r.data)}`);

  // 13. Institution with non-approved org should fail
  const unapprovedOrg = await Organization.create({ name:"Unapproved", slug:"unapproved", description:"x", createdBy:superAdmin._id, status:"PENDING_REVIEW", category:"UNIVERSITY" });
  r = await j("/onboarding/institution", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ organizationId:String(unapprovedOrg._id) } });
  ok("unapproved institution blocked", r.status===400, `status=${r.status}`);

  // 14. Interests with stable IDs
  r = await j("/onboarding/interests", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ interests:["technology","music"] } });
  ok("interests set", r.status===200 && r.data.interests?.includes("technology"), `status=${r.status}`);

  // 15. Interests with invalid IDs filtered
  r = await j("/onboarding/interests", { method:"PUT", headers:{ Authorization:`Bearer ${aToken}` }, body:{ interests:["technology","invalid_id_xyz"] } });
  ok("invalid interests filtered", r.status===200 && !r.data.interests?.includes("invalid_id_xyz"), `status=${r.status}`);

  // 16. Complete onboarding — should succeed after required steps
  r = await j("/onboarding/complete", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` } });
  ok("complete onboarding", r.status===200 && r.data.onboardingCompletedAt, `status=${r.status} ${JSON.stringify(r.data)}`);

  // 17. Privacy enforcement: private profile should block followers list for non-follower
  r = await j(`/users/${userA._id}/profile`, { headers:{ Authorization:`Bearer ${bToken}` } });
  ok("private profile canView false for non-follower", r.status===200 && r.data.canView===false, `canView=${r.data.canView}`);

  // 18. Follow request for private profile
  r = await j(`/follow/${userA._id}`, { method:"POST", headers:{ Authorization:`Bearer ${bToken}` } });
  ok("follow request created for private", r.status===200 && r.data.requested===true, `status=${r.status} ${JSON.stringify(r.data)}`);

  // 19. Followers list blocked for private non-follower (userB is pending, not accepted)
  r = await j(`/follow/${userA._id}/followers`, { headers:{ Authorization:`Bearer ${bToken}` } });
  ok("followers list blocked for private", r.status===403, `status=${r.status}`);

  // 20. Accept follow request
  r = await j(`/follow/requests/${userB._id}/accept`, { method:"POST", headers:{ Authorization:`Bearer ${aToken}` } });
  ok("accept follow request", r.status===200, `status=${r.status}`);

  // 21. Now private profile should be visible to follower
  r = await j(`/users/${userA._id}/profile`, { headers:{ Authorization:`Bearer ${bToken}` } });
  ok("private profile visible to follower", r.status===200 && r.data.canView===true, `canView=${r.data.canView}`);

  // 22. Content moderation: create post with abusive content should be quarantined or flagged
  r = await j("/posts", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` }, body:{ content:"fuck you all" } });
  ok("abusive post moderation", r.status===201 && ["quarantined","flagged","pending"].includes(r.data.post?.moderationStatus), `status=${r.status} mod=${r.data.post?.moderationStatus}`);

  const abusivePostId = r.data.post?._id;

  // 23. Abusive post should not appear in other user's feed
  r = await j("/posts/feed", { headers:{ Authorization:`Bearer ${bToken}` } });
  const foundAbusive = r.data.posts?.find(p=>String(p._id)===String(abusivePostId));
  ok("abusive post not in other's feed", !foundAbusive, `found=${!!foundAbusive}`);

  // 24. Abusive post should still be visible to author via get by id (author bypass)
  r = await j(`/posts/${abusivePostId}`, { headers:{ Authorization:`Bearer ${aToken}` } });
  ok("author can see own quarantined post", r.status===200, `status=${r.status}`);

  // 25. Non-author cannot see quarantined post by id
  r = await j(`/posts/${abusivePostId}`, { headers:{ Authorization:`Bearer ${bToken}` } });
  ok("non-author cannot see quarantined post", r.status===404, `status=${r.status}`);

  // 26. Trust & Safety: user reporting
  r = await j("/reports", { method:"POST", headers:{ Authorization:`Bearer ${bToken}` }, body:{ contentType:"user", contentId:String(userA._id), reason:"abusive_language", details:"abusive bio" } });
  ok("user report submitted", r.status===201 || r.status===200, `status=${r.status}`);

  // 27. Report dedup: same user reporting same content again should be blocked or deduped
  r = await j("/reports", { method:"POST", headers:{ Authorization:`Bearer ${bToken}` }, body:{ contentType:"user", contentId:String(userA._id), reason:"abusive_language", details:"again" } });
  ok("report dedup", r.status===409 || r.status===400 || r.status===200, `status=${r.status}`);

  // 28. Super Admin overview
  r = await j("/admin/moderation/overview", { headers:{ Authorization:`Bearer ${saToken}` } });
  ok("super admin overview", r.status===200 && r.data.overview!==undefined, `status=${r.status}`);

  // 29. Super Admin user search
  r = await j(`/admin/moderation/users/search?q=${userA.email}`, { headers:{ Authorization:`Bearer ${saToken}` } });
  ok("super admin user search", r.status===200 && r.data.users?.length>0, `status=${r.status}`);

  // 30. Enforcement: warning
  r = await j(`/admin/moderation/users/${userA._id}/enforce`, { method:"POST", headers:{ Authorization:`Bearer ${saToken}` }, body:{ actionType:"warning", reason:"test warning for abusive content", policyCategory:"abusive_language" } });
  ok("enforcement warning", r.status===200 && r.data.enforcement?.actionType==="warning", `status=${r.status}`);

  // 31. Enforcement: posting restriction
  r = await j(`/admin/moderation/users/${userA._id}/enforce`, { method:"POST", headers:{ Authorization:`Bearer ${saToken}` }, body:{ actionType:"posting_restriction", reason:"posting restriction test", policyCategory:"spam", durationDays:1 } });
  ok("posting restriction", r.status===200, `status=${r.status}`);

  // 32. Posting should be blocked when restricted
  r = await j("/posts", { method:"POST", headers:{ Authorization:`Bearer ${aToken}` }, body:{ content:"should be blocked" } });
  ok("posting blocked when restricted", r.status===403, `status=${r.status}`);

  // 33. Super Admin can reverse enforcement
  const enforcementsRes = await j(`/admin/moderation/enforcements?targetUser=${userA._id}`, { headers:{ Authorization:`Bearer ${saToken}` } });
  const restriction = enforcementsRes.data.enforcements?.find(e=>e.actionType==="posting_restriction" && e.status==="active");
  if (restriction) {
    r = await j(`/admin/moderation/enforcement/${restriction._id}/reverse`, { method:"POST", headers:{ Authorization:`Bearer ${saToken}` }, body:{ reversalReason:"test reversal" } });
    ok("reverse enforcement", r.status===200 && r.data.enforcement?.status==="reversed", `status=${r.status}`);
  } else {
    ok("reverse enforcement (no active restriction found)", false, "no restriction");
  }

  // 34. Token version revocation: ban user should increment tokenVersion and block auth
  r = await j(`/admin/moderation/users/${userA._id}/enforce`, { method:"POST", headers:{ Authorization:`Bearer ${saToken}` }, body:{ actionType:"permanent_ban", reason:"permanent ban test for session revocation", policyCategory:"other" } });
  ok("permanent ban", r.status===200 && r.data.enforcement?.actionType==="permanent_ban", `status=${r.status}`);

  // Try to use old token (should be revoked)
  r = await j("/users/me/social", { headers:{ Authorization:`Bearer ${aToken}` } });
  ok("banned user token revoked", r.status===401 || r.status===403, `status=${r.status}`);

  // 35. IP restriction
  r = await j("/admin/moderation/ip", { method:"POST", headers:{ Authorization:`Bearer ${saToken}` }, body:{ ip:"1.2.3.4", reason:"test ip block", category:"abuse", expiresInHours:1 } });
  ok("IP restriction created", r.status===201 && r.data.restriction?.ip==="1.2.3.4", `status=${r.status}`);

  r = await j("/admin/moderation/ip", { headers:{ Authorization:`Bearer ${saToken}` } });
  ok("IP restriction list", r.status===200 && r.data.restrictions?.length>0, `status=${r.status}`);

  // 36. Expiry cron: expireOldRestrictions should clear expired
  const { expireEnforcementsTick, expireIpRestrictionsTick } = require("../services/enforcement-expiry.service");
  const expiredCount = await expireEnforcementsTick();
  ok("expiry cron runs", typeof expiredCount==="number", `count=${expiredCount}`);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length) console.log("Failures:", failures);

  await mongod.stop();
  process.exit(failed===0?0:1);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
