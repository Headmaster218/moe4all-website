# 引擎与网站的封装兼容核对

本轮只读核对维护工作区的 Rust 生产者及独立 Python 解码器；没有修改该并行工作区。普通 Benchmark、manual、报错样本已通过网站解码与独立 Python 交叉校验。

## 已确认的摘要边界差异

网站当前按 `crates/infr-cli/src/submission.rs` 的 `one_line` 行为生成并核对摘要。但维护工作区 `scripts/moe4all_submission.py` 的 `_one_line` 存在两处不同：

| 输入 | Rust 当前生产行为 | Python 当前复核行为 |
| --- | --- | --- |
| 描述正好 240 个 code point | 到达 240 时追加 `...` | 只有超过 240 才追加 `...` |
| 描述内含 `a\u0000b` | 控制字符替换为空格，摘要为 `a b` | `split()` 不替换 NUL，保留 NUL |

相应 Rust 格式报告会被 Python 判成 `summary-004 does not match payload`。同类差异还可能影响 80 / 160 / 500 字符的摘要边界。并非 payload 损坏，也不是 gzip 或 SHA 不一致；不应通过忽略摘要来掩盖。

建议在引擎侧统一单行规范化和截断的精确定义，并给 Rust / Python 增加共享的黄金向量：239 / 240 / 241 字符、499 / 500 / 501 字符、首尾空白、重复空白、C0 / C1 控制字符及中文 / 非 BMP 字符。如果决定修正 Rust 的 `>=` 行为，网站的 `oneLine` 也应同步，不能只改其中一端。

网站没有放宽接受不一致的可读摘要。当前的普通样本交叉测试通过不表示这些边界问题已经在引擎侧解决；正式启用公开入口前应完成同步。

## 其他接入约束

- fatal 报告可先生成空描述，但网站提交要求非空描述、最多 4096 code point；应在向导导出前完成。
- 外层 header `sha256` 是解压后 JSON 的 hash。HTTP 会话另用 `file_sha256` 绑定原始文件，不能复用这个 header 值。
- UTC 时间允许 `+00:00`，网页保留原字符串，不强制改写成 `Z`。
- gzip 单 member、CRC、解压限额由网站独立验证；使用的 pako 解码路径不依赖生产者可执行文件。
- 自动 / 手动结果都走 `.m4b`，报错走 `.m4e`，不再接受旧接口草案的裸 JSON 或 `diagnostic` kind。
