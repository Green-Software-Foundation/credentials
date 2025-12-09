// @ts-check
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import netlify from "@astrojs/netlify";

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
  integrations: [react()],
  adapter: netlify(),
  output: "server",
});
