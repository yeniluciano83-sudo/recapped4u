import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/mockSupabase";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GET } from "./route";

function makeRequest() {
  return { headers: { get: () => null } };
}

describe("GET /api/bookings/[id]/analysis-failures", () => {
  let sb;

  beforeEach(() => {
    sb = createSupabaseMock();
    supabase.from.mockImplementation(sb.from);
  });

  it("returns the failures for a booking", async () => {
    const failures = [{ id: "f1", storage_key: "k1", error_message: "bad file", created_at: "2026-01-01" }];
    sb.mockResponse({ data: failures, error: null });
    const res = await GET(makeRequest(), { params: { id: "b1" } });
    const json = await res.json();
    expect(json).toEqual({ failures });
  });

  it("returns an empty list when there are no failures", async () => {
    sb.mockResponse({ data: [], error: null });
    const res = await GET(makeRequest(), { params: { id: "b1" } });
    const json = await res.json();
    expect(json).toEqual({ failures: [] });
  });

  it("degrades to an empty list rather than erroring when the table/column is missing (pre-migration-024)", async () => {
    sb.mockResponse({ data: null, error: new Error("relation does not exist") });
    const res = await GET(makeRequest(), { params: { id: "b1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ failures: [] });
  });
});
