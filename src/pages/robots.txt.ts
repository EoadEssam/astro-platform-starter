import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
    const lines = ['User-agent: *', 'Allow: /', 'Disallow: /api/'];
    // The sitemap is only generated when the site's address is known, see astro.config.mjs
    if (site) lines.push('', `Sitemap: ${new URL('sitemap-index.xml', site)}`);
    return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
