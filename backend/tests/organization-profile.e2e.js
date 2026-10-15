"use strict";

/** Focused Organization Phase 2/3 API test: profile editing, discovery filters,
 * compatible lookups, cursor pages, institution linking, and global search.
 * Uses MongoMemoryServer; no production database/provider is touched. */
process.env.NODE_ENV = "test";
process.env.PORT = "5072";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "organization-profile-example-secret";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "example-client-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const OrgFollow = require("../models/orgFollow.model");
const Event = require("../models/event.model");
const Post = require("../models/post.model");
const Community = require("../models/community.model");

const BASE = `http://127.0.0.1:${process.env.PORT}/api`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

function tokenFor(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role || "user", purpose: "auth" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      const data = await response.json();
      if (response.ok && data.db === "connected") return;
    } catch {}
    await wait(250);
  }
  throw new Error("API did not become ready");
}

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  require("../server");
  await waitForApi();

  const creator = await User.create({
    firstName: "Org",
    lastName: "Creator",
    email: "org-creator@example.test",
    passwordHash: "test-password",
    emailVerified: true,
  });
  const viewer = await User.create({
    firstName: "Org",
    lastName: "Viewer",
    email: "org-viewer@example.test",
    passwordHash: "test-password",
    emailVerified: true,
  });
  const creatorToken = tokenFor(creator);
  const viewerToken = tokenFor(viewer);

  const primary = await Organization.create({
    name: "Amsterdam Builders",
    slug: "amsterdam-builders",
    category: "COLLEGE",
    description: "A builder community in Amsterdam.",
    city: "Amsterdam",
    state: "North Holland",
    country: "Netherlands",
    website: "https://builders.example.test",
    socialLinks: { instagram: "https://instagram.com/builders" },
    isVerified: true,
    createdBy: creator._id,
  });
  await Organization.create({
    name: "Rotterdam Design Club",
    slug: "rotterdam-design-club",
    category: "STUDENT_CLUB",
    city: "Rotterdam",
    country: "Netherlands",
    createdBy: creator._id,
  });
  await Organization.create({
    name: "Amsterdam Founders",
    slug: "amsterdam-founders",
    category: "STARTUP",
    city: "Amsterdam",
    createdBy: creator._id,
  });
  const parentOrganization = await Organization.create({
    name: "Delhi Institute of Technology",
    slug: "delhi-institute-of-technology",
    category: "UNIVERSITY",
    city: "Delhi",
    country: "India",
    createdBy: creator._id,
  });
  const childOrganization = await Organization.create({
    name: "Tech Student Club",
    slug: "tech-student-club",
    category: "STUDENT_CLUB",
    city: "Delhi",
    createdBy: creator._id,
  });
  const universityCommunity = await Organization.create({
    name: "Delhi University Community",
    slug: "delhi-university-community",
    category: "UNIVERSITY_COMMUNITY",
    createdBy: creator._id,
  });
  const schoolParent = await Organization.create({
    name: "Delhi Public School",
    slug: "delhi-public-school",
    category: "SCHOOL",
    createdBy: creator._id,
  });
  // A pre-foundation record has only the established slug field. Keep the
  // public route resolving these records without requiring a backfill.
  await Organization.collection.insertOne({
    name: "Legacy Design Society",
    slug: "legacy-design-society",
    description: "A record created before organization handles existed.",
    category: "OTHER",
    isVerified: false,
    verifiedAt: null,
    managers: [],
    createdBy: creator._id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const categories = await request("/organizations/categories");
  assert.equal(categories.status, 200);
  assert.equal(categories.data.categories.length, 16);
  assert.ok(categories.data.categories.some((item) => item.value === "COLLEGE_COMMUNITY"));

  const filtered = await request("/organizations?q=builders&category=COLLEGE&city=Amsterdam&verified=true&limit=12");
  assert.equal(filtered.status, 200);
  assert.equal(filtered.data.organizations.length, 1);
  assert.equal(filtered.data.organizations[0].handle, primary.slug);
  assert.equal(filtered.data.organizations[0].city, "Amsterdam");
  assert.equal(filtered.data.organizations[0].following, false);

  await OrgFollow.create({ user: viewer._id, organization: primary._id });
  const followed = await request("/organizations?following=true&limit=12", { token: viewerToken });
  assert.equal(followed.status, 200);
  assert.deepEqual(followed.data.organizations.map((org) => org._id), [String(primary._id)]);
  assert.equal(followed.data.organizations[0].following, true);
  assert.equal((await request("/organizations?following=true")).status, 401);

  // Cursor pages remain stable even when records share the same millisecond.
  const firstPage = await request("/organizations?limit=1");
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.data.organizations.length, 1);
  assert.equal(firstPage.data.hasMore, true);
  assert.ok(firstPage.data.nextCursor);
  const secondPage = await request(`/organizations?limit=1&cursor=${encodeURIComponent(firstPage.data.nextCursor)}`);
  assert.equal(secondPage.status, 200);
  assert.equal(secondPage.data.organizations.length, 1);
  assert.notEqual(secondPage.data.organizations[0]._id, firstPage.data.organizations[0]._id);

  const profile = await request(`/organizations/${primary.handle}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.organization.handle, primary.slug);
  assert.equal(profile.data.organization.category, "COLLEGE");
  assert.equal(profile.data.organization.socialLinks.instagram, "https://instagram.com/builders");
  assert.equal(profile.data.organization.canManage, false);
  assert.equal(Object.hasOwn(profile.data.organization, "ownershipStatus"), false);
  const legacyProfile = await request("/organizations/legacy-design-society");
  assert.equal(legacyProfile.status, 200);
  assert.equal(legacyProfile.data.organization.handle, "legacy-design-society");

  const parentOptions = await request(`/organizations/${childOrganization._id}/parent-options?q=Delhi`, { token: creatorToken });
  assert.equal(parentOptions.status, 200);
  assert.deepEqual(parentOptions.data.allowedCategories, ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"]);
  assert.ok(parentOptions.data.organizations.some((item) => item._id === String(parentOrganization._id)));
  assert.equal((await request(`/organizations/${childOrganization._id}/parent-options`, { token: viewerToken })).status, 403);
  assert.equal((await request(`/organizations/${childOrganization._id}/parent-options`)).status, 401);

  const linkedChild = await request(`/organizations/${childOrganization._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { parentOrganizationId: String(parentOrganization._id) },
  });
  assert.equal(linkedChild.status, 200);
  assert.equal(linkedChild.data.organization.parentOrganization._id, String(parentOrganization._id));
  const childProfile = await request(`/organizations/${childOrganization.handle}`);
  assert.equal(childProfile.status, 200);
  assert.equal(childProfile.data.organization.parentOrganization.name, parentOrganization.name);
  const childrenPage = await request(`/organizations/${parentOrganization.handle}/children?limit=1`);
  assert.equal(childrenPage.status, 200);
  assert.equal(childrenPage.data.children.length, 1);
  assert.equal(childrenPage.data.children[0].handle, childOrganization.slug);
  assert.equal(childrenPage.data.hasMore, false);

  const incompatibleLink = await request(`/organizations/${universityCommunity._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { parentOrganizationId: String(schoolParent._id) },
  });
  assert.equal(incompatibleLink.status, 400);
  const categoryWhileLinked = await request(`/organizations/${childOrganization._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { category: "COMPANY" },
  });
  assert.equal(categoryWhileLinked.status, 400);
  const institutionCategoryWithChildren = await request(`/organizations/${parentOrganization._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { category: "COMPANY" },
  });
  assert.equal(institutionCategoryWithChildren.status, 400);

  const organizationSearch = await request("/search?q=Tech%20Student&type=organizations");
  assert.equal(organizationSearch.status, 200);
  assert.equal(organizationSearch.data.organizations.length, 1);
  assert.equal(organizationSearch.data.organizations[0].handle, childOrganization.slug);
  const allSearch = await request("/search?q=Tech%20Student&type=all");
  assert.ok(Array.isArray(allSearch.data.organizations));
  assert.equal(allSearch.data.organizations.length, 1);
  const globalOrgPage1 = await request("/search?q=Delhi&type=organizations&limit=1");
  assert.equal(globalOrgPage1.status, 200);
  assert.equal(globalOrgPage1.data.organizations.length, 1);
  assert.equal(globalOrgPage1.data.hasMore, true);
  const globalOrgPage2 = await request(`/search?q=Delhi&type=organizations&limit=1&cursor=${encodeURIComponent(globalOrgPage1.data.nextCursor)}`);
  assert.equal(globalOrgPage2.data.organizations.length, 1);
  assert.notEqual(globalOrgPage2.data.organizations[0]._id, globalOrgPage1.data.organizations[0]._id);
  const shortSearch = await request("/search?q=t&type=organizations");
  assert.deepEqual(shortSearch.data.organizations, []);

  const unlinkedChild = await request(`/organizations/${childOrganization._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { category: "COMPANY", parentOrganizationId: null },
  });
  assert.equal(unlinkedChild.status, 200);
  assert.equal(unlinkedChild.data.organization.parentOrganization, null);

  const updated = await request(`/organizations/${primary._id}`, {
    method: "PUT",
    token: creatorToken,
    body: {
      description: "Updated organization profile",
      category: "TECH_COMMUNITY",
      address: "12 Canal Street",
      city: "Utrecht",
      state: "Utrecht",
      country: "Netherlands",
      postalCode: "3511 AA",
      email: "team@builders.example.test",
      phone: "+31 20 123 4567",
      website: "https://builders.example.test/about",
      socialLinks: { linkedin: "https://linkedin.com/company/builders" },
      status: "SUSPENDED",
      ownershipStatus: "DISPUTED",
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.organization.category, "TECH_COMMUNITY");
  assert.equal(updated.data.organization.city, "Utrecht");
  assert.equal(updated.data.organization.email, "team@builders.example.test");
  assert.equal(updated.data.organization.socialLinks.linkedin, "https://linkedin.com/company/builders");
  assert.equal(Object.hasOwn(updated.data.organization, "status"), false);
  const persistedProfile = await Organization.findById(primary._id).lean();
  assert.equal(persistedProfile.status, "APPROVED");
  assert.equal(persistedProfile.ownershipStatus, "PERSONAL");
  const denied = await request(`/organizations/${primary._id}`, {
    method: "PUT",
    token: viewerToken,
    body: { description: "Not allowed" },
  });
  assert.equal(denied.status, 403);
  const unsafeWebsite = await request(`/organizations/${primary._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { website: "javascript:alert(1)" },
  });
  assert.equal(unsafeWebsite.status, 400);
  const unsafeSocial = await request(`/organizations/${primary._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { socialLinks: { instagram: "javascript:alert(1)" } },
  });
  assert.equal(unsafeSocial.status, 400);
  const invalidCategory = await request(`/organizations/${primary._id}`, {
    method: "PUT",
    token: creatorToken,
    body: { category: "NOT_REAL" },
  });
  assert.equal(invalidCategory.status, 400);

  const now = Date.now();
  await Event.create([1, 2, 3].map((index) => ({
    title: `Builder Meetup ${index}`,
    slug: `builder-meetup-${index}`,
    description: "A public community event",
    category: "Workshop",
    eventType: "online",
    onlineEventLink: "https://events.example.test/join",
    startDate: new Date(now + index * 60 * 60 * 1000),
    endDate: new Date(now + index * 60 * 60 * 1000 + 30 * 60 * 1000),
    visibility: "public",
    createdBy: creator._id,
    organization: primary._id,
  })));
  const eventPage1 = await request(`/organizations/${primary.handle}/events?scope=upcoming&limit=1`);
  assert.equal(eventPage1.status, 200);
  assert.equal(eventPage1.data.upcoming.length, 1);
  assert.equal(eventPage1.data.hasMore, true);
  const eventPage2 = await request(`/organizations/${primary.handle}/events?scope=upcoming&limit=1&cursor=${encodeURIComponent(eventPage1.data.nextCursor)}`);
  assert.equal(eventPage2.data.upcoming.length, 1);
  assert.notEqual(eventPage2.data.upcoming[0]._id, eventPage1.data.upcoming[0]._id);
  const legacyEvents = await request(`/organizations/${primary.handle}/events`);
  assert.equal(legacyEvents.status, 200);
  assert.equal(legacyEvents.data.upcoming.length, 3);
  assert.ok(Array.isArray(legacyEvents.data.past));

  await Post.create([1, 2, 3].map((index) => ({
    author: creator._id,
    organization: primary._id,
    content: `Organization post ${index}`,
  })));
  const postPage1 = await request(`/organizations/${primary.handle}/posts?limit=1`);
  assert.equal(postPage1.status, 200);
  assert.equal(postPage1.data.posts.length, 1);
  assert.equal(postPage1.data.hasMore, true);
  const postPage2 = await request(`/organizations/${primary.handle}/posts?limit=1&cursor=${encodeURIComponent(postPage1.data.nextCursor)}`);
  assert.equal(postPage2.data.posts.length, 1);
  assert.notEqual(postPage2.data.posts[0]._id, postPage1.data.posts[0]._id);
  const legacyPostPage = await request(`/organizations/${primary.handle}/posts?page=1&limit=1`);
  assert.equal(legacyPostPage.status, 200);
  assert.equal(legacyPostPage.data.page, 1);
  assert.equal(legacyPostPage.data.posts.length, 1);
  assert.equal(legacyPostPage.data.hasMore, true);

  await Community.create([1, 2, 3].map((index) => ({
    name: `Builders Community ${index}`,
    slug: `builders-community-${index}`,
    createdBy: creator._id,
    organization: primary._id,
  })));
  const communityPage1 = await request(`/organizations/${primary.handle}/communities?limit=1`);
  assert.equal(communityPage1.status, 200);
  assert.equal(communityPage1.data.communities.length, 1);
  assert.equal(communityPage1.data.hasMore, true);
  const communityPage2 = await request(`/organizations/${primary.handle}/communities?limit=1&cursor=${encodeURIComponent(communityPage1.data.nextCursor)}`);
  assert.equal(communityPage2.data.communities.length, 1);
  assert.notEqual(communityPage2.data.communities[0]._id, communityPage1.data.communities[0]._id);

  console.log("Organization profile/discovery/link/search API checks passed.");
  await mongooseDisconnect();
  await mongod.stop();
  process.exit(0);
})().catch(async (error) => {
  console.error("Organization profile/discovery API checks failed:", error);
  await mongooseDisconnect().catch(() => {});
  process.exit(1);
});

async function mongooseDisconnect() {
  const mongoose = require("mongoose");
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
