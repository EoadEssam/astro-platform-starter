// Part of the template demo: rewrites /edge to a page chosen by the visitor's country.
// While the demo is off (DEMO_ENABLED is not "true") the request passes through untouched,
// and since the /edge pages are not built either, the visitor gets the site's 404.
const isDemoEnabled = () => globalThis.Netlify?.env.get('DEMO_ENABLED')?.toLowerCase() === 'true';

export default async (request, context) => {
    if (!isDemoEnabled()) return;

    const path = context.geo?.country?.code === 'AU' ? '/edge/australia/' : '/edge/not-australia/';
    // Returning a URL (rather than a Response) rewrites the request
    return new URL(path, request.url);
};

export const config = {
    path: '/edge'
};
