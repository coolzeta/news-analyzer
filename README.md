# Market News Intelligence System

A full-stack application that monitors market news, evaluates its potential impact on a portfolio of financial products using AI, and presents actionable insights through a web-based dashboard.

[中文文档](./README_CN.md)

## System Architecture

```
┌────────────────────┐      ┌────────────────────┐      ┌────────────────────┐      ┌──────────┐
│     Collector      │      │    Main Service    │      │   Agent Service    │      │ Frontend │
│     (Python)       │      │     (Python)       │      │     (Node.js)      │      │ (Next.js)│
│                    │      │                    │      │                    │      │          │
│  - RSS/NewsAPI     │      │  - REST API        │      │  - pi-agent-core   │      │  - WS    │
│  - URL Dedup       │─────▶│  - SQLite Storage  │◀────▶│  - LLM Calls       │◀────▶│  Client  │
│  - Vector Dedup    │ POST │  - WebSocket       │ HTTP │  - Tool Execution  │ HTTP │          │
│  - Embedding API   │      │  - Auto Analysis   │      │                    │      │          │
└────────────────────┘      └────────────────────┘      └────────────────────┘      └──────────┘
```

## Features

1. **News Ingestion** - RSS feeds, two-level deduplication, configurable interval
2. **AI-Powered Impact Analysis** - LLM-based analysis with relevance scores and sentiment
3. **Dashboard** - Real-time updates via WebSocket, filtering, status indicators
4. **Analytics Dashboard** - Sentiment heatmap and historical trends

## Quick Start

### Docker Compose (Recommended)

```bash
# 1. Clone
git clone <repository-url>
cd news-analizer

# 2. Create .env
cat > .env << 'ENVEOF'
LLM_API_KEY=your_api_key_here
LLM_PROVIDER=openrouter
LLM_MODEL=minimax/minimax-m2.7
ENVEOF

# 3. Run
docker compose up -d --build

# Access: http://localhost:3000
```

### Manual Setup

```bash
# Terminal 1: Agent Service
cd agent-service && npm install && npm start

# Terminal 2: Main Service  
cd main-service && pip install -r requirements.txt && python main.py

# Terminal 3: Frontend
cd frontend && npm install && npm run dev

# Terminal 4: Collector
cd collector && pip install -r requirements.txt && python main.py --daemon --interval 1
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | Yes | - | LLM provider API key (OpenRouter recommended) |
| `LLM_PROVIDER` | No | openrouter | LLM provider |
| `LLM_MODEL` | No | - | Model identifier |
| `COLLECT_INTERVAL_MINUTES` | No | 1 | Collection interval |
| `AUTO_ANALYZE` | No | true | Auto-analyze new articles |
| `AGENT_TIMEOUT` | No | 120 | Agent timeout (seconds) |
| `LOG_LEVEL` | No | INFO | Logging level |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List all products |
| GET | `/api/products/{code}` | Get product details |
| GET | `/api/products/{code}/impacts` | Get news affecting a specific product (with analysis for that product only) |
| GET | `/api/news` | List news (filterable by status, sentiment, product) |
| GET | `/api/news/{id}` | Get news with analyses |
| POST | `/api/news/{id}/analyze` | Trigger AI analysis |
| POST | `/api/news/{id}/retry` | Retry failed analysis |
| GET | `/api/analytics/heatmap` | Sentiment heatmap data |
| GET | `/api/analytics/trends` | Historical sentiment trends |
| POST | `/api/admin/cleanup-low-relevance` | Delete analyses with relevance < 3 |
| GET | `/ws` | WebSocket real-time updates |

## Pre-configured Products

| Code | Name | Sector |
|------|------|--------|
| 7709.HK | CSOP SK Hynix Daily (2x) Leveraged | Technology |
| 7747.HK | CSOP Samsung Electronics Daily (2x) Leveraged | Technology |
| 7347.HK | CSOP Samsung Electronics Daily (-2x) Inverse | Technology |
| 2828.HK | iShares MSCI China A ETF | China A-Share |
| 83168.HK | CSOP Hang Seng Index ETF | Hong Kong Equity |
| 3010.HK | CSOP SSE 50 ETF | China A-Share |
| 3033.HK | CSOP CSI 500 ETF | China A-Share |
| 3115.HK | CSOP Nikkei 225 ETF | Japan Equity |

## Design Decisions

1. Two-level deduplication: URL + vector similarity
2. WebSocket for real-time updates
3. Retry mechanism (max 3 attempts)
4. Concurrent analysis limit (max 5)
5. Configurable LLM provider
6. Minimum relevance threshold: analyses with relevance < 3 are discarded

## Known Limitations

- SQLite not for production scale
- No user authentication
- Single-instance architecture

## AI Tools Used

| Tool | Purpose |
|------|---------|
| Claude (Anthropic) | Code generation, debugging |
| GitHub Copilot | IDE suggestions |

## Development Time

~18 hours

## Tech Stack

Next.js, FastAPI, SQLite, ChromaDB, WebSocket, Docker

## License

MIT
