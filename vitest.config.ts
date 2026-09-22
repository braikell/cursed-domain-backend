import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["../godot-backend-tests/**/*.test.ts"],
  },
});
