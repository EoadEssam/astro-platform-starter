// Every page and API route of the template demo. None of them lives in src/pages,
// so a route exists only when the integration in ./integration.mjs registers it.
export const demoRoutes = [
    { pattern: '/demo', entrypoint: 'src/demo/pages/index.astro' },
    { pattern: '/revalidation', entrypoint: 'src/demo/pages/revalidation.astro' },
    { pattern: '/image-cdn', entrypoint: 'src/demo/pages/image-cdn.astro' },
    { pattern: '/edge', entrypoint: 'src/demo/pages/edge/index.astro' },
    { pattern: '/edge/australia', entrypoint: 'src/demo/pages/edge/australia/index.astro' },
    { pattern: '/edge/not-australia', entrypoint: 'src/demo/pages/edge/not-australia/index.astro' },
    { pattern: '/blobs', entrypoint: 'src/demo/pages/blobs/index.astro' },
    { pattern: '/api/blob', entrypoint: 'src/demo/pages/api/blob.ts' },
    { pattern: '/api/blobs', entrypoint: 'src/demo/pages/api/blobs.ts' },
    { pattern: '/api/revalidate', entrypoint: 'src/demo/pages/api/revalidate.ts' }
];

// Links shown in the header while the demo is on
export const demoNavItems = [
    { linkText: 'Demo', href: '/demo' },
    { linkText: 'Revalidation', href: '/revalidation' },
    { linkText: 'Image CDN', href: '/image-cdn' },
    { linkText: 'Edge Function', href: '/edge' },
    { linkText: 'Blobs', href: '/blobs' }
];
