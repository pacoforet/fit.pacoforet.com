// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://fit.pacoforet.com",
  vite: {
    plugins: [tailwindcss()],
  },
});
