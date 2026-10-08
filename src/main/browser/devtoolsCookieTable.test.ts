import { describe, expect, it } from "vitest";
import { parseDevtoolsCookieTable } from "./devtoolsCookieTable";

/** DevTools Cookie 表格（无表头，列序：name value domain path expires size httpOnly secure sameSite） */
const TABLE_NO_HEADER = [
  ["SID", "abc123", ".google.com", "/", "2027-10-08T11:00:00.000Z", "9", "✓", "✓", "Lax"].join(
    "\t",
  ),
  ["__Host-GAPS", "gaps-value", "accounts.google.com", "/", "Session", "12", "✓", "", "Lax"].join(
    "\t",
  ),
  ["NID", "nid-value", ".google.com", "/", "2027-04-08T11:00:00.000Z", "9", "✓", "✓", ""].join(
    "\t",
  ),
].join("\n");

describe("parseDevtoolsCookieTable", () => {
  it("maps positional columns including domain / host-only, flags and expiry", () => {
    const cookies = parseDevtoolsCookieTable(TABLE_NO_HEADER);
    expect(cookies).not.toBeNull();
    expect(cookies).toHaveLength(3);

    const sid = cookies?.[0];
    expect(sid).toMatchObject({
      name: "SID",
      value: "abc123",
      domain: ".google.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    expect(sid?.expires).toBe(Math.floor(Date.parse("2027-10-08T11:00:00.000Z") / 1000));

    const gaps = cookies?.[1];
    expect(gaps).toMatchObject({
      name: "__Host-GAPS",
      domain: "accounts.google.com",
      httpOnly: true,
      secure: false,
      expires: undefined,
      sameSite: "lax",
    });

    expect(cookies?.[2]?.sameSite).toBe("unspecified");
  });

  it("accepts a table that still has the header row", () => {
    const header = [
      "Name",
      "Value",
      "Domain",
      "Path",
      "Expires / Max-Age",
      "Size",
      "HttpOnly",
      "Secure",
      "SameSite",
    ].join("\t");
    const cookies = parseDevtoolsCookieTable(`${header}\n${TABLE_NO_HEADER}`);
    expect(cookies).toHaveLength(3);
    expect(cookies?.[0]?.name).toBe("SID");
    expect(cookies?.[0]?.expires).toBeDefined();
  });

  it("tolerates a missing Size column (older/newer DevTools)", () => {
    const row = [
      "sid",
      "v",
      ".example.com",
      "/",
      "2027-01-01T00:00:00.000Z",
      "✓",
      "✓",
      "None",
    ].join("\t");
    const cookies = parseDevtoolsCookieTable(row);
    expect(cookies?.[0]).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "no_restriction",
    });
  });

  it("parses several pasted tables at once and skips unusable rows", () => {
    const second = [
      "OTZ",
      "otz-value",
      "accounts.google.com",
      "/",
      "2026-11-07T11:00:00.000Z",
      "7",
      "",
      "✓",
      "Lax",
    ].join("\t");
    const broken = ["no-tabs-here"];
    const cookies = parseDevtoolsCookieTable(`${TABLE_NO_HEADER}\n${second}\n${broken}`);
    expect(cookies).toHaveLength(4);
    expect(cookies?.map((cookie) => cookie.name)).toEqual(["SID", "__Host-GAPS", "NID", "OTZ"]);
  });

  it("returns null for non-table text so the caller can fall back to name=value pairs", () => {
    expect(parseDevtoolsCookieTable("sid=abc; other=1")).toBeNull();
    expect(parseDevtoolsCookieTable("")).toBeNull();
    expect(parseDevtoolsCookieTable("Cookie: sid=abc; other=1")).toBeNull();
  });

  it("does not treat a bogus row as a cookie (missing path/domain)", () => {
    expect(parseDevtoolsCookieTable("a\tb\tc\td")).toBeNull();
  });
});
