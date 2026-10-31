// 对照实验用服务器：有状态（sessionId）+ 故意不关闭 transport，观察泄漏
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getTrending } from "../src/service.js";

const LEAK = process.env.LEAK === "1";
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  const m = process.memoryUsage();
  res.json({ ok: true, rssMB: +(m.rss / 1024 / 1024).toFixed(1), heapUsedMB: +(m.heapUsed / 1024 / 1024).toFixed(1), leakMode: LEAK });
});

app.post("/mcp", async (req, res) => {
  const server = new McpServer({ name: "stateful-demo", version: "1.0.0" });
  server.registerTool(
    "get-trending",
    {
      description: "获取 GitHub 热门仓库",
      inputSchema: { topic: z.string().optional().describe("关键词"), limit: z.number().min(1).max(10).optional().describe("条数") },
    },
    async ({ topic, limit }) => ({
      content: [{ type: "text", text: JSON.stringify(await getTrending(topic || "typescript", limit || 5), null, 2) }],
    })
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  if (!LEAK) res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3002, () => console.log("stateful MCP on :3002/mcp"));
