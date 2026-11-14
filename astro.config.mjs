import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import demo from './src/demo/integration.mjs';

// https://astro.build/config
export default defineConfig({
    // Netlify sets URL to the site's main address at build time; used for canonical URLs and the sitemap
    site: process.env.URL,
    vite: {
        plugins: [tailwindcss()]
    },
    // The template demo (pages, API routes) is only built when DEMO_ENABLED=true, see src/demo/README.md
    integrations: [react(), sitemap(), demo()],
    adapter: netlify({
        devFeatures: {
            environmentVariables: true
        }
    })
});
