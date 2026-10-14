# MoE4All

## 释放卡之潜力。

**让更多人，用自己的电脑，拥有自己的 AI。**

游戏显卡、家里的电脑、你已经拥有的硬件，都值得多一点可能。MoE4All 把本地推理引擎、Agent 和插件放在一起：让大模型跑起来，也让 AI 记住有用的背景、安排接下来的事情，成为日常工作的一部分。

**[逛逛官网](https://headmaster218.github.io/moe4all-website/everyday.html)** · **[看看引擎与实测](https://headmaster218.github.io/moe4all-website/index.html#engine)** · **[认识 Agent](https://github.com/Headmaster218/MoE4All-Agent)** · **[下载引擎](https://github.com/Headmaster218/MoE4All/releases)**

[![MoE4All：把想法，变成下一步。自己的电脑，自己的 AI。](https://headmaster218.github.io/moe4all-website/assets/readme/welcome.jpg)](https://headmaster218.github.io/moe4all-website/everyday.html)

- **让硬件多做一点。** 显存装不下整个模型？让 RAM 和 SSD 一起参与，按需加载专家。
- **让对话多留一点。** 有用的记忆留给下一次，约好的事情交给定时任务。
- **让数据离你近一点。** 本地模型、本地对话、本地记忆。私人资料，在自己的电脑上处理。

## 记得昨天，也能安排明天

有时候，我们需要的不是重新问一次，而是接着上次聊。

> “我记得上周和小丽提过一个会，但想不起来具体是什么了。”

MoE4All Agent 可以从已保存的记忆里找回相关约定：是读书会的准备会，还是之前讨论过的项目安排？人物、偏好和项目背景，不必每次重新介绍。

> “每周一上午 9 点，提醒我把会议材料发给小丽。”

从回忆一件事，到安排下一件事。记忆与定时任务就在同一个工作台里，聊天也可以有后续。

[![演示工作台：找回和小丽的约定，并创建每周一的提醒](https://headmaster218.github.io/moe4all-website/assets/readme/workspace.png)](https://headmaster218.github.io/moe4all-website/everyday.html#partner)

*上图及下方界面为演示工作区，人物、对话和任务使用虚构内容。*

### 有用的背景，留给下一次

关于你、项目，以及曾经说好的事情，都有迹可循。记忆可以打开查看，让对话里的有用信息成为下一次的背景。

[![演示记忆管理：人物背景、项目偏好和读书会约定](https://headmaster218.github.io/moe4all-website/assets/readme/memory.png)](assets/readme/memory.png)

### 换一个屏幕，还是你的工作台

手机配对后，可以接着电脑上的对话。同一份对话，同一份记忆；模型仍在电脑上运行，你只是换了一块屏幕。

[![演示手机访问：已授权手机连接同一个电脑工作台](https://headmaster218.github.io/moe4all-website/assets/readme/remote.png)](assets/readme/remote.png)

**[打开互动展示，看看工作台、模型、记忆和手机访问](https://headmaster218.github.io/moe4all-website/everyday.html#partner)**

<details>
<summary>还有模型管理：大模型与记忆检索，放在一起。</summary>

![演示模型管理：FlashNext、35B 与本地 Embedding](https://headmaster218.github.io/moe4all-website/assets/readme/models.png)

</details>

## 私人的事，留在自己的电脑上

工作材料、个人计划、尚未公开的想法，还有那些只想留给自己的对话，都可以交给本地 AI 处理。

**选择本地模型时，推理在你的电脑上进行，对话和记忆也保存在本地，不需要为了提问而上传到云端模型服务。** 手机连接的是这台电脑；云端模型和联网工具，则由你选择是否接入。

不是只有“我同意”，也可以有“我自己保管”。

## 显存有限。模型，不必。

大模型不一定要整块塞进显存。

MoE4All Engine 协调 **VRAM、RAM 和 SSD**：常用的专家靠近 GPU，需要时再把其他专家逐级送上来。让有限的显存，服务于远超显存容量的 MoE 模型。

[![专家流动 GIF：热专家前移、冷专家淘汰，缺失专家从 SSD 经 RAM 进入 VRAM，再送往 GPU 计算](https://headmaster218.github.io/moe4all-website/assets/readme/expert-flow.gif)](https://headmaster218.github.io/moe4all-website/index.html#engine)

*专家流动与 token 输出为原理示意，不是实时推理录像。点击进入官网，可暂停动效并查看完整过程。*

支持 Vulkan，面向 AMD、NVIDIA、Intel 等显卡；提供终端对话和 OpenAI 兼容 API，也可以接入你已有的客户端。自动资源规划、长上下文、并发会话，以及可选 MTP 加速，让硬件潜力变成实际体验。

### 一张 RX 7900 XTX，跑起来是什么样？

30K 上下文下，v0.11.0 开发构建的 Decode 实测：

| 模型 | 单会话 | 双会话总吞吐量 | 三会话总吞吐量 |
| --- | ---: | ---: | ---: |
| **FlashNext-176B · 4.27 bpw** | **50.44 tok/s** | 66.19 tok/s | **71.20 tok/s** |
| **Qwen3.6-35B · APEX I-Balanced · ≈5.91 bpw** | 80.49 tok/s | **118.34 tok/s** | 110.78 tok/s |

同样测到了 **150K 长上下文**。30K 冷请求的 Prefill：FlashNext **1414.75 tok/s**，35B **2749.06 tok/s**。

*Windows · RX 7900 XTX · 24 GiB VRAM / 48 GiB RAM 进程预算 · Q8 KV · MTP 关闭。Decode 为预热后三轮平均，并发列是总吞吐量，不是每路速度。*

**[查看全部 30K / 150K 结果与测试条件](https://headmaster218.github.io/moe4all-website/index.html#engine)**

## 从一个引擎，到自己的 AI 工作台

你可以从整套 Agent 认识 MoE4All，也可以只用引擎，或者为已有的 DeepSeek Harness 加上插件。

| 项目 | 它带来什么 | 去看看 |
| --- | --- | --- |
| **MoE4All Engine** | 超显存 MoE 推理，终端对话与 OpenAI 兼容 API。 | [项目](https://github.com/Headmaster218/MoE4All) · [发行版](https://github.com/Headmaster218/MoE4All/releases) |
| **MoE4All Agent** | 将本地引擎、工作台和定制插件结合起来，让 AI 有记忆、有后续。 | [Agent 项目](https://github.com/Headmaster218/MoE4All-Agent) |
| **DSH 插件** | 本地模型、记忆、定时任务、手机访问、朗读和更多工具。 | [插件展示](https://headmaster218.github.io/moe4all-website/index.html#ecosystem) |
| **长音频后端** | 正在开发的本地长录音转录，探索让声音也成为 AI 的一部分。 | [长音频项目](https://github.com/Headmaster218/long-audio-backend) |

### 给工作台，多一些本领

**[本地模型](https://github.com/Headmaster218/dsh-llm-moe4all)** · **[Mneme 记忆](https://github.com/Headmaster218/dsh-mneme-moe4all)** · **[定时任务](https://github.com/Headmaster218/dsh-plugin-cron-moe4all)** · **[手机访问](https://github.com/Headmaster218/dsh-remote-web-ui-moe4all)**

[插件市场](https://github.com/Headmaster218/dsh-market-moe4all) · [TTS 朗读](https://github.com/Headmaster218/dsh-plugin-tts-moe4all) · [EasyRewrite](https://github.com/Headmaster218/dsh-easyrewrite-moe4all) · [Brave Search](https://github.com/Headmaster218/dsh-web-search-brave-moe4all)

未来不只是一段文字。语音、图像、视频，还有更多本地 AI 的可能，都在这条路上。

---

**各种卡，各种专家。让更多人，用上 AI。**

[先逛逛 MoE4All](https://headmaster218.github.io/moe4all-website/everyday.html) · [下载引擎，开始体验](https://github.com/Headmaster218/MoE4All/releases) · [关注 Agent 的进展](https://github.com/Headmaster218/MoE4All-Agent)

欢迎用 Star 关注进展，也欢迎到对应项目的 Issues 分享你的硬件、体验和想法。
