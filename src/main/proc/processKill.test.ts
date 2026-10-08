import { describe, expect, it } from "vitest";
import { isPidReuse, parseProcessJson } from "./processKill";

describe("isPidReuse", () => {
  it("flags missing process as reuse/not-stoppable", () => {
    expect(isPidReuse({ commandLine: "node vite", startedAt: 1000 }, null)).toBe(true);
  });

  it("rejects when command line differs", () => {
    expect(
      isPidReuse(
        { commandLine: "node vite", startedAt: 1000 },
        { commandLine: "totally different", startedAt: 1000 },
      ),
    ).toBe(true);
  });

  it("rejects when creation time drifts beyond 2s", () => {
    expect(
      isPidReuse(
        { commandLine: "node vite", startedAt: 10_000 },
        { commandLine: "node vite", startedAt: 14_000 },
      ),
    ).toBe(true);
  });

  it("accepts matching command line and close start time", () => {
    expect(
      isPidReuse(
        { commandLine: "  node   vite ", startedAt: 10_000 },
        { commandLine: "node vite", startedAt: 10_500 },
      ),
    ).toBe(false);
  });

  it("skips checks when fields unknown", () => {
    expect(isPidReuse({ commandLine: "", startedAt: 0 }, { commandLine: "", startedAt: 0 })).toBe(
      false,
    );
  });
});

describe("parseProcessJson", () => {
  it("parses single object and array shapes", () => {
    const single = parseProcessJson(
      '{"pid":12,"ppid":4,"name":"node.exe","commandLine":"node vite","startedAt":99}',
    );
    expect(single?.get(12)?.commandLine).toBe("node vite");

    const many = parseProcessJson(
      '[{"pid":1,"ppid":0,"name":"a.exe","commandLine":"a","startedAt":1},{"pid":2,"ppid":1,"name":"b.exe","commandLine":"b","startedAt":2}]',
    );
    expect(many?.size).toBe(2);
    expect(many?.get(2)?.ppid).toBe(1);
  });

  it("returns null on empty or invalid json", () => {
    expect(parseProcessJson("")).toBeNull();
    expect(parseProcessJson("not-json")).toBeNull();
    expect(parseProcessJson("[]")).toBeNull();
  });
});
