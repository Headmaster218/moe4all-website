# MoE4All 社区提交后端协议 v1

状态：本地实现。异步转发、限额、清理和回执均有测试；本次更新尚未部署，生产 Worker、Bot 与真实 PR 流程仍需上线验收。

## 1. 目标与边界

社区后端接收 Benchmark 与错误报告，完成浏览器确认、格式校验、短期缓存、GitHub PR 转发和回执查询。

Cloudflare 是可靠转发层，不是长期报告仓库：

```text
客户端生成报告
  -> Cloudflare 接收、校验并暂存
  -> GitHub Bot 创建公开 PR
  -> 后端复核 PR head 中的原件
  -> 删除 Cloudflare 中的报告正文
  -> 保留回执、hash、PR 地址和状态
```

GitHub `main` 是最终公开数据源。后端不自动合并 PR、不直接写入 `main`、不创建 Issue。GitHub 侧 CI 与维护者审核规则不属于本后端协议。

排行榜从网站静态压缩索引读取已审核成绩，在浏览器筛选与分页，不依赖本 API。`GET /benchmarks` 仅保留旧派生数据兼容；Git 导入端点在正式 PR 模式返回 404，直接 Git 提交不进入 D1。

正式地址：

```text
API:  https://api.moe4all.com/v1
网页: https://moe4all.com/community/upload.html
```

## 2. 报告文件

| 类型 | 扩展名 | `kind` | Payload schema | Git 路径 |
| --- | --- | --- | --- | --- |
| Benchmark | `.m4b` | `benchmark` | `benchmark/1` | `benchmark-database/v1/YYYY-MM/<id>.m4b` |
| 错误报告 | `.m4e` | `error` | `error/1` | `error-database/v1/YYYY-MM/<id>.m4e` |

两类报告统一使用 `MOE4ALL-SUBMISSION/1` 文本封装：JSON payload 先经 gzip 压缩，再以 Base64 标准字符写入带可读摘要的文本文件。Base64 会增加压缩数据的文本体积，但报告 JSON 重复度较高，完整封装通常仍明显小于解压后的 JSON。上传时发送原始文件字节，不使用 multipart，不解包重传，也不再次 Base64。

限制：

- 完整 `.m4b/.m4e` 封装文件最大 128 KiB。
- 解压后 JSON 最大 128 KiB。
- `file_sha256` 是整个封装文件的 SHA-256，用于绑定上传和复核 PR 原件。
- `payload_sha256` 是解压后原始 JSON 字节的 SHA-256，用于内容去重。
- 同类型、同报告 ID、不同 payload 拒绝覆盖。
- 客户端 ID 使用 UTC 毫秒时间加 128-bit 系统随机数；Benchmark 可追加本地冲突序号。

完整字段与编码规则由引擎的 `documentation/reference/submission-format.md`、`benchmark/1` 和 `error/1` schema 定义。

## 3. 上传流程

```text
生成并本地校验报告
  -> POST /upload-sessions
  -> 打开 verification_url
  -> 用户主动确认公开用途并完成 Turnstile
  -> 文件端轮询到 ready
  -> POST 原始 .m4b / .m4e
  -> 保存 receipt_id 与 receipt_token
  -> 后端转发到 GitHub PR
```

两类 PR 在创建后立即公开，不必等到合并。确认页必须展示报告类型、ID、大小、文件 hash、可读摘要和公开用途，且同意框不得默认勾选。

Benchmark 和错误报告都支持两条路线：有 GitHub 账户且可使用 Git 工具时直接提交同格式 PR；否则使用本流程。网页仅拖入引擎生成的封装文件，不手工编辑 JSON。两条路线都需维护者手动合并，不创建 Issue。

## 4. 接口

所有路径相对 API 基地址。JSON 使用 UTF-8；受保护接口使用 `Authorization: Bearer <credential>`；敏感响应使用 `Cache-Control: no-store`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 服务模式、协议版本和大小限制 |
| `POST` | `/upload-sessions` | 创建上传会话 |
| `GET` | `/upload-sessions/{id}` | 文件端查询会话 |
| `GET` | `/upload-sessions/{id}/confirmation` | 浏览器读取确认信息 |
| `POST` | `/upload-sessions/{id}/authorize` | 浏览器授权上传 |
| `POST` | `/upload-sessions/{id}/cancel` | 浏览器取消会话 |
| `POST` | `/upload-sessions/{id}/report` | 上传原始报告文件 |
| `GET` | `/receipts/{id}` | 查询 PR 与归档状态 |
| `GET` | `/benchmarks` | 查询已收录 Benchmark 的派生数据 |
| `POST` | `/integrations/github/import` | 旧本地兼容接口；正式 PR 模式为 404 |

### 创建会话

`POST /upload-sessions`：

```json
{
  "kind": "benchmark",
  "report_id": "20261019T080000.000Z-0123456789abcdef0123456789abcdef",
  "file_sha256": "<64 lowercase hex>",
  "size_bytes": 12345
}
```

成功返回 `201`，包含：

- `session_id`
- `session_token`
- `state=awaiting_verification`
- `expires_at`
- `poll_after_seconds`
- `verification_url`
- `max_upload_bytes`

会话默认有效15分钟。`session_token` 只供文件端使用；`verification_url` 只携带独立的浏览器确认凭证。

可选 `summary` 是最多 8 行、每行最多 500 个 Unicode 字符的可读摘要数组。确认页在收到原件前明确标注“客户端提供，尚未校验原件”；旧客户端不提供摘要时，提示在 CMD 核对。最终上传会重新生成、比对封装摘要，不信任这个元数据。上传后确认端点返回已校验摘要与 `summary_verified=true`。

`turnstile_site_key`、摘要与校验标记仅由浏览器 `/confirmation` 返回，不出现在文件端轮询响应中。

### 浏览器确认

确认页使用浏览器凭证读取会话，然后提交：

```json
{
  "consent": "public_benchmark",
  "turnstile_token": "<token>"
}
```

Benchmark 使用 `public_benchmark`，错误报告使用 `public_error`。服务端必须验证 Turnstile 的成功状态、hostname 和 `action=submission`。成功后会话变为 `ready`。

### 上传报告

`POST /upload-sessions/{id}/report` 使用 `session_token`：

```text
Content-Type: text/plain; charset=utf-8
Accept: application/json
```

请求正文是原始报告文件。服务端重新验证文件大小、文件 hash、封装、gzip、payload schema、摘要、报告 ID、类型和隐私约束。

首次接收返回 `202`，相同报告的幂等重试返回 `200`。响应包含：

- `receipt_id` 与 `receipt_token`
- `kind`、`report_id`
- `file_sha256`、`payload_sha256`
- `status`
- `public_url`（PR 尚未建立时为 `null`）
- `duplicate`

首次响应状态为 `forwarding`，不等待 GitHub 网络请求。后台立即尝试转发；定时任务每 5 分钟补偿重试，失败采用退避。PR 待审核状态每 15 分钟同步一次；回执读取本身不等待 GitHub。

上传失败不得删除客户端原件。回执凭证应单独保存在本地私有目录，不写入报告、日志或 Git。

## 5. 状态

| 状态 | 含义 |
| --- | --- |
| `forwarding` | Cloudflare 已接收，正在创建或重试 GitHub PR |
| `pending_review` | PR 已建立，PR head 原件已通过 hash 复核 |
| `published` | PR 已合并，且 main 中的原件已复核 |
| `rejected` | PR 已关闭且未合并 |
| `delivery_failed` | 转发期限已结束，正文已清理；从向导重新导出新 ID 的报告再提交 |

`GET /receipts/{id}` 使用 `receipt_token` 返回当前状态、更新时间、PR 或 Git 文件地址。错误报告的 `published` 只表示已归档，不表示问题已经修复。

回执还包含 `failure_code`、`body_retained`。同 ID 重传只返回原回执，不重复计数或重启失败期限；重新尝试已终止的报告须重新导出。客户端必须读取状态，不能把 HTTP 200 等同于 PR 已建立。

### 浏览器回执交接

CMD 不实现查询界面，保存私密回执后打开 `https://moe4all.com/community/index.html#receipt=<receipt_id>&token=<receipt_token>`。fragment 不进入 HTTP 请求；网页读取后立即改为 `#receipts`，使用本站已配置的 API 查询并复核身份，成功后才保存在浏览器。

网页也接受主动选择的 `.private-receipt.json`（最大 8 KiB），用于浏览器更换或自动打开失败后的恢复。文件中的 `api_base` 如与当前服务不一致则拒绝，绝不按导入文件指定的地址发送凭证。不要将完整交接 URL 写入普通日志或 Git；Git 直提 PR 不需要 Cloudflare 回执。

## 6. GitHub 转发

Bot 为每份报告创建独立分支和 PR：

```text
branch: community/<kind>/<file_sha256>
base:   main
files:  exactly one immutable .m4b or .m4e
```

PR 创建后，后端必须从 PR head 重新读取文件，并核对路径、类型和 `file_sha256`。只有复核成功才进入 `pending_review`，并允许删除 Cloudflare 中的正文。

PR 合并后，后端确认目标 commit 属于 `main` 历史且原件 hash 一致，再标记为 `published`。PR 关闭且未合并时标记为 `rejected`。

GitHub 暂时不可用时保留原件并重试。重试必须幂等：相同报告复用既有分支、PR 和回执，不重复创建。

## 7. 临时存储与限流

- 待转发原件共用128 MiB滚动缓冲区。
- 无效报告在完整校验失败后立即拒绝，不进入缓冲区。
- PR head 复核成功后立即删除正文，仅保留元数据、hash、回执和公开地址。
- GitHub 转发失败的正文最多保留72小时；到期后标记为 `delivery_failed` 再释放空间。
- 仍在有效重试期内的报告不得被静默淘汰；空间不足时拒绝新上传并返回可重试的503。
- 每个来源24小时内最多成功提交50份报告，两种类型合计。
- 每个来源24小时内最多创建100个会话，并保留短时间突发限制。
- 来源使用服务端盐化摘要计数，不持久保存明文 IP。

50 份报告和 100 个会话均使用滚动 24 小时窗口；重复报告和校验失败不消耗成功报告额度。入库、容量检查与成功报告计数在同一事务完成。短期突发上限为每来源每 15 分钟创建 20 个会话、上传 30 次。直接 Git PR 不受 Cloudflare 来源配额约束。

过期会话、限流桶和失效同步锁应定期清理。

## 8. 安全与隐私

- 正式环境只允许 HTTPS；仅显式开发配置允许 loopback HTTP。
- 浏览器请求的 `Origin` 必须匹配配置站点；CORS 不能替代凭证验证。
- 确认 URL 使用 fragment；页面读取后立即从地址栏清除，并使用 `Referrer-Policy: no-referrer`。
- `session_token`、浏览器凭证、`receipt_token`、Turnstile secret 和 GitHub token 不能互换或进入普通日志。
- 错误报告不得包含 prompt、response、API key 或未脱敏本地路径；客户端声明后，服务端仍需再次检查。
- GitHub Bot token 限定目标仓库及所需权限；报告分支与目录由转发代码约束，建议同时保护 `main` 分支。
- 本地开发模式只能监听 loopback，可跳过 Turnstile，但不得部署到公网。

## 9. 错误处理

错误响应统一包含 `api_version` 和 `error.code`。客户端根据 HTTP 状态、`retryable` 和 `Retry-After` 决定是否重试。

- 网络失败、429和可重试的5xx：有限重试，保留本地原件。
- 4xx格式、隐私或冲突错误：停止自动重试，修正后生成新报告。
- 任何非成功响应、非 JSON 响应或缺少预期字段的响应，都不得显示上传成功。

报告生成成功、Cloudflare 接收成功、PR 创建成功和 PR 合并成功是四个独立状态，客户端必须分别展示。
