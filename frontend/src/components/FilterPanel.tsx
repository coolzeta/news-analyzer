'use client';

import { useState, useEffect } from 'react';
import { Product, Sentiment } from '@/types';

interface FilterPanelProps {
  onFilterChange: (filters: FilterState) => void;
}

export interface FilterState {
  sentiment: Sentiment | '';
  productCode: string;
  minRelevance: number;
  dateFrom: string;
  dateTo: string;
}

export function FilterPanel({ onFilterChange }: FilterPanelProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    sentiment: '',
    productCode: '',
    minRelevance: 0,
    dateFrom: '',
    dateTo: '',
  });

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/products`);
        if (response.ok) {
          const data = await response.json();
          setProducts(data);
        }
      } catch (error) {
        console.error('Failed to fetch products:', error);
      }
    };
    fetchProducts();
  }, []);

  useEffect(() => {
    onFilterChange(filters);
  }, [filters, onFilterChange]);

  const handleReset = () => {
    setFilters({
      sentiment: '',
      productCode: '',
      minRelevance: 0,
      dateFrom: '',
      dateTo: '',
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
        <button
          onClick={handleReset}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Reset All
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Sentiment Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sentiment
          </label>
          <select
            value={filters.sentiment}
            onChange={(e) => setFilters({ ...filters, sentiment: e.target.value as Sentiment | '' })}
            className="w-full rounded-md border-gray-300 border p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All</option>
            <option value="Positive">Positive</option>
            <option value="Negative">Negative</option>
            <option value="Neutral">Neutral</option>
          </select>
        </div>

        {/* Product Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Product
          </label>
          <select
            value={filters.productCode}
            onChange={(e) => setFilters({ ...filters, productCode: e.target.value })}
            className="w-full rounded-md border-gray-300 border p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Products</option>
            {products.map((product) => (
              <option key={product.code} value={product.code}>
                {product.code}
              </option>
            ))}
          </select>
        </div>

        {/* Min Relevance Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Min Relevance: {filters.minRelevance}
          </label>
          <input
            type="range"
            min="0"
            max="10"
            value={filters.minRelevance}
            onChange={(e) => setFilters({ ...filters, minRelevance: parseInt(e.target.value) })}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Date From Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date From
          </label>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            className="w-full rounded-md border-gray-300 border p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Date To Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date To
          </label>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            className="w-full rounded-md border-gray-300 border p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
