# 排行榜 Git 数据链路

更新：2026-10-21。

## 职责

原始报告经 PR 校验和人工审核后合入 `Headmaster218/MoE4All` 的 main。
可信 main CI 从 `benchmark-database/v1/` 原件生成全量精简库，并提交到
同仓库 main 的 `benchmark-database/index/v1/`。网站直接读取 Git 数据，不查询
Cloudflare、不等待六小时、不因数据更新重新部署。

```text
报告 PR -> 校验与人工合并 -> 引擎 main CI
                             |
                             v
Git：manifest.json + 内容寻址 Brotli/gzip
                             |
                             v
浏览器：校验 -> 缓存 -> 本地筛选、排序、分页
```

Cloudflare 仍可承担上传中转和回执，但不参与精简库生成、存储或读取。
错误报告、未合并 PR 和本地演示数据不进入排行榜。社区提交不等于独立复测。

## 入口与数据格式

固定入口：

`https://raw.githubusercontent.com/Headmaster218/MoE4All/main/benchmark-database/index/v1/manifest.json`

沿用现有精简索引 v1：报告、上下文、测量三张表，列式编码，无损保留原有字段。
两种压缩包解码结果相同；浏览器优先 Brotli，不能使用时回退 gzip。
原始报告协议、上传渠道和排行榜筛选维度不变。

manifest 的 `source.commit` 是最后修改性能原件的 commit；
`package_commit` 是包含压缩包的不可变 Git commit，两者不能混用。
CI 先提交压缩包，再提交引用它们的 manifest，通过同一次索引生成物合并发布。
浏览器按 `package_commit` 读取压缩包，不追随移动分支读取包体，避免更新期间混读。
最新树只保留当前包；旧 manifest 引用的历史包仍可从对应 commit 取得。

## CI

引擎 `.github/workflows/benchmark-index.yml` 在 main 的原件或生成器变化后运行，
并提供手动初始化、重试入口。只有原件合入 main 后才生成索引；报告 PR 仍只能新增一份原件，
不得夹带索引、脚本或工作流。生成提交不触发自身循环。

每次从最新 main 的完整原件树重新校验和构建。相同输入不产生新提交。
并发更新使用普通非强制 push；冲突后从最新 main 重建，不能覆盖新报告。
失败保留上一已发布版本。原件只需一次人工审核；CI 在内部自动创建并合并
仅含精简索引文件的生成物 PR，不让维护者再审批一次，不自动审批或合并原始报告。
发布任务先核对机器人身份、仓库、head SHA、文件集合和 main 是否前进，再合并并复核生成物。
机器 PR 保留合并提交以维持 `package_commit` 可达，临时发布分支完成后删除。
仓库需允许 Actions 创建 PR；默认 token 权限仍为只读，仅可信 main 发布任务声明写权限。
不改 main 的 PR 保护，不新增跨仓库通知凭证；网站仍固定读取 main。

网站退出旧快照生成与通知流程。网站 Pages 的产品版本同步可继续独立定时运行，
不影响榜单新数据的可见性。

## 浏览器

每次访问检查固定 manifest，无六小时客户端冷却期；Git 托管侧缓存可能仍有短暂延迟。
同版本复用已校验压缩包，新版本完整校验通过后替换缓存。
读取失败时可保留旧的已校验版本，明确标为离线缓存。

校验包括封装大小/hash、解压大小/hash、字段、引用、行数、来源和正式/演示标记。
manifest 上限 64 KiB，单压缩包 16 MiB，解码 64 MiB；
最多 50,000 报告、150,000 上下文、300,000 测量、8,000,000 单元格。
超限失败，不截断或展示半个数据集。字段详见 [精简索引规范](leaderboard-index-v1.md)。

本地演示继续使用 loopback 专用数据，不能作为 Git 正式数据的静默替代。
