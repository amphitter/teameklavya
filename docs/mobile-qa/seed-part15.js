/**
 * seed-part15.js — put one message of every content type into the QA DM.
 *
 *   node seed-part15.js
 *
 * Reads QA_READY from /var/tmp/qa-ready.json (written from the QA server log).
 * Seeds, in this order (newest last, so the thread reads bottom-up):
 *   1  incoming text          "yes"
 *   2  sent text              "Hi?"
 *   3  sent text              "Are you there?"
 *   4  sent text              "Sooo"
 *   5  sent text              "Yo"            ← 2–5 are the consecutive group
 *   6  sent emoji             "🧠"
 *   7  sent long text
 *   8  sent image
 *   9  incoming image
 *  10  sent shared post
 *  11  incoming shared post
 *
 * Every send goes through the real API (`POST /api/messages/conversations/:id`)
 * with the real tokens — nothing is written to the database directly and
 * nothing is faked in the DOM.
 */
const fs = require("fs");

const QA = JSON.parse(fs.readFileSync("/var/tmp/qa-ready.json", "utf8"));
const API = "http://127.0.0.1:5999/api";
const DM = QA.dmId;
const CONVO = `${API}/messages/conversations/${DM}`;

const UP = "http://127.0.0.1:5999/uploads";
const IMG = `${UP}/stories/seed-story.png`;

async function call(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 160)}`);
  return json;
}

(async () => {
  const ana = QA.ana.token;
  const ben = QA.ben.token;

  // A public post ben can also see (the share is refused unless BOTH ends can
  // read it — message.controller.js), so take one from his own feed.
  const feed = await call("GET", `${API}/posts/feed?limit=8`, ben);
  const posts = feed.posts || feed.data || [];
  const post = posts.find((p) => p.visibility === "public") || posts[0];
  if (!post) throw new Error("no posts in the QA feed to share");
  console.log(`sharing post ${post._id} (${post.visibility})`);

  const sent = [];
  const step = async (label, token, body) => {
    const r = await call("POST", CONVO, token, body);
    sent.push(label);
    console.log(`  ✓ ${label}`);
    return r;
  };

  await step("1  incoming text", ben, { content: "yes" });
  await step("2  sent text — Hi?", ana, { content: "Hi?" });
  await step("3  sent text — Are you there?", ana, { content: "Are you there?" });
  await step("4  sent text — Sooo", ana, { content: "Sooo" });
  await step("5  sent text — Yo", ana, { content: "Yo" });
  await step("6  sent emoji", ana, { content: "🧠" });
  await step(
    "7  sent long text",
    ana,
    {
      content:
        "Okay so the plan for tomorrow: I'll reach the venue by nine, grab the corner table near the charging point, and start on the API integration while you finish the deck. If the wifi drops again we'll tether off my phone — the password is on the whiteboard.",
    }
  );
  await step("8  sent image", ana, { content: "", image: IMG });
  await step("9  incoming image", ben, { content: "", image: IMG });
  await step("10 sent shared post", ana, { content: "Shared a post", sharedPostId: post._id });
  await step("11 incoming shared post", ben, { content: "Shared a post", sharedPostId: post._id });

  const thread = await call("GET", `${CONVO}?limit=50`, ana);
  console.log(`\nthread now holds ${thread.messages.length} messages:`);
  for (const m of thread.messages) {
    const mine = String(m.sender?._id || m.sender) === QA.ana.id;
    const kind = m.sharedPost ? "sharedPost" : m.image ? "image" : "text";
    console.log(`  ${mine ? "ana" : "ben"}  ${kind.padEnd(10)} ${JSON.stringify((m.content || "").slice(0, 32))}`);
  }
  console.log("\nfixtures ready:", sent.length);
})();
