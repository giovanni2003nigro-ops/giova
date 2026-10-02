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
        name: 'Giova Fit – Sport, Ligen & Ernährung',
        short_name: 'Giova Fit',
        description: 'Laufen, Hyrox, Schwimmen, Gym & Co. aufzeichnen, in Ligen antreten und mit KI-Ernährungsplan trainieren',
        lang: 'de',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
