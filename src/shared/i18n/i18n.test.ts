import { describe, expect, it } from "vitest";
import { buildCatalog } from "./locales";
import { createTranslate, interpolate } from "./translate";
import { normalizeLocalePreference, resolveLocale } from "./types";

describe("i18n", () => {
  it("resolveLocale 解析 system 与固定语言", () => {
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("en-US", "zh-CN")).toBe("en-US");
    expect(resolveLocale("system", "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "en-US")).toBe("en-US");
    expect(resolveLocale("system", "fr-FR")).toBe("zh-CN");
    expect(normalizeLocalePreference("nope")).toBe("system");
  });

  it("createTranslate 按语言取文案并插值", () => {
    const catalog = buildCatalog();
    const t = createTranslate(catalog, "en-US");
    expect(t("common.ok")).toBe("OK");
    expect(t("settings.general.language")).toBe("Language");
    expect(t("session.fileEdits.many", { count: 3 })).toBe("Changed 3 files this turn");
  });

  it("缺 key 回退 key 本身；缺参数保留占位", () => {
    const catalog = buildCatalog();
    const t = createTranslate(catalog, "en-US");
    expect(t("nope.missing")).toBe("nope.missing");
    expect(interpolate("hi {name}", {})).toBe("hi {name}");
  });

  it("zh-CN 与 en-US key 集合一致", () => {
    const catalog = buildCatalog();
    const zh = Object.keys(catalog["zh-CN"]).sort();
    const en = Object.keys(catalog["en-US"]).sort();
    expect(en).toEqual(zh);
  });
});
