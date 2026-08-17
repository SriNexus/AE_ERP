import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type TerserOptions } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:3000',
        changeOrigin: true,
        // Local dev runs Vite only; the API (api/* Vercel functions) is served
        // by `vercel dev` on the proxy target. When that server is not running,
        // http-proxy emits an error and Vite would otherwise surface a raw 500
        // for every /api/* call (e.g. POST /api/demo-reset). Return an explicit,
        // diagnosable JSON error instead of a misleading generic 500 so the
        // console makes the root cause clear.
        configure(proxy) {
          proxy.on('error', (err, _req, res) => {
            console.error(`[api-proxy] upstream error: ${err.message}`);
            const serverResponse = res as unknown as { writeHead?: (code: number, headers: Record<string, string>) => void; headersSent?: boolean; end?: (chunk?: string) => void };
            if (typeof serverResponse.writeHead !== 'function' || typeof serverResponse.end !== 'function') return;
            if (!serverResponse.headersSent) {
              serverResponse.writeHead(502, { 'Content-Type': 'application/json' });
            }
            serverResponse.end(JSON.stringify({
              success: false,
              error: {
                code: 'API_SERVER_UNAVAILABLE',
                message: 'API server unavailable: start `vercel dev` (or set VITE_API_PROXY to the deployed API) so /api/* can be served.',
              },
            }));
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/firestore", "firebase/auth"],
          // Data layer
          "vendor-query":    ["@tanstack/react-query", "zustand"],
          // UI / charts (keep separate — loaded async by recharts pages)
          "vendor-ui":       ["recharts", "lucide-react"],
          // Utilities
          "vendor-utils":    ["react-hot-toast", "clsx", "tailwind-merge"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
    // Minification
    minify: "esbuild",
    terserOptions: { compress: { drop_debugger: true } } as unknown as TerserOptions,
    // Source maps for production debugging (disable for final prod)
    sourcemap: false,
  },
  esbuild: { drop: ["debugger"] },
  // Optimize deps pre-bundling
  optimizeDeps: {
    include: [
      "react", "react-dom", "react-router-dom",
      "@tanstack/react-query", "zustand",
      "react-hot-toast", "lucide-react",
    ],
  },
});
