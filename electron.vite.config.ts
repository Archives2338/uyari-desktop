import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(import.meta.dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        // Segundo entry: el utilityProcess de audio. electron-vite emite
        // out/main/index.js y out/main/audio-worker.js (más chunks compartidos).
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'audio-worker': resolve(import.meta.dirname, 'src/main/workers/audio-worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
      },
    },
  },
})
