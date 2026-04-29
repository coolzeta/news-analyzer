'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { Product } from '@/types';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { ProductForm } from './ProductForm';

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      const data = await api.getProducts();
      setProducts(data);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleCreate = async (data: Omit<Product, 'id'>) => {
    await api.createProduct(data);
    setShowForm(false);
    await fetchProducts();
  };

  const handleUpdate = async (data: Omit<Product, 'id'>) => {
    if (!editingProduct) return;
    await api.updateProduct(editingProduct.code, data);
    setEditingProduct(null);
    await fetchProducts();
  };

  const handleDelete = async (code: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProduct(code);
      setDeleteConfirm(null);
      await fetchProducts();
    } catch (err: any) {
      setDeleteError(
        err?.message || 'Failed to delete product. It may have associated analyses.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleForceDelete = async (code: string) => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProduct(code, true);
      setDeleteConfirm(null);
      await fetchProducts();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete product.');
    } finally {
      setDeleting(false);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-600 mt-2">
            Manage financial products tracked for news impact analysis
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      {deleteError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm flex items-start justify-between">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p>{deleteError}</p>
              {deleteConfirm && (
                <button
                  onClick={() => handleForceDelete(deleteConfirm)}
                  disabled={deleting}
                  className="mt-2 text-red-700 underline hover:text-red-900 text-sm"
                >
                  Force delete (including associated analyses)
                </button>
              )}
            </div>
          </div>
          <button onClick={() => setDeleteError(null)} className="text-red-400 hover:text-red-600 ml-4">
            &times;
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((product) => (
          <div
            key={product.id}
            className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <Link href={`/products/${product.code}`}>
                  <span className="px-2 py-1 text-xs font-mono bg-blue-100 text-blue-700 rounded hover:bg-blue-200 cursor-pointer">
                    {product.code}
                  </span>
                </Link>
                {product.asset_class && (
                  <span className="text-xs text-gray-500">{product.asset_class}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditingProduct(product)}
                  className="p-1 text-gray-400 hover:text-blue-600 rounded"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteConfirm(product.code);
                  }}
                  className="p-1 text-gray-400 hover:text-red-600 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <Link href={`/products/${product.code}`}>
              <h2 className="text-lg font-semibold text-gray-900 mb-2 hover:text-blue-600 cursor-pointer">
                {product.name}
              </h2>
            </Link>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {product.sector && (
                <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                  {product.sector}
                </span>
              )}
              {product.domicile && (
                <span className="text-gray-500">{product.domicile}</span>
              )}
            </div>

            {product.background && (
              <p className="mt-3 text-sm text-gray-500 line-clamp-2">
                {product.background.substring(0, 120)}
                {product.background.length > 120 ? '...' : ''}
              </p>
            )}
          </div>
        ))}
      </div>

      {products.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No products yet. Click &quot;Add Product&quot; to get started.
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {(showForm || editingProduct) && (
        <ProductForm
          product={editingProduct}
          onSubmit={editingProduct ? handleUpdate : handleCreate}
          onCancel={() => {
            setShowForm(false);
            setEditingProduct(null);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Delete Product</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Are you sure you want to delete <strong>{deleteConfirm}</strong>? This action cannot
                  be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
