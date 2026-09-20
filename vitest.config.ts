import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Nuxt aliases so app/composables (and stores) are importable in tests
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '@@': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app/', import.meta.url)),
      '@': fileURLToPath(new URL('./app/', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['core/**/*.test.ts', 'app/**/*.test.ts'],
    testTimeout: 15_000,
  },
  define: {
    // composables guarded by import.meta.client are testable under happy-dom
    'import.meta.client': 'true',
    'import.meta.server': 'false',
  },
})


