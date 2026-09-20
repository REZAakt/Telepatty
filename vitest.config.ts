import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
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


