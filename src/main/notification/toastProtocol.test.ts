import { describe, expect, it } from "vitest";
import { buildToastXml, parseToastToken, ToastTargets } from "./toastProtocol";

const token = "12345678-1234-1234-1234-123456789abc";

describe("Windows toast protocol", () => {
  it("uses explicit protocol activation and escapes session text and icon URLs", () => {
    const xml = buildToastXml(
      'PiDesk · <task> & "review"',
      "It's done",
      `pidesk-dev://notification/${token}`,
      "file:///C:/My%20App/icon.png?a=1&b=2",
    );
    expect(xml).toContain(`activationType="protocol" launch="pidesk-dev://notification/${token}"`);
    expect(xml).toContain("&lt;task&gt; &amp; &quot;review&quot;");
    expect(xml).toContain("It&apos;s done");
    expect(xml).toContain("?a=1&amp;b=2");
    expect(xml).toContain('<audio silent="true"/>');
  });

  it("extracts activation from Electron launch arguments, including an app path with spaces", () => {
    expect(
      parseToastToken(
        ["C:\\Electron\\electron.exe", "D:\\My Project", `pidesk-dev://notification/${token}`],
        "pidesk-dev",
      ),
    ).toBe(token);
  });

  it.each([
    `pidesk://notification/${token}`,
    `pidesk-dev://other/${token}`,
    `pidesk-dev://notification/${token}?sessionFile=C:/secret`,
    `pidesk-dev://notification/${token}#extra`,
    `pidesk-dev://user@notification/${token}`,
    "pidesk-dev://notification/arbitrary-file",
    "--some-argument",
  ])("ignores foreign or malformed activation: %s", (arg) => {
    expect(parseToastToken([arg], "pidesk-dev")).toBeUndefined();
  });

  it("keeps concurrent session targets separate and consumes each once", () => {
    const targets = new ToastTargets();
    targets.add("a", { title: "A", sessionId: "A", sessionFile: "A.jsonl" });
    targets.add("b", { title: "B", sessionId: "B", sessionFile: "B.jsonl" });
    expect(targets.take("b")).toEqual({ sessionId: "B", sessionFile: "B.jsonl" });
    expect(targets.take("a")).toEqual({ sessionId: "A", sessionFile: "A.jsonl" });
    expect(targets.take("a")).toBeUndefined();
    expect(targets.take("unknown")).toBeUndefined();
  });

  it("bounds targets even if notifications are dismissed without activation", () => {
    const targets = new ToastTargets();
    for (let i = 0; i < 129; i++) targets.add(String(i), { title: "Task", sessionId: String(i) });
    expect(targets.take("0")).toBeUndefined();
    expect(targets.take("128")?.sessionId).toBe("128");
  });
});
