import { defineConfig } from "vitest/config";

// integration test ใช้ PostgreSQL จริง (TEST_DATABASE_URL) — ไม่ตั้งค่าไว้เทสจะถูกข้าม
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  test: {
    include: ["src/**/*.itest.ts"],
    environment: "node",
    fileParallelism: false,
    globalSetup: "./src/test/global-setup.ts",
    setupFiles: ["./src/test/integration-setup.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url).pathname,
    },
  },
});
