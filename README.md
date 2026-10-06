# EventHub

> **A social network built around events.**
> Discover events. Register. Attend. Connect. Grow.

EventHub is a modern event platform for organizers and participants —
event discovery, registration, tickets with QR check-in, RSVPs and
attendee management, all in one place.

## Monorepo structure

```
/backend    Node.js + Express 5 + MongoDB API  (deployed on Render)
/frontend   Next.js 15 + React 19 + Tailwind  (deployed on Vercel)
```

## Features

**Discover & attend**
- Explore with live search, category / price / format filters and featured events
- Rich event pages: poster hero, schedule, speakers, partners, benefits, participants, map embed
- Registration with custom questions (auto-fill from profile), QR tickets + email delivery, manual approval mode
- "My events" — upcoming / past registrations with tickets and QR check-in codes

**Social layer**
- Home feed (For you / Following) — text + photo posts, event-native posts, community posts
- Likes, comments (with delete), saves, follow/unfollow (authors, communities)
- Public profiles with real stats, achievements, posts and events
- Organizations / communities: directory, follow, org pages with their events
- Direct messages (1:1 chats with unread badges)
- Notifications: follows, likes, comments, registrations, community follows, announcements

**Organizer studio** (`/admin`)
- Dashboard with real stats, upcoming events with live registration counts, quick actions
- 5-step event creation wizard (basics → details → activities → settings → review)
- Event management: overview, registrations (export/approve), analytics, live quiz console, QR scanner
- Announcements: email every user + in-app notification
- Live quizzes with instant scoring and leaderboards

**Event memories**
- Photo + text memory walls on event pages and `/events/[slug]/memories`
- Memories double as feed posts and appear on author profiles

## Quick start (local)

```bash
# 1. Backend
cd backend
cp .env.example .env        # fill in MONGO_URI, JWT_SECRET, etc.
npm install
npm run dev                 # http://localhost:5000

# 2. Frontend
cd frontend
cp .env.example .env.local  # set NEXT_PUBLIC_API_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:3000
```

## Testing (backend E2E)

Each suite spins up its own in-memory MongoDB — no local database needed:

```bash
cd backend
npm run test:social      # feed, posts, likes, comments, saves, follows, orgs (41 checks)
npm run test:community   # notifications, messages, community wiring (38 checks)
npm run test:quiz        # live quiz + leaderboard lifecycle (32 checks)
npm run test:memories    # event memory walls (14 checks)
npm run test:mgmt        # organizer management API chain (11 checks)
# or everything at once:
npm run test:all
```

## Environment variables

See `backend/.env.example` and `frontend/.env.example` for the full list.

Key integrations:

| Service | Purpose | Where configured |
|---|---|---|
| MongoDB | Database | `MONGO_URI` (backend) |
| Cloudinary | Image uploads (posters, avatars, logos) | `CLOUDINARY_*` (backend) |
| Resend | Primary transactional email | `RESEND_API_KEY` (backend) |
| Gmail SMTP | Email fallback | `SMTP_*` (backend) |
| Google OAuth | Sign in with Google | `GOOGLE_*` (backend) |

## Email architecture

All transactional email flows through a single backend service
(`backend/services/email.service.js`):

```
Application code
      ↓
emailService.send()
      ↓
Resend (primary)  →  Gmail SMTP (automatic fallback)
```

Sender identity: **EventHub \<eventhub-noreply@ayanm.in\>**

## Security notes

- JWT secret is environment-based and **required** at boot.
- All admin/organizer endpoints enforce server-side role checks.
- Uploads are validated (type + size) and stored in Cloudinary.
- Rate limiting protects auth and upload endpoints.

## Deploying

- **Backend (Render):** set all backend env vars in the Render dashboard.
- **Frontend (Vercel):** set `NEXT_PUBLIC_API_URL` to the Render backend URL.
