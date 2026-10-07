import { describe, expect, it } from "vitest";
import {
  connectDesktopView,
  type DesktopViewClient,
  openHeader,
  parseEndpoint,
  ViewHostError,
  widgetSpec,
} from "./index.js";

describe("connectDesktopView env probe", () => {
  it("returns null without handshake env", () => {
    expect(connectDesktopView({ env: {} })).toBeNull();
    expect(connectDesktopView({ env: { PIDESK_VIEW_ENDPOINT: "x" } })).toBeNull();
  });

  it("reads PIDESK_VIEW_* first", () => {
    const client = connectDesktopView({
      env: {
        PIDESK_VIEW_ENDPOINT: "\\\\.\\pipe\\pidesk-view-1",
        PIDESK_VIEW_TOKEN: "abc",
        PIDESK_VIEW_PROTOCOL: "view/v1",
        PI_VIEW_ENDPOINT: "http://127.0.0.1:1",
        PI_VIEW_TOKEN: "other",
      },
    });
    expect(client?.env.endpoint).toBe("\\\\.\\pipe\\pidesk-view-1");
    expect(client?.env.token).toBe("abc");
  });

  it("falls back to PI_VIEW_*", () => {
    const client = connectDesktopView({
      env: {
        PI_VIEW_ENDPOINT: "http://127.0.0.1:9",
        PI_VIEW_TOKEN: "tok",
      },
    });
    expect(client?.env.endpoint).toBe("http://127.0.0.1:9");
    expect(client?.env.token).toBe("tok");
  });

  it("rejects non-view protocol strings", () => {
    expect(
      connectDesktopView({
        env: {
          PIDESK_VIEW_ENDPOINT: "http://127.0.0.1:1",
          PIDESK_VIEW_TOKEN: "t",
          PIDESK_VIEW_PROTOCOL: "rpc/v9",
        },
      }),
    ).toBeNull();
  });
});

describe("parseEndpoint", () => {
  it("parses http TCP fallback", () => {
    expect(parseEndpoint("http://127.0.0.1:45123")).toEqual({ host: "127.0.0.1", port: 45123 });
  });

  it("treats bare paths as pipe/socket", () => {
    expect(parseEndpoint("\\\\.\\pipe\\pidesk-view-1")).toEqual({
      path: "\\\\.\\pipe\\pidesk-view-1",
    });
    expect(parseEndpoint("/tmp/pidesk-view-1.sock")).toEqual({ path: "/tmp/pidesk-view-1.sock" });
  });
});

describe("helper failure semantics", () => {
  it("openHeader normalizes a transport failure to ViewHostError", async () => {
    const failing = {
      ensureConnected: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:1");
      },
    } as unknown as DesktopViewClient;
    const options = { root: { type: "text" as const, content: "x" } };
    await expect(openHeader(failing, options)).rejects.toBeInstanceOf(ViewHostError);
    await expect(openHeader(failing, options)).rejects.toMatchObject({ code: "internal" });
  });
});

describe("widgetSpec", () => {
  const root = { type: "text" as const, content: "hi" };

  it("defaults to floating aboveEditor and requires the slot", () => {
    const spec = widgetSpec({ root });
    expect(spec.placement).toBe("widget");
    expect(spec.placementRequired).toBe(true);
    expect(spec.placementHint).toEqual({ side: "aboveEditor", floating: false });
  });

  it("keeps floating false unless explicitly requested", () => {
    expect(widgetSpec({ root, floating: false }).placementHint?.floating).toBe(false);
    expect(widgetSpec({ root }).placementHint?.floating).toBe(false);
  });

  it("opts into floating overlay and belowEditor side", () => {
    const spec = widgetSpec({
      root,
      side: "belowEditor",
      floating: true,
      title: "回答问题",
      actions: [{ id: "submit", label: "提交", variant: "primary" }],
    });
    expect(spec.title).toBe("回答问题");
    expect(spec.placementHint).toEqual({ side: "belowEditor", floating: true });
    expect(spec.actions).toHaveLength(1);
  });
});
