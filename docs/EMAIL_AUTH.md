# Email authentication (SPF / DKIM / DMARC)

All transactional mail (`lib/email.js`) goes out through **Resend** from
`hello@recappedforyou.com`. DNS for `recappedforyou.com` is on **Cloudflare**.

Unauthenticated mail from a young domain that links back to itself is one of
the strongest "deceptive site" signals Google Safe Browsing and the mailbox
providers act on. This doc gets the domain to **DMARC-passing on both SPF and
DKIM**, with an enforced policy.

Run `node scripts/check-email-auth.js` at any point to see current state.

---

## Current state (2026-09-06)

| Mechanism | State | Notes |
|-----------|-------|-------|
| **DKIM**  | ✅ configured | `resend._domainkey.recappedforyou.com` publishes a valid key; Resend signs `d=recappedforyou.com`. |
| **SPF**   | ✅ configured | On the **bounce domain**, via the section 3 custom return-path: `send.recappedforyou.com` publishes `v=spf1 include:amazonses.com ~all` plus the SES feedback MX. Resend reports both as verified. |
| **DMARC** | ⚠️ weak | `v=DMARC1; p=none; rua=mailto:hello@recappedforyou.com` — monitor-only, and `hello@` has no MX, so aggregate reports bounce. **The only real gap left.** |
| **MX**    | ❌ none | `hello@recappedforyou.com` cannot receive mail (the address the site lists as its contact). Also why the `rua` above is dead. |

Both mechanisms now pass *and* align, so DMARC rides on either one rather than
DKIM alone. Evidence: the last 100 sends through Resend all report `delivered`.

> **SPF lives on `send.`, not the apex — this trips people up.** SPF
> authenticates the envelope sender (Return-Path), not the visible `From:`
> header, and the section 3 return-path moves that envelope to
> `send.recappedforyou.com`. Checking the apex therefore shows "no SPF" on a
> domain whose mail authenticates perfectly. `scripts/check-email-auth.js`
> made exactly that mistake and reported a hard FAIL for it; it now checks the
> bounce domain. An apex `v=spf1` is optional hardening (it denies spoofers a
> domain with no stated policy) and is not required for Resend delivery.

The one gap that still costs us: `p=none` asks receivers to do nothing about
failures, and the dead `rua` means we can't see them either.

> **Resend is the only thing that sends as `@recappedforyou.com`** — confirmed
> 2026-09-06. No Gmail "send as" alias, no CRM, no newsletter tool. That single
> fact is what makes enforcement safe: the usual reason to sit at `p=none` is
> to discover senders you'd forgotten, and there are none to discover. Stripe
> and Vercel both send from their own domains, not this one. **If that ever
> stops being true, add the new sender's SPF include and confirm it passes
> before it meets `p=reject`** — under an enforced policy an unauthenticated
> sender doesn't degrade, it disappears.

---

## 1. Apex SPF — optional, and NOT what fixes sending

> **Superseded by section 3, which is already done.** Sending is authenticated
> by the SPF record on `send.recappedforyou.com`, because that's the envelope
> domain receivers evaluate. Adding an apex record does not improve Resend
> deliverability. Its only value is denying a spoofer a domain with no
> published policy, and if you want that, `v=spf1 -all` says it more honestly
> than the SES include below — nothing legitimately sends with an apex
> envelope. Skip to section 5 if you're here to fix DMARC.

Cloudflare dashboard → **DNS → Records → Add record**:

| Field | Value |
|-------|-------|
| Type  | `TXT` |
| Name  | `@` (i.e. `recappedforyou.com`) |
| Content | `v=spf1 include:amazonses.com ~all` |
| TTL   | Auto |

Resend sends through Amazon SES, so `include:amazonses.com` is the correct
mechanism. `~all` (softfail) rather than `-all` while we confirm nothing else
sends as the domain; tighten to `-all` later.

> **Only one SPF record is allowed per domain.** If you later enable Cloudflare
> Email Routing (section 4), it wants to add `include:_spf.mx.cloudflare.net`.
> Do **not** add a second `v=spf1` record — merge the includes into one:
> `v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all`

## 2. Confirm DKIM is still green

No DNS change needed — the `resend._domainkey` CNAME/TXT is already live.
In the **Resend dashboard → Domains → recappedforyou.com**, confirm the domain
still shows **Verified** and DKIM is green. If Resend ever shows it as failed,
re-copy the DKIM records it lists into Cloudflare (Name `resend._domainkey`).

## 3. Enable SPF *alignment* via Resend custom return-path (recommended)

By default Resend uses its own bounce domain as the envelope sender, so SPF
passes but doesn't *align* with `recappedforyou.com` — DMARC then rides on DKIM
only. Adding a custom return-path makes SPF align too, so DMARC survives even
if DKIM breaks in transit (mailing lists, some forwarders).

1. Resend dashboard → **Domains → recappedforyou.com → enable "Custom return
   path"** (Resend may call it MAIL FROM / bounce subdomain). It defaults to
   the subdomain `send`.
2. Resend will show two records — add both in Cloudflare exactly as given.
   They look like:

   | Type | Name | Value |
   |------|------|-------|
   | `MX`  | `send` | `feedback-smtp.<region>.amazonses.com` (priority `10`) |
   | `TXT` | `send` | `v=spf1 include:amazonses.com ~all` |

   `<region>` matches your Resend account's region (shown in the dashboard,
   e.g. `us-east-1`).
3. Wait for Resend to mark the return-path **Verified**.

## 4. (Optional) Cloudflare Email Routing — make `hello@` a real inbox

The site lists `hello@recappedforyou.com` as its contact address but nothing
receives there. A working inbox is a Safe-Browsing-review trust signal and
gives customers a real reply path.

Cloudflare dashboard → **Email → Email Routing → Get started**:

- Cloudflare adds 3 `MX` records + its SPF include automatically. **Merge**
  its SPF include with Resend's (see the warning in section 1) — end state:
  `v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all`
- Add routes: `hello@recappedforyou.com` → your real inbox, and
  `dmarc@recappedforyou.com` → your real inbox (used in section 5).
- Once this is live, set `REPLY_TO=hello@recappedforyou.com` in the app's env
  (Vercel + GitHub Actions secrets). `lib/email.js` picks it up automatically.

## 5. Strengthen DMARC

Two ways to get a working `rua` (aggregate-report inbox):

**Option A — Cloudflare DMARC Management (no MX needed, parses in-dashboard):**
Cloudflare dashboard → **Email → DMARC Management → Enable**. Cloudflare
rewrites the `_dmarc` TXT record with its own reporting address and shows
parsed reports in the dashboard. After enabling, **edit the record** so the
policy is enforced — final value:

```
v=DMARC1; p=quarantine; rua=mailto:<address Cloudflare inserted>; fo=1; pct=100
```

**Option B — self-hosted `rua` (needs section 4 done):**
Replace the `_dmarc.recappedforyou.com` TXT record with:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@recappedforyou.com; fo=1; pct=100
```

Either way:

- We send through exactly one ESP (Resend) and DKIM already aligns, so going
  straight to `p=quarantine` is safe. Keep it there ~1 week, watch the
  aggregate reports for any source that isn't Resend, then move to `p=reject`.
- If you'd rather ramp: ship `p=none` with the working `rua` first, confirm a
  few days of 100%-pass reports, then `p=quarantine`, then `p=reject`.

---

## Verifying

```
node scripts/check-email-auth.js
```

Exits non-zero if SPF is missing, DKIM is missing, or DMARC is absent /
`p=none` / has an unreachable `rua`. Run it after each DNS change (allow a few
minutes for propagation). External cross-checks: [MXToolbox
SuperTool](https://mxtoolbox.com/SuperTool.aspx), Google Admin Toolbox, or
send a message to `check-auth@verifier.port25.com`.
