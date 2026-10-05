import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the web app runs on :5173 and proxies API calls to :4000, so
// the browser sees a single origin (cookies and CSRF checks behave as in production).
export default defineConfig({
  plugins: [react()],
  build: {
    // Small files are normally embedded in the stylesheet as data: URLs. The
    // content security policy only allows fonts from our own origin, so fonts
    // always stay separate files.
    assetsInlineLimit: (filePath) => (/\.woff2?$/.test(filePath) ? false : undefined),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:4000", xfwd: true },
    },
  },
});
