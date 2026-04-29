export interface Product {
  id: number;
  code: string;
  name: string;
  asset_class: string | null;
  domicile: string | null;
  sector: string | null;
  theme: string | null;
  background: string | null;
}

export interface News {
  id: number;
  title: string;
  source: string;
  published_date: string;
  summary: string | null;
  content: string | null;
  url: string;
  created_at: string;
  analysis_status: 'pending' | 'analyzing' | 'completed' | 'failed';
  analysis_retry_count: number;
  analyses?: Analysis[];
}

export interface Analysis {
  id: number;
  news_id: number;
  product_code: string;
  relevance_score: number;
  sentiment: 'Positive' | 'Negative' | 'Neutral';
  impact_summary: string;
  created_at: string;
  status: 'pending' | 'completed' | 'failed';
  retry_count: number;
}

export interface NewsWithAnalysis extends News {
  analyses: Analysis[];
}

export type Sentiment = 'Positive' | 'Negative' | 'Neutral';
