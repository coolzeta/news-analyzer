const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface NewsFilters {
  search?: string;
  sentiment?: 'Positive' | 'Negative' | 'Neutral';
  product_code?: string;
  min_relevance?: number;
  start_date?: string;
  end_date?: string;
  status?: 'pending' | 'analyzing' | 'completed' | 'failed';
  skip?: number;
  limit?: number;
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  getProducts: () => fetchAPI<Product[]>('/api/products'),
  
  getProduct: (code: string) => fetchAPI<Product>(`/api/products/${code}`),
  
  getProductImpacts: (code: string, minRelevance = 0) => 
    fetchAPI<NewsWithAnalysis[]>(`/api/products/${code}/impacts?min_relevance=${minRelevance}`),
  
  getNews: (filters?: NewsFilters) => {
    const params = new URLSearchParams();
    params.set('skip', String(filters?.skip ?? 0));
    params.set('limit', String(filters?.limit ?? 20));
    if (filters?.search) params.set('search', filters.search);
    if (filters?.sentiment) params.set('sentiment', filters.sentiment);
    if (filters?.product_code) params.set('product_code', filters.product_code);
    if (filters?.min_relevance !== undefined) params.set('min_relevance', String(filters.min_relevance));
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);
    if (filters?.status) params.set('status', filters.status);
    
    return fetchAPI<News[]>(`/api/news?${params.toString()}`);
  },
  
  getNewsDetail: (id: number) => 
    fetchAPI<NewsWithAnalysis>(`/api/news/${id}`),
  
  createNews: (news: Partial<News>) => 
    fetchAPI<News>('/api/news', {
      method: 'POST',
      body: JSON.stringify(news),
    }),
  
  analyzeNews: (id: number) => 
    fetchAPI<{ status: string; analyses_count: number }>(`/api/news/${id}/analyze`, {
      method: 'POST',
    }),
  
  retryAnalysis: (id: number) => 
    fetchAPI<{ status: string; news_id: number }>(`/api/news/${id}/retry`, {
      method: 'POST',
    }),
  
  getAnalyses: (params?: { sentiment?: string; product_code?: string; min_relevance?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.sentiment) searchParams.set('sentiment', params.sentiment);
    if (params?.product_code) searchParams.set('product_code', params.product_code);
    if (params?.min_relevance !== undefined) searchParams.set('min_relevance', params.min_relevance.toString());
    
    const query = searchParams.toString();
    return fetchAPI<Analysis[]>(`/api/analyses${query ? `?${query}` : ''}`);
  },
  
  getSentimentHeatmap: (params?: { start_date?: string; end_date?: string; days?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    if (params?.days) searchParams.set('days', params.days.toString());
    
    const query = searchParams.toString();
    return fetchAPI<HeatmapResponse>(`/api/analytics/heatmap${query ? `?${query}` : ''}`);
  },
  
  getSentimentTrends: (params?: { start_date?: string; end_date?: string; days?: number; granularity?: 'day' | 'week' }) => {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    if (params?.days) searchParams.set('days', params.days.toString());
    if (params?.granularity) searchParams.set('granularity', params.granularity);
    
    const query = searchParams.toString();
    return fetchAPI<TrendsResponse>(`/api/analytics/trends${query ? `?${query}` : ''}`);
  },
};

export interface HeatmapResponse {
  start_date: string;
  end_date: string;
  products: Record<string, { name: string; sector: string | null }>;
  data: Array<{
    date: string;
    products: Record<string, {
      Positive: number;
      Negative: number;
      Neutral: number;
      total: number;
      avg_relevance: number;
    }>;
  }>;
}

export interface TrendsResponse {
  start_date: string;
  end_date: string;
  granularity: 'day' | 'week';
  trends: Array<{
    period: string;
    granularity: string;
    Positive: number;
    Negative: number;
    Neutral: number;
    total: number;
    avg_relevance: number;
    sentiment_score: number;
    by_product: Record<string, { Positive: number; Negative: number; Neutral: number; total: number }>;
  }>;
}

import { Product, News, Analysis, NewsWithAnalysis } from '@/types';
