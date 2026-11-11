import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("provides working localStorage and sessionStorage", () => {
    for (const s of [localStorage, window.localStorage, sessionStorage]) {
      expect(s).toBeDefined();
      s.setItem("zhess:probe", "1");
      expect(s.getItem("zhess:probe")).toBe("1");
      s.removeItem("zhess:probe");
      expect(s.getItem("zhess:probe")).toBeNull();
    }
  });
});
