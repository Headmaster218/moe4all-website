window.MOE4ALL_DATA = {
  "site": {
    "schema": 1,
    "engineRepository": "Headmaster218/MoE4All",
    "agentRepository": "Headmaster218/MoE4All-Agent",
    "websiteRepository": "Headmaster218/moe4all-website",
    "brand": "MoE4All",
    "fallbackVersion": "1.0.0",
    "carouselIntervalMs": 6000,
    "heroScreen": {
      "width": 960,
      "height": 620,
      "imageWidth": 1860,
      "imageHeight": 846,
      "corners": [
        [
          952,
          107
        ],
        [
          1706,
          92
        ],
        [
          1706,
          596
        ],
        [
          952,
          573
        ]
      ]
    }
  },
  "releases": {
    "schema": 1,
    "engine": {
      "version": "1.0.0",
      "tag": "release-1.0.0",
      "url": "https://github.com/Headmaster218/MoE4All/releases/tag/release-1.0.0",
      "prerelease": false,
      "publishedAt": "2026-10-14T19:06:04Z",
      "assets": [
        {
          "name": "image-codec-sources.tar.gz",
          "url": "https://github.com/Headmaster218/MoE4All/releases/download/release-1.0.0/image-codec-sources.tar.gz",
          "size": 4524569
        },
        {
          "name": "MoE4All-Linux-x86_64-v1.0.0.tar.gz",
          "url": "https://github.com/Headmaster218/MoE4All/releases/download/release-1.0.0/MoE4All-Linux-x86_64-v1.0.0.tar.gz",
          "size": 51308893
        },
        {
          "name": "MoE4All-Windows-x86_64-v1.0.0.zip",
          "url": "https://github.com/Headmaster218/MoE4All/releases/download/release-1.0.0/MoE4All-Windows-x86_64-v1.0.0.zip",
          "size": 17535477
        }
      ]
    },
    "enginePreview": null,
    "agent": null
  },
  "benchmarks": {
    "schema": 1,
    "version": "0.11.0",
    "buildCommit": "fabf3e614a56efed66dfaa89d4fac3a10ec0c40b",
    "binarySha256": "8a3c80cd8f8872778ae2425568f108562353d051a3aa002edff0d3819feeafff",
    "measuredOn": "2026-10-13",
    "source": "Original values verified against local release-0.11.0-benchmark manifests; FlashNext 30K Decode revised by the maintainer, exact revised build not supplied",
    "metric": "mean_aggregate_decode_tokens_per_second",
    "metricDefinition": "Within each measured round: total output tokens / slowest lane Decode duration. Arithmetic mean over three measured rounds after one warmup round.",
    "hardware": {
      "gpu": "AMD Radeon RX 7900 XTX",
      "vramBudgetGiB": 24,
      "ramBudgetGiB": 48,
      "os": "Windows"
    },
    "settings": {
      "mtp": false,
      "temperature": 0,
      "thinking": false,
      "kv": "Q8_0 K/V",
      "contextCapacity": 163840,
      "ubatch": 4096,
      "cpuThreads": 10,
      "configuredDecodeSlots": 3,
      "outputTokensPerLane": 512,
      "warmupRounds": 1,
      "measuredDecodeRounds": 3,
      "coldPrefillRequests": 1,
      "prefillCachedTokens": 0,
      "residentGpuLayers": 16
    },
    "contexts": [
      2000,
      30000,
      150000
    ],
    "models": [
      {
        "id": "flashnext",
        "name": "FlashNext-176B · 4.27 bpw",
        "label": "FlashNext-176B",
        "detail": "4.27 bpw",
        "quantization": "Qwen3.8-Flash-Next-AD-4.27bpw-Q4_K_M-M64",
        "results": {
          "30000": {
            "decode": [
              50.44,
              66.19,
              71.2
            ],
            "prefill": 1414.75,
            "decodeSource": "Maintainer revision; exact revised build not supplied"
          },
          "150000": {
            "decode": [
              44.16,
              49.5,
              45.47
            ],
            "prefill": 1445.5
          }
        }
      },
      {
        "id": "qwen35",
        "name": "Qwen3.6-35B · I-Balanced · ≈5.91 bpw",
        "label": "Qwen3.6-35B",
        "detail": "I-Balanced · ≈5.91 bpw",
        "quantization": "Qwen3.6-35B-A3B-APEX-I-Balanced",
        "storageEquivalent": {
          "parameters": 34660610688,
          "tensorPayloadBytes": 25613967872,
          "bpw": 5.911948431045486,
          "method": "Local GGUF file bytes minus aligned metadata header, multiplied by 8 / total tensor elements. Includes tensor alignment padding, excludes mmproj; storage-equivalent, not a uniform tensor quantization."
        },
        "results": {
          "2000": {
            "decode": [
              130.26,
              168.09,
              206.63
            ],
            "decodeSegments": [
              [
                130.14,
                129.99,
                130.65
              ],
              [
                164.18,
                161.78,
                157.85
              ],
              [
                205.56,
                205.7,
                194.75
              ]
            ]
          },
          "30000": {
            "decode": [
              80.49,
              118.34,
              110.78
            ],
            "prefill": 2749.06
          },
          "150000": {
            "decode": [
              41.91,
              50.87,
              49.27
            ],
            "prefill": 1169.4
          }
        }
      }
    ]
  },
  "demo": {
    "schema": 1,
    "fictional": true,
    "person": {
      "zh": "小李",
      "en": "Li"
    },
    "conversations": [
      {
        "zh": "和小丽的讨论",
        "en": "Planning with Xiaoli"
      },
      {
        "zh": "社区读书会筹备",
        "en": "Community reading club"
      },
      {
        "zh": "我的每周阅读笔记",
        "en": "Weekly reading notes"
      },
      {
        "zh": "新工作室的计划",
        "en": "Plans for a new studio"
      }
    ],
    "past": {
      "question": {
        "zh": "我记得上周和小丽提过一个会，但想不起来具体是什么了。",
        "en": "I remember mentioning a meeting with Xiaoli last week. What was it about?"
      },
      "answer": {
        "zh": "是社区读书会的筹备会。你们约了周五下午 3 点线上讨论，主要确认活动流程和场地。",
        "en": "It was the planning meeting for the community reading club. You agreed to meet online on Friday at 3 pm to discuss the agenda and venue."
      },
      "source": {
        "zh": "和小丽的讨论 · 上周",
        "en": "Planning with Xiaoli · last week"
      }
    },
    "future": {
      "question": {
        "zh": "每周一上午 9 点，提醒我把会议材料发给小丽。",
        "en": "Every Monday at 9 am, remind me to send the meeting notes to Xiaoli."
      },
      "answer": {
        "zh": "安排好了。每周一上午 9 点，我会在工作台提醒你把材料发给小丽。",
        "en": "Scheduled. Every Monday at 9 am, I will remind you in the workspace to send the notes to Xiaoli."
      }
    },
    "private": {
      "question": {
        "zh": "这份合作协议我不想上传云端，帮我整理一下需要确认的条款。",
        "en": "I do not want to upload this collaboration agreement. Help me organize the points I need to confirm."
      },
      "answer": {
        "zh": "可以在本地一起梳理：交付时间、费用结算、修改范围，以及终止合作时的处理方式。",
        "en": "We can work through it locally: delivery dates, payment terms, revision scope and what happens if the collaboration ends."
      }
    },
    "memories": [
      {
        "category": {
          "zh": "个人背景",
          "en": "Background"
        },
        "text": {
          "zh": "小李，在上海工作，研究生学习人机交互。",
          "en": "Li works in Shanghai and studied human-computer interaction in graduate school."
        }
      },
      {
        "category": {
          "zh": "偏好",
          "en": "Preference"
        },
        "text": {
          "zh": "喜欢先看三条重点，再决定是否展开细节。",
          "en": "Prefers three key points first, then expands the details when needed."
        }
      },
      {
        "category": {
          "zh": "项目",
          "en": "Project"
        },
        "text": {
          "zh": "正在和小丽筹备社区读书会，先确认场地与活动流程。",
          "en": "Planning a community reading club with Xiaoli, starting with the venue and agenda."
        }
      },
      {
        "category": {
          "zh": "约定",
          "en": "Plan"
        },
        "text": {
          "zh": "周五下午 3 点，与小丽线上讨论读书会筹备。",
          "en": "Friday at 3 pm: an online planning meeting with Xiaoli."
        }
      }
    ],
    "tasks": [
      {
        "time": {
          "zh": "每周一 · 09:00",
          "en": "Monday · 09:00"
        },
        "text": {
          "zh": "提醒发送会议材料",
          "en": "Remind me to send meeting notes"
        }
      },
      {
        "time": {
          "zh": "每天 · 20:00",
          "en": "Daily · 20:00"
        },
        "text": {
          "zh": "整理今天的阅读笔记",
          "en": "Summarize today's reading notes"
        }
      },
      {
        "time": {
          "zh": "每周日 · 18:00",
          "en": "Sunday · 18:00"
        },
        "text": {
          "zh": "回顾本周读书会计划",
          "en": "Review this week's club plans"
        }
      }
    ],
    "models": [
      {
        "name": "FlashNext-176B",
        "detail": "4.27 bpw",
        "type": {
          "zh": "对话模型",
          "en": "Conversation"
        }
      },
      {
        "name": "Qwen3.6-35B",
        "detail": "APEX I-Balanced",
        "type": {
          "zh": "对话模型",
          "en": "Conversation"
        }
      },
      {
        "name": "Qwen3-Embedding-0.6B",
        "detail": "Q8_0",
        "type": {
          "zh": "记忆检索",
          "en": "Memory retrieval"
        }
      }
    ]
  }
};
