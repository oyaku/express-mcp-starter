import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTrending, getRepoReadme } from "./service.js";

// 工具定义只写一次，stdio / 本地 HTTP / Vercel 三个入口共用
// description 是模型唯一的接口文档，改这里等于改 API 文档
export function createMcpServer(name: string): McpServer {
  const server = new McpServer({ name, version: "1.0.0" });

  server.registerTool(
    "get-trending",
    {
      description: "获取 GitHub 热门仓库，按 topic 和语言过滤",
      inputSchema: {
        topic: z.string().optional().describe("关键词，如 typescript, mcp, self-hosted"),
        limit: z.number().min(1).max(10).optional().describe("返回条数，默认5"),
      },
    },
    async ({ topic, limit }) => {
      const data = await getTrending(topic || "typescript", limit || 5);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get-readme",
    {
      description: "读取指定 GitHub 仓库的 README，适合做项目解读",
      inputSchema: {
        repo: z.string().describe("形如 n8n-io/n8n 的完整仓库名"),
      },
    },
    async ({ repo }) => {
      const readme = await getRepoReadme(repo);
      return { content: [{ type: "text", text: readme }] };
    }
  );

  return server;
}
