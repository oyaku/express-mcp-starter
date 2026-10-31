import express from "express";
import cors from "cors";
import { mountMcpHttp } from "./mcp-http.js";

// 本地跑的独立 MCP HTTP 进程；Vercel 走 src/app.ts（平台只认那几个入口文件名）
// 两个入口共用 src/tools.ts 与 src/mcp-http.ts，逻辑不重复

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, mode: "express+mcp-http" }));

mountMcpHttp(app, "express-mcp-demo-http");

// PaaS（Vercel/Render）只认它注入的 PORT，所以 PORT 优先于本地的 MCP_PORT
const PORT = Number(process.env.PORT || process.env.MCP_PORT || 3001);
app.listen(PORT, () => {
  console.log(`✅ MCP HTTP on http://localhost:${PORT}/mcp`);
});
