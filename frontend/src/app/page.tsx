'use client';

import { api, NewsFilters } from '@/lib/api';
import { useWebSocket } from '@/lib/useWebSocket';
import { News, Sentiment, Product } from '@/types';
import { format } from 'date-fns';
import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, X, Filter, ChevronDown, ArrowUp, RefreshCw, AlertCircle } from 'lucide-react';

const PAGE_SIZE = 20;

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  
  if (dateStr.includes(',')) {
    const parts = dateStr.split(' ');
    if (parts.length >= 5) {
      const day = parts[1];
      const month = parts[2];
      const year = parts[3];
      const time = parts[4];
      const monthMap: Record<string, string> = {
        Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
        Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
      };
      const isoStr = `${year}-${monthMap[month] || '01'}-${day.padStart(2, '0')}T${time}Z`;
      const d = new Date(isoStr);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  
  if (dateStr.includes(' ')) {
    const d = new Date(dateStr.replace(' ', 'T') + 'Z');
    if (!isNaN(d.getTime())) return d;
  }
  
  return new Date();
}

function getAggregateSentiment(analyses?: { sentiment: string }[]): Sentiment | null {
  if (!analyses || analyses.length === 0) return null;
  const counts = { Positive: 0, Negative: 0, Neutral: 0 };
  for (const a of analyses) {
    if (a.sentiment in counts) counts[a.sentiment as keyof typeof counts]++;
  }
  const max = Math.max(counts.Positive, counts.Negative, counts.Neutral);
  if (max === 0) return null;
  if (counts.Positive === max) return 'Positive';
  if (counts.Negative === max) return 'Negative';
  return 'Neutral';
}

function SentimentBadge({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return null;
  const classes: Record<Sentiment, string> = {
    Positive: 'bg-green-100 text-green-800',
    Negative: 'bg-red-100 text-red-800',
    Neutral: 'bg-gray-100 text-gray-800',
  };
  return <span className={`px-2 py-1 rounded text-xs font-medium ${classes[sentiment]}`}>{sentiment}</span>;
}

function AnalysisStatusBadge({ status, hasAnalyses }: { status: string; hasAnalyses: boolean }) {
  if (status === 'analyzing') {
    return (
      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
        <Loader2 className="w-3 h-3 animate-spin" />
        Analyzing...
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
        <AlertCircle className="w-3 h-3" />
        Analysis Failed
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
        Queued for Analysis
      </span>
    );
  }
  if (status === 'completed' && !hasAnalyses) {
    return (
      <span className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
        No Relevant Products
      </span>
    );
  }
  return null;
}

function NewsCard({ news, onRetry }: { news: News; onRetry: (id: number) => void }) {
  const aggregateSentiment = getAggregateSentiment(news.analyses);
  const date = parseDate(news.published_date);
  const hasAnalyses = !!(news.analyses && news.analyses.length > 0);
  const isCompleted = news.analysis_status === 'completed';
  const showStatus = !isCompleted || !hasAnalyses;
  
  return (
    <article className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <Link href={`/news/${news.id}`}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold text-gray-900 line-clamp-2 hover:text-blue-600">{news.title}</h2>
              {aggregateSentiment && <SentimentBadge sentiment={aggregateSentiment} />}
            </div>
          </Link>
          <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
            <span className="font-medium text-blue-600">{news.source}</span>
            <span>{format(date, 'MMM d, yyyy HH:mm')}</span>
            {isCompleted && hasAnalyses && (
              <span className="text-green-600 font-medium">
                {news.analyses!.length} products affected
              </span>
            )}
          </div>
          {news.summary && <p className="text-gray-600 text-sm line-clamp-2">{news.summary}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        {showStatus && <AnalysisStatusBadge status={news.analysis_status} hasAnalyses={hasAnalyses} />}
        {news.analysis_status === 'failed' && (
          <button
            onClick={() => onRetry(news.id)}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        )}
        {isCompleted && hasAnalyses && (
          <Link 
            href={`/news/${news.id}`}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            View Details →
          </Link>
        )}
      </div>
    </article>
  );
}

export default function HomePage() {
  const [news, setNews] = useState<News[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filters, setFilters] = useState<NewsFilters>({ limit: PAGE_SIZE, skip: 0 });
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const newsRef = useRef<News[]>([]);

  useEffect(() => {
    api.getProducts().then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleWebSocketMessage = useCallback((message: unknown) => {
    const msg = message as { type: string; data: Record<string, unknown> };
    if (msg.type === 'news_update') {
      const newsId = msg.data.id as number;
      const status = msg.data.analysis_status as string;
      
      setNews(prev => {
        const exists = prev.some(item => item.id === newsId);
        if (!exists && status === 'pending') {
          const newNews: News = {
            id: newsId,
            title: msg.data.title as string,
            source: msg.data.source as string,
            published_date: msg.data.published_date as string,
            summary: msg.data.summary as string || '',
            content: msg.data.content as string || '',
            url: msg.data.url as string,
            analyses: [],
            created_at: msg.data.created_at as string || '',
            analysis_status: 'pending',
            analysis_retry_count: 0,
          };
          return [newNews, ...prev];
        }
        return prev.map(item => 
          item.id === newsId 
            ? { ...item, analysis_status: status as News['analysis_status'] }
            : item
        );
      });
      
      newsRef.current = (() => {
        const exists = newsRef.current.some(item => item.id === newsId);
        if (!exists && status === 'pending') {
          const newNews: News = {
            id: newsId,
            title: msg.data.title as string,
            source: msg.data.source as string,
            published_date: msg.data.published_date as string,
            summary: msg.data.summary as string || '',
            content: msg.data.content as string || '',
            url: msg.data.url as string,
            analyses: [],
            created_at: msg.data.created_at as string || '',
            analysis_status: 'pending',
            analysis_retry_count: 0,
          };
          return [newNews, ...newsRef.current];
        }
        return newsRef.current.map(item =>
          item.id === newsId
            ? { ...item, analysis_status: status as News['analysis_status'] }
            : item
        );
      })();
    } else if (msg.type === 'analysis_update') {
      const newsId = msg.data.news_id as number;
      const analyses = msg.data.analyses as News['analyses'];
      setNews(prev => prev.map(item => 
        item.id === newsId 
          ? { ...item, analysis_status: 'completed', analyses }
          : item
      ));
      newsRef.current = newsRef.current.map(item =>
        item.id === newsId
          ? { ...item, analysis_status: 'completed', analyses }
          : item
      );
    }
  }, []);

  const wsUrl = typeof window !== 'undefined' 
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8000/ws`
    : '';
  
  useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
    reconnect: true,
  });

  const loadNews = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      setNews([]);
      newsRef.current = [];
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    
    try {
      const skip = reset ? 0 : newsRef.current.length;
      const data = await api.getNews({ ...filters, skip, limit: PAGE_SIZE });
      
      const sortedData = [...data].sort((a, b) => {
        const dateA = parseDate(a.published_date).getTime();
        const dateB = parseDate(b.published_date).getTime();
        return dateB - dateA;
      });
      
      if (reset) {
        setNews(sortedData);
        newsRef.current = sortedData;
      } else {
        const existingIds = new Set(newsRef.current.map(n => n.id));
        const newData = sortedData.filter(n => !existingIds.has(n.id));
        const combined = [...newsRef.current, ...newData];
        setNews(combined);
        newsRef.current = combined;
      }
      
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filters]);

  useEffect(() => {
    newsRef.current = [];
    loadNews(true);
  }, [filters.sentiment, filters.product_code, filters.min_relevance, filters.start_date, filters.end_date, filters.status]);

  useEffect(() => {
    if (!hasMore || loading || loadingMore) return;
    
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) {
        loadNews(false);
      }
    }, { rootMargin: '200px' });
    
    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }
    
    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, loadingMore, loadNews]);

  const updateFilter = (key: keyof NewsFilters, value: string | number | undefined) => {
    setFilters(prev => ({ ...prev, [key]: value || undefined, skip: 0 }));
  };

  const clearFilters = () => {
    setFilters({ limit: PAGE_SIZE, skip: 0 });
  };

  const handleRetry = async (newsId: number) => {
    try {
      await api.retryAnalysis(newsId);
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const hasActiveFilters = filters.sentiment || filters.product_code || 
    filters.min_relevance !== undefined || filters.start_date || filters.end_date || filters.status;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Latest News</h1>
        <p className="text-gray-600 mt-2">Monitor market news and their impact on financial products</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <button
          onClick={() => setFiltersExpanded(!filtersExpanded)}
          className="flex items-center gap-2 text-gray-700 font-medium w-full"
        >
          <Filter className="w-4 h-4" />
          <span>Filters</span>
          {hasActiveFilters && (
            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">Active</span>
          )}
          <ChevronDown className={`w-4 h-4 ml-auto transition-transform ${filtersExpanded ? 'rotate-180' : ''}`} />
        </button>

        {filtersExpanded && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input 
                type="date" 
                value={filters.start_date?.split('T')[0] || ''}
                onChange={(e) => updateFilter('start_date', e.target.value ? `${e.target.value}T00:00:00` : undefined)}
                className="w-full border rounded-md px-3 py-2 text-sm" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input 
                type="date" 
                value={filters.end_date?.split('T')[0] || ''}
                onChange={(e) => updateFilter('end_date', e.target.value ? `${e.target.value}T23:59:59` : undefined)}
                className="w-full border rounded-md px-3 py-2 text-sm" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sentiment</label>
              <select 
                value={filters.sentiment || ''}
                onChange={(e) => updateFilter('sentiment', e.target.value as Sentiment || undefined)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">All Sentiments</option>
                <option value="Positive">Positive</option>
                <option value="Negative">Negative</option>
                <option value="Neutral">Neutral</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
              <select 
                value={filters.product_code || ''}
                onChange={(e) => updateFilter('product_code', e.target.value || undefined)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">All Products</option>
                {products.map((p) => (<option key={p.code} value={p.code}>{p.code} - {p.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Relevance</label>
              <input 
                type="number" 
                min="0" 
                max="10" 
                step="0.5"
                value={filters.min_relevance ?? ''}
                onChange={(e) => updateFilter('min_relevance', e.target.value ? parseFloat(e.target.value) : undefined)}
                className="w-full border rounded-md px-3 py-2 text-sm" 
                placeholder="0-10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select 
                value={filters.status || ''}
                onChange={(e) => updateFilter('status', e.target.value as News['analysis_status'] || undefined)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="analyzing">Analyzing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={clearFilters} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Clear Filters
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center justify-between">
          <p className="text-red-800">{error}</p>
          <button onClick={() => setError(null)} className="text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-600">Loading news...</span>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {news.map((item) => (<NewsCard key={item.id} news={item} onRetry={handleRetry} />))}
          </div>
          
          <div ref={loadMoreRef} className="py-8">
            {loadingMore && (
              <div className="flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <span className="ml-2 text-gray-600">Loading more...</span>
              </div>
            )}
            {!hasMore && news.length > 0 && (
              <p className="text-center text-gray-500 text-sm">No more news</p>
            )}
          </div>
        </>
      )}

      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors z-50"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
