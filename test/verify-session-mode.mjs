// 对照实验：sessionIdGenerator 设为 undefined（无状态）vs 给出 id（有状态）
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL("http://localhost:3003/mcp");

// A) 无状态：直接 new Client 后 listTools 不发 initialize 也能过
// B) 有状态：客户端必须先 initialize 拿到 Mcp-Session-Id
const client = new Client({ name: "stateful-client", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));
console.log("serverInfo:", JSON.stringify(client.getServerVersion()));

const { tools } = await client.listTools();
console.log("tools:", tools.map(t => t.name).join(", "));

const r = await client.callTool({ name: "get-trending", arguments: { topic: "mcp", limit: 2 } });
console.log("callTool ok:", typeof r.content[0].text === "string");

// 原始 HTTP：跳过 initialize 直接 tools/list，看有状态服务器怎么拒绝
const raw = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
});
console.log("no-initialize status:", raw.status, (await raw.text()).slice(0, 200));
process.exit(0);
