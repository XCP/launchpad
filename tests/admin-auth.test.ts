import { describe, expect, it } from "vitest";
import { authed } from "#api/admin-auth";

describe("admin authentication", () => {
  it("accepts the exact configured token including non-ASCII characters", () => {
    expect(authed("token-😊", "token-😊")).toBe(true);
  });
  it.each([undefined, "", "t", "token-😁", "token-😊 ", "token-😊extra"])("rejects a missing or different token: %s", supplied => {
    expect(authed(supplied, "token-😊")).toBe(false);
  });
  it.each([undefined, ""])("fails closed when the secret is unconfigured: %s", expected => {
    expect(authed(expected, expected)).toBe(false);
  });
});
