import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Порт 1432: 1430 занят YummyAnime Desktop, 1431 — pc_wrapped.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // Не следим за src-tauri: туда пишет компилятор Rust, и Vite ругается на занятые файлы.
  server: { port: 1432, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'] },
});
