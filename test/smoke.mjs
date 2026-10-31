// 最简冒烟测试：node --import tsx/esm test/smoke.mjs
import assert from "node:assert";

const base = process.env.BASE || "http://localhost:3000";

const h = await fetch(base + "/health").then(r => r.json());
assert(h.ok, "health failed");
console.log("✅ health ok", h);

const t = await fetch(base + "/api/trending?topic=typescript&limit=2").then(r => r.json());
assert(Array.isArray(t.data), "trending.data not array");
console.log("✅ trending ok", t.data.map(d => d.repo));
console.log("\n全部通过！去写文章吧");
