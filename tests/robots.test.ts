import type { APIContext } from 'astro';
import { describe, expect, it } from 'vitest';
import { GET } from '../src/pages/robots.txt';

const robots = async (site?: string) => {
    const response = await GET({ site: site ? new URL(site) : undefined } as unknown as APIContext);
    return { contentType: response.headers.get('content-type'), text: await response.text() };
};

describe('GET /robots.txt', () => {
    it('allows crawling pages but not the API routes', async () => {
        const { contentType, text } = await robots();

        expect(contentType).toContain('text/plain');
        expect(text.split('\n')).toEqual(expect.arrayContaining(['User-agent: *', 'Allow: /', 'Disallow: /api/']));
    });

    it('points to the sitemap when the site address is known', async () => {
        const { text } = await robots('https://example.netlify.app');

        expect(text).toContain('Sitemap: https://example.netlify.app/sitemap-index.xml\n');
    });

    it('omits the sitemap line when the site address is unknown', async () => {
        const { text } = await robots();

        expect(text).not.toContain('Sitemap');
    });
});
