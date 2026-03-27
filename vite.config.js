import { defineConfig } from "vite";

const getGithubPagesBase = () => {
  const repository = process.env.GITHUB_REPOSITORY;

  if (!repository) {
    return "/";
  }

  const repoName = repository.split("/")[1] ?? "";

  if (repoName.endsWith(".github.io")) {
    return "/";
  }

  return `/${repoName}/`;
};

export default defineConfig({
  base: process.env.VITE_BASE_PATH || getGithubPagesBase(),
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
