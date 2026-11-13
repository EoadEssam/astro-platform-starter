import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
    // Netlify sets URL to the site's main address at build time; used for canonical URLs and the sitemap
    site: process.env.URL,
    vite: {
        plugins: [tailwindcss()]
    },
    integrations: [react(), sitemap()],
    adapter: netlify({
        devFeatures: {
            environmentVariables: true
        }
    })
});
