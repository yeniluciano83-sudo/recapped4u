# Recapped For You — Setup Checklist

This is the full app skeleton: booking flow, guest upload page, internal
dashboard, gallery delivery, Stripe payment, email, and the AI curation
pipeline, wired together. The code is done — what's left is account
creation and pasting keys into `.env.local`. Roughly 45–90 minutes.

## 1. Accounts to create (all free to start)

1. **Vercel** (vercel.com) — hosting. Sign up with GitHub.
2. **Supabase** (supabase.com) — database. Create a new project, then:
   - Go to the SQL Editor, paste in `schema.sql`, run it.
   - Go to Project Settings → API, copy `Project URL` and `service_role` key.
3. **Cloudflare R2** (dash.cloudflare.com) — file storage.
   - Create a bucket (e.g. `recapped-uploads`).
   - Go to "Manage R2 API Tokens," create a token, copy Account ID, Access Key ID, Secret Access Key.
4. **Stripe** (stripe.com) — payments.
   - Get your API key from Developers → API keys (use the test key first).
   - You'll add the webhook secret after deploying (step 4 below).
5. **Resend** (resend.com) — email sending.
   - Verify a sending domain (or use their test domain while developing).
   - Copy your API key from API Keys.
6. **Anthropic** (console.anthropic.com) — for the curation pipeline.
   - Copy your API key.

## 2. Local setup

```bash
npm install
cp .env.example .env.local
# paste every key you copied above into .env.local
npm run dev
```

Visit `localhost:3000/booking` to test the booking flow end-to-end
(use a Stripe test card: 4242 4242 4242 4242, any future date/CVC).

## 3. Deploy

```bash
git init && git add . && git commit -m "initial"
# push to a new GitHub repo, then in Vercel: "Import Project" from that repo
```

In Vercel's project settings, add every variable from `.env.local` under
Environment Variables, then redeploy.

## 4. Connect the Stripe webhook (after deploying)

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://yourdomain.com/api/webhooks/stripe`
3. Event to send: `checkout.session.completed`
4. Copy the generated signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel's env vars, redeploy.

## 5. Point your domain

In Vercel → Domains, add `recappedforyou.com` (or whatever you registered)
and follow the DNS instructions it gives you.

## What's still manual per event (not yet automated)

- Generating each event's QR code from its `upload_slug` — the `qrcode`
  npm package is already in package.json; a small script or admin button
  using it is the next thing to add once you're testing with real events.
- Triggering `lib/curate.js` — currently a standalone script; wiring it to
  run automatically when a booking's status changes to "editing" is a
  small serverless function, worth adding once real files are flowing
  through R2.
- File cleanup — a scheduled job (Vercel Cron or a Supabase Edge Function)
  to delete raw uploads 30 days after delivery, matching the retention
  policy already reflected in the UI copy and database schema.

## File map

- `app/booking/page.jsx` — client-facing booking form (4-step flow)
- `app/event/[eventId]/page.jsx` — guest upload page (QR code destination)
- `app/dashboard/page.jsx` — your internal event tracker
- `app/gallery/[bookingId]/page.jsx` — final client delivery page
- `app/api/bookings/route.js` — creates a booking + starts Stripe Checkout
- `app/api/webhooks/stripe/route.js` — marks booking paid, sends confirmation email
- `lib/curate.js` — AI curation pipeline (run manually or wire to automate)
- `lib/storage.js` — R2 upload/download helpers
- `lib/email.js` — Resend email templates
- `schema.sql` — full database schema
