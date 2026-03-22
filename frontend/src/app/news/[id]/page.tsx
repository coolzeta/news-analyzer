'use client';

import { api } from '@/lib/api';
import { useWebSocket } from '@/lib/useWebSocket';
import { NewsWithAnalysis, Product, Analysis } from '@/types';
import { format } from 'date-fns';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, AlertCircle, Star } from 'lucide-react';

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

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const classes: Record<string, string> = {
    Positive: 'bg-green-100 text-green-800',
    Negative: 'bg-red-100 text-red-800',
    Neutral: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${classes[sentiment] || classes.Neutral}`}>
      {sentiment}
    </span>
  );
}

function RelevanceScore({ score }: { score: number }) {
  let color = 'text-gray-500';
  if (score >= 7) color = 'text-green-600 font-semibold';
  else if (score >= 4) color = 'text-yellow-600';

  return <span className={color}>{score}/10</span>;
}

function AnalysisCard({ analysis, productMap, highlighted = false }: { 
  analysis: Analysis;
  productMap: Map<string, Product>;
  highlighted?: boolean;
}) {
  const product = productMap.get(analysis.product_code);
  
  return (
    <div 
      id={`analysis-${analysis.product_code}`}
      className={`rounded-lg p-4 transition-colors ${
        highlighted 
          ? 'bg-yellow-50 border-2 border-yellow-400 shadow-sm' 
          : 'bg-gray-50 hover:bg-gray-100'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <Link 
          href={`/products/${analysis.product_code}`}
          className="group"
        >
          <span className={`font-mono text-sm ${highlighted ? 'text-yellow-700' : 'text-blue-600 group-hover:text-blue-800'}`}>
            {analysis.product_code}
          </span>
          {product && (
            <span className={`text-sm ml-2 ${highlighted ? 'text-yellow-700' : 'text-gray-600 group-hover:text-gray-800'}`}>
              {product.name}
            </span>
          )}
        </Link>
        <div className="flex items-center gap-2 flex-shrink-0">
          <SentimentBadge sentiment={analysis.sentiment} />
          <span className="text-sm text-gray-500">
            <RelevanceScore score={analysis.relevance_score} />
          </span>
        </div>
      </div>
      <p className="text-gray-700 text-sm">{analysis.impact_summary}</p>
    </div>
  );
}

export default function NewsDetailPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams();
  const highlightProduct = searchParams.get('product');
  
  const [news, setNews] = useState<NewsWithAnalysis | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const productMap = new Map(products.map(p => [p.code, p]));

  const loadNews = useCallback(async () => {
    try {
      const data = await api.getNewsDetail(parseInt(params.id));
      setNews(data);
    } catch (err) {
      console.error('Failed to load news:', err);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    api.getProducts().then(setProducts).catch(() => {});
    loadNews();
  }, [loadNews]);

  const handleWebSocketMessage = useCallback((message: unknown) => {
    const msg = message as { type: string; data: Record<string, unknown> };
    if (msg.type === 'news_update') {
      const newsId = msg.data.id as number;
      if (newsId === parseInt(params.id)) {
        loadNews();
      }
    } else if (msg.type === 'analysis_update') {
      const newsId = msg.data.news_id as number;
      if (newsId === parseInt(params.id)) {
        loadNews();
      }
    }
  }, [params.id, loadNews]);

  const wsUrl = typeof window !== 'undefined' 
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8000/ws`
    : '';
  
  useWebSocket({
    url: wsUrl,
    onMessage: handleWebSocketMessage,
    reconnect: true,
  });

  const handleRetry = async () => {
    if (!news) return;
    setRetrying(true);
    try {
      await api.retryAnalysis(news.id);
      setTimeout(loadNews, 2000);
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (!news) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">News not found</p>
        <Link href="/" className="text-blue-600 hover:text-blue-800 mt-4 inline-block">
          ← Back to News
        </Link>
      </div>
    );
  }

  const date = parseDate(news.published_date);
  const hasAnalyses = news.analyses && news.analyses.length > 0;
  const isAnalyzing = news.analysis_status === 'analyzing';
  const isPending = news.analysis_status === 'pending';
  const isFailed = news.analysis_status === 'failed';

  return (
    <div>
      <Link 
        href={highlightProduct ? `/products/${highlightProduct}` : '/'} 
        className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        ← {highlightProduct ? `Back to ${highlightProduct}` : 'Back to News'}
      </Link>

      <article className="bg-white rounded-lg shadow-sm border p-8 mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{news.title}</h1>
        
        <div className="flex items-center gap-4 text-sm text-gray-500 mb-6">
          <span className="font-medium text-blue-600">{news.source}</span>
          <span>{format(date, 'MMMM d, yyyy HH:mm')}</span>
        </div>

        {news.summary && (
          <p className="text-gray-700 mb-4">{news.summary}</p>
        )}

        {news.content && (
          <p className="text-gray-600">{news.content}</p>
        )}

        <div className="mt-6 pt-6 border-t">
          <a 
            href={news.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            Read original article →
          </a>
        </div>
      </article>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Impact Analysis
            {hasAnalyses && (
              <span className="text-gray-500 font-normal ml-2">
                ({news.analyses!.length} products affected)
              </span>
            )}
          </h2>
          
          {isAnalyzing && (
            <span className="flex items-center gap-2 px-3 py-1 rounded text-sm font-medium bg-blue-100 text-blue-800">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing...
            </span>
          )}
          
          {isPending && (
            <span className="px-3 py-1 rounded text-sm font-medium bg-yellow-100 text-yellow-800">
              Queued for analysis
            </span>
          )}
          
          {isFailed && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex items-center gap-2 px-3 py-1 rounded text-sm font-medium bg-red-100 text-red-800 hover:bg-red-200 transition-colors disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Retry Analysis
            </button>
          )}
        </div>

        {!hasAnalyses ? (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            {isAnalyzing ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
                <p className="text-gray-500">Analyzing impact on products...</p>
                <p className="text-gray-400 text-sm mt-1">This may take up to 2 minutes</p>
              </div>
            ) : isPending ? (
              <div className="text-center py-8">
                <p className="text-gray-500">Waiting in queue for analysis...</p>
              </div>
            ) : isFailed ? (
              <div className="text-center py-8">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                <p className="text-red-600">Analysis failed</p>
                <p className="text-gray-400 text-sm mt-1">Click retry above to try again</p>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-500">This news doesn't affect any tracked products.</p>
                <p className="text-gray-400 text-sm mt-1">The AI determined no relevant impact on our product portfolio.</p>
              </div>
            )}
          </div>
        ) : highlightProduct ? (
          (() => {
            const highlightedAnalysis = news.analyses!.find(a => a.product_code === highlightProduct);
            const otherAnalyses = news.analyses!.filter(a => a.product_code !== highlightProduct);
            const highlightedProduct = productMap.get(highlightProduct);
            
            return (
              <div className="space-y-4">
                {highlightedAnalysis && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                      <span className="text-sm font-medium text-yellow-700">
                        Impact on {highlightedProduct?.name || highlightProduct}
                      </span>
                    </div>
                    <AnalysisCard 
                      analysis={highlightedAnalysis} 
                      productMap={productMap} 
                      highlighted={true}
                    />
                  </div>
                )}
                
                {otherAnalyses.length > 0 && (
                  <>
                    <div className="relative py-4">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-300"></div>
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-gray-50 px-3 text-sm text-gray-500">
                          Other affected products ({otherAnalyses.length})
                        </span>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      {otherAnalyses.map((analysis) => (
                        <AnalysisCard 
                          key={analysis.id} 
                          analysis={analysis} 
                          productMap={productMap} 
                          highlighted={false}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()
        ) : (
          <div className="space-y-3">
            {news.analyses!.map((analysis) => (
              <AnalysisCard 
                key={analysis.id} 
                analysis={analysis} 
                productMap={productMap} 
                highlighted={false}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
