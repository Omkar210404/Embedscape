import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The dev server injects inline scripts for hot reload, so the CSP only goes into production builds.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function cspMeta(): Plugin {
  return {
    name: "embedscape-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /embedscape/. Override with BASE_PATH for other hosts.
  base: process.env.BASE_PATH ?? "/embedscape/",
  plugins: [cspMeta()],
  // three.js is most of the bundle (~585 kB raw, ~150 kB gzip); one chunk is fine for a single-page app.
  build: { target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 700 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
