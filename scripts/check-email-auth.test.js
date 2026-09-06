import { describe, it, expect } from "vitest";
import { evaluate, parseDmarc, ruaMailtoDomains, flattenTxt } from "./check-email-auth";

const DOMAIN = "recappedforyou.com";

// A fully-configured domain: SPF with SES, Resend DKIM, enforced DMARC with a
// reachable rua.
const GOOD = {
  domain: DOMAIN,
  rootTxt: ["v=spf1 include:amazonses.com -all"],
  dkimTxt: ["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDalxXbHwDp3cQfDUP6S01"],
  dmarcTxt: ["v=DMARC1; p=reject; rua=mailto:dmarc@recappedforyou.com; fo=1"],
  ruaDomainHasMx: { "recappedforyou.com": true },
};

describe("evaluate", () => {
  it("passes a fully-configured domain", () => {
    const { ok, checks } = evaluate(GOOD);
    expect(ok).toBe(true);
    expect(checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("fails when SPF is missing entirely", () => {
    const { ok, checks } = evaluate({ ...GOOD, rootTxt: ["some=other-txt-record"] });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "SPF").status).toBe("fail");
  });

  it("fails when two SPF records exist", () => {
    const { ok, checks } = evaluate({
      ...GOOD,
      rootTxt: ["v=spf1 include:amazonses.com ~all", "v=spf1 include:_spf.mx.cloudflare.net ~all"],
    });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "SPF").detail).toMatch(/only one allowed/);
  });

  it("warns when SPF is present but does not authorize SES", () => {
    const { checks } = evaluate({ ...GOOD, rootTxt: ["v=spf1 include:_spf.google.com ~all"] });
    const spf = checks.find((c) => c.name === "SPF");
    expect(spf.status).toBe("warn");
    expect(spf.detail).toMatch(/amazonses\.com/);
  });

  it("accepts a merged SES + Cloudflare SPF record", () => {
    const { checks } = evaluate({
      ...GOOD,
      rootTxt: ["v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all"],
    });
    expect(checks.find((c) => c.name === "SPF").status).toBe("pass");
  });

  it("fails when the Resend DKIM key is absent", () => {
    const { ok, checks } = evaluate({ ...GOOD, dkimTxt: [] });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "DKIM").status).toBe("fail");
  });

  it("fails DMARC when there is no record", () => {
    const { ok, checks } = evaluate({ ...GOOD, dmarcTxt: [] });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "DMARC").status).toBe("fail");
  });

  it("fails DMARC policy when p=none", () => {
    const { ok, checks } = evaluate({
      ...GOOD,
      dmarcTxt: ["v=DMARC1; p=none; rua=mailto:dmarc@recappedforyou.com"],
    });
    expect(ok).toBe(false);
    const policy = checks.find((c) => c.name === "DMARC policy");
    expect(policy.status).toBe("fail");
    expect(policy.detail).toMatch(/monitor only/);
  });

  it("warns (does not fail) at p=quarantine", () => {
    const { ok, checks } = evaluate({
      ...GOOD,
      dmarcTxt: ["v=DMARC1; p=quarantine; rua=mailto:dmarc@recappedforyou.com"],
    });
    expect(ok).toBe(true);
    expect(checks.find((c) => c.name === "DMARC policy").status).toBe("warn");
  });

  it("fails when the rua address is on a domain with no MX", () => {
    const { ok, checks } = evaluate({
      ...GOOD,
      dmarcTxt: ["v=DMARC1; p=reject; rua=mailto:hello@recappedforyou.com"],
      ruaDomainHasMx: { "recappedforyou.com": false },
    });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "DMARC rua").detail).toMatch(/bounce/);
  });

  it("does not fail on an external rua provider even without MX data", () => {
    const { ok, checks } = evaluate({
      ...GOOD,
      dmarcTxt: ["v=DMARC1; p=reject; rua=mailto:xyz@dmarc.cloudflare.net"],
      ruaDomainHasMx: {},
    });
    expect(ok).toBe(true);
    expect(checks.find((c) => c.name === "DMARC rua").status).toBe("pass");
  });

  it("warns when DMARC has no rua at all", () => {
    const { checks } = evaluate({ ...GOOD, dmarcTxt: ["v=DMARC1; p=reject"] });
    expect(checks.find((c) => c.name === "DMARC rua").status).toBe("warn");
  });

  // SPF authenticates the envelope sender, and Resend bounces through
  // send.<domain> -- so that is where receivers look, not the apex. Checking
  // the apex alone produced a hard FAIL against a domain that was
  // authenticating and delivering perfectly.
  describe("SPF is read from the bounce domain, not the apex", () => {
    it("passes on a bounce-domain record with an empty apex", () => {
      const { checks } = evaluate({
        ...GOOD,
        rootTxt: [],
        bounceTxt: ["v=spf1 include:amazonses.com ~all"],
      });
      const spf = checks.find((c) => c.name === "SPF");
      expect(spf.status).toBe("pass");
      expect(spf.detail).toContain(`send.${DOMAIN}`);
    });

    it("flags a missing apex record as an optional warning, never a failure", () => {
      const { ok, checks } = evaluate({
        ...GOOD,
        rootTxt: [],
        bounceTxt: ["v=spf1 include:amazonses.com ~all"],
        dmarcTxt: ["v=DMARC1; p=reject; rua=mailto:dmarc@external-provider.com"],
      });
      expect(checks.find((c) => c.name === "SPF (apex, optional)").status).toBe("warn");
      expect(ok).toBe(true);
    });

    it("stays quiet about the apex when the apex also has SPF", () => {
      const { checks } = evaluate({
        ...GOOD,
        rootTxt: ["v=spf1 include:amazonses.com -all"],
        bounceTxt: ["v=spf1 include:amazonses.com ~all"],
      });
      expect(checks.find((c) => c.name === "SPF (apex, optional)")).toBeUndefined();
    });

    it("still fails when neither the bounce domain nor the apex has a record", () => {
      const { checks } = evaluate({ ...GOOD, rootTxt: [], bounceTxt: [] });
      const spf = checks.find((c) => c.name === "SPF");
      expect(spf.status).toBe("fail");
      expect(spf.detail).toContain(`send.${DOMAIN}`);
    });
  });

  it("reflects today's actual production state (SPF + DKIM good, DMARC p=none, dead rua)", () => {
    const { ok, checks } = evaluate({
      domain: DOMAIN,
      rootTxt: [],
      bounceTxt: ["v=spf1 include:amazonses.com ~all"],
      dkimTxt: ["p=MIGfMA0GCSqGSIb3DQEB"],
      dmarcTxt: ["v=DMARC1; p=none; rua=mailto:hello@recappedforyou.com"],
      ruaDomainHasMx: { "recappedforyou.com": false },
    });
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name === "SPF").status).toBe("pass");
    expect(checks.find((c) => c.name === "DKIM").status).toBe("pass");
    // The two things genuinely still outstanding.
    expect(checks.find((c) => c.name === "DMARC policy").status).toBe("fail");
    expect(checks.find((c) => c.name === "DMARC rua").status).toBe("fail");
  });
});

describe("parseDmarc", () => {
  it("splits tag=value pairs and lowercases keys", () => {
    expect(parseDmarc("v=DMARC1; P=quarantine; rua=mailto:a@b.com; fo=1")).toEqual({
      v: "DMARC1",
      p: "quarantine",
      rua: "mailto:a@b.com",
      fo: "1",
    });
  });

  it("keeps '=' inside a value intact", () => {
    expect(parseDmarc("v=DMARC1; rua=mailto:a@b.com?subject=x=y").rua).toBe("mailto:a@b.com?subject=x=y");
  });
});

describe("ruaMailtoDomains", () => {
  it("extracts every mailto domain, lowercased", () => {
    expect(ruaMailtoDomains("mailto:A@X.COM, mailto:b@y.net")).toEqual(["x.com", "y.net"]);
  });

  it("returns [] for empty / missing input", () => {
    expect(ruaMailtoDomains(undefined)).toEqual([]);
    expect(ruaMailtoDomains("")).toEqual([]);
  });
});

describe("flattenTxt", () => {
  it("joins the chunked string[][] form from dns.resolveTxt", () => {
    expect(flattenTxt([["v=spf1 ", "include:amazonses.com ~all"], ["other"]])).toEqual([
      "v=spf1 include:amazonses.com ~all",
      "other",
    ]);
  });
});
