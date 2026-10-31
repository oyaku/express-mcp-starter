import express from "express";
import cors from "cors";
import { getTrending, getRepoReadme } from "./service.js";
import { mountMcpHttp } from "./mcp-http.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 你最熟的部分：REST接口
app.get("/api/trending", async (req, res) => {
  const topic = String(req.query.topic || "typescript");
  const limit = Number(req.query.limit || 5);
  const data = await getTrending(topic, limit);
  res.json({ topic, count: data.length, data });
});

app.get("/api/readme", async (req, res) => {
  const repo = String(req.query.repo || "modelcontextprotocol/typescript-sdk");
  const readme = await getRepoReadme(repo);
  res.json({ repo, readme: readme.slice(0, 8000) });
});

// Vercel 的 Express 零配置检测只认 src/app.ts 这类入口文件名，
// 所以 MCP 路由必须挂在同一个 app 上，否则部署上去 /mcp 直接 404
mountMcpHttp(app, "express-mcp-demo-http");

// Serverless 上由平台接管监听，这里不该自己 listen 抢端口
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const PORT = Number(process.env.PORT || 3000);
if (!IS_SERVERLESS && process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`✅ API on http://localhost:${PORT}`);
    console.log(`👉 try: http://localhost:${PORT}/api/trending?topic=mcp`);
    console.log(`👉 mcp: http://localhost:${PORT}/mcp (需 Authorization: Bearer $MCP_AUTH_TOKEN)`);
  });
}

export default app;
