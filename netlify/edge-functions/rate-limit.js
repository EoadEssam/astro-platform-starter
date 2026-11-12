// The API routes are public, so cap how often a single visitor can call them.
// The limit is enforced by Netlify from the config below; the function itself
// does nothing and lets the request continue to the Astro server function.
export default async () => {};

export const config = {
    path: '/api/*',
    rateLimit: {
        // Up to 60 requests per 60 seconds, counted per IP address
        windowLimit: 60,
        windowSize: 60,
        aggregateBy: ['ip', 'domain']
    }
};
