// 核心业务层：REST 和 MCP 共用这里，别在 route / tool 里写逻辑
// 方便测试、复用、写文章讲解

export interface RepoItem {
  repo: string;
  stars: number;
  desc: string;
  url: string;
}

const FALLBACK: RepoItem[] = [
  { repo: "n8n-io/n8n", stars: 98700, desc: "TS工作流自动化", url: "https://github.com/n8n-io/n8n" },
  { repo: "modelcontextprotocol/typescript-sdk", stars: 13600, desc: "MCP官方TS SDK", url: "https://github.com/modelcontextprotocol/typescript-sdk" },
  { repo: "triggerdotdev/trigger.dev", stars: 12000, desc: "Node后台任务框架", url: "https://github.com/triggerdotdev/trigger.dev" },
];

export async function getTrending(topic = "typescript", limit = 5): Promise<RepoItem[]> {
  try {
    // 用 GitHub Search API 做真实数据，免 key 但有频率限制 (60次/小时)
    const q = encodeURIComponent(`topic:${topic} language:TypeScript stars:>500`);
    const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${limit}`, {
      headers: {
        "User-Agent": "express-mcp-starter",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`github api ${res.status}`);
    const data: any = await res.json();
    return (data.items || []).slice(0, limit).map((r: any) => ({
      repo: r.full_name,
      stars: r.stargazers_count,
      desc: r.description || "",
      url: r.html_url,
    }));
  } catch (e) {
    console.error("[service] github api failed, use fallback:", (e as Error).message);
    return FALLBACK.slice(0, limit);
  }
}

export async function getRepoReadme(repo: string): Promise<string> {
  // 给第二个 tool 用：让 AI 能读 README 做解读，写内容很出彩
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/readme`, {
      headers: {
        Accept: "application/vnd.github.raw",
        "User-Agent": "express-mcp-starter",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`readme ${res.status}`);
    const text = await res.text();
    return text.slice(0, 8000); // 截断防超长
  } catch (e) {
    return `读取 ${repo} README 失败: ${(e as Error).message}`;
  }
}
