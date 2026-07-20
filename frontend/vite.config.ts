import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { 
        target: 'http://localhost:5000', 
        changeOrigin: true,
        secure: false,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('proxying:', req.method, req.url, 'to', options.target);
          });
        }
      },
      '/socket.io': { target: 'http://localhost:5000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor libs into separate cacheable chunks
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-query':   ['@tanstack/react-query'],
          'vendor-charts':  ['recharts'],
          'vendor-motion':  ['framer-motion'],
          'vendor-socket':  ['socket.io-client'],
          'vendor-forms':   ['react-hook-form', 'zod', '@hookform/resolvers'],
          'vendor-zustand': ['zustand'],
          'vendor-utils':   ['axios', 'date-fns', 'clsx', 'tailwind-merge'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    minify: 'esbuild',
  },
});
