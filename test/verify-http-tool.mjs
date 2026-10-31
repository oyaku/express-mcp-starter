// 验证脚本：通过 Streamable HTTP 连接 MCP 服务，确认鉴权、工具注册、端到端调用都正常
// 本地：MCP_AUTH_TOKEN=xxx node test/verify-http-tool.mjs
// 部署后：MCP_URL=https://你的域名/mcp MCP_AUTH_TOKEN=xxx node test/verify-http-tool.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:3001/mcp";
const TOKEN = process.env.MCP_AUTH_TOKEN;
console.log("target:", MCP_URL, TOKEN ? "(带 bearer)" : "(⚠️ 未带 MCP_AUTH_TOKEN，服务端会 401)");

const client = new Client({ name: "verify-client", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} },
  })
);

const { tools } = await client.listTools();
console.log("tools:", tools.map(t => ({ name: t.name, desc: t.description, schema: t.inputSchema?.properties && Object.keys(t.inputSchema.properties) })));

// 光看注册不够，真调一次才知道出网、限频兜底这些是不是通的
const called = await client.callTool({ name: "get-trending", arguments: { topic: "mcp", limit: 2 } });
const rows = JSON.parse(called.content[0].text);
console.log("callTool get-trending ->", rows.map(r => `${r.repo} (${r.stars})`).join(", "));

const ok = tools.length === 2
  && tools.find(t => t.name === "get-trending")?.inputSchema?.properties?.topic
  && !!tools.find(t => t.name === "get-readme")?.description
  && Array.isArray(rows) && rows.length > 0 && typeof rows[0].stars === "number";
console.log(ok ? "✅ HTTP 模式鉴权/注册/调用全部正常" : "❌ 异常");
process.exit(ok ? 0 : 1);
