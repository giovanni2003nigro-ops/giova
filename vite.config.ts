/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Für GitHub Pages wird BASE_PATH (z. B. "/giova/") im Workflow gesetzt.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Giova Fit – Training, Ernährung & Schlaf',
        short_name: 'Giova Fit',
        description: 'Trainings-, Ernährungs- und Schlaftracker mit KI-Coach',
        lang: 'de',
        theme_color: '#1a1a19',
        background_color: '#0d0d0d',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    // Anthropic-SDK + Zod machen das Bundle groß; es wird vom Service Worker offline gecacht.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
  },
});
