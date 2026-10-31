import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools.js";

// 注意：stdio 模式下千万别用 console.log，会污染协议
// 调试一律用 console.error

const server = createMcpServer("express-mcp-demo");

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ MCP stdio started: express-mcp-demo");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
