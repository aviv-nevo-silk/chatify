import { defineConfig } from "vite";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const certPath = resolve(__dirname, "cert.pem");
const keyPath = resolve(__dirname, "key.pem");
const httpsConfig =
  existsSync(certPath) && existsSync(keyPath)
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined;

export default defineConfig({
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
        dev: resolve(__dirname, "dev.html"),
        taskpane: resolve(__dirname, "taskpane.html"),
        viewer: resolve(__dirname, "viewer.html"),
      },
    },
  },
});
