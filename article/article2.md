# 把 MCP 部署到公网：一个 404 把我上了一课

上一篇《我用 Express 写了个 MCP，Claude 直接调用我的 API 了》结尾立了个 flag：把 `http-mcp.ts` 部署出去，让远端也能调我的工具。

这篇就是那个 flag 的交付。**先说清楚证据边界**：本文所有协议行为、报错原文、数字，都是我在本地把服务真跑起来、用官方 SDK Client 和 curl 打出来的（Node 20 + `@modelcontextprotocol/sdk` 实测版本 1.32.2）。部署平台从 Render 换成了 Vercel（Render 建免费服务要绑卡，直接劝退），第 7 节的平台规则和限制数值我逐条核对了 Vercel 官方文档，但公网 URL 的实测数据还缺，标了「待补」。

结论先放前面：

> **远端 MCP 的坑，九成不在业务代码，在会话生命周期。**

## 1. 为什么非要用 HTTP 版

上一篇的 stdio 版有个硬限制：它是 Claude Desktop 用 `command` spawn 出来的**本地子进程**，只有你这台机器能用。要让别人的 Claude 也能调你的接口，只剩一条路——给 MCP 挂个公网 URL，也就是 `src/http-mcp.ts` 里的 `POST /mcp`。

本地先跑通：

```bash
npm run dev:mcp:http
# ✅ MCP HTTP on http://localhost:3001/mcp
```

curl 探一下健康检查，确认 Express 这层是活的：

```bash
$ curl -s http://localhost:3001/health
{"ok":true,"mode":"express+mcp-http"}
```

到这一步很多人就直接把 URL 贴进客户端了。**然后开始报错。**

## 2. 第一个坑：浏览器打开 /mcp，404

我在本地对着跑着的服务试了一把最常见的误操作：

```bash
$ curl -i http://localhost:3001/mcp
HTTP/1.1 404 Not Found
X-Powered-By: Express
...
<pre>Cannot GET /mcp</pre>
```

这不是服务挂了。`src/mcp-http.ts:10` 只注册了 `app.post("/mcp", ...)`，MCP Streamable HTTP 的**请求走 POST**，GET 只在「客户端想要一条服务端推送的 SSE 通道」时才会用到。

所以判断一个远端 MCP 死没死，别用浏览器，用两条 curl：

```bash
curl -s <你的URL>/health                       # Express 层活着吗
curl -s -o /dev/null -w "%{http_code}\n" <你的URL>/mcp   # 404 是「路径在但只吃 POST」，正常
```

看到 `Cannot GET /mcp` 先别慌，那是 Express 的默认 404 页，说明路由没匹配上方法，不是没匹配上路径。

## 3. 第二个坑：406 Not Acceptable，客户端连不上

这是远端调试最容易误判成「跨域问题」的一个。我用 curl 复现了：

```bash
# 只带 Content-Type，没带 Accept
$ curl -s -X POST http://localhost:3001/mcp \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}
```

HTTP 状态码 **406**。协议要求客户端同时接受 `application/json` 和 `text/event-stream`，少一个都不给过：

```bash
$ curl ... -H 'Accept: application/json'   → 406
$ curl ... -H 'Accept: application/json, text/event-stream' → 200
```

正规客户端（Claude Desktop / Cursor / 官方 SDK Client）都会自动带这两个，所以**你自己写脚本或 Postman 手测时才会撞上它**。看到 406，改 header，别去查 CORS。

顺带一个部署相关的观察：本地所有响应的 `content-type` 都是 `text/event-stream`，不是 `application/json`：

```
initialize → text/event-stream
tools/list → text/event-stream
```

也就是说 **MCP 的返回默认走 SSE 流**。你在前面套 Nginx、云厂商 LB、CDN 的时候，一旦开了响应缓冲（Nginx 的 `proxy_buffering on`），流会被攒住，客户端表现为「连上了但没反应」。反代配置里给 `/mcp` 加上 `proxy_buffering off;` 和足够长的 `proxy_read_timeout`，是这个架构的必配项。

## 4. 第三个坑：把 stdio 的忠告搬到 HTTP

上一篇我写了「stdio 里绝对不能 `console.log`，会污染 JSON-RPC」。这条在 HTTP 版**不成立**：HTTP 模式下 stdout 不参与协议，`src/http-mcp.ts:19` 那句 `console.log(...)` 是正常启动日志，留着反而有用。

但搬过来的过程本身有代价——我在写有状态版本时，顺手照抄了 `res.on("close", () => transport.close())`，直接翻车。下面展开。

## 5. 核心：per-request new McpServer 只在「无状态」下成立

`http-mcp.ts` 的写法是每个请求进来 `new McpServer` + `new StreamableHTTPServerTransport`，配 `sessionIdGenerator: undefined`。这套能跑，而且很省事：

```typescript
// src/mcp-http.ts:12 —— 无状态：不生成 sessionId
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
```

用官方 Client 验一下，两个客户端各自独立连、各自看到 2 个工具：

```
client1 tools=2 server=express-mcp-demo-http
client2 tools=2 server=express-mcp-demo-http
```

无状态的好处对部署场景很实在：**不依赖内存里的会话表**，随便扩实例、随便重启、Serverless 也能放。我本地测了延迟分布：

```
第1次 tools/list: 200 91.6ms
第2次 tools/list: 200 8.7ms
第3次 tools/list: 200 6.0ms
```

### 那有状态怎么写？我先把错误的写了一遍

SDK 源码里对模式写得很清楚（`node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js` 顶部的注释块，第 37 行附近）：

```
In stateful mode:
 - Session ID is generated and included in response headers
 - Requests with invalid session IDs are rejected with 404 Not Found
 - Non-initialization requests without a session ID are rejected with 400 Bad Request
```

我照着「每个请求建一套 server+transport」的思路，只把 `sessionIdGenerator` 改成 `() => randomUUID()`，客户端立刻炸：

```
StreamableHTTPError: Streamable HTTP error: Error POSTing to endpoint:
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Server not initialized"},"id":null}
{ code: 400 }
```

服务端日志更有意思，会话创建出来了又凭空消失：

```
[req] POST method=initialize sid=-
[session] created aa048b27-...
[close] 连接结束，删除 sid=aa048b27-...          ← 我加的 res.on("close") 干的
[req] POST method=notifications/initialized sid=aa048b27-...
[404] sid=aa048b27-... known=[]                 ← Map 已经空了
```

**根因：在有状态模式下，一次 HTTP 响应的结束 ≠ 一个 MCP 会话的结束。** 客户端的 `initialize` 和紧随其后的 `notifications/initialized` 是**两个独立 HTTP 请求**，共用一个 `Mcp-Session-Id`。你把 `transport.close()` 挂在第一个请求的 `close` 事件上，等于刚发完房卡就把房间拆了。

上一篇「记得 `res.on("close")` 清理，否则连接泄漏」这条忠告，**只适用于无状态模式**。有状态模式照抄，就是上面的 404。

### 正确的有状态写法

要点三条：**会话存 Map、登记用 `onsessioninitialized`、回收用 `onsessionclosed`**（客户端显式 `DELETE` 才会触发）。完整可跑版本在 `test/stateful-fixed-server.mjs`：

```javascript
const sessions = new Map();

// POST / GET / DELETE 三种方法都要落到同一个 transport，缺一客户端就报错
app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport;

  if (req.method === "POST" && req.body?.method === "initialize") {
    const server = buildServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => sessions.set(sid, { server, transport }),
      onsessionclosed: (sid) => {          // 只有 DELETE 才算会话结束
        sessions.get(sid)?.server.close();
        sessions.delete(sid);
      },
    });
    // 这里绝不挂 res.on("close") 销毁会话
    await server.connect(transport);
  } else {
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    }
    transport = sessions.get(sessionId).transport;
  }
  await transport.handleRequest(req, res, req.body);
});
```

实测通过，SDK Client 全流程干净跑完：

```
serverInfo: {"name":"stateful-demo","version":"1.0.0"}
tools: get-trending
callTool ok: true
```

顺手验证了有状态确实有鉴权价值——跳过 `initialize` 裸调一次 `tools/list`，被拒：

```
no-initialize status: 404 {"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}
```

`DELETE` 也确认能回收：

```
DELETE status=200
{"ok":true,"sessions":0,...}      # 之前是 sessions:1
```

## 6. 会话不回收会怎样：我压了一组数

在有状态版本里把 `/health` 加上 `sessions.size` 和内存，然后**故意只 initialize、不发 DELETE** 打 100 次：

```
=== before ===
{"ok":true,"sessions":0,"rssMB":79.2,"heapUsedMB":20.5}
=== after 100 次未 DELETE 的 initialize ===
{"ok":true,"sessions":100,"rssMB":90.2,"heapUsedMB":26.7}
```

100 个会话全留在内存里，一个没掉。数字看着不大，但它只随访问量线性增长，**重启前不会释放**。放到免费实例的小内存容器上，这就是那条「跑两天突然 502」的线索。

所以两条路自己选：

| | 无状态（`sessionIdGenerator: undefined`） | 有状态（sessions Map） |
|---|---|---|
| 会话泄漏 | 不存在 | 必须靠 DELETE + TTL 兜底 |
| 扩实例 / Serverless | 可以 | 不行（Map 在单进程内存里） |
| 服务端主动推送、`listChanged` | 不支持 | 支持 |
| 会话级鉴权 | 自己做 | 协议自带 |
| 上手难度 | 低 | 中高 |

**给远端部署的第一版建议：用无状态。** 你有 2 个只读工具，没有任何需要服务端主动推的东西，选有状态只会白背一个泄漏问题。等你真需要 `listChanged` 或会话级权限再说，而且那时也别用内存 Map，上 Redis。

如果坚持有状态，加个 TTL 兜底：

```javascript
// 给会话打时间戳，定时清掉超时未使用的
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.lastSeen > 30 * 60_000) {
      s.server.close();
      sessions.delete(sid);
    }
  }
}, 60_000);
```

## 7. 部署配置（改投 Vercel）

原本按计划要上 Render，结果卡在第一步：**建免费 Web Service 要绑信用卡**。换 Vercel，Hobby 计划不绑卡，而且它对 Express 是官方零配置支持。

先说 Vercel 文档里那条最容易毁掉部署的规则（`vercel.com/docs/frameworks/backend/express`）：平台会按**入口文件名白名单**去找你的 Express app —— `app.{js,ts...}`、`index.*`、`server.*`、`src/app.*`、`src/index.*`、`src/server.*`，文件里 `import express` 并且 `export default app`，然后**整个 app 变成一个 Vercel Function**。

这条规则正好砸中本仓库：我们的 REST 入口就叫 `src/app.ts`，在匹配列表里；而带 `/mcp` 的是 `src/http-mcp.ts`，**不在**列表里。所以直接把仓库丢上去，Vercel 部署的是 REST 版，`/mcp` 一定 404——而且 `/health` 是通的，看日志还会以为部署成功了。

修法不是改文件名（第一篇的目录结构就废了），而是**让入口 app 同时带 REST 和 MCP**：

```typescript
// src/app.ts 末尾
// Vercel 的 Express 零配置检测只认 src/app.ts 这类入口文件名，
// 所以 MCP 路由必须挂在同一个 app 上，否则部署上去 /mcp 直接 404
mountMcpHttp(app, "express-mcp-demo-http");

// Serverless 上由平台接管监听，这里不该自己 listen 抢端口
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const PORT = Number(process.env.PORT || 3000);
if (!IS_SERVERLESS && process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => { /* ... */ });
}

export default app;
```

顺手把三处重复的 `registerTool` 收进 `src/tools.ts`，stdio / 本地 HTTP / Vercel 三个入口共用一份定义——改 description 就是改接口文档，不该有三个副本。

**平台的限制决定了会话模式该选哪个**，这几个是官方数字（Hobby 即可用）：

| 项目 | Hobby 限制 | 对本项目的意义 |
|---|---|---|
| 函数最长执行 | 300s（默认即上限） | 无状态模式单次 POST 几百 ms，绰绰有余 |
| 流式响应 | 支持（`res.write` / `res.end`） | MCP 的 SSE 返回能出得来 |
| 请求/响应体 | 4.5 MB | README 截到 8000 字符远在限内 |
| 函数包体积 | 250 MB | 四个依赖，无压力 |
| 内存 | 2 GB / 1 vCPU | 够用 |
| 区域 | 默认单区 `iad1` | 国内访问有延迟，介意的换自己的服务器 |

有状态模式在这里是走不通的：它要维持一条长连接、会话表存在单实例内存里，而 Serverless 实例随时新建随时销毁。**Serverless 上只能选无状态**，这不是偏好问题，是平台约束。

环境变量只有两个要配：`MCP_AUTH_TOKEN`（勾 Sensitive，必填）和 `GITHUB_TOKEN`（选填，不填就吃 60 次/小时限频，`service.ts` 的 `FALLBACK` 会顶住，但结果会变假）。`MCP_AUTH_TOKEN` 缺失时 `src/auth.ts` 在 import 阶段就 `process.exit(1)`——这是故意的，宁可函数全量报错，也不要哪天忘配就把公网 MCP 裸放出去。

部署动作本身：推到 GitHub → `vercel.com/new` 导入仓库 → 让它识别出 Express → 填环境变量 → Deploy。URL 是 `https://<项目名>.vercel.app/mcp`（注意还带 `/mcp` 路径）。

> ⚠️ 本节文件名规则、限制数值来自 Vercel 官方文档（我逐条核对过），但**真实公网 URL 的响应时间、`verify-http-tool.mjs` 在 `*.vercel.app` 上的输出、Claude Desktop 远程连接**这三条要等部署完成才有。上线后补进这里。

（Render 的对照结论也有价值：它给的是一条常驻进程，`PORT` 语义、`res.on("close")` 回收会话、冷启动休眠那套都成立；Vercel 是函数，思路要换成「无状态 + 短请求」。你要是看到别的教程混着讲，多半就是这里没分清。）

## 8. 部署完怎么自证：一个脚本查到底

第一篇给了本地 stdio 的验证脚本，这篇补公网版。`test/verify-http-tool.mjs` 读两个环境变量就能验任何远端 MCP——注意远端一定要带 bearer token（为什么加鉴权见第 7 节）：

```javascript
const MCP_URL = process.env.MCP_URL || "http://localhost:3001/mcp";
const TOKEN = process.env.MCP_AUTH_TOKEN;

const client = new Client({ name: "verify-client", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} },
  })
);

const { tools } = await client.listTools();
// 光看注册不够，真调一次才知道出网、限频兜底这些是不是通的
const called = await client.callTool({ name: "get-trending", arguments: { topic: "mcp", limit: 2 } });
```

本地实测输出：

```
target: http://localhost:3000/mcp (带 bearer)
tools: [
  {
    name: 'get-trending',
    desc: '获取 GitHub 热门仓库，按 topic 和语言过滤',
    schema: [ 'topic', 'limit' ]
  },
  {
    name: 'get-readme',
    desc: '读取指定 GitHub 仓库的 README，适合做项目解读',
    schema: [ 'repo' ]
  }
]
callTool get-trending -> morluto/rea (413118), n8n-io/n8n (209169)
✅ HTTP 模式鉴权/注册/调用全部正常
```

**这个脚本比「Claude 里问一句试试」可靠**，因为它一次性回答四个问题：鉴权过没过、路由对不对、`registerTool` 生效没、工具真跑起来能不能拿到数据。线上出问题，先跑它，能立刻把锅分给「协议层」还是「模型层」。

顺带一句：我这台开发机上 `curl` 打 `api.github.com`、`*.vercel.app` 全部秒失败，但 Node 的 `fetch` 同一个地址 200。所以**别照本文的 curl 命令去验远端**，先用 Node 探活，否则你会误判成「部署失败了」：

```bash
node -e 'fetch(process.env.MCP_URL.replace(/\/mcp$/,"/health")).then(r=>r.json()).then(d=>console.log(d)).catch(e=>console.log("FAIL",e.cause?.code||e.message))'
```

**这个脚本比「Claude 里问一句试试」可靠**，因为它一次性回答三个问题：路由对不对、`registerTool` 生效没、schema 有没有真的传出去。线上出问题，先跑它，能立刻把锅分给「协议层」还是「模型层」。

## 9. 顺手补上：README 工具与 8000 字截断

上一篇预告的第三个工具其实已经有两个都在跑了（`get-trending` + `get-readme`）。带 token 实调一次（本地 `src/app.ts`，3000 端口）：

```bash
$ curl -X POST http://localhost:3000/mcp \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get-readme","arguments":{"repo":"modelcontextprotocol/typescript-sdk"}}}'
# 返回正文开头，含 SDK v2 与 2026-07-28 spec 的说明
```

注意 `src/service.ts:53` 那句 `return text.slice(0, 8000)`（工具层直接用它，不再二次截断）。这是我目前唯一觉得会欠债的地方：

- 8000 字符**按 README 头部硬切**，一个长 README 会切在句子中间，模型拿到的是残缺上下文；
- 8000 字符大致落在 2~3k token，一次调用不算贵，但工具描述里没有「返回会被截断」的提示，模型会以为拿到了全文，进而做出「这个项目没有 X 功能」的错误结论。

最小改法是把截断显式化，让模型知道后面还有：

```typescript
const raw = await getRepoReadme(repo);
const text = raw.length > 8000
  ? `${raw.slice(0, 8000)}\n\n[已截断，原文 ${raw.length} 字符]`
  : raw;
```

再进一步是给 tool 的 `description` 里补一句「返回前 8000 字符，长 README 请分段或指定章节」。**工具的 description 是模型唯一的接口文档**，它对「数据不完整」这件事不知情，就会自信地编。

## 10. 版本提醒

`package.json` 写的是 `"@modelcontextprotocol/sdk": "^1.12.0"`，我本地实际解析到的是 **1.32.2**。别把依赖钉死在小版本，这个 SDK 迭代很快——我从 README 工具拿回来的内容里就看到官方已经把 v2 挪到 `main` 分支、v1.x 单独拉了分支。你抄网上代码时，先 `npm ls @modelcontextprotocol/sdk` 看一眼自己装的到底是哪版，比对报错更有用。

## 11. 上线前自检清单

按这个顺序打一遍，比在客户端里试运气快得多：

```bash
# 1. 进程活着（Vercel 上也适用）
node -e 'fetch("<URL>/health").then(r=>r.json()).then(console.log)'

# 2. GET /mcp 期望 404 —— 只吃 POST，不是连不上
# 3. POST 不带 Accept: text/event-stream 期望 406
# 4. POST 不带 / 带错 Authorization 期望 401
curl -X POST <URL>/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'

# 5. 一次覆盖鉴权 + 注册 + 真调用
MCP_URL=<URL>/mcp MCP_AUTH_TOKEN=<token> node test/verify-http-tool.mjs
```

前面说过我这台机器 `curl` 走不通、Node 能走通，所以上面第 1 步故意用 `node -e`——**探活失败先怀疑网络，别急着重构代码**。

6. 入口文件名：Vercel 这类平台按白名单找入口，确认带 `/mcp` 的那个 app 才是被部署的那一个
7. 会话模式：Serverless 只能无状态；常驻进程想用有状态，必须同时有 DELETE 回收和 TTL
8. 自托管反代关缓冲：`proxy_buffering off;`，`proxy_read_timeout` 拉到分钟级（Vercel 自己管，不用你配）
9. `GITHUB_TOKEN` 在环境变量里，且不是明文提交
10. 客户端 URL 带 `/mcp`，并且 `headers` 里带上 `Authorization`

## 小结

这一篇和上一篇的最大差别是：**业务代码几乎没变，变的是对「连接」和「谁能进来」的假设。**

- `POST /mcp` 返回 404 不代表服务挂了，GET 本来就不该有响应；
- 406 是 `Accept` 少一项，不是 CORS；
- `res.on("close") => transport.close()` 在无状态下是防泄漏，在有状态下是拆房卡；
- 有状态会话不 DELETE 就永久留在内存里，我拿 100 次请求验过它一个都不掉；
- 远端 MCP 的返回是 SSE 流，反代缓冲会把「能用」变成「没反应」；
- 部署版只能选**无状态**——Serverless 实例随时消失，内存里的会话表活不过一次冷启动；
- 平台按**入口文件名**挑你的 app，文件名撞车会让部署「看起来成功」但 MCP 路由根本不存在；
- 公网 URL 必须带 token，而且缺 token 时要让进程**拒绝启动**，而不是默默裸放。

一句话：**本地跑通的 MCP 只是「能调」，公网跑通的 MCP 是「能被别人调」，中间隔的是生命周期和鉴权。**

## 下一篇预告

这一篇用静态 bearer 把门守住了，但它有两个天花板：token 是长期有效的明文，而且 Claude 的**远程 OAuth 客户端**（Claude Desktop / Claude API 的 connector）会要求标准授权流程。下一篇讲 `Authorization` 在 MCP 里的正规解法：受保护资源元数据、动态客户端注册、PKCE 回调，以及为什么免费 PaaS 的回调端口在本地开发时特别容易踩坑。

---

如果你觉得有用，点个收藏；评论区可以贴你的 `/health` 和 `verify-http-tool.mjs` 输出，我帮你看卡在哪一层。
