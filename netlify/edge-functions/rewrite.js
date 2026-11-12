export default async (request, context) => {
    const path = context.geo?.country?.code === 'AU' ? '/edge/australia/' : '/edge/not-australia/';
    // Returning a URL rewrites the request: the visitor stays on /edge and gets the content of that path
    return new URL(path, request.url);
};

export const config = {
    path: '/edge'
};
