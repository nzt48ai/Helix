import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          typeof warning.id === "string" &&
          warning.id.includes("framer-motion")
        ) {
          return;
        }
        warn(warning);
      },
    },
  },
});
