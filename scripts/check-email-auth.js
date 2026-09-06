/**
 * Checks that the sending domain has SPF, DKIM (Resend), and an enforced
 * DMARC policy with a reachable aggregate-report address.
 *
 * Background + the exact records to add live in docs/EMAIL_AUTH.md. Run this
 * after each DNS change (allow a few minutes for propagation):
 *
 *   node scripts/check-email-auth.js [domain]
 *
 * Domain defaults to the host of APP_URL, else recappedforyou.com. Exits
 * non-zero if any check fails, so it can gate a deploy or run in CI.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local"), quiet: true });
const dns = require("dns/promises");

const DKIM_SELECTOR = "resend._domainkey"; // Resend's fixed selector

function domainFromEnv() {
  try {
    if (process.env.APP_URL) return new URL(process.env.APP_URL).host.replace(/^www\./, "");
  } catch {
    /* fall through */
  }
  return "recappedforyou.com";
}

// Join the chunked form dns.resolveTxt returns (string[][]) into plain strings.
function flattenTxt(records) {
  return (records || []).map((chunks) => (Array.isArray(chunks) ? chunks.join("") : String(chunks)));
}

async function safeResolveTxt(name) {
  try {
    return flattenTxt(await dns.resolveTxt(name));
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") return [];
    throw err;
  }
}

async function safeResolveMx(name) {
  try {
    return await dns.resolveMx(name);
  } catch (err) {
    if (err.code === "ENOTFOUND" || err.code === "ENODATA") return [];
    throw err;
  }
}

function parseDmarc(txt) {
  const tags = {};
  for (const part of txt.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) tags[k.trim().toLowerCase()] = rest.join("=").trim();
  }
  return tags;
}

function ruaMailtoDomains(ruaValue) {
  // rua=mailto:a@x.com,mailto:b@y.net  ->  ["x.com", "y.net"]
  return (ruaValue || "")
    .split(",")
    .map((s) => s.trim().replace(/^mailto:/i, ""))
    .filter(Boolean)
    .map((addr) => addr.split("@")[1])
    .filter(Boolean)
    .map((d) => d.toLowerCase());
}

/**
 * Pure evaluation of already-resolved DNS data. Returns
 * { ok: boolean, checks: [{ name, status: "pass"|"warn"|"fail", detail }] }.
 *
 * @param {object} input
 * @param {string}   input.domain
 * @param {string[]} input.rootTxt          TXT records on the apex
 * @param {string[]} input.dkimTxt          TXT records on resend._domainkey.<domain>
 * @param {string[]} input.dmarcTxt         TXT records on _dmarc.<domain>
 * @param {Record<string, boolean>} input.ruaDomainHasMx
 *        for each in-scope rua domain (the sending domain or a subdomain of
 *        it), whether it currently has an MX record. External report
 *        providers (cloudflare, dmarc aggregators, ...) are assumed reachable.
 */
function evaluate({ domain, rootTxt = [], dkimTxt = [], dmarcTxt = [], ruaDomainHasMx = {} }) {
  const checks = [];

  // --- SPF ---
  const spf = rootTxt.filter((t) => /^v=spf1\b/i.test(t.trim()));
  if (spf.length === 0) {
    checks.push({ name: "SPF", status: "fail", detail: `no v=spf1 record on ${domain}` });
  } else if (spf.length > 1) {
    checks.push({ name: "SPF", status: "fail", detail: `${spf.length} SPF records (only one allowed): ${spf.join(" || ")}` });
  } else {
    const rec = spf[0].trim();
    const hasSes = /include:amazonses\.com/i.test(rec);
    const allMech = (rec.match(/[~\-+?]all\b/) || [])[0] || "(none)";
    checks.push({
      name: "SPF",
      status: hasSes ? "pass" : "warn",
      detail: hasSes
        ? `${rec}  (${allMech})`
        : `present but missing include:amazonses.com — Resend mail will not be authorized: ${rec}`,
    });
  }

  // --- DKIM (Resend) ---
  const dkim = dkimTxt.filter((t) => /(^|;|\s)p=[A-Za-z0-9+/]+/.test(t));
  if (dkim.length === 0) {
    checks.push({ name: "DKIM", status: "fail", detail: `no key at ${DKIM_SELECTOR}.${domain}` });
  } else {
    checks.push({ name: "DKIM", status: "pass", detail: `${DKIM_SELECTOR}.${domain} publishes a key` });
  }

  // --- DMARC ---
  const dmarcRecs = dmarcTxt.filter((t) => /^v=dmarc1\b/i.test(t.trim()));
  if (dmarcRecs.length === 0) {
    checks.push({ name: "DMARC", status: "fail", detail: `no v=DMARC1 record on _dmarc.${domain}` });
  } else {
    const tags = parseDmarc(dmarcRecs[0]);
    const policy = (tags.p || "none").toLowerCase();
    if (policy === "none") {
      checks.push({ name: "DMARC policy", status: "fail", detail: `p=none (monitor only) — move to p=quarantine, then p=reject` });
    } else if (policy === "quarantine") {
      checks.push({ name: "DMARC policy", status: "warn", detail: `p=quarantine — tighten to p=reject once reports are clean` });
    } else if (policy === "reject") {
      checks.push({ name: "DMARC policy", status: "pass", detail: `p=reject` });
    } else {
      checks.push({ name: "DMARC policy", status: "fail", detail: `unrecognized p=${policy}` });
    }

    const ruaDomains = ruaMailtoDomains(tags.rua);
    if (ruaDomains.length === 0) {
      checks.push({ name: "DMARC rua", status: "warn", detail: `no rua= — you get no aggregate reports` });
    } else {
      const inScope = (d) => d === domain || d.endsWith("." + domain);
      const broken = ruaDomains.filter((d) => inScope(d) && ruaDomainHasMx[d] === false);
      if (broken.length) {
        checks.push({
          name: "DMARC rua",
          status: "fail",
          detail: `reports sent to ${broken.join(", ")} which has no MX — they will bounce`,
        });
      } else {
        checks.push({ name: "DMARC rua", status: "pass", detail: `rua=${tags.rua}` });
      }
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks };
}

async function main() {
  const domain = process.argv[2] || domainFromEnv();
  console.log(`Checking email authentication for ${domain}\n`);

  const [rootTxt, dkimTxt, dmarcTxt, apexMx] = await Promise.all([
    safeResolveTxt(domain),
    safeResolveTxt(`${DKIM_SELECTOR}.${domain}`),
    safeResolveTxt(`_dmarc.${domain}`),
    safeResolveMx(domain),
  ]);

  // Resolve MX only for rua domains that are this domain or a subdomain of it.
  const dmarcRec = dmarcTxt.find((t) => /^v=dmarc1\b/i.test(t.trim()));
  const ruaDomainHasMx = {};
  if (dmarcRec) {
    const ruaDomains = ruaMailtoDomains(parseDmarc(dmarcRec).rua);
    for (const d of ruaDomains) {
      if (d === domain || d.endsWith("." + domain)) {
        ruaDomainHasMx[d] = d === domain ? apexMx.length > 0 : (await safeResolveMx(d)).length > 0;
      }
    }
  }

  const { ok, checks } = evaluate({ domain, rootTxt, dkimTxt, dmarcTxt, ruaDomainHasMx });

  const mark = { pass: "PASS", warn: "WARN", fail: "FAIL" };
  for (const c of checks) console.log(`  [${mark[c.status]}] ${c.name}: ${c.detail}`);
  console.log(`\n  MX on ${domain}: ${apexMx.length ? apexMx.map((m) => `${m.exchange}(${m.priority})`).join(", ") : "none"}`);
  console.log(`\n${ok ? "OK — no failing checks." : "FAILED — see docs/EMAIL_AUTH.md for the records to add."}`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("check-email-auth: unexpected error:", err);
    process.exit(2);
  });
}

module.exports = { evaluate, parseDmarc, ruaMailtoDomains, flattenTxt };
