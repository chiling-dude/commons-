# Commons backend

A real backend for the Commons prototype: Express (REST) + Socket.IO (real-time
chat) + PostgreSQL. This replaces the client-side `window.storage` mock the
prototype used — accounts, rooms, messages, reports, violations, and blocks
now live in a real database, and password hashing, session tokens, and
suspension enforcement all happen server-side instead of just in the browser.

## Message retention

Messages aren't kept forever. Two rules, whichever a message hits first
removes it:

- at most `MAX_MESSAGES_PER_ROOM` per room (default 500, newest kept)
- nothing older than `MAX_MESSAGE_AGE_DAYS` (default 90), regardless of count

Both are configurable in `.env`. Cleanup runs lazily, triggered by a message
being sent to that room — not a scheduled job — because Render's free tier
sleeps after 15 idle minutes, so a cron-style background job wouldn't fire
reliably. It's fire-and-forget: it never adds latency to the person sending
the message.

**This is paired with real pagination**, not just a silent cutoff: `GET
/api/messages/:roomId?before=<timestamp>` loads the next page back, so
anything within the retention window is actually reachable by scrolling, not
just retained-but-invisible. Reports store their own copy of the reported
message's text, so a report stays valid evidence even after the original
message is eventually trimmed.

## What's real here that wasn't in the prototype

- **Passwords are hashed with bcrypt server-side**, not client-side SHA-256.
- **Sessions are signed JWTs**, verified on every request and every socket
  connection.
- **Suspension is enforced server-side.** A restricted account's messages are
  rejected by the socket layer itself, not just hidden in the UI.
- **The permanent-ban deletion is a real, scheduled check.** 24 hours after a
  4th violation, the very next `/api/account/status` call (which the client
  makes on login and on re-entering the app) deletes the account for real.
- **Rate limiting** on auth and room-creation endpoints, plus a basic flood
  guard on message sending.

## Setup

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL and JWT_SECRET in .env
npm run migrate
npm start
```

Requires Node 18+ and a PostgreSQL database. `npm run migrate` creates every
table and seeds the Global Lobby room — safe to re-run, it won't duplicate
anything.

## Testing

`tests/integration.test.js` runs 17 real assertions against a running server
and a real database — signup/login, room creation, the full report-review-
escalate chain (warning through permanent), blocking, and real-time
Socket.IO delivery, including confirming a restricted account is rejected
*server-side* when it tries to send. Not mocked — this is exactly how it was
verified before being handed to you.

```bash
# terminal 1
npm run migrate
npm start

# terminal 2
npm run test:integration
```

Uses a fresh throwaway nickname each run, so it's safe to re-run repeatedly
against the same database.

## Deploying for free, to start

You don't need to pay anything to get this live:

1. **Railway** or **Render** — both have a free/hobby tier, both support
   Node + a managed Postgres add-on, both support WebSockets out of the box
   (Socket.IO needs a host that keeps long-lived connections open — this
   rules out some purely serverless-function platforms unless configured for
   it).
2. Push this folder to a GitHub repo, connect it in Railway/Render, add a
   Postgres instance, copy its connection string into `DATABASE_URL`, set
   `JWT_SECRET` and `CORS_ORIGIN` (your frontend's real domain).
3. Run `npm run migrate` once (Railway/Render both let you run one-off
   commands against your deployed service).

That's it — no server to rent, no credit card required to start.

## Honest scaling notes — "as many people as possible"

The architecture here is genuinely built to scale, but scaling to real
traffic still needs a couple of changes when you get there, not because
anything here is a toy:

- **Socket.IO across multiple instances needs the Redis adapter.** Right now,
  message flood-guarding and room membership live in a single process's
  memory (`Map()` in `sockets/index.js`). That's completely fine for one
  server instance handling a meaningful amount of concurrent users. The
  moment you run *two or more* instances for load, you need
  `@socket.io/redis-adapter` so instances share room state and can relay
  messages to each other — otherwise a user connected to instance A won't
  see a message from a user on instance B. This is a well-documented,
  standard Socket.IO pattern, not a rewrite.
- **Free-tier Postgres has a connection limit** (commonly 20-100 depending on
  provider). The pool here is capped at 20 for exactly this reason. If you
  outgrow that, add PgBouncer (connection pooling) before you need a bigger
  database plan.
- **The moderation queue has no role system yet.** Any logged-in account can
  currently view and resolve reports (`GET/POST /api/reports/*`) — same as
  the prototype. Before real launch, add a `role` column to `accounts` and
  gate those two routes on it.
- **No CDN/edge layer yet.** Fine at low-to-moderate traffic; add one
  (Cloudflare in front of your API, or your host's built-in edge network) once
  static asset delivery or global latency actually becomes a bottleneck —
  don't add this before you need it.

None of this is a rewrite when the time comes — it's additive infrastructure
on top of the same codebase.

## API overview

| Method | Path                          | Auth | What it does |
|---|---|---|---|
| POST | `/api/auth/signup` | – | Create an account |
| POST | `/api/auth/login` | – | Log in, get a JWT |
| GET  | `/api/rooms` | – | List all rooms |
| POST | `/api/rooms` | ✓ | Create a room |
| GET  | `/api/messages/:roomId` | – | Recent message history for a room |
| POST | `/api/reports` | ✓ | File a report |
| GET  | `/api/reports/queue` | ✓ | View pending reports |
| POST | `/api/reports/:id/resolve` | ✓ | Dismiss or take action |
| GET  | `/api/account/status` | ✓ | Check suspension status (also runs the 24h deletion check) |
| GET  | `/api/account/violations` | ✓ | Your own violation history (raw timestamps) |
| POST | `/api/account/change-password` | ✓ | Change password |
| GET  | `/api/account/blocked` | ✓ | List blocked nicknames |
| POST | `/api/account/block` | ✓ | Block a nickname |
| POST | `/api/account/unblock` | ✓ | Unblock a nickname |

Real-time (Socket.IO, connect with `{ auth: { token } }`):

| Event | Direction | Payload |
|---|---|---|
| `join_room` / `leave_room` | client → server | `roomId` |
| `send_message` | client → server | `{ roomId, text }`, ack returns `{ ok }` or `{ error }` |
| `new_message` | server → client | `{ roomId, message }` |

## Not done yet, on purpose

This is a working MVP, not a finished product. Deliberately out of scope for
this pass: automated tests, CI/CD, Docker, moderator roles, email/phone
recovery (the prototype's whole point was not needing those), and load
testing. Happy to build any of these next — just say which.
