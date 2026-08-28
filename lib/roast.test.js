import { describe, it, expect } from "vitest";
import { validateAndSortRoastScript } from "./roast";

describe("validateAndSortRoastScript", () => {
  it("passes through a script that's already in order", () => {
    const script = [
      { photo_index: 0, line: "a" },
      { photo_index: 1, line: "b" },
      { photo_index: 2, line: "c" },
    ];
    expect(validateAndSortRoastScript(script, 3)).toEqual(script);
  });

  it("sorts a script whose entries arrive out of order", () => {
    const script = [
      { photo_index: 2, line: "c" },
      { photo_index: 0, line: "a" },
      { photo_index: 1, line: "b" },
    ];
    expect(validateAndSortRoastScript(script, 3)).toEqual([
      { photo_index: 0, line: "a" },
      { photo_index: 1, line: "b" },
      { photo_index: 2, line: "c" },
    ]);
  });

  it("rejects a response with the wrong number of lines", () => {
    const script = [{ photo_index: 0, line: "a" }];
    expect(() => validateAndSortRoastScript(script, 2)).toThrow(/mismatch/);
  });

  it("rejects a non-array response", () => {
    expect(() => validateAndSortRoastScript({ not: "an array" }, 1)).toThrow(/mismatch/);
  });

  it("rejects a duplicate photo_index", () => {
    const script = [
      { photo_index: 0, line: "a" },
      { photo_index: 0, line: "b" },
    ];
    expect(() => validateAndSortRoastScript(script, 2)).toThrow(/duplicate/);
  });

  it("rejects a photo_index outside the valid range", () => {
    const script = [
      { photo_index: 0, line: "a" },
      { photo_index: 5, line: "b" },
    ];
    expect(() => validateAndSortRoastScript(script, 2)).toThrow(/invalid or duplicate/);
  });

  it("rejects a missing or non-numeric photo_index", () => {
    const script = [{ line: "a" }];
    expect(() => validateAndSortRoastScript(script, 1)).toThrow(/invalid or duplicate/);
  });
});
