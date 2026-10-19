# 社区提交服务部署与联调清单

本次仅完成 website 仓的本地实现与验证；没有部署 Worker、执行远程 D1 迁移、创建真实 PR，也没有更改 MoE4All 引擎仓。不要把测试中的模拟 PR 当成生产验证。

## 仓库职责

| 位置 | 职责 |
| --- | --- |
| website / community | 拖入 `.m4b` / `.m4e`、独立校验、浏览器授权、回执、静态榜单 |
| website / backend | Cloudflare 转发缓冲区、Turnstile、Bot 创建 PR、核验原件、立即清理正文、状态同步 |
| MoE4All 引擎仓 | 报告生产、CMD 向导、Git 直提 PR、独立 Python 复核、报告 PR 的轻量 CI、维护者审核 |
| website CI | 从已合入 main 的 `.m4b` 提炼全量精简静态索引，压缩后供浏览器筛选 |

两类文件都允许 Git 或 Cloudflare 路线。Git 直提无需向 D1 导入；错误报告也不创建 Issue、不进入排行榜。旧本地私有审核界面仅作兼容，不是正式生产流程，正式 PR 模式关闭管理接口。

## 部署顺序

1. 先审阅并备份现有 D1，确认 `0001.sql`、`0002_public_pr.sql` 已在迁移记录中。旧服务若通过控制台手工建表，须先核对实际列，不能盲目重复执行 ALTER。
2. 使用 `backend/wrangler.toml` 对目标数据库应用新增 `0003_forwarding.sql`。该迁移新增转发元数据、摘要与滚动限额记录；只为已授权公开的旧正文补 72 小时期限，不把旧私有记录改成公开。
3. 部署新 Worker。配置中的 D1 binding 为 `DB`；生产始终使用 `github_pr`，不依赖 Cloudflare Access 或旧导入 token。
4. 核对 Pages 网关的 `SUBMISSIONS` service binding 仍指向该 Worker，自定义域名和 HTTPS 正常。
5. 核对 Turnstile 允许域名与 `SITE_ORIGIN` 匹配。站点公钥仅由确认接口提供；CMD 轮询不需要它。
6. 确认每 5 分钟一次的 cron 已生效，再部署网页。GitHub Pages 工作流不部署 Worker，也不执行 D1 迁移，不能只上线网页而跳过这两步。

所需变量：`SITE_ORIGIN`、`GITHUB_REPOSITORY`、`TURNSTILE_SITE_KEY`。

所需 secrets：`RATE_LIMIT_SALT`、`TURNSTILE_SECRET`、`GITHUB_TOKEN`。不要把值写进 Git、测试输出、错误信息或交接记录。GitHub token 限定目标仓库的 Contents 与 Pull requests 写权限；代码只向报告分支写文件，绝不自动合并。

## 转发与维护

- HTTP 请求完成校验和原子入库即返回 `202 / forwarding`，使用 `ctx.waitUntil` 执行首次转发。
- cron 每批最多处理 3 份到期任务，补偿请求中断或 GitHub 暂时不可用；失败按 30 秒起步、最长 1 小时退避，待审核 PR 每 15 分钟检查一次。任务较多时实际同步会排队，不能承诺精确到分钟。
- 每次 GitHub 转发有 25 秒总网络预算，单次请求最多 15 秒；同步锁避免同一回执被多个任务同时推进。
- 对 PR head 的路径、唯一新增文件、原件 SHA-256 复核成功后，保存原始 UTC 时间、Git 路径、PR / head / hash，立即将正文置空。后续不需要解码原件即可同步状态。
- 正文缓冲区上限 128 MiB。超过 72 小时的未验证转发标记 `delivery_failed`，释放正文、保留回执；在下一次维护任务清理。正在执行的有效同步锁会暂缓清理，避免任务和清理互相覆盖。
- 旧私有记录不自动发布、不自动清理；上线前单独审计，不能借此次迁移批量公开。它们仍占用缓冲区，必要时由维护者另行处置。
- 两种报告共用每来源滚动 24 小时 50 份成功新报告、100 个成功会话额度；无效文件和重复报告不消耗成功报告额度。还受短期突发限制。来源只保存盐化摘要。
- 已失败报告的同 ID 重传只返回原失败回执；再次尝试请由向导重新导出新 ID，不无限重启存储期限。

## 引擎侧待配合

1. `.m4b` 和 `.m4e` 均选择 Git 直提 PR 或 Cloudflare 转发；不要继续将错误只导向 Cloudflare。
2. 完整封装与解压 JSON 均执行 128 KiB 限额；同步 Rust、Python、CMD 文案和报告 PR CI。网站对手动 Benchmark 的结果类型也要求明确为 `prefill` 或 `decode`。
3. 创建会话可附带最多 8 行、每行 500 字符的摘要；摘要不传正文，不把“已授权”显示为“已上传”。实际发文件后必须保留回执并分别展示五种状态。
4. 对 429 / 503 有限重试，遵循 `Retry-After`；保留本地原件。`delivery_failed` 不表示文件可静默重传成功。
5. 在 PR 创建前明确提示立即公开，不只在合并时提示；错误描述在导出前完成、可返回修改，诊断日志仍须去敏。
6. 对齐 Rust / Python 的单行摘要规范化边界，参见 [兼容核对](submission-compatibility.md)。网站现有普通样本通过交叉测试不等于这些边界差异已经修复。
7. 报告 PR 跑独立轻量校验，不触发推理 / GPU 重测、不自动合并；合并 Benchmark 后通知 website 刷新索引，错误报告合并只归档。

## 上线验收

先用明确标记的两份测试报告做真实联调，审核后清理测试 PR，不伪装成实测成绩：

- health 两个限额都为 `131072`；两个授权凭证不能互换，确认页能看到未验证摘要，文件端不能读到 widget 配置。
- Benchmark / 错误均可返回 `forwarding`，然后生成唯一公开 PR；检查 GitHub PR head 字节与原文件一致、D1 正文已空、回执仍正常。
- 实测重复上传不会重复创建 PR；GitHub 暂时失败能恢复，额度和容量不足不会返回成功或淘汰未过期报告。
- 手动合并 / 关闭后，正文为空的回执仍可转为 `published` / `rejected`；错误 `published` 只代表归档，不代表修复。
- 直接 Git 合入 `.m4b` 后，CI 静态索引更新；不触发 D1 导入，`.m4e` 不上榜。
- 用户界面不暴露 token、原始 IP、私有配置或测试数据；正式包不包含本地管理界面和 fixtures。
