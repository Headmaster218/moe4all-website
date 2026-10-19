# 排行榜静态数据链路

更新：2026-10-19。代码、本地测试与构建已实现；本轮没有 push、运行线上工作流、修改 Cloudflare 配置或清理线上数据。

## 唯一方案与职责

原始 `.m4b` / `.m4e` 最终存 Git，D1 只承担上传、转发、回执及审核期间的状态。排行榜使用 CI 从已合入 Git main 的 `.m4b` 提炼的**一份全量精简索引**，不查询 D1，不按模型或筛选组合分片。

```text
CMD 直接 Git PR --------------------+
                                    +-> 维护者审核 -> 数据仓库 main
CMD / 网页 -> Cloudflare -> Git PR --+                      |
                                                          v
网站 CI：读取不可变 Git 原件 -> JS 校验 + 独立 Python 解码复核
                                                          |
                                                          v
网站 Git：content/leaderboard/snapshot.json
                                                          |
                                                          v
网站构建：manifest + 内容寻址 Brotli / gzip
                                                          |
                                                          v
浏览器：小目录 + 一种压缩包 -> 校验 -> 本地筛选 / 排序 / 分页
```

`.m4e`、未合并 PR、收件箱及本地演示数据不进入正式排行榜。通过格式校验或维护者审核不等于独立复测，网页仍标为社区提交。

不建设多维组合文件，不同时从 Git 与 Cloudflare 下载重复总库，不引入 D1 排行榜查询副本。用户从模型、GPU 或 RAM 任一维度开始筛选，使用的是同一个已经加载的索引。

## 源码入口

| 模块 | 作用 |
| --- | --- |
| `community/leaderboard-model.mjs` | 白名单字段投影、三层短引用、列式编解码、语义校验、溯源链接 |
| `scripts/build-leaderboard.mjs` | 从指定 Git commit 读取封装原件，生成快照和静态压缩资源 |
| `community/leaderboard-loader.mjs` | 限流量读取、解压、hash 校验、持久缓存与离线回退 |
| `community/ui-model.mjs` | 多选、范围过滤、可比性判断与 CSV |
| `community/app.mjs` | 排行榜与提交界面；榜单不调用 `/v1/benchmarks` |
| `.github/workflows/leaderboard.yml` | 手动、定时及数据通知触发，校验原件并提交精简快照 |
| `.github/workflows/pages.yml` | 从已提交快照生成网站，部署时不请求原件 |
| `backend/leaderboard-preview.mjs` | 仅 loopback 服务可用的虚构演示数据，禁止生产发布 |

字段范围、事实与缺口见 [精简索引字段清单](leaderboard-index-v1.md)。上传接口见 [提交协议](submission-api-v1.md)。

## 来源与数据版本

数据仓库为 `Headmaster218/MoE4All`，原件路径为 `benchmark-database/v1/YYYY-MM/<id>.m4b`。生成器解析指定 ref 后，固定到最后一次改变该目录的完整 commit，避免无关引擎代码提交造成索引反复失效。

每次刷新从该目录的**完整 Git 树**重建，规模小时以确定性和可靠补漏优先；不是只读本次 push 差量。CI 会重新读取原件，浏览器不会。每次只提交这一份生成快照；不提交压缩包、原件副本和测试输出。未来原件规模变大后，可在不改变浏览器协议的前提下增加 CI 提取缓存。

生成器拒绝重复 ID、ID/文件名不一致、月份与原始 UTC 时间不符、未脱敏内容、格式或独立解码复核失败；遇到尚未转换的旧 JSON 会失败，不静默忽略。原件被移除或更正后，下一次完整构建反映当前受审 Git 树。

全局来源保存仓库、不可变数据 commit 与路径格式版本。浏览器根据报告 ID 和原始 UTC 月份构造 GitHub blob / raw 下载链接，不重复传逐报告长链接，也不依赖 GitHub 列表 API。引擎 build commit 与数据 commit 分开。

版本是列式 JSON 字节的 SHA-256。生成时间放在 manifest 外层，不因刷新时钟改变内容版本。相同报告、字段及数据来源生成同一个版本；压缩不四舍五入原始速率，也不丢失已定义的索引字段。

## 资源与缓存

目录为 `/community/data/`：

1. `manifest.json`：很小，包含数据版本、来源、三表行数、解码大小和两种压缩包的大小/hash。浏览器每次访问重新核验目录。
2. `index-<sha256>.br.bin`：Brotli Q11。支持原生 Brotli 解压的浏览器优先选择。
3. `index-<sha256>.gz.bin`：gzip level 9。其他浏览器选择它；Brotli 请求或解压失败时也可回退。正常只下载其中一种。

浏览器先核对压缩包长度/hash，再解压并核对 JSON 长度/hash，最后核对字段、引用、版本、来源、行数及正式/演示标记。不能只检查 HTTP 200。原生 gzip 不可用时才加载已有 gzip 解码器；普通榜单浏览不会预先加载上传 codec。

独立硬上限：manifest 64 KiB、单个压缩包 16 MiB、解码 JSON 64 MiB、报告 50,000、上下文 150,000、测量 300,000、展开单元格 8,000,000。各限制共同生效，不能据此承诺任意形状的 50,000 份报告都可容纳。超限时构建或读取失败，不截断成绩，也不展示半个数据集。

使用独立 CacheStorage `moe4all-leaderboard-v1`。同版本再访仅取 manifest，压缩包从已校验缓存读取。新版本完整通过校验后才替换缓存，不保留重复版本；缓存损坏会删除并重取。新版本或网络不可用时，可以使用旧的已校验版本并明确标为离线缓存，不能把旧成绩冒充最新。缓存权限被拒绝时仍能在线加载。

筛选、排序、分页、查看摘要均不再下载数据。只有主动打开 Git 原件，才访问 GitHub。上传、回执与人机验证仍使用独立 Cloudflare API，与榜单静态包互不依赖。

## CI 触发与发布

网站 `leaderboard.yml` 提供三种入口：

- 手动运行。
- 每 6 小时定时刷新，用于补漏；定时事件可能延迟，不是实时保证。
- `repository_dispatch: benchmark-data`，供数据仓库在受信 main 校验成功后通知。

引擎侧接入模板为 `integrations/notify-benchmark-step.yml`。本轮不修改引擎工作区，模板尚未代为安装；未接入时仍可手动或定时刷新。通知凭证只放 Actions secrets，不放网页。

生成成功且快照有变化时，CI 只暂存 `content/leaderboard/snapshot.json`，普通提交并推送网站 main；不 force push。需要仓库允许工作流写入，若 main 保护策略阻止 bot 直接提交，应改成快照 PR 后再合并，不绕过保护。

`GITHUB_TOKEN` 发起的普通 push 不会再次触发常规 push 工作流，因此刷新任务另外发 `leaderboard-data-ready` 事件，Pages 明确监听它。该事件不是产品 release 通知，不传给版本同步解析器。说明见 [GitHub 官方触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。现有 Pages 定时入口也可兜底重新构建。

推送冲突、校验失败或部署失败都保留上一线上版本，后续从完整树重试，不推进不完整快照。数据 CI 与 Pages 各有自己的 concurrency 组。首次线上验收还需确认仓库写权限、受保护分支规则、数据仓库 Python 解码器与生成报告的兼容性，以及 dispatch/Pages 最终结果。

## 本地与生产的隔离

loopback 演示使用同一套投影、编解码与加载器，数据显式为 `mode=preview` / `demo=true`。演示不生成虚假的 Git 原件链接。

正式构建只读取受版本管理的 `content/leaderboard/snapshot.json`，拒绝 preview、demo、来源仓库不匹配和不合法快照。发布文件使用 allowlist，不包含本地管理页、SQLite、fixture、后端源码及浏览器配置。

当前初始正式快照为空：本轮只读核对的引擎本地 Git 树没有可提取的归档原件。不能用演示成绩填充生产榜；接入数据 CI 后按已审核 Git 原件更新。

## 容量测量与验收口径

早期原型测量为合成数据，不是真实社区分布：每份报告 3 上下文 × 3 并发，1,000 份报告的核心列式 Brotli 约 63–119 KiB，10,000 份约 0.44–1.14 MiB；gzip 分别约 104–138 KiB、0.92–1.37 MiB。它使用旧候选字段，不能当作本版新增字段后的精确尺寸。

原型证据保存在 `local-work/results/agent/20261019-202910-full-index-compression-7ce2/`。当前真实生成器与浏览器验收结果保存在本轮证据和结果目录 `20261019-205715-static-leaderboard-9a3f`。传输大小不等于内存占用，压缩还原无损不等于摘要保留全部原始报告；完整信息始终在 Git 原件。

本版生成器的较难压缩合成样本：所有分段速率与模型盘读测速率独立变化，保留完整浮点精度和当前全部字段，并逐项验证压缩还原。

| 报告 / 测量数 | 列式 JSON | Brotli Q11 | gzip 9 | manifest |
| --- | ---: | ---: | ---: | ---: |
| 1,000 / 9,000 | 988.1 KiB | 369.9 KiB | 405.9 KiB | 843 B |
| 10,000 / 90,000 | 9.75 MiB | 3.59 MiB | 3.89 MiB | 849 B |

桌面 Node 中本次 10,000 份的解压、解析和恢复对象约 1.04 秒，生成与两种压缩约 30.4 秒；不是手机、Safari 或网页交互耗时。高独立性浮点数据比早期相关样本更难压缩，不把旧估算冒充新实现的保证。当前浏览器验收覆盖 32 份演示报告与空生产快照，不据此宣称十万条记录的移动端体验已经验收。真实规模增长时需继续测解析、过滤及内存，必要时再引入 Worker 或远端查询，不预建筛选组合。

当前范围不包含：开启或修改线上服务、将旧 D1 数据迁走、删除待审原件、自动合并用户 PR、自动调整源报告，以及实测推理性能。旧 `/v1/benchmarks` 与 Git 导入 API 保留兼容，不是正式网页榜单来源；暂存清理必须按原有归档复核规则独立执行。
