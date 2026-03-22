import 'dotenv/config';
import express from 'express';
import { Agent, ProviderTransport } from '@mariozechner/pi-agent-core';
import { getModel } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import pkg from 'duckduckgo-search';
import { EventEmitter } from 'events';
const { search } = pkg;

import { loadConfig, loadPrompts, loadFinancialContexts } from './config.js';

const config = loadConfig();
const prompts = loadPrompts(config);
const financialContexts = loadFinancialContexts(config);

// Global event emitter for streaming analysis events
const analysisEvents = new EventEmitter();
// Keep track of active analyses by article_id
const activeAnalyses = new Map();

const SYSTEM_PROMPT = prompts?.system || `
You are a rigorous financial news analyst specializing in ETF impact assessment.
Your role is to provide OBJECTIVE, EVIDENCE-BASED analysis.

## Core Principles

1. **OBJECTIVITY**: Base your analysis solely on facts from the news.
   Do not speculate beyond what is explicitly stated or can be directly inferred.

2. **RELEVANCE THRESHOLD**: Only include products where you can establish a
   CLEAR, DIRECT connection. A score of 3+ requires you to articulate a specific
   causal chain.

3. **EVIDENCE-BASED**: Every analysis must cite specific facts from the news
   article. Generic statements without evidence are unacceptable.

## Relevance Score Criteria (BE PRECISE)

**Score 0-2 (EXCLUDE from results)**: No meaningful connection
- Product is in same broad region/sector but no specific linkage
- Impact is too indirect or speculative
- Example: A China regulatory news but product is Japan ETF with no China exposure

**Score 3-4 (MARGINAL relevance)**: Indirect but plausible connection
- Product has exposure to mentioned sector/region
- Impact chain exists but involves multiple assumptions
- Example: Semiconductor equipment news -> Samsung ETF (Samsung makes chips, uses equipment)

**Score 5-6 (MODERATE relevance)**: Clear indirect connection
- Product's underlying assets directly related to news topic
- Impact mechanism is clear but timing/magnitude uncertain
- Example: SK Hynix earnings miss -> SK Hynix leveraged ETF

**Score 7-8 (HIGH relevance)**: Direct material impact expected
- News directly concerns product's tracked index/underlying
- Clear and immediate impact pathway
- Example: BoJ rate hike -> Nikkei 225 ETF

**Score 9-10 (CRITICAL relevance)**: Primary direct impact
- News is about the exact underlying asset
- Product will be materially affected in near-term
- Example: Samsung stock plunges 5% -> Samsung 2x leveraged ETF

## Sentiment Guidelines

- **Positive**: News creates clear upside for product (earnings beat, favorable policy,
  demand surge)
- **Negative**: News creates clear downside for product (earnings miss, unfavorable
  policy, demand drop)
- **Neutral**: Impact exists but direction unclear, or offsetting factors present

## Impact Summary Requirements

Each summary MUST:
1. Start with a specific fact from the news
2. Explain the causal chain to the product
3. Indicate confidence level and key assumptions
4. Be 2-3 sentences, no fluff

Example of GOOD analysis:
"Samsung reported Q3 revenue decline of 12% YoY due to weak memory chip demand.
This directly impacts the Samsung 2x Leveraged ETF which tracks Samsung stock
performance. The negative sentiment is clear, though magnitude depends on whether
this was already priced in."

Example of BAD analysis (DO NOT DO THIS):
"Samsung news may affect the ETF as it tracks Samsung. The impact could be
significant depending on market reaction."

## Tools Usage

- Use web_search ONLY when critical context is missing from the article
- Use get_financial_context to understand product exposure
- Use get_historical_news to check if similar news occurred before

## Final Output

Always use the analyze_impact tool to return results.
Only include products where you can defend a score of 3+ with specific evidence.
`;

const app = express();
app.use(express.json());

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...data }));
}

function createAnalyzeTool() {
  return {
    name: 'analyze_impact',
    label: 'Analyze Impact',
    description: `
Return your final analysis as structured results. This is the MANDATORY final step.

## When to Call This Tool
Call this AFTER you have:
1. Read and understood the news article
2. Considered each product's exposure to the news topic
3. Optionally gathered additional context via other tools

## Parameter Requirements

**results**: Array of product analyses. Each entry MUST include:
- **product_code** (string): Exact product code from the provided list (e.g., "7709.HK")
- **relevance_score** (integer 0-10): 
  - 0-2: Exclude from results (not relevant enough)
  - 3-4: Marginal relevance (indirect connection)
  - 5-6: Moderate relevance (clear indirect connection)
  - 7-8: High relevance (direct impact expected)
  - 9-10: Critical relevance (primary direct impact)
- **sentiment** (string): Exactly one of "Positive", "Negative", or "Neutral"
- **impact_summary** (string): 2-3 sentences explaining:
  1. Specific fact from the news
  2. Causal chain to the product
  3. Confidence/assumptions

## Important Rules
- ONLY include products with relevance_score >= 3
- If no products are meaningfully affected, return empty array: {"results": []}
- Do NOT invent product codes - use ONLY from the provided list
- Be precise with sentiment - no hedging like "slightly positive"

## Example Output
{
  "results": [
    {
      "product_code": "7709.HK",
      "relevance_score": 8,
      "sentiment": "Negative",
      "impact_summary": "SK Hynix reported Q3 revenue decline of 15% due to weak memory demand. This directly impacts 7709.HK which is a 2x leveraged ETF tracking SK Hynix stock. The negative earnings surprise will likely cause downward pressure on the ETF."
    },
    {
      "product_code": "7747.HK",
      "relevance_score": 4,
      "sentiment": "Negative",
      "impact_summary": "Memory chip weakness affects Samsung as a major DRAM/NAND producer. However, Samsung's diversified business (smartphones, appliances) provides some buffer. Impact is indirect via memory market sentiment."
    }
  ]
}
`.trim(),
    parameters: Type.Object({
      results: Type.Array(Type.Object({
        product_code: Type.String({ 
          description: 'Exact product code from the provided list (e.g., "7709.HK", "2828.HK"). Do NOT invent codes.' 
        }),
        relevance_score: Type.Integer({ 
          description: 'Integer 0-10. 0-2: exclude, 3-4: marginal, 5-6: moderate, 7-8: high, 9-10: critical. Must be >= 3 to include.' 
        }),
        sentiment: Type.String({ 
          description: 'Exactly one of: "Positive", "Negative", or "Neutral". No other values allowed.' 
        }),
        impact_summary: Type.String({ 
          description: '2-3 sentences: (1) specific fact from news, (2) causal chain to product, (3) confidence/assumptions.' 
        })
      }))
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      log('info', 'analyze_impact called', { 
        resultsCount: params.results?.length || 0,
        products: params.results?.map(r => r.product_code) || []
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(params.results) }],
        details: params
      };
    }
  };
}

function createWebSearchTool() {
  return {
    name: 'web_search',
    label: 'Web Search',
    description: `
Search the web for additional context using DuckDuckGo.

## When to Use
- Need company financial data not in the news article
- Want recent stock price movements or analyst ratings
- Checking sector/market trends mentioned in the news
- Verifying facts or getting more details on events

## When NOT to Use
- The news article already has sufficient detail
- You just need to analyze the provided content
- The product exposure is already clear

## Parameters
- **query** (required): Search query, be specific
- **max_results** (optional): Number of results, default 5, max 10

## Example Queries
- "Samsung Electronics Q4 2024 earnings results"
- "SK Hynix HBM demand 2024"
- "China property sector stimulus 2024"
- "Nikkei 225 index performance March 2024"
`.trim(),
    parameters: Type.Object({
      query: Type.String({ 
        description: 'Specific search query. Include company name, time period, and topic for best results.' 
      }),
      max_results: Type.Optional(Type.Integer({ 
        description: 'Number of results to return (default: 5, max: 10)' 
      }))
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const maxResults = Math.min(params.max_results || 5, 10);
      log('info', 'web_search called', { query: params.query, maxResults });
      
      try {
        const results = await search(params.query, { maxResults });
        
        const formattedResults = results.map((r, i) => 
          `[${i + 1}] ${r.title}\n${r.href}\n${r.description}\n`
        ).join('\n');
        
        return {
          content: [{
            type: 'text',
            text: `Web search results for "${params.query}":\n\n${formattedResults}`
          }]
        };
      } catch (error) {
        log('error', 'web_search failed', { error: error.message });
        return {
          content: [{
            type: 'text',
            text: `Web search failed: ${error.message}`
          }]
        };
      }
    }
  };
}

function createHistoricalNewsTool() {
  return {
    name: 'get_historical_news',
    label: 'Get Historical News',
    description: `
Search our database for previously collected news articles.

## When to Use
- Check if similar news has been reported before
- Find historical context for a developing story
- Compare current news with past events about the same company/sector
- Understand if this is a new development or follow-up

## When NOT to Use
- The current news is self-contained and actionable
- You don't need historical comparison
- The topic is clearly new/novel

## Parameters
- **query** (required): Search keywords (company name, sector, topic)
- **limit** (optional): Max articles to return, default 5

## Returns
List of matching news articles with title, source, date, and summary.
Returns empty message if no matches found.
`.trim(),
    parameters: Type.Object({
      query: Type.String({ 
        description: 'Search keywords: company name, sector, or topic (e.g., "Samsung", "semiconductor", "China property")' 
      }),
      limit: Type.Optional(Type.Integer({ 
        description: 'Maximum number of articles to return (default: 5)' 
      }))
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!config.mainServiceUrl) {
        return {
          content: [{ type: 'text', text: 'MAIN_SERVICE_URL is not configured. Historical news lookup unavailable.' }]
        };
      }

      const limit = params.limit || 5;
      log('info', 'get_historical_news called', { query: params.query, limit });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.httpTimeout);

      try {
        const response = await fetch(
          `${config.mainServiceUrl}/api/news?limit=${limit}&search=${encodeURIComponent(params.query)}`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);

        if (!response.ok) {
          return { content: [{ type: 'text', text: `Failed to fetch historical news: HTTP ${response.status}` }] };
        }

        const data = await response.json();
        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: `No historical news found for "${params.query}"` }] };
        }

        const formattedNews = data.map((n, i) => 
          `[${i + 1}] ${n.title}\nSource: ${n.source} | Date: ${n.published_date}\n${n.summary || ''}\n`
        ).join('\n');

        return { content: [{ type: 'text', text: `Historical news for "${params.query}":\n\n${formattedNews}` }] };
      } catch (error) {
        clearTimeout(timeout);
        log('error', 'Historical news fetch failed', { error: error.message });
        return { content: [{ type: 'text', text: `Failed to fetch historical news: ${error.message}` }] };
      }
    }
  };
}

function createFinancialContextTool() {
  return {
    name: 'get_financial_context',
    label: 'Get Financial Context',
    description: `
Get pre-defined financial context for companies, sectors, and market themes.

## When to Use
- Need background on a company's business segments
- Understanding sector dynamics and key players
- Learning about ETF mechanics (leveraged, inverse)
- Quick reference for market themes

## When NOT to Use
- Need real-time data (use web_search instead)
- The topic is not in our pre-defined list
- You already have sufficient context

## Available Context Types
- **Companies**: Samsung Electronics, SK Hynix
- **Sectors**: semiconductor, technology, memory chip
- **Markets**: China A-share, Hong Kong equity, Japan equity
- **Products**: leveraged ETF, inverse ETF

## Parameters
- **topic** (required): Company name, sector, or theme
- **context_type** (optional): "company", "sector", or "theme" (auto-detected if omitted)

## Returns
Structured context including overview, key metrics, market dynamics, and ETF impact notes.
Returns "not found" message if topic is not in our database.
`.trim(),
    parameters: Type.Object({
      topic: Type.String({ 
        description: 'Company name, sector, or market theme (e.g., "Samsung Electronics", "semiconductor", "leveraged ETF")' 
      }),
      context_type: Type.Optional(Type.String({ 
        description: 'Type of context: "company", "sector", or "theme" (default: auto-detect)' 
      }))
    }),
    execute: async (toolCallId, params, signal, onUpdate) => {
      const topicLower = params.topic.toLowerCase();
      log('info', 'get_financial_context called', { topic: params.topic });
      
      let matchedContext = null;

      for (const [key, context] of Object.entries(financialContexts)) {
        if (topicLower.includes(key) || key.includes(topicLower)) {
          matchedContext = { key, ...context };
          break;
        }
      }

      if (matchedContext) {
        const { key, ...context } = matchedContext;
        const contextText = Object.entries(context)
          .map(([k, v]) => `${k.replace(/_/g, ' ').toUpperCase()}:\n${typeof v === 'string' ? v : (Array.isArray(v) ? v.join(', ') : JSON.stringify(v, null, 2))}`)
          .join('\n\n');
        
        return {
          content: [{
            type: 'text',
            text: `Financial context for "${params.topic}":\n\n${contextText}`
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: `No pre-defined context for "${params.topic}". Consider using web_search tool to find additional information.`
        }]
      };
    }
  };
}

function getApiKey(provider) {
  if (provider === 'openrouter') return config.llm.apiKey;
  return process.env[`${provider.toUpperCase()}_API_KEY`];
}

function createCustomModel(provider, modelId) {
  const baseUrls = {
    'openrouter': 'https://openrouter.ai/api/v1',
    'openai': 'https://api.openai.com/v1',
    'anthropic': 'https://api.anthropic.com/v1',
  };

  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: provider,
    baseUrl: baseUrls[provider] || 'https://openrouter.ai/api/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

function getOrCreateModel(provider, modelId) {
  try {
    const model = getModel(provider, modelId);
    if (model) return model;
  } catch (e) {
    log('info', `Model ${modelId} not in predefined list, creating custom model`);
  }
  return createCustomModel(provider, modelId);
}

function createAgent() {
  const model = getOrCreateModel(config.llm.provider, config.llm.model);

  const transport = new ProviderTransport({
    getApiKey: getApiKey
  });

  return new Agent({
    transport: transport,
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: model,
      tools: [
        createAnalyzeTool(),
        createWebSearchTool(),
        createHistoricalNewsTool(),
        createFinancialContextTool()
      ],
    },
  });
}

async function analyzeNews(article, products, articleId = null) {
  const agent = createAgent();

  const productList = products.map(p => 
    `- ${p.code}: ${p.name} (Sector: ${p.sector || 'N/A'})`
  ).join('\n');

  const content = article.content || article.summary || '';
  
  const prompt = `Analyze the following news article and its potential impact on each product.

NEWS ARTICLE:
Title: ${article.title}
${content ? `Content: ${content.substring(0, 2000)}` : ''}

PRODUCTS TO ANALYZE:
${productList}

Instructions:
1. Use available tools (web_search, get_historical_news, get_financial_context) if you need additional context
2. Analyze each product's potential exposure to this news
3. Use the analyze_impact tool to return your analysis for each product with meaningful relevance (score >= 3).`;

  let results = [];
  
  agent.subscribe((event) => {
    const emitEvent = (eventType, data = {}) => {
      if (articleId) {
        const eventPayload = {
          type: eventType,
          article_id: articleId,
          timestamp: new Date().toISOString(),
          ...data
        };
        analysisEvents.emit('analysis_event', eventPayload);
        log('debug', `Emitted ${eventType}`, { articleId, ...data });
      }
    };

    if (event.type === 'tool_execution_start' || event.type === 'tool_start') {
      const toolName = event.toolName || event.name || 'unknown';
      emitEvent('tool_start', { tool: toolName });
    }
    
    if (event.type === 'tool_execution_end' || event.type === 'tool_end') {
      const toolName = event.toolName || event.name || 'unknown';
      emitEvent('tool_end', { tool: toolName });
      
      try {
        if (toolName === 'analyze_impact') {
          const data = JSON.parse(event.result.content[0].text);
          results = data;
        }
      } catch (e) {
        log('error', 'Failed to parse tool result', { error: e.message });
      }
    }
  });

  try {
    await agent.prompt(prompt);
    await agent.waitForIdle();
  } catch (error) {
    log('error', 'Agent error', { error: error.message });
    throw error;
  }

  return results;
}

app.use((err, req, res, next) => {
  log('error', 'Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.post('/analyze', async (req, res) => {
  try {
    const { article_id, title, content, summary, products } = req.body;

    if (!title || !products || products.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: title, products' });
    }

    log('info', `Analyzing article ${article_id}`, { title: title.substring(0, 50) });

    const results = await analyzeNews(
      { title, content, summary },
      products,
      article_id
    );

    log('info', `Analysis complete`, { articleId: article_id, resultsCount: results.length });
    res.json({ results });
  } catch (error) {
    log('error', 'Analysis error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post('/analyze/stream', async (req, res) => {
  const { article_id, title, content, summary, products } = req.body;

  if (!title || !products || products.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: title, products' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const eventHandler = (event) => {
    if (event.article_id === article_id) {
      sendEvent(event);
      if (event.type === 'analysis_complete' || event.type === 'analysis_error') {
        analysisEvents.off('analysis_event', eventHandler);
      }
    }
  };

  analysisEvents.on('analysis_event', eventHandler);

  sendEvent({ type: 'analysis_start', article_id, timestamp: new Date().toISOString() });
  log('info', `Starting streaming analysis for article ${article_id}`);

  try {
    const results = await analyzeNews(
      { title, content, summary },
      products,
      article_id
    );

    sendEvent({ 
      type: 'analysis_complete', 
      article_id, 
      results,
      timestamp: new Date().toISOString() 
    });
    log('info', `Streaming analysis complete`, { articleId: article_id, resultsCount: results.length });
  } catch (error) {
    sendEvent({ 
      type: 'analysis_error', 
      article_id, 
      error: error.message,
      timestamp: new Date().toISOString() 
    });
    log('error', 'Streaming analysis error', { error: error.message });
  } finally {
    analysisEvents.off('analysis_event', eventHandler);
    res.end();
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    tools: ['analyze_impact', 'web_search', 'get_historical_news', 'get_financial_context'],
    endpoints: ['/analyze', '/analyze/stream'],
    config: {
      llmProvider: config.llm.provider,
      llmModel: config.llm.model,
      mainServiceConfigured: !!config.mainServiceUrl
    }
  });
});

app.listen(config.port, () => {
  log('info', `Agent Service running`, {
    port: config.port,
    llmProvider: config.llm.provider,
    llmModel: config.llm.model,
    mainServiceUrl: config.mainServiceUrl || 'not configured'
  });
});
