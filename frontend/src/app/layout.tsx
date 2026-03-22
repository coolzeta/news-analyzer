import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market News Intelligence',
  description: 'Monitor market news and analyze impact on financial products',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex">
                <a href="/" className="flex items-center">
                  <span className="text-xl font-bold text-primary-600">Market News</span>
                </a>
                <div className="hidden sm:flex sm:ml-6 sm:space-x-8">
                  <a href="/" className="inline-flex items-center px-1 pt-1 text-gray-900 hover:text-primary-600">
                    News
                  </a>
                  <a href="/products" className="inline-flex items-center px-1 pt-1 text-gray-500 hover:text-primary-600">
                    Products
                  </a>
                  <a href="/analytics" className="inline-flex items-center px-1 pt-1 text-gray-500 hover:text-primary-600">
                    Analytics
                  </a>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-24">
          {children}
        </main>
      </body>
    </html>
  );
}
