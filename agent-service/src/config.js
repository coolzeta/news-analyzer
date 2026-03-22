import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadConfig() {
  const requiredVars = ['LLM_MODEL', 'LLM_API_KEY'];
  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  return {
    port: parseInt(process.env.PORT || '8001', 10),
    llm: {
      provider: process.env.LLM_PROVIDER || 'openrouter',
      model: process.env.LLM_MODEL,
      apiKey: process.env.LLM_API_KEY,
    },
    mainServiceUrl: process.env.MAIN_SERVICE_URL,
    httpTimeout: parseInt(process.env.HTTP_TIMEOUT || '30000', 10),
    promptsPath: process.env.AGENT_PROMPTS_PATH || path.join(__dirname, 'prompts.json'),
    financialContextsPath: process.env.FINANCIAL_CONTEXTS_PATH || path.join(__dirname, 'financial-contexts.json'),
  };
}

function loadPrompts(config) {
  try {
    if (fs.existsSync(config.promptsPath)) {
      const data = fs.readFileSync(config.promptsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`Failed to load prompts from ${config.promptsPath}: ${error.message}`);
  }
  return null;
}

function loadFinancialContexts(config) {
  try {
    if (fs.existsSync(config.financialContextsPath)) {
      const data = fs.readFileSync(config.financialContextsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn(`Failed to load financial contexts from ${config.financialContextsPath}: ${error.message}`);
  }
  return {};
}

export { loadConfig, loadPrompts, loadFinancialContexts };
