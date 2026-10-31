# express-mcp-starter

Express 老炮转 MCP，一套 `service` 三吃：REST + MCP stdio + MCP HTTP。

> 文章标题直接用：《我用Express写了个MCP，Claude直接调用我的API了》

## 1. 5分钟跑起来

```bash
npm install
cp .env.example .env
# 终端1：跑 REST
npm run dev:api
# 打开 http://localhost:3000/api/trending?topic=mcp

# 终端2：跑 MCP (给 Claude 用)
npm run dev:mcp
```

## 2. 接入 Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac)
或 `%APPDATA%/Claude/claude_desktop_config.json` (Win)：

```json
{
  "mcpServers": {
    "express-demo": {
      "command": "npx",
      "args": ["tsx", "/你的绝对路径/express-mcp-starter/src/mcp.ts"]
    }
  }
}
```

重启 Claude，问：`调用 get-trending 查下 mcp 热门`

Cursor 同理：Settings -> MCP -> Add Server 粘贴上面配置。

## 3. 目录

```
src/
  service.ts 核心业务，REST和MCP共用
  app.ts     Express REST: /api/trending /api/readme
  mcp.ts     MCP stdio版，给本地Claude用
  http-mcp.ts MCP HTTP版，POST /mcp，可部署成远端服务
```

## 4. 踩坑（写文章必备）

1. `package.json` 必须 `"type":"module"`，否则 import 报错
2. stdio 里不能 `console.log`，一律 `console.error`
3. zod 参数一定要写 `.describe()`，否则 AI 不知道传啥
4. GitHub API 限频 60次/小时，加 `GITHUB_TOKEN` 到 `.env` 可提到 5000次

## 5. 下一步选题

- 《部署到 Render/Sealos，让远端 MCP 也能用》用 `http-mcp.ts`
- 《加第三个 tool：读 README 做项目解读》
- 去 GitHub 发仓库，README 放 Trends 上涨截图 + Claude 调用截图

## 6. 验证风向

- Trends: https://trends.google.com 对比 `MCP server vs AI Agent`
- Trending TS: https://github.com/trending/typescript
- 官方 SDK: https://github.com/modelcontextprotocol/typescript-sdk
