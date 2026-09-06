# Recapped For You — Setup Checklist

The app is fully built and automated end to end: booking flow, guest upload
page, internal dashboard, gallery delivery, Stripe payment, email, AI photo
curation/roast scripts, and video assembly. A scheduled job
(`scripts/poll-and-recap.js`, run every 3 hours by
`.github/workflows/recap-scheduler.yml`) picks up eligible bookings on its
own — nothing needs to be triggered by hand. What's left is account
creation, pasting keys into two places, and pointing the domain.

## 1. Accounts to create (all free to start)

1. **Vercel** (vercel.com) — hosting. Sign up with GitHub.
2. **Supabase** (supabase.com) — database. Create a new project, then:
   - Go to the SQL Editor, paste in `schema.sql`, run it.
   - Then run every file in `migrations/`, in order (001 through the
     highest-numbered one) — each is a small, additive `alter table`.
   - Go to Project Settings → API, copy `Project URL` and `service_role` key.
3. **Cloudflare R2** (dash.cloudflare.com) — file storage.
   - Create a bucket (e.g. `recapped-uploads`).
   - Go to "Manage R2 API Tokens," create a token, copy Account ID, Access Key ID, Secret Access Key.
4. **Stripe** (stripe.com) — payments.
   - Get your API key from Developers → API keys (use the test key first).
   - You'll add the webhook secret after deploying (step 4 below).
5. **Resend** (resend.com) — email sending.
   - Add and verify the sending domain used in `lib/email.js`'s `FROM`
     address (SPF/DKIM records in your DNS) — mail from an unverified
     domain gets dropped or lands in spam.
   - Copy your API key from API Keys.
6. **Anthropic** (console.anthropic.com) — for the photo curation and
   Roast Reel script generation.
   - Copy your API key.
7. **Upstash** (upstash.com) — Redis, used for API rate limiting.
   - Create a free Redis database, copy the REST URL and REST token.

## 2. Local setup

Create `.env.local` in the project root with these keys (no example file
to copy — just fill in real values from the accounts above):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
ANTHROPIC_API_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
APP_URL=
ADMIN_ALERT_EMAIL=
DASHBOARD_PASSWORD=
```

- `APP_URL` is your site's base URL (`http://localhost:3000` for local dev,
  your real domain in production).
- `ADMIN_ALERT_EMAIL` gets a notification if a scheduled pipeline run fails.
- `DASHBOARD_PASSWORD` gates `/dashboard` (see `middleware.js`) — pick
  anything; there's no dashboard login without it.

```bash
npm install
npm run dev
```

Visit `localhost:3000/booking` to test the booking flow end-to-end
(use a Stripe test card: 4242 4242 4242 4242, any future date/CVC). To test
the recap pipeline locally without waiting for the cron schedule, run
`node scripts/poll-and-recap.js` directly — it needs `ffmpeg` on your PATH
(or `FFMPEG_PATH` pointed at a binary).

## 3. Deploy

```bash
git init && git add . && git commit -m "initial"
# push to a new GitHub repo, then in Vercel: "Import Project" from that repo
```

In Vercel's project settings, add every variable from `.env.local` under
Environment Variables, then redeploy.

## 4. Wire up the scheduled pipeline (GitHub Actions)

`.github/workflows/recap-scheduler.yml` runs `scripts/poll-and-recap.js`
every 3 hours in CI, not on Vercel — it needs its own copy of most of the
same secrets, set in the GitHub repo's **Settings → Secrets and variables →
Actions** (these do NOT sync automatically from `.env.local` or Vercel):

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
RESEND_API_KEY
APP_URL
ADMIN_ALERT_EMAIL
```

Without these, bookings will accept payment and collect uploads, but the
recap video/gallery will never actually get generated or delivered. You can
trigger a manual run from the repo's Actions tab (`workflow_dispatch`) to
confirm it's working before waiting for the schedule.

## 5. Connect the Stripe webhook (after deploying)

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://yourdomain.com/api/webhooks/stripe`
3. Event to send: `checkout.session.completed`
4. Copy the generated signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel's env vars, redeploy.

## 6. Point your domain

In Vercel → Domains, add `recappedforyou.com` (or whatever you registered)
and follow the DNS instructions it gives you.

## 7. Email authentication (SPF / DKIM / DMARC)

All mail goes out through Resend. A young domain sending unauthenticated mail
that links back to itself is a strong "deceptive site" signal for Google Safe
Browsing and the mailbox providers, so this isn't optional in production.

Full record list and dashboard steps: **[`docs/EMAIL_AUTH.md`](docs/EMAIL_AUTH.md)**.
Check the live state at any time with:

```bash
node scripts/check-email-auth.js
```

## File map

- `app/booking/page.jsx` — client-facing booking form
- `app/qr/[slug]/page.jsx` — guest upload page (QR code destination)
- `app/api/qrcode/[slug]/route.js` — generates each event's QR code
- `app/dashboard/page.jsx` — internal event tracker (gated by `DASHBOARD_PASSWORD`)
- `app/gallery/[bookingId]/page.jsx` — final client delivery page
- `app/api/bookings/route.js` — creates a booking + starts Stripe Checkout
- `app/api/webhooks/stripe/route.js` — marks booking paid, sends confirmation email
- `scripts/auto-recap.js` — the full pipeline: curation, video assembly, Roast Reel, delivery
- `scripts/poll-and-recap.js` — finds eligible bookings and runs the pipeline on them; also purges expired galleries. Run on a schedule by `.github/workflows/recap-scheduler.yml`
- `lib/roast.js` — Roast Reel script generation (Anthropic)
- `lib/video-assemble.js` — ffmpeg-based video assembly
- `lib/storage.js` — R2 upload/download helpers
- `lib/email.js` — Resend email templates
- `scripts/check-email-auth.js` — verifies SPF/DKIM/DMARC on the sending domain (see `docs/EMAIL_AUTH.md`)
- `middleware.js` — dashboard auth gate
- `schema.sql` — base database schema
- `migrations/` — additive schema changes since `schema.sql`, run in order
