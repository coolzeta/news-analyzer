# 市场新闻智能监控系统

一个全栈应用程序，监控市场新闻，使用 AI 评估其对金融产品组合的潜在影响，并通过 Web 仪表板展示可操作的洞察。

[English](./README.md)

## 系统架构

```
┌────────────────────┐      ┌────────────────────┐      ┌────────────────────┐      ┌──────────┐
│     Collector      │      │    Main Service    │      │   Agent Service    │      │ Frontend │
│     (Python)       │      │     (Python)       │      │     (Node.js)      │      │ (Next.js)│
│                    │      │                    │      │                    │      │          │
│  - RSS/NewsAPI     │      │  - REST API        │      │  - pi-agent-core   │      │  - WS    │
│  - URL 去重        │─────▶│  - SQLite 存储     │◀────▶│  - LLM 调用        │◀────▶│  Client  │
│  - 向量去重        │ POST │  - WebSocket       │ HTTP │  - Tool 执行       │ HTTP │          │
│  - Embedding API   │      │  - 自动分析        │      │                    │      │          │
└────────────────────┘      └────────────────────┘      └────────────────────┘      └──────────┘
```

## 功能特性

1. **新闻采集** - RSS 源、两级去重、可配置采集间隔
2. **AI 影响分析** - 基于 LLM 的分析，含相关性评分和情感分析
3. **仪表板** - WebSocket 实时更新、筛选、状态指示器
4. **分析仪表板** - 情感热图和历史趋势

## 快速开始

### Docker Compose（推荐）

```bash
# 1. 克隆
git clone <repository-url>
cd news-analizer

# 2. 创建 .env
cat > .env << 'ENVEOF'
LLM_API_KEY=your_api_key_here
LLM_PROVIDER=openrouter
LLM_MODEL=minimax/minimax-m2.7
ENVEOF

# 3. 运行
docker compose up -d --build

# 访问: http://localhost:3000
```

### 手动部署

```bash
# 终端 1: Agent Service
cd agent-service && npm install && npm start

# 终端 2: Main Service
cd main-service && pip install -r requirements.txt && python main.py

# 终端 3: Frontend
cd frontend && npm install && npm run dev

# 终端 4: Collector
cd collector && pip install -r requirements.txt && python main.py --daemon --interval 1
```

## 环境变量

| 变量 | 必需 | 默认值 | 描述 |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | 是 | - | LLM 提供商 API key（推荐 OpenRouter） |
| `LLM_PROVIDER` | 否 | openrouter | LLM 提供商 |
| `LLM_MODEL` | 否 | - | 模型标识 |
| `COLLECT_INTERVAL_MINUTES` | 否 | 1 | 采集间隔 |
| `AUTO_ANALYZE` | 否 | true | 自动分析新文章 |
| `AGENT_TIMEOUT` | 否 | 120 | Agent 超时（秒） |
| `LOG_LEVEL` | 否 | INFO | 日志级别 |

## API 端点

| 方法 | 路径 | 描述 |
|--------|------|-------------|
| GET | `/api/products` | 获取所有产品 |
| GET | `/api/products/{code}` | 获取产品详情 |
| GET | `/api/products/{code}/impacts` | 获取影响指定产品的新闻（仅包含该产品的分析） |
| GET | `/api/news` | 获取新闻列表（可按状态、情感、产品筛选） |
| GET | `/api/news/{id}` | 获取新闻及分析 |
| POST | `/api/news/{id}/analyze` | 触发 AI 分析 |
| POST | `/api/news/{id}/retry` | 重试失败的分析 |
| GET | `/api/analytics/heatmap` | 情感热图数据 |
| GET | `/api/analytics/trends` | 历史情感趋势 |
| POST | `/api/admin/cleanup-low-relevance` | 删除相关度 < 3 的分析 |
| GET | `/ws` | WebSocket 实时更新 |

## 预配置产品

| 代码 | 名称 | 板块 |
|------|------|--------|
| 7709.HK | CSOP SK Hynix Daily (2x) Leveraged | Technology |
| 7747.HK | CSOP Samsung Electronics Daily (2x) Leveraged | Technology |
| 7347.HK | CSOP Samsung Electronics Daily (-2x) Inverse | Technology |
| 2828.HK | iShares MSCI China A ETF | China A-Share |
| 83168.HK | CSOP Hang Seng Index ETF | Hong Kong Equity |
| 3010.HK | CSOP SSE 50 ETF | China A-Share |
| 3033.HK | CSOP CSI 500 ETF | China A-Share |
| 3115.HK | CSOP Nikkei 225 ETF | Japan Equity |

## 设计决策

1. 两级去重：URL + 向量相似度
2. WebSocket 实时更新
3. 重试机制（最多 3 次）
4. 并发分析限制（最多 5 个）
5. 可配置 LLM 提供商
6. 最低相关度阈值：相关度 < 3 的分析将被丢弃

## 已知限制

- SQLite 不适合生产规模
- 无用户认证
- 单实例架构

## 开发中使用的 AI 工具

| 工具 | 用途 |
|------|---------|
| Claude (Anthropic) | 代码生成、调试 |
| GitHub Copilot | IDE 建议 |

## 开发时间

~18 小时

## 技术栈

Next.js, FastAPI, SQLite, ChromaDB, WebSocket, Docker

## 许可证

MIT
