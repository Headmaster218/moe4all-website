# 引擎与网站的封装兼容核对

更新：2026-10-20。本地引擎维护分支与 website 已对齐并完成联调；不表示生产 Worker 或真实 GitHub PR 已验收。

## 既有差异与修复

此前 Python 在描述恰好达到 240 个 code point 时不追加 ...，也没有将 NUL 等控制字符转为空格，因而会把合法 Rust 报告误判为摘要损坏。现已沿用 Rust 既有语义统一：达到截断上限即追加 ...、控制字符转空格、Unicode White_Space 合并。U+FEFF 不按空白删除。

同时对齐了严格 JSON、标准 Base64、gzip 单 member、128 KiB 双重限额、非空错误描述最多 4096 code point、日志范围、手动结果类型、容量和 lane 矩阵等上传约束。schema／隐私校验由 Rust 上传 verifier、独立 Python PR validator 与网站分别执行；decode 仍可查看待补描述的 fatal 报告。

## 共享向量与实证

引擎的 scripts/fixtures/submission-vectors.json 与网站 qa/fixtures/submission-vectors.json 保持一致，覆盖 239／240／241 字符、80／500 截断边界、中文、非 BMP、控制字符、空白与 BOM，以及非法字段、数值、矩阵和隐私数据。网站交叉测试验证文件一致性并调用独立 Python，不通过放松摘要比对掩盖错误。

本地联调使用实际 Rust CLI 生成 Benchmark、修改错误描述并验证原件；实际 Windows 向导函数向 loopback 服务提交两类文件，包含 CRLF 重试；浏览器接收回执、移除 URL 凭证并恢复私密回执文件；合成 Git 归档生成精简索引，确认 PCIe／磁盘补全可进入索引，错误不入榜。GitHub 写操作均为 fixture，没有推理或云端写入。

## 继续保持的边界

- 完整文件 hash 与原始 JSON hash 不同。换行重试时，原件 file_sha256 与本次 submitted_file_sha256 也可能不同。
- UTC 接受 Z／+00:00，按原报告月份归档，不重写时间字符串。
- 初始 fatal 报告可留空描述，但提交前必须在向导补齐；原始滚动日志不整体上传。
- GitHub 和 Cloudflare 路线共用原件；Git 直提不进入 D1，不自动创建 Issue 或合并。
- CMD 只保存回执并打开浏览器；网站不信任导入文件指定的 API 地址。
- 榜单读取网站 CI 已生成的静态索引，默认每 6 小时或手动更新，不要求引擎逐次通知。
- Zsh 测试不替代原生 macOS 发包、安装与浏览器验证；真实云端验收仍须部署后执行。
