import { defineConfig } from "vite";

// GitHub Pages 部署在 https://<user>.github.io/<repo>/ 子路径，
// 使用相对 base 让构建产物在任意路径下都能加载。
export default defineConfig({
  base: "./",
});
