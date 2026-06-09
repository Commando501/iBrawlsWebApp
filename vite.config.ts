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
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Otherwise ignore the local Worker D1 state: `wrangler dev --local` writes to
      // worker/.wrangler on every account/config request, which would otherwise trip
      // Vite into an endless full-reload loop while both dev servers run together.
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : { ignored: ['**/.wrangler/**'] },
    },
    build: {
      // This workspace has had Windows EPERM locks on stale dist assets. Do not
      // block production builds on cleanup; npm run clean remains available.
      emptyOutDir: false,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          mapmaker: path.resolve(__dirname, 'mapmaker.html'),
          animationEditor: path.resolve(__dirname, 'animation-editor.html'),
          armorModelEditor: path.resolve(__dirname, 'armor-model-editor.html'),
        },
      },
    },
  };
});
