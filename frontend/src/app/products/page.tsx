import { api } from '@/lib/api';
import { Product } from '@/types';
import Link from 'next/link';

async function getProducts() {
  try {
    return await api.getProducts();
  } catch {
    return [];
  }
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Link href={`/products/${product.code}`}>
      <div className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-1 text-xs font-mono bg-blue-100 text-blue-700 rounded">
            {product.code}
          </span>
          {product.asset_class && (
            <span className="text-xs text-gray-500">{product.asset_class}</span>
          )}
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{product.name}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {product.sector && (
            <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">{product.sector}</span>
          )}
          {product.domicile && (
            <span className="text-gray-500">{product.domicile}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Products</h1>
        <p className="text-gray-600 mt-2">Financial products tracked for news impact analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
