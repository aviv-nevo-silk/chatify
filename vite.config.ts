import { defineConfig } from "vite";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const certPath = resolve(__dirname, "cert.pem");
const keyPath = resolve(__dirname, "key.pem");
const httpsConfig =
  existsSync(certPath) && existsSync(keyPath)
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined;

// For GitHub Pages: site lives at https://<user>.github.io/<repo>/
// Set CHATIFY_BASE=/chatify/ at build time to prefix all asset URLs.
const base = process.env.CHATIFY_BASE ?? "/";

export default defineConfig({
  base,
  server: {
    https: httpsConfig,
    host: true,
    port: 3000,
    fs: {
      allow: [".."],
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        dev: resolve(__dirname, "dev.html"),
        taskpane: resolve(__dirname, "taskpane.html"),
        viewer: resolve(__dirname, "viewer.html"),
        commands: resolve(__dirname, "commands.html"),
      },
    },
  },
});
