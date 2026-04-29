'use client';

import { api } from '@/lib/api';
import { Product, NewsWithAnalysis } from '@/types';
import { format } from 'date-fns';
import Link from 'next/link';
import { notFound, useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { Loader2, ChevronDown } from 'lucide-react';

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

function ImpactCard({ news, analysis, productCode }: { news: NewsWithAnalysis; analysis: { relevance_score: number; sentiment: string; impact_summary: string }; productCode: string }) {
  const date = parseDate(news.published_date);
  
  return (
    <Link href={`/news/${news.id}?product=${productCode}`}>
      <div className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2">{news.title}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{news.source}</span>
              <span>•</span>
              <span>{format(date, 'MMM d, yyyy')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
            <SentimentBadge sentiment={analysis.sentiment} />
            <span className="text-sm font-medium text-gray-600">{analysis.relevance_score}/10</span>
          </div>
        </div>
        <p className="text-gray-600 text-sm line-clamp-2">{analysis.impact_summary}</p>
      </div>
    </Link>
  );
}

const RELEVANCE_OPTIONS = [
  { value: 0, label: 'All (0+)' },
  { value: 1, label: 'Low (1+)' },
  { value: 3, label: 'Medium (3+)' },
  { value: 5, label: 'High (5+)' },
  { value: 7, label: 'Very High (7+)' },
];

function ProductDetailContent({ code }: { code: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRelevance = parseInt(searchParams.get('min_relevance') || '0', 10);
  
  const [product, setProduct] = useState<Product | null>(null);
  const [impacts, setImpacts] = useState<NewsWithAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [minRelevance, setMinRelevance] = useState(initialRelevance);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getProduct(code),
      api.getProductImpacts(code, minRelevance),
    ])
      .then(([productData, impactsData]) => {
        setProduct(productData);
        setImpacts(impactsData);
      })
      .catch(() => {
        setProduct(null);
      })
      .finally(() => setLoading(false));
  }, [code, minRelevance]);

  const handleRelevanceChange = (value: number) => {
    setMinRelevance(value);
    const params = new URLSearchParams();
    if (value > 0) {
      params.set('min_relevance', String(value));
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (!product) {
    notFound();
  }

  const analyses = impacts
    .flatMap((news) => news.analyses || [])
    .filter((a) => a.product_code === product.code);

  return (
    <div>
      <Link href="/products" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
        ← Back to Products
      </Link>

      <div className="bg-white rounded-lg shadow-sm border p-8 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="px-3 py-1 text-sm font-mono bg-blue-100 text-blue-700 rounded">
            {product.code}
          </span>
          <span className="text-gray-400 text-sm">•</span>
          <span className="text-sm text-gray-500">{product.asset_class || 'N/A'}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{product.name}</h1>
        
        <div className="flex flex-wrap gap-3">
          {product.sector && (
            <span className="px-3 py-1 bg-gray-100 rounded text-sm text-gray-700">
              {product.sector}
            </span>
          )}
          {product.domicile && (
            <span className="px-3 py-1 bg-gray-100 rounded text-sm text-gray-700">
              {product.domicile}
            </span>
          )}
        </div>

        {product.background && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <h3 className="text-sm font-medium text-blue-800 mb-2">Background</h3>
            <p className="text-sm text-blue-900 whitespace-pre-wrap">{product.background}</p>
          </div>
        )}
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Recent News Impact ({analyses.length} items)
          </h2>
          
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Min Relevance:</label>
            <div className="relative">
              <select
                value={minRelevance}
                onChange={(e) => handleRelevanceChange(parseInt(e.target.value, 10))}
                className="appearance-none bg-white border rounded-md px-3 py-1.5 pr-8 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {RELEVANCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {analyses.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <p className="text-gray-500 text-center">No relevant news found for this product with current filter.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {impacts.map((news) => {
              const analysis = news.analyses?.find((a) => a.product_code === product.code);
              if (!analysis) return null;
              return <ImpactCard key={news.id} news={news} analysis={analysis} productCode={product.code} />;
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default function ProductDetailPage({ params }: { params: { code: string } }) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Loading...</span>
      </div>
    }>
      <ProductDetailContent code={params.code} />
    </Suspense>
  );
}
