import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    host: true,
    port: 4321
  },
  vite: {
    plugins: [tailwindcss()]
  }
});
