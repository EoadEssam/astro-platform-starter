import type { APIRoute } from 'astro';
import { purgeCache } from '@netlify/functions';
import { createHash, timingSafeEqual } from 'node:crypto';
import { demoCacheTags } from '../../utils';

export const prerender = false;

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 128;

// Purging is a privileged operation: without restrictions, anyone could keep emptying the CDN cache.
// Requests carrying `Authorization: Bearer <REVALIDATE_SECRET>` may purge any tag,
// all other requests are limited to the tags of the demo page.
function isAuthorized(request: Request) {
    const secret = process.env.REVALIDATE_SECRET;
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!secret || !token) return false;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(token), digest(secret));
}

export const POST: APIRoute = async ({ request }) => {
    const body = await request.json().catch(() => null);
    const tags: unknown = body?.tags;

    if (
        !Array.isArray(tags) ||
        tags.length === 0 ||
        tags.length > MAX_TAGS ||
        !tags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= MAX_TAG_LENGTH)
    ) {
        return Response.json({ error: `Bad Request: expected a "tags" array of 1-${MAX_TAGS} non-empty strings in the body` }, { status: 400 });
    }

    if (!isAuthorized(request) && !tags.every((tag) => demoCacheTags.includes(tag))) {
        return Response.json({ error: 'Forbidden: purging these tags requires authorization' }, { status: 403 });
    }

    await purgeCache({ tags });
    return Response.json({ invalidated: tags });
};
