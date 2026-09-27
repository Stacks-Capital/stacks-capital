import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// 5173 belongs to Playwright and 5180 to the app, so the landing page takes its own port.
export default defineConfig({
  plugins: [tailwindcss()],
  server: { port: 5190, strictPort: true },
});
