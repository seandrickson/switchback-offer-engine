import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    typecheck: {
      include: ['src/**/*.test-d.ts'],
    },
  },
})
