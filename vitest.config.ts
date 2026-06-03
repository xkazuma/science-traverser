import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  // vite-plugin-vuetify resolves Vuetify component auto-imports (<v-app>,
  // <v-btn>, ...) so chrome component tests render real Vuetify markup.
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    // Vuetify ships untranspiled .css/SFC bits; let Vite process them.
    server: { deps: { inline: ['vuetify'] } },
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
  },
})
