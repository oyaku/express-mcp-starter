// 正确的有状态写法：sessions Map，一个 Mcp-Session-Id 对应一套 server+transport
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getTrending } from "../src/service.js";

const sessions = new Map();

function buildServer() {
  const server = new McpServer({ name: "stateful-demo", version: "1.0.0" });
  server.registerTool(
    "get-trending",
    {
      description: "获取 GitHub 热门仓库",
      inputSchema: { topic: z.string().optional().describe("关键词"), limit: z.number().min(1).max(10).optional().describe("条数") },
    },
    async ({ topic, limit }) => ({
      content: [{ type: "text", text: JSON.stringify(await getTrending(topic || "typescript", limit || 2), null, 2) }],
    })
  );
  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  const m = process.memoryUsage();
  res.json({ ok: true, sessions: sessions.size, rssMB: +(m.rss / 1048576).toFixed(1), heapUsedMB: +(m.heapUsed / 1048576).toFixed(1) });
});

// 三种方法都要落到同一个 transport 上，缺一客户端就报错
app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    console.error(`[req] ${req.method} method=${req.body?.method ?? "-"} sid=${sessionId ?? "-"}`);

    let transport;
    if (req.method === "POST" && req.body?.method === "initialize") {
      const server = buildServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // 官方钩子：initialize 处理时就登记会话，比等 handleRequest 返回更早一步
        onsessioninitialized: (sid) => {
          console.error(`[session] created ${sid}`);
          sessions.set(sid, { server, transport });
        },
        // 只有客户端显式 DELETE 才代表会话结束，这里才是回收的地方
        onsessionclosed: (sid) => {
          console.error(`[session] closed ${sid}`);
          sessions.get(sid)?.server.close();
          sessions.delete(sid);
        },
      });
      // 注意：这里不能挂 res.on("close") 销毁会话。
      // 有状态模式下 HTTP 响应结束 ≠ MCP 会话结束，_initialize 的 close 会把刚建的会话删掉。
      await server.connect(transport);
    } else {
      if (!sessionId || !sessions.has(sessionId)) {
        console.error(`[404] sid=${sessionId} known=${JSON.stringify([...sessions.keys()])}`);
        return res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
      }
      transport = sessions.get(sessionId).transport;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

app.listen(3003, () => console.log("stateful-fixed MCP on :3003/mcp"));
