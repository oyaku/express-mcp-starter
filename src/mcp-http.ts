import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";
import { requireBearer } from "./auth.js";

// 无状态模式（sessionIdGenerator: undefined）：每个请求独立一套 server+transport，
// 所以响应结束就能回收，也才能随便扩实例 / 放 Serverless。
// 换成有状态就不能这么写了，见 test/stateful-fixed-server.mjs
export function mountMcpHttp(app: Express, serverName: string) {
  app.post("/mcp", requireBearer, async (req: Request, res: Response) => {
    const server = createMcpServer(serverName);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp-http]", e);
      if (!res.headersSent) res.status(500).json({ error: String(e) });
    }
  });
}
