import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // The backend writes its search index and database into the project folder. Without this,
        // every upload makes Vite reload the page and the app jumps back to the first screen.
        ignored: [
          '**/backend/**',
          '**/vector_index.faiss',
          '**/vector_metadata.json',
          '**/*.db',
          '**/*.db-journal',
        ],
      },
      // Proxy API calls to the FastAPI backend
      proxy: {
        '/documents': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/router': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/query': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/index': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/graph': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/auth': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/health': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/admin': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        // --- new: Efficiency & Chunks page ---
        '/chunks': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/metrics': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  };
});