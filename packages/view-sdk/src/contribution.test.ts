import { describe, expect, it } from "vitest";
import {
  parseContributionKeyMap,
  readContributionKeysEnv,
  resolveContributionKey,
} from "./contribution.js";

/** docs/design/19 §3.1.1 验证：env 缺失 / 非法 JSON / 非对象 / 值非字符串 / 正常命中。 */
describe("resolveContributionKey", () => {
  it("returns undefined when the env var is absent (headless pi / TUI)", () => {
    expect(resolveContributionKey("yoki-plan", {})).toBeUndefined();
    expect(readContributionKeysEnv({})).toBeUndefined();
  });

  it("returns undefined on malformed JSON instead of throwing", () => {
    expect(
      resolveContributionKey("yoki-plan", { PIDESK_VIEW_CONTRIBUTION_KEYS: "{not json" }),
    ).toBeUndefined();
  });

  it("returns undefined when the payload is not a JSON object", () => {
    expect(
      resolveContributionKey("yoki-plan", { PIDESK_VIEW_CONTRIBUTION_KEYS: '"ck:str"' }),
    ).toBeUndefined();
    expect(
      resolveContributionKey("yoki-plan", { PIDESK_VIEW_CONTRIBUTION_KEYS: "null" }),
    ).toBeUndefined();
    expect(
      resolveContributionKey("yoki-plan", { PIDESK_VIEW_CONTRIBUTION_KEYS: "42" }),
    ).toBeUndefined();
    expect(
      resolveContributionKey("yoki-plan", { PIDESK_VIEW_CONTRIBUTION_KEYS: "[]" }),
    ).toBeUndefined();
    expect(
      resolveContributionKey("yoki-plan", { PIDESK_VIEW_CONTRIBUTION_KEYS: '["ck:0"]' }),
    ).toBeUndefined();
  });

  it("ignores non-string and empty-string values", () => {
    const env = { PIDESK_VIEW_CONTRIBUTION_KEYS: '{"a":7,"b":null,"c":"","d":{"k":"v"}}' };
    expect(resolveContributionKey("a", env)).toBeUndefined();
    expect(resolveContributionKey("b", env)).toBeUndefined();
    expect(resolveContributionKey("c", env)).toBeUndefined();
    expect(resolveContributionKey("d", env)).toBeUndefined();
  });

  it("returns the bound key on a hit and undefined for unknown ids", () => {
    const env = { PIDESK_VIEW_CONTRIBUTION_KEYS: '{"yoki-plan":"ck:9f3a","other":"ck:x"}' };
    expect(resolveContributionKey("yoki-plan", env)).toBe("ck:9f3a");
    expect(resolveContributionKey("other", env)).toBe("ck:x");
    expect(resolveContributionKey("missing", env)).toBeUndefined();
  });

  it("prefers PIDESK_VIEW_ over PI_VIEW_", () => {
    const env = {
      PIDESK_VIEW_CONTRIBUTION_KEYS: '{"yoki-plan":"ck:new"}',
      PI_VIEW_CONTRIBUTION_KEYS: '{"yoki-plan":"ck:old"}',
    };
    expect(resolveContributionKey("yoki-plan", env)).toBe("ck:new");
  });

  it("falls back to PI_VIEW_ when the PIDESK_ prefix is absent", () => {
    const env = { PI_VIEW_CONTRIBUTION_KEYS: '{"yoki-plan":"ck:legacy"}' };
    expect(resolveContributionKey("yoki-plan", env)).toBe("ck:legacy");
  });
});

describe("parseContributionKeyMap", () => {
  it("returns an empty map for undefined / malformed / non-object payloads", () => {
    expect(parseContributionKeyMap(undefined)).toEqual({});
    expect(parseContributionKeyMap("")).toEqual({});
    expect(parseContributionKeyMap("{")).toEqual({});
    expect(parseContributionKeyMap("[]")).toEqual({});
    expect(parseContributionKeyMap("false")).toEqual({});
  });

  it("keeps only non-empty string entries", () => {
    expect(parseContributionKeyMap('{"a":"ck:1","b":2,"c":"","d":true}')).toEqual({ a: "ck:1" });
  });

  it("does not treat prototype-ish keys as inherited values", () => {
    expect(parseContributionKeyMap('{"toString":"ck:1"}')).toEqual({ toString: "ck:1" });
  });
});
