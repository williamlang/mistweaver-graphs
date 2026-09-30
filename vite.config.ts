import { defineConfig } from 'vite'

// Relative asset paths, so the built site works wherever it is served from
// (https://<user>.github.io/<repo>/ on GitHub Pages, or a local preview).
export default defineConfig({
  base: './',
})
