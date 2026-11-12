import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';
import { uploadDisabled } from '../../utils';
import type { BlobParameterProps } from '../../types';

export const prerender = false;

// `uploadDisabled` comes from a PUBLIC_ variable, which is inlined at build time.
// Also checking process.env per request lets uploads be turned off without a rebuild.
function isUploadDisabled() {
    return uploadDisabled || process.env.PUBLIC_DISABLE_UPLOADS?.toLowerCase() === 'true';
}

// A shape's parameters are ~150 bytes of JSON
const MAX_BODY_BYTES = 2048;
// Uploads are public and there is no way to delete shapes, so keep the store from growing indefinitely
const MAX_SHAPES = 100;

const isNumberInRange = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && value >= min && value <= max;
const isIntegerInRange = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && isNumberInRange(value, min, max);

// This endpoint is public, so only accept what the shape editor can produce (see generateBlob() in utils.ts)
// and only store the known fields.
function parseShapeParameters(input: any): BlobParameterProps | null {
    if (typeof input !== 'object' || input === null) return null;
    const { seed, size, edges, growth, name, colors } = input;
    const valid =
        typeof name === 'string' &&
        /^[a-z0-9]+(-[a-z0-9]+){0,4}$/.test(name) &&
        name.length <= 64 &&
        isIntegerInRange(seed, 0, Number.MAX_SAFE_INTEGER) &&
        isIntegerInRange(size, 16, 2048) &&
        isIntegerInRange(edges, 3, 20) &&
        isIntegerInRange(growth, 2, 9) &&
        Array.isArray(colors) &&
        colors.length === 2 &&
        colors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color));
    return valid ? { seed, size, edges, growth, name, colors } : null;
}

export const POST: APIRoute = async ({ request }) => {
    if (isUploadDisabled()) {
        return Response.json({ error: 'Sorry, uploads are disabled' }, { status: 403 });
    }

    const body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
        return Response.json({ error: 'Payload too large' }, { status: 413 });
    }

    let parameters: BlobParameterProps | null = null;
    try {
        parameters = parseShapeParameters(JSON.parse(body));
    } catch {
        // Not JSON, handled below
    }
    if (!parameters) {
        return Response.json({ error: 'Bad Request: invalid shape parameters' }, { status: 400 });
    }

    const blobStore = getStore({ name: 'shapes', consistency: 'strong' });
    const { blobs } = await blobStore.list();
    if (blobs.length >= MAX_SHAPES && !blobs.some(({ key }) => key === parameters.name)) {
        return Response.json({ error: 'Sorry, the shape store is full' }, { status: 507 });
    }

    await blobStore.setJSON(parameters.name, parameters);
    return Response.json({ message: `Stored shape "${parameters.name}"` });
};

export const GET: APIRoute = async () => {
    try {
        const blobStore = getStore({ name: 'shapes', consistency: 'strong' });
        const data = await blobStore.list();
        const keys = data.blobs.map(({ key }) => key);
        return Response.json({ keys });
    } catch (e) {
        console.error(e);
        return Response.json({ keys: [], error: 'Failed listing blobs' }, { status: 500 });
    }
};
