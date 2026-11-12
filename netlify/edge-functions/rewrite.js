export default async (request, context) => {
    const path = context.geo?.country?.code === 'AU' ? '/edge/australia/' : '/edge/not-australia/';
    // Returning a URL (rather than a Response) rewrites the request
    return new URL(path, request.url);
};

export const config = {
    path: '/edge'
};
