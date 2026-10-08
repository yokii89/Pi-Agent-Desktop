import { describe, expect, it } from "vitest";
import { normalizeMarketServer, suggestServerName } from "./mcpMarket";

/** 注册表记录归一化直测（docs/design/41 §三）；fixtures 对齐实测响应的包装结构。 */
describe("suggestServerName", () => {
  it("取反转 DNS 尾段", () => {
    expect(suggestServerName("io.github.user/airtable-mcp-server")).toBe("airtable-mcp-server");
    expect(suggestServerName("com.pulsemcp/remote-filesystem")).toBe("remote-filesystem");
  });

  it("非法字符归一为下划线，空结果兜底", () => {
    expect(suggestServerName("io.github.user/pkg.name")).toBe("pkg_name");
    expect(suggestServerName("纯中文")).toBe("mcp-server");
  });
});

describe("normalizeMarketServer", () => {
  const officialMeta = {
    "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true },
  };

  it("npm 包 → npx stdio 模板，版本锁死 identifier@version", () => {
    const entry = normalizeMarketServer({
      server: {
        name: "com.example/remote-fs",
        description: "Filesystem over the cloud.",
        version: "0.1.3",
        repository: { url: "https://github.com/example/repo" },
        packages: [
          {
            registryType: "npm",
            identifier: "remote-filesystem-mcp-server",
            version: "0.1.3",
            runtimeHint: "npx",
            transport: { type: "stdio" },
            runtimeArguments: [{ value: "-y", type: "positional" }, { value: "--verbose" }],
            environmentVariables: [
              { name: "GCS_BUCKET", description: "Bucket name.", isRequired: true },
              { name: "GCS_PRIVATE_KEY", isSecret: true },
              { name: "GCS_MAKE_PUBLIC", default: "false" },
            ],
          },
        ],
      },
      _meta: officialMeta,
    });
    expect(entry).not.toBeNull();
    expect(entry?.template).toMatchObject({
      kind: "stdio",
      command: "npx",
      args: ["-y", "remote-filesystem-mcp-server@0.1.3", "--verbose"],
      matchKey: "remote-filesystem-mcp-server",
    });
    expect(entry?.template.env).toEqual([
      {
        name: "GCS_BUCKET",
        description: "Bucket name.",
        isRequired: true,
        isSecret: false,
        defaultValue: undefined,
      },
      {
        name: "GCS_PRIVATE_KEY",
        description: undefined,
        isRequired: false,
        isSecret: true,
        defaultValue: undefined,
      },
      {
        name: "GCS_MAKE_PUBLIC",
        description: undefined,
        isRequired: false,
        isSecret: false,
        defaultValue: "false",
      },
    ]);
    expect(entry?.suggestName).toBe("remote-fs");
    expect(entry?.repositoryUrl).toBe("https://github.com/example/repo");
  });

  it("remotes → streamable-http 模板", () => {
    const entry = normalizeMarketServer({
      server: {
        name: "ai.example/deepwiki",
        remotes: [
          {
            type: "streamable-http",
            url: "https://mcp.example.com/mcp",
            headers: [{ name: "Authorization", value: "Bearer {api_key}" }],
          },
        ],
      },
      _meta: officialMeta,
    });
    expect(entry?.template).toMatchObject({
      kind: "http",
      url: "https://mcp.example.com/mcp",
      matchKey: "https://mcp.example.com/mcp",
    });
    expect(entry?.template.headers?.[0]).toMatchObject({ name: "Authorization" });
  });

  it("pypi 包 → uvx 模板并标记 needsUv", () => {
    const entry = normalizeMarketServer({
      server: {
        name: "io.example/fetch",
        packages: [{ registryType: "pypi", identifier: "mcp-server-fetch", version: "1.2.0" }],
      },
      _meta: officialMeta,
    });
    expect(entry?.template).toMatchObject({
      kind: "stdio",
      command: "uvx",
      args: ["mcp-server-fetch==1.2.0"],
    });
    expect(entry?.needsUv).toBe(true);
  });

  it("历史版本（isLatest=false）与不可映射形态跳过", () => {
    const base = {
      server: { name: "io.example/x", packages: [{ registryType: "npm", identifier: "x" }] },
    };
    expect(
      normalizeMarketServer({
        ...base,
        _meta: {
          "io.modelcontextprotocol.registry/official": { status: "active", isLatest: false },
        },
      }),
    ).toBeNull();
    expect(normalizeMarketServer({ server: { name: "io.example/docker-only" } })).toBeNull();
    expect(normalizeMarketServer({ server: {} })).toBeNull();
    expect(normalizeMarketServer(null)).toBeNull();
  });

  it("缺字段降级：无描述、无仓库、无版本仍可用", () => {
    const entry = normalizeMarketServer({
      server: {
        name: "io.example/minimal",
        packages: [{ registryType: "npm", identifier: "minimal-mcp" }],
      },
    });
    expect(entry).toMatchObject({
      id: "io.example/minimal",
      description: "",
      source: "registry",
      suggestName: "minimal",
    });
    expect(entry?.repositoryUrl).toBeUndefined();
    expect(entry?.version).toBeUndefined();
  });
});
