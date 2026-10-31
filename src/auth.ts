import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// 公网 URL 一旦泄露，任何人都能拿你的服务烧 GitHub 配额，所以 MCP 入口必须带 token。
// 缺 token 直接拒绝启动，避免哪天忘配就裸放上线。
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN ?? "";

if (!AUTH_TOKEN) {
  console.error('❌ 缺少 MCP_AUTH_TOKEN，拒绝以裸放状态启动。生成：node -e "console.log(require(\'crypto\').randomUUID())"');
  process.exit(1);
}

// 定长比较，避免逐字节短路带来的计时侧信道
export function requireBearer(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  if (scheme === "Bearer" && token) {
    const got = Buffer.from(token);
    const want = Buffer.from(AUTH_TOKEN);
    if (got.length === want.length && timingSafeEqual(got, want)) return next();
  }
  res.setHeader("WWW-Authenticate", "Bearer");
  res.status(401).json({ error: "missing or invalid bearer token" });
}
