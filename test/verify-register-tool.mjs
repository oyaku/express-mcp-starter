// 临时验证脚本：用 MCP Client 通过 stdio 连 src/mcp.ts，验证 registerTool 迁移后工具可列出、参数 schema 正常
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx/esm", "src/mcp.ts"],
});
const client = new Client({ name: "verify-client", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map(t => ({ name: t.name, desc: t.description, schema: t.inputSchema?.properties && Object.keys(t.inputSchema.properties) })));

const getReadme = tools.find(t => t.name === "get-readme");
if (!getReadme || getReadme.description !== "读取指定 GitHub 仓库的 README，适合做项目解读" || !getReadme.inputSchema?.properties?.repo) {
  console.error("❌ registerTool 迁移后 get-readme 注册异常");
  process.exit(1);
}
console.log("✅ 工具注册与 schema 均正常");

await client.close();
process.exit(0);
