import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

export const GET: APIRoute = async (context) => {
    const urlParams = new URL(context.url);
    const key = urlParams.searchParams.get('key');
    if (!key) {
        return Response.json({ error: 'Bad Request: missing "key" query parameter' }, { status: 400 });
    }

    try {
        const blobStore = getStore('shapes');
        const blob = await blobStore.get(key, { type: 'json' });
        if (blob === null) {
            return Response.json({ error: 'Not Found' }, { status: 404 });
        }
        return Response.json({ blob });
    } catch (e) {
        console.error(e);
        return Response.json({ error: 'Failed reading blob' }, { status: 500 });
    }
};
