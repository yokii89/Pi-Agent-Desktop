import type { McpMarketEntry } from "../../shared/ipc";

/**
 * 内置精选清单（docs/design/41）：手工校验过来源与参数的常用 server，
 * 市场空搜索词时展示（不出网），也是注册表不可用时的离线兜底。
 * 描述双语；registry 条目只有上游英文描述，中文优先展示时回退英文。
 */
export const MARKET_CURATED_ENTRIES: McpMarketEntry[] = [
  {
    id: "curated/filesystem",
    title: "Filesystem",
    description:
      "Read, write and search files inside the allowed directories (Node.js official reference server).",
    descriptionZh:
      "在允许的目录内读取、写入、搜索文件（官方参考实现）。默认只开放当前目录，可在参数中修改。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "filesystem",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      matchKey: "@modelcontextprotocol/server-filesystem",
    },
  },
  {
    id: "curated/memory",
    title: "Memory",
    description:
      "Knowledge-graph based persistent memory across sessions (official reference server).",
    descriptionZh: "基于知识图谱的跨会话持久记忆（官方参考实现）。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "memory",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      env: [
        {
          name: "MEMORY_FILE_PATH",
          description: "记忆存储文件路径；缺省存放在 server 运行目录",
        },
      ],
      matchKey: "@modelcontextprotocol/server-memory",
    },
  },
  {
    id: "curated/sequential-thinking",
    title: "Sequential Thinking",
    description:
      "Dynamic, revisable step-by-step reasoning scaffold for complex problems (official reference server).",
    descriptionZh: "分步思考脚手架：可修订的动态推理过程，适合复杂问题拆解（官方参考实现）。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "sequential-thinking",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      matchKey: "@modelcontextprotocol/server-sequential-thinking",
    },
  },
  {
    id: "curated/everything",
    title: "Everything",
    description:
      "Test server exercising every MCP feature: echo, sampling, resources, prompts and more.",
    descriptionZh:
      "覆盖全部 MCP 能力的测试 server（echo、采样、资源、prompts），用于验证接入是否正常。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "everything",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
      matchKey: "@modelcontextprotocol/server-everything",
    },
  },
  {
    id: "curated/github",
    title: "GitHub",
    description: "GitHub API access: repositories, issues, pull requests and more.",
    descriptionZh: "GitHub API：仓库、issue、PR 等常用操作。需要 GitHub 个人访问令牌。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "github",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: [
        {
          name: "GITHUB_PERSONAL_ACCESS_TOKEN",
          description: "GitHub 个人访问令牌（github.com/settings/tokens 生成）",
          isSecret: true,
          isRequired: true,
        },
      ],
      matchKey: "@modelcontextprotocol/server-github",
    },
  },
  {
    id: "curated/brave-search",
    title: "Brave Search",
    description: "Web and local search via the Brave Search API.",
    descriptionZh: "通过 Brave Search API 进行网页与本地搜索。需要 Brave API Key。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "brave-search",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: [
        {
          name: "BRAVE_API_KEY",
          description: "Brave Search API Key（brave.com/search/api 申请）",
          isSecret: true,
          isRequired: true,
        },
      ],
      matchKey: "@modelcontextprotocol/server-brave-search",
    },
  },
  {
    id: "curated/puppeteer",
    title: "Puppeteer",
    description: "Browser automation: navigate, click, fill forms and screenshot web pages.",
    descriptionZh: "浏览器自动化：打开网页、点击、填表、截图。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "puppeteer",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      matchKey: "@modelcontextprotocol/server-puppeteer",
    },
  },
  {
    id: "curated/slack",
    title: "Slack",
    description: "Slack workspace access: channels, messages and reactions.",
    descriptionZh: "Slack 工作区：频道、消息与回应。需要 Bot Token。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "slack",
    template: {
      kind: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: [
        {
          name: "SLACK_BOT_TOKEN",
          description: "Slack Bot Token（xoxb- 开头）",
          isSecret: true,
          isRequired: true,
        },
        { name: "SLACK_TEAM_ID", description: "Slack 团队 ID（T 开头）", isRequired: true },
      ],
      matchKey: "@modelcontextprotocol/server-slack",
    },
  },
  {
    id: "curated/fetch",
    title: "Fetch",
    description: "Fetch a URL and convert it to markdown for the model (Python reference server).",
    descriptionZh: "抓取 URL 并转成 Markdown 给模型阅读（官方 Python 参考实现，需要 uv）。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "fetch",
    needsUv: true,
    template: {
      kind: "stdio",
      command: "uvx",
      args: ["mcp-server-fetch"],
      matchKey: "mcp-server-fetch",
    },
  },
  {
    id: "curated/git",
    title: "Git",
    description: "Read and operate on Git repositories: status, diff, log, commit and branches.",
    descriptionZh: "读写 Git 仓库：status、diff、log、commit、分支操作（需要 uv）。",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    source: "curated",
    suggestName: "git",
    needsUv: true,
    template: {
      kind: "stdio",
      command: "uvx",
      args: ["mcp-server-git"],
      matchKey: "mcp-server-git",
    },
  },
  {
    id: "curated/context7",
    title: "Context7",
    description: "Up-to-date, version-specific library documentation and code examples.",
    descriptionZh: "实时、按版本号的第三方库文档与代码示例（Upstash 官方远程服务，无需密钥）。",
    repositoryUrl: "https://github.com/upstash/context7",
    source: "curated",
    suggestName: "context7",
    template: {
      kind: "http",
      url: "https://mcp.context7.com/mcp",
      matchKey: "https://mcp.context7.com/mcp",
    },
  },
  {
    id: "curated/deepwiki",
    title: "DeepWiki",
    description: "Ask questions about GitHub repositories and get wiki-structured answers.",
    descriptionZh:
      "对 GitHub 仓库提问，返回结构化的 wiki 式解答（Cognition 官方远程服务，公开只读）。",
    repositoryUrl: "https://deepwiki.com",
    source: "curated",
    suggestName: "deepwiki",
    template: {
      kind: "http",
      url: "https://mcp.deepwiki.com/mcp",
      matchKey: "https://mcp.deepwiki.com/mcp",
    },
  },
  {
    id: "curated/ms-learn",
    title: "Microsoft Learn",
    description: "Search and query official Microsoft documentation and code samples.",
    descriptionZh: "检索微软官方文档与代码示例（Microsoft 官方远程服务，无需密钥）。",
    repositoryUrl: "https://learn.microsoft.com",
    source: "curated",
    suggestName: "ms-learn",
    template: {
      kind: "http",
      url: "https://learn.microsoft.com/api/mcp",
      matchKey: "https://learn.microsoft.com/api/mcp",
    },
  },
  {
    id: "curated/sentry",
    title: "Sentry",
    description: "Retrieve and analyze error reports, stack traces and releases from Sentry.",
    descriptionZh:
      "查询与分析 Sentry 的错误报告、堆栈与版本（OAuth 登录，添加后请在卡片菜单登录）。",
    repositoryUrl: "https://github.com/getsentry/sentry-mcp",
    source: "curated",
    suggestName: "sentry",
    template: {
      kind: "http",
      url: "https://mcp.sentry.dev/mcp",
      matchKey: "https://mcp.sentry.dev/mcp",
    },
  },
  {
    id: "curated/notion",
    title: "Notion",
    description: "Search, read and write Notion pages and databases.",
    descriptionZh: "搜索、读取与写入 Notion 页面和数据库（OAuth 登录，添加后请在卡片菜单登录）。",
    repositoryUrl: "https://developers.notion.com/docs/mcp",
    source: "curated",
    suggestName: "notion",
    template: {
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      matchKey: "https://mcp.notion.com/mcp",
    },
  },
];
