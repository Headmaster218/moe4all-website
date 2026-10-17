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
    "catalog": {
      "schema": 1,
      "records": [
        {
          "id": "maintainer-7900xtx-202610",
          "file": "benchmarks.json",
          "contributor": "Headmaster218",
          "origin": "maintainer",
          "verification": "reviewed",
          "source": "https://github.com/Headmaster218/moe4all-website/blob/main/content/benchmarks.json"
        }
      ]
    },
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
      4000,
      30000,
      150000
    ],
    "models": [
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
          "4000": {
            "decode": [
              120.98,
              164.64,
              201.28
            ],
            "decodeSegments": [
              [
                108.82924582892765,
                118.57658637707449,
                120.97746947205847
              ],
              [
                162.15867224943122,
                164.29601017360517,
                164.64254336173826
              ],
              [
                204.63428765373476,
                202.4771720559045,
                201.2831421396867
              ]
            ],
            "prefill": 3604.71,
            "measurement": {
              "version": "1.0.1",
              "measuredOn": "2026-10-16",
              "binarySha256": "6160e6ee9676c404d1272eb0673619268fd7c6a2099f157b7d393b21b9d45906",
              "profile": "aggressive",
              "contextCapacity": 8192,
              "configuredSlots": 3,
              "ubatch": 4096,
              "cpuThreads": 10,
              "kv": "Q8_0 K/V",
              "mtp": false,
              "residentGpuLayers": 16,
              "decode": {
                "sourceTask": "20261016-002027-d0-decode-123-a1",
                "promptTokensRange": [
                  4096,
                  4096
                ],
                "outputTokensPerLane": 512,
                "measuredWindow": [
                  342,
                  512
                ],
                "measuredRoundsPerConcurrency": 3,
                "thinking": true,
                "note": "Short-context Decode, not a full 2000-token prompt. Aggregate stream-window throughput from the original manifest; not a three-round mean."
              },
              "prefill": {
                "sourceTask": "20261016-032448-qwen35-2k-prefill-site-3bc7",
                "promptTokens": 8192,
                "measuredRounds": 3,
                "coldProcessPerRound": true,
                "thinking": false,
                "cachedTokens": [
                  0,
                  0,
                  0
                ],
                "milliseconds": [
                  2738.372199999998,
                  2272.583000000006,
                  2243.428100000019
                ],
                "samples": [
                  2991.5582695442226,
                  3604.7088269163232,
                  3651.554511597644
                ],
                "selectedSample": 2,
                "mean": 3415.9405360193964,
                "note": "Displayed Prefill uses the maintainer-selected third sample, rounded to two decimals. Each round starts a fresh process with SSD KV disabled; OS file and kernel caches are not cleared. Model startup and client HTTP overhead are excluded."
              }
            }
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
      },
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
  },
  "benchmarkCatalog": {
    "schema": 1,
    "records": [
      {
        "id": "maintainer-7900xtx-202610",
        "file": "benchmarks.json",
        "contributor": "Headmaster218",
        "origin": "maintainer",
        "verification": "reviewed",
        "source": "https://github.com/Headmaster218/moe4all-website/blob/main/content/benchmarks.json"
      }
    ]
  },
  "benchmarkDatasets": {},
  "gpuSpecs": {
    "schema": 1,
    "gpus": [
      {
        "name": "RTX PRO 6000 Blackwell Workstation Edition",
        "vendor": "nvidia",
        "releaseDate": "2025",
        "architecture": "Blackwell",
        "vramGiB": 96,
        "fp32Tflops": 125,
        "bandwidthGBs": 1792
      },
      {
        "name": "GeForce RTX 5090",
        "vendor": "nvidia",
        "releaseDate": "2025-01-30",
        "architecture": "Blackwell",
        "vramGiB": 32,
        "fp32Tflops": 104.88,
        "bandwidthGBs": 1792
      },
      {
        "name": "GeForce RTX 4090",
        "vendor": "nvidia",
        "releaseDate": "2022",
        "architecture": "Ada Lovelace",
        "vramGiB": 24,
        "fp32Tflops": 82.58,
        "bandwidthGBs": 1008
      },
      {
        "name": "Radeon RX 7900 XTX",
        "vendor": "amd",
        "releaseDate": "2022-12-13",
        "architecture": "RDNA 3",
        "vramGiB": 24,
        "fp32Tflops": 61.4,
        "bandwidthGBs": 960
      },
      {
        "name": "GeForce RTX 5080",
        "vendor": "nvidia",
        "releaseDate": "2025-01-30",
        "architecture": "Blackwell",
        "vramGiB": 16,
        "fp32Tflops": 56.34,
        "bandwidthGBs": 960
      },
      {
        "name": "GeForce RTX 4080 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2024",
        "architecture": "Ada Lovelace",
        "vramGiB": 16,
        "fp32Tflops": 52.22,
        "bandwidthGBs": 736
      },
      {
        "name": "Radeon RX 7900 XT",
        "vendor": "amd",
        "releaseDate": "2022-12-13",
        "architecture": "RDNA 3",
        "vramGiB": 20,
        "fp32Tflops": 51.6,
        "bandwidthGBs": 800
      },
      {
        "name": "GeForce RTX 4080",
        "vendor": "nvidia",
        "releaseDate": "2022",
        "architecture": "Ada Lovelace",
        "vramGiB": 16,
        "fp32Tflops": 48.83,
        "bandwidthGBs": 717
      },
      {
        "name": "Radeon RX 9070 XT",
        "vendor": "amd",
        "releaseDate": "2025-03-06",
        "architecture": "RDNA 4",
        "vramGiB": 16,
        "fp32Tflops": 48.7,
        "bandwidthGBs": 640
      },
      {
        "name": "Radeon AI PRO R9700",
        "vendor": "amd",
        "releaseDate": "2025",
        "architecture": "RDNA 4",
        "vramGiB": 32,
        "fp32Tflops": 47.8,
        "bandwidthGBs": 640
      },
      {
        "name": "Radeon RX 7900 GRE",
        "vendor": "amd",
        "releaseDate": "2023-07-27",
        "architecture": "RDNA 3",
        "vramGiB": 16,
        "fp32Tflops": 46,
        "bandwidthGBs": 576
      },
      {
        "name": "GeForce RTX 4070 Ti SUPER",
        "vendor": "nvidia",
        "releaseDate": "2024",
        "architecture": "Ada Lovelace",
        "vramGiB": 16,
        "fp32Tflops": 44.1,
        "bandwidthGBs": 672
      },
      {
        "name": "GeForce RTX 5070 Ti",
        "vendor": "nvidia",
        "releaseDate": "2025-02-20",
        "architecture": "Blackwell",
        "vramGiB": 16,
        "fp32Tflops": 43.9,
        "bandwidthGBs": 896
      },
      {
        "name": "GeForce RTX 4070 Ti",
        "vendor": "nvidia",
        "releaseDate": "2023",
        "architecture": "Ada Lovelace",
        "vramGiB": 12,
        "fp32Tflops": 40.09,
        "bandwidthGBs": 504
      },
      {
        "name": "GeForce RTX 3090 Ti",
        "vendor": "nvidia",
        "releaseDate": "2022",
        "architecture": "Ampere",
        "vramGiB": 24,
        "fp32Tflops": 40,
        "bandwidthGBs": 1008
      },
      {
        "name": "Radeon RX 7800 XT",
        "vendor": "amd",
        "releaseDate": "2023-09-06",
        "architecture": "RDNA 3",
        "vramGiB": 16,
        "fp32Tflops": 37.3,
        "bandwidthGBs": 624
      },
      {
        "name": "Radeon RX 9070",
        "vendor": "amd",
        "releaseDate": "2025-03-06",
        "architecture": "RDNA 4",
        "vramGiB": 16,
        "fp32Tflops": 36.1,
        "bandwidthGBs": 640
      },
      {
        "name": "GeForce RTX 3090",
        "vendor": "nvidia",
        "releaseDate": "2020",
        "architecture": "Ampere",
        "vramGiB": 24,
        "fp32Tflops": 35.69,
        "bandwidthGBs": 936
      },
      {
        "name": "GeForce RTX 4070 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2024",
        "architecture": "Ada Lovelace",
        "vramGiB": 12,
        "fp32Tflops": 35.55,
        "bandwidthGBs": 504
      },
      {
        "name": "Radeon RX 7700 XT",
        "vendor": "amd",
        "releaseDate": "2023-09-06",
        "architecture": "RDNA 3",
        "vramGiB": 12,
        "fp32Tflops": 35.2,
        "bandwidthGBs": 432
      },
      {
        "name": "Radeon RX 9070 GRE",
        "vendor": "amd",
        "releaseDate": "2025",
        "architecture": "RDNA 4",
        "vramGiB": 12,
        "fp32Tflops": 34.3,
        "bandwidthGBs": 432
      },
      {
        "name": "GeForce RTX 3080 Ti",
        "vendor": "nvidia",
        "releaseDate": "2021",
        "architecture": "Ampere",
        "vramGiB": 12,
        "fp32Tflops": 34.2,
        "bandwidthGBs": 912
      },
      {
        "name": "GeForce RTX 5070",
        "vendor": "nvidia",
        "releaseDate": "2025-03-05",
        "architecture": "Blackwell",
        "vramGiB": 12,
        "fp32Tflops": 30.84,
        "bandwidthGBs": 672
      },
      {
        "name": "GeForce RTX 3080 12GB",
        "vendor": "nvidia",
        "releaseDate": "2022",
        "architecture": "Ampere",
        "vramGiB": 12,
        "fp32Tflops": 30.64,
        "bandwidthGBs": 912
      },
      {
        "name": "GeForce RTX 3080 10GB",
        "vendor": "nvidia",
        "releaseDate": "2020",
        "architecture": "Ampere",
        "vramGiB": 10,
        "fp32Tflops": 29.77,
        "bandwidthGBs": 760
      },
      {
        "name": "GeForce RTX 4070 12GB GDDR6X",
        "vendor": "nvidia",
        "releaseDate": "2023",
        "architecture": "Ada Lovelace",
        "vramGiB": 12,
        "fp32Tflops": 29.2,
        "bandwidthGBs": 504
      },
      {
        "name": "Radeon RX 9060 XT 16GB",
        "vendor": "amd",
        "releaseDate": "2025-06-05",
        "architecture": "RDNA 4",
        "vramGiB": 16,
        "fp32Tflops": 25.6,
        "bandwidthGBs": 320
      },
      {
        "name": "Radeon RX 9060 XT 8GB",
        "vendor": "amd",
        "releaseDate": "2025-06-05",
        "architecture": "RDNA 4",
        "vramGiB": 8,
        "fp32Tflops": 25.6,
        "bandwidthGBs": 320
      },
      {
        "name": "GeForce RTX 5060 Ti 16GB",
        "vendor": "nvidia",
        "releaseDate": "2025-04-16",
        "architecture": "Blackwell",
        "vramGiB": 16,
        "fp32Tflops": 23.69,
        "bandwidthGBs": 448
      },
      {
        "name": "GeForce RTX 5060 Ti 8GB",
        "vendor": "nvidia",
        "releaseDate": "2025-04-16",
        "architecture": "Blackwell",
        "vramGiB": 8,
        "fp32Tflops": 23.69,
        "bandwidthGBs": 448
      },
      {
        "name": "Radeon RX 6950 XT",
        "vendor": "amd",
        "releaseDate": "2022-05-10",
        "architecture": "RDNA 2",
        "vramGiB": 16,
        "fp32Tflops": 23.65,
        "bandwidthGBs": 576
      },
      {
        "name": "Radeon RX 6900 XT",
        "vendor": "amd",
        "releaseDate": "2020-12-08",
        "architecture": "RDNA 2",
        "vramGiB": 16,
        "fp32Tflops": 23.04,
        "bandwidthGBs": 512
      },
      {
        "name": "Radeon RX 7600 XT",
        "vendor": "amd",
        "releaseDate": "2024-01-24",
        "architecture": "RDNA 3",
        "vramGiB": 16,
        "fp32Tflops": 22.6,
        "bandwidthGBs": 288
      },
      {
        "name": "GeForce RTX 4060 Ti 16GB",
        "vendor": "nvidia",
        "releaseDate": "2023",
        "architecture": "Ada Lovelace",
        "vramGiB": 16,
        "fp32Tflops": 22.11,
        "bandwidthGBs": 288
      },
      {
        "name": "GeForce RTX 4060 Ti 8GB",
        "vendor": "nvidia",
        "releaseDate": "2023",
        "architecture": "Ada Lovelace",
        "vramGiB": 8,
        "fp32Tflops": 22.11,
        "bandwidthGBs": 288
      },
      {
        "name": "GeForce RTX 3070 Ti",
        "vendor": "nvidia",
        "releaseDate": "2021",
        "architecture": "Ampere",
        "vramGiB": 8,
        "fp32Tflops": 21.75,
        "bandwidthGBs": 608
      },
      {
        "name": "Radeon RX 7600",
        "vendor": "amd",
        "releaseDate": "2023-05-25",
        "architecture": "RDNA 3",
        "vramGiB": 8,
        "fp32Tflops": 21.7,
        "bandwidthGBs": 288
      },
      {
        "name": "Radeon RX 9060",
        "vendor": "amd",
        "releaseDate": "2025",
        "architecture": "RDNA 4",
        "vramGiB": 8,
        "fp32Tflops": 21.4,
        "bandwidthGBs": 288
      },
      {
        "name": "Radeon RX 6800 XT",
        "vendor": "amd",
        "releaseDate": "2020-11-18",
        "architecture": "RDNA 2",
        "vramGiB": 16,
        "fp32Tflops": 20.74,
        "bandwidthGBs": 512
      },
      {
        "name": "GeForce RTX 3070",
        "vendor": "nvidia",
        "releaseDate": "2020",
        "architecture": "Ampere",
        "vramGiB": 8,
        "fp32Tflops": 20.37,
        "bandwidthGBs": 448
      },
      {
        "name": "GeForce RTX 5060",
        "vendor": "nvidia",
        "releaseDate": "2025-05-19",
        "architecture": "Blackwell",
        "vramGiB": 8,
        "fp32Tflops": 19.2,
        "bandwidthGBs": 448
      },
      {
        "name": "Arc A770 16GB",
        "vendor": "intel",
        "releaseDate": "2022",
        "architecture": "Xe HPG",
        "vramGiB": 16,
        "fp32Tflops": 17.2032,
        "bandwidthGBs": 560
      },
      {
        "name": "Arc A770 8GB",
        "vendor": "intel",
        "releaseDate": "2022",
        "architecture": "Xe HPG",
        "vramGiB": 8,
        "fp32Tflops": 17.2032,
        "bandwidthGBs": 512
      },
      {
        "name": "GeForce RTX 3060 Ti 8GB GDDR6",
        "vendor": "nvidia",
        "releaseDate": "2020",
        "architecture": "Ampere",
        "vramGiB": 8,
        "fp32Tflops": 16.25,
        "bandwidthGBs": 448
      },
      {
        "name": "Radeon RX 6800",
        "vendor": "amd",
        "releaseDate": "2020-11-18",
        "architecture": "RDNA 2",
        "vramGiB": 16,
        "fp32Tflops": 16.17,
        "bandwidthGBs": 512
      },
      {
        "name": "GeForce RTX 4060",
        "vendor": "nvidia",
        "releaseDate": "2023",
        "architecture": "Ada Lovelace",
        "vramGiB": 8,
        "fp32Tflops": 15.11,
        "bandwidthGBs": 272
      },
      {
        "name": "Arc A750",
        "vendor": "intel",
        "releaseDate": "2022",
        "architecture": "Xe HPG",
        "vramGiB": 8,
        "fp32Tflops": 14.6944,
        "bandwidthGBs": 512
      },
      {
        "name": "GeForce RTX 2080 Ti",
        "vendor": "nvidia",
        "releaseDate": "2018",
        "architecture": "Turing",
        "vramGiB": 11,
        "fp32Tflops": 14.27,
        "bandwidthGBs": 616
      },
      {
        "name": "Arc B580",
        "vendor": "intel",
        "releaseDate": "2024-12",
        "architecture": "Xe2 HPG",
        "vramGiB": 12,
        "fp32Tflops": 13.6704,
        "bandwidthGBs": 456
      },
      {
        "name": "Radeon RX 6750 XT",
        "vendor": "amd",
        "releaseDate": "2022-05-10",
        "architecture": "RDNA 2",
        "vramGiB": 12,
        "fp32Tflops": 13.31,
        "bandwidthGBs": 432
      },
      {
        "name": "Radeon RX 6700 XT",
        "vendor": "amd",
        "releaseDate": "2021-03",
        "architecture": "RDNA 2",
        "vramGiB": 12,
        "fp32Tflops": 13.21,
        "bandwidthGBs": 384
      },
      {
        "name": "Radeon RX 6750 GRE 12GB",
        "vendor": "amd",
        "releaseDate": "2023-10-17",
        "architecture": "RDNA 2",
        "vramGiB": 12,
        "fp32Tflops": 13.21,
        "bandwidthGBs": 384
      },
      {
        "name": "GeForce RTX 5050",
        "vendor": "nvidia",
        "releaseDate": "2025",
        "architecture": "Blackwell",
        "vramGiB": 8,
        "fp32Tflops": 13.16,
        "bandwidthGBs": 320
      },
      {
        "name": "GeForce RTX 3060 12GB",
        "vendor": "nvidia",
        "releaseDate": "2021",
        "architecture": "Ampere",
        "vramGiB": 12,
        "fp32Tflops": 12.76,
        "bandwidthGBs": 360
      },
      {
        "name": "Arc Pro B60",
        "vendor": "intel",
        "releaseDate": "2025",
        "architecture": "Xe2 HPG",
        "vramGiB": 24,
        "fp32Tflops": 12.28,
        "bandwidthGBs": 456
      },
      {
        "name": "Arc B570",
        "vendor": "intel",
        "releaseDate": "2025-01",
        "architecture": "Xe2 HPG",
        "vramGiB": 10,
        "fp32Tflops": 11.52,
        "bandwidthGBs": 380
      },
      {
        "name": "GeForce GTX 1080 Ti",
        "vendor": "nvidia",
        "releaseDate": "2017",
        "architecture": "Pascal",
        "vramGiB": 11,
        "fp32Tflops": 11.3,
        "bandwidthGBs": 484
      },
      {
        "name": "Radeon RX 6700",
        "vendor": "amd",
        "releaseDate": null,
        "architecture": "RDNA 2",
        "vramGiB": 10,
        "fp32Tflops": 11.29,
        "bandwidthGBs": 320
      },
      {
        "name": "Radeon RX 6750 GRE 10GB",
        "vendor": "amd",
        "releaseDate": "2023-10-17",
        "architecture": "RDNA 2",
        "vramGiB": 10,
        "fp32Tflops": 11.29,
        "bandwidthGBs": 320
      },
      {
        "name": "GeForce RTX 2080 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 8,
        "fp32Tflops": 11.18,
        "bandwidthGBs": 496
      },
      {
        "name": "Radeon RX 6650 XT",
        "vendor": "amd",
        "releaseDate": "2022-05-10",
        "architecture": "RDNA 2",
        "vramGiB": 8,
        "fp32Tflops": 10.79,
        "bandwidthGBs": 280
      },
      {
        "name": "Arc Pro B50",
        "vendor": "intel",
        "releaseDate": "2025",
        "architecture": "Xe2 HPG",
        "vramGiB": 16,
        "fp32Tflops": 10.65,
        "bandwidthGBs": 224
      },
      {
        "name": "GeForce RTX 2080",
        "vendor": "nvidia",
        "releaseDate": "2018",
        "architecture": "Turing",
        "vramGiB": 8,
        "fp32Tflops": 10.6,
        "bandwidthGBs": 448
      },
      {
        "name": "Radeon RX 6600 XT",
        "vendor": "amd",
        "releaseDate": "2021-08-11",
        "architecture": "RDNA 2",
        "vramGiB": 8,
        "fp32Tflops": 10.6,
        "bandwidthGBs": 256
      },
      {
        "name": "Arc A580",
        "vendor": "intel",
        "releaseDate": "2023",
        "architecture": "Xe HPG",
        "vramGiB": 8,
        "fp32Tflops": 10.4448,
        "bandwidthGBs": 512
      },
      {
        "name": "GeForce RTX 3050 8GB",
        "vendor": "nvidia",
        "releaseDate": "2022",
        "architecture": "Ampere",
        "vramGiB": 8,
        "fp32Tflops": 9.11,
        "bandwidthGBs": 224
      },
      {
        "name": "GeForce RTX 2070 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 8,
        "fp32Tflops": 9.06,
        "bandwidthGBs": 448
      },
      {
        "name": "Radeon RX 6600",
        "vendor": "amd",
        "releaseDate": "2021-10-13",
        "architecture": "RDNA 2",
        "vramGiB": 8,
        "fp32Tflops": 8.93,
        "bandwidthGBs": 224
      },
      {
        "name": "GeForce GTX 1080",
        "vendor": "nvidia",
        "releaseDate": "2016-05-27",
        "architecture": "Pascal",
        "vramGiB": 8,
        "fp32Tflops": 8.873,
        "bandwidthGBs": 320
      },
      {
        "name": "GeForce RTX 2070",
        "vendor": "nvidia",
        "releaseDate": "2018",
        "architecture": "Turing",
        "vramGiB": 8,
        "fp32Tflops": 7.88,
        "bandwidthGBs": 448
      },
      {
        "name": "GeForce RTX 2060 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 8,
        "fp32Tflops": 7.18,
        "bandwidthGBs": 448
      },
      {
        "name": "GeForce RTX 2060 12GB",
        "vendor": "nvidia",
        "releaseDate": "2021",
        "architecture": "Turing",
        "vramGiB": 12,
        "fp32Tflops": 7.18,
        "bandwidthGBs": 336
      },
      {
        "name": "GeForce RTX 3050 6GB",
        "vendor": "nvidia",
        "releaseDate": "2024",
        "architecture": "Ampere",
        "vramGiB": 6,
        "fp32Tflops": 6.77,
        "bandwidthGBs": 168
      },
      {
        "name": "GeForce GTX 1070",
        "vendor": "nvidia",
        "releaseDate": "2016-06-10",
        "architecture": "Pascal",
        "vramGiB": 8,
        "fp32Tflops": 6.5,
        "bandwidthGBs": 256
      },
      {
        "name": "GeForce RTX 2060 6GB",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 6,
        "fp32Tflops": 6.45,
        "bandwidthGBs": 336
      },
      {
        "name": "GeForce GTX 1660 Ti",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 6,
        "fp32Tflops": 5.44,
        "bandwidthGBs": 288
      },
      {
        "name": "GeForce GTX 1660 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 6,
        "fp32Tflops": 5.03,
        "bandwidthGBs": 336
      },
      {
        "name": "GeForce GTX 1660",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 6,
        "fp32Tflops": 5.03,
        "bandwidthGBs": 192
      },
      {
        "name": "GeForce GTX 1650 SUPER",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 4,
        "fp32Tflops": 4.42,
        "bandwidthGBs": 192
      },
      {
        "name": "GeForce GTX 1060 6GB",
        "vendor": "nvidia",
        "releaseDate": "2016-07-19",
        "architecture": "Pascal",
        "vramGiB": 6,
        "fp32Tflops": 4.3725,
        "bandwidthGBs": 192
      },
      {
        "name": "GeForce GTX 1060 3GB",
        "vendor": "nvidia",
        "releaseDate": "2016",
        "architecture": "Pascal",
        "vramGiB": 3,
        "fp32Tflops": 3.9352,
        "bandwidthGBs": 192
      },
      {
        "name": "GeForce GTX 1650 GDDR5",
        "vendor": "nvidia",
        "releaseDate": "2019",
        "architecture": "Turing",
        "vramGiB": 4,
        "fp32Tflops": 2.98,
        "bandwidthGBs": 128
      },
      {
        "name": "GeForce GTX 1650 GDDR6",
        "vendor": "nvidia",
        "releaseDate": "2020",
        "architecture": "Turing",
        "vramGiB": 4,
        "fp32Tflops": 2.85,
        "bandwidthGBs": 192
      },
      {
        "name": "GeForce GTX 1050 Ti",
        "vendor": "nvidia",
        "releaseDate": "2016",
        "architecture": "Pascal",
        "vramGiB": 4,
        "fp32Tflops": 2.1381,
        "bandwidthGBs": 112
      },
      {
        "name": "GeForce GTX 1050 2GB",
        "vendor": "nvidia",
        "releaseDate": "2016",
        "architecture": "Pascal",
        "vramGiB": 2,
        "fp32Tflops": 1.8624,
        "bandwidthGBs": 112
      }
    ]
  }
};
