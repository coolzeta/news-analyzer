'use client';

import { api, HeatmapResponse, TrendsResponse } from '@/lib/api';
import { useState, useEffect, useCallback } from 'react';
import { Loader2, TrendingUp, TrendingDown, Minus, Calendar } from 'lucide-react';
import Link from 'next/link';
import { format, subDays } from 'date-fns';
import { ResponsiveHeatMap } from '@nivo/heatmap';
import { ResponsiveLine } from '@nivo/line';

function SentimentHeatmap({ data }: { data: HeatmapResponse }) {
  const productCodes = Object.keys(data.products);
  const dates = data.data.map(d => d.date);
  
  const heatmapData = productCodes.map(code => ({
    id: code,
    data: dates.map(date => {
      const dayData = data.data.find(d => d.date === date);
      const productData = dayData?.products[code];
      const total = productData?.total || 0;
      const positive = productData?.Positive || 0;
      const negative = productData?.Negative || 0;
      const score = total > 0 ? (positive - negative) / total : 0;
      return {
        x: format(new Date(date), 'MM/dd'),
        y: score,
        total,
        positive,
        negative,
        neutral: productData?.Neutral || 0,
      };
    }),
  }));

  const getProductName = (code: string) => data.products[code]?.name || code;

  if (heatmapData.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No data available for heatmap
      </div>
    );
  }

  return (
    <div className="h-96">
      <ResponsiveHeatMap
        data={heatmapData}
        margin={{ top: 60, right: 30, bottom: 60, left: 100 }}
        valueFormat=".2f"
        xInnerPadding={0.1}
        yInnerPadding={0.1}
        colors={{
          type: 'diverging',
          scheme: 'red_yellow_green',
          divergeAt: 0.5,
        }}
        emptyColor="#f3f4f6"
        axisTop={{
          tickSize: 5,
          tickPadding: 5,
          tickRotation: -45,
        }}
        axisLeft={{
          tickSize: 5,
          tickPadding: 5,
          tickRotation: 0,
          format: (code) => code,
        }}
        tooltip={({ cell }) => (
          <div className="bg-gray-900 text-white px-3 py-2 rounded text-xs">
            <div className="font-medium mb-1">{getProductName(cell.serieId as string)}</div>
            <div className="text-gray-400 text-[10px] mb-1">{cell.serieId}</div>
            <div>Score: {cell.formattedValue}</div>
            <div>Total: {cell.data.total}</div>
            <div className="flex gap-2 mt-1">
              <span className="text-green-400">+{cell.data.positive}</span>
              <span className="text-red-400">-{cell.data.negative}</span>
              <span className="text-gray-400">~{cell.data.neutral}</span>
            </div>
          </div>
        )}
        theme={{
          text: { fill: '#64748b', fontSize: 11 },
          axis: {
            ticks: { line: { stroke: '#e2e8f0' } },
          },
        }}
      />
    </div>
  );
}

function SentimentTrendChart({ data }: { data: TrendsResponse }) {
  if (!data.trends || data.trends.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No trend data available
      </div>
    );
  }

  const chartData = [
    {
      id: 'Positive',
      color: '#22c55e',
      data: data.trends.map(t => ({
        x: t.period,
        y: t.Positive,
      })),
    },
    {
      id: 'Negative',
      color: '#ef4444',
      data: data.trends.map(t => ({
        x: t.period,
        y: t.Negative,
      })),
    },
    {
      id: 'Neutral',
      color: '#6b7280',
      data: data.trends.map(t => ({
        x: t.period,
        y: t.Neutral,
      })),
    },
  ];

  return (
    <div className="h-80">
      <ResponsiveLine
        data={chartData}
        margin={{ top: 20, right: 110, bottom: 60, left: 60 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 0, max: 'auto' }}
        curve="monotoneX"
        axisTop={null}
        axisRight={null}
        axisBottom={{
          tickSize: 5,
          tickPadding: 5,
          tickRotation: -45,
        }}
        axisLeft={{
          tickSize: 5,
          tickPadding: 5,
        }}
        colors={{ datum: 'color' }}
        lineWidth={2}
        pointSize={4}
        pointColor={{ from: 'color' }}
        pointBorderWidth={2}
        pointBorderColor={{ from: 'color' }}
        pointLabelYOffset={-12}
        enableArea
        areaOpacity={0.1}
        legends={[
          {
            anchor: 'bottom-right',
            direction: 'column',
            translateX: 100,
            itemWidth: 80,
            itemHeight: 20,
            symbolSize: 12,
            symbolShape: 'circle',
          },
        ]}
        theme={{
          text: { fill: '#64748b', fontSize: 11 },
          axis: {
            ticks: { line: { stroke: '#e2e8f0' } },
          },
          grid: { line: { stroke: '#f1f5f9' } },
        }}
      />
    </div>
  );
}

export default function AnalyticsPage() {
  const [heatmapData, setHeatmapData] = useState<HeatmapResponse | null>(null);
  const [trendsData, setTrendsData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [trendDays, setTrendDays] = useState(30);
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [heatmap, trends] = await Promise.all([
        api.getSentimentHeatmap({ days }),
        api.getSentimentTrends({ days: trendDays, granularity }),
      ]);
      setHeatmapData(heatmap);
      setTrendsData(trends);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [days, trendDays, granularity]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summaryStats = trendsData?.trends.reduce(
    (acc, t) => ({
      total: acc.total + t.total,
      positive: acc.positive + t.Positive,
      negative: acc.negative + t.Negative,
      neutral: acc.neutral + t.Neutral,
    }),
    { total: 0, positive: 0, negative: 0, neutral: 0 }
  );

  const avgSentiment = summaryStats && summaryStats.total > 0
    ? ((summaryStats.positive - summaryStats.negative) / summaryStats.total).toFixed(2)
    : '0.00';

  const sentimentColor = parseFloat(avgSentiment) > 0.1
    ? 'text-green-600'
    : parseFloat(avgSentiment) < -0.1
    ? 'text-red-600'
    : 'text-gray-600';

  const SentimentIcon = parseFloat(avgSentiment) > 0.1
    ? TrendingUp
    : parseFloat(avgSentiment) < -0.1
    ? TrendingDown
    : Minus;

  return (
    <div>
      <div className="mb-8">
        <Link href="/" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
          ← Back to News
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Portfolio Analytics</h1>
        <p className="text-gray-600 mt-2">Sentiment heatmap and historical trends across your product portfolio</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <label className="text-sm font-medium text-gray-700">Heatmap:</label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border rounded-md px-3 py-1.5 text-sm"
            >
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Trends:</label>
            <select
              value={trendDays}
              onChange={(e) => setTrendDays(Number(e.target.value))}
              className="border rounded-md px-3 py-1.5 text-sm"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Granularity:</label>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as 'day' | 'week')}
              className="border rounded-md px-3 py-1.5 text-sm"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-600">Loading analytics...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <p className="text-sm text-gray-500 mb-1">Total Analyses</p>
              <p className="text-2xl font-bold text-gray-900">{summaryStats?.total || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <p className="text-sm text-gray-500 mb-1">Positive</p>
              <p className="text-2xl font-bold text-green-600">{summaryStats?.positive || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <p className="text-sm text-gray-500 mb-1">Negative</p>
              <p className="text-2xl font-bold text-red-600">{summaryStats?.negative || 0}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <p className="text-sm text-gray-500 mb-1">Avg Sentiment</p>
              <div className="flex items-center gap-2">
                <SentimentIcon className={`w-5 h-5 ${sentimentColor}`} />
                <p className={`text-2xl font-bold ${sentimentColor}`}>{avgSentiment}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Sentiment Heatmap</h2>
            <p className="text-sm text-gray-500 mb-4">
              Color intensity indicates sentiment score: <span className="text-green-600">green</span> = positive, <span className="text-red-600">red</span> = negative
            </p>
            {heatmapData ? (
              <SentimentHeatmap data={heatmapData} />
            ) : (
              <div className="text-center py-8 text-gray-500">No heatmap data available</div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Historical Trends</h2>
            <p className="text-sm text-gray-500 mb-4">
              Sentiment distribution over time
            </p>
            {trendsData ? (
              <SentimentTrendChart data={trendsData} />
            ) : (
              <div className="text-center py-8 text-gray-500">No trend data available</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
