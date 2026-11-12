import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { uploadDisabled } from '../../utils';

export const prerender = false;

// `uploadDisabled` comes from a PUBLIC_ variable, which is inlined at build time.
// Also checking process.env per request lets uploads be turned off without a rebuild.
function isUploadDisabled() {
    return uploadDisabled || process.env.PUBLIC_DISABLE_UPLOADS?.toLowerCase() === 'true';
}

export const POST: APIRoute = async ({ request }) => {
    if (isUploadDisabled()) {
        return new Response(JSON.stringify({ error: 'Sorry, uploads are disabled' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const parameters = await request.json();
    const blobStore = getStore('shapes');
    const key = parameters.name;
    await blobStore.setJSON(key, parameters);
    return new Response(
        JSON.stringify({
            message: `Stored shape "${key}"`
        })
    );
};

export const GET: APIRoute = async ({ request }) => {
    try {
        const blobStore = getStore({ name: 'shapes', consistency: 'strong' });
        const data = await blobStore.list();
        const keys = data.blobs.map(({ key }) => key);
        return new Response(
            JSON.stringify({
                keys
            })
        );
    } catch (e) {
        console.error(e);
        return new Response(
            JSON.stringify({
                keys: [],
                error: 'Failed listing blobs'
            })
        );
    }
};
