import blobshape from 'blobshape';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import type { BlobParameterProps, BlobProps } from '../types';

export function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

export function uniqueName() {
    const config = {
        dictionaries: [adjectives, animals],
        separator: '-',
        length: 2
    };
    return uniqueNamesGenerator(config) + '-' + randomInt(100, 999);
}

// Creates a random shape, or recreates a stored one when given its parameters
export function generateBlob(parameters: Partial<BlobParameterProps> = {}): BlobProps {
    const gradientColors = [
        ['#2E3192', '#1BFFFF'],
        ['#93A5CF', '#E4EfE9'],
        ['#BFF098', '#6FD6FF'],
        ['#A1C4FD', '#C2E9FB'],
        ['#11998E', '#38EF7D'],
        ['#D8B5FF', '#1EAE98']
    ];

    const { seed, ...shape } = {
        size: 512,
        edges: randomInt(3, 20),
        growth: randomInt(2, 9),
        name: uniqueName(),
        colors: gradientColors[randomInt(0, gradientColors.length - 1)],
        ...parameters
    };
    // blobshape's types declare the seed as a string, but it generates, returns and accepts a number
    const { path: svgPath, seedValue } = blobshape({ ...shape, seed: seed as unknown as string });
    return { parameters: { seed: seedValue, ...shape }, svgPath };
}

export function cacheHeaders(maxAgeDays = 365, cacheTags?: string[]): Record<string, string> {
    // As far as the browser is concerned, it must revalidate on every request.
    // However, Netlify CDN is told to keep the content cached for up to maxAgeDays (note: new deployments bust the cache by default).
    // We're also setting cache tags to be able to later purge via API (see: https://www.netlify.com/blog/cache-tags-and-purge-api-on-netlify/)
    const headers: Record<string, string> = {
        'Cache-Control': 'public, max-age=0, must-revalidate', // Tell browsers to always revalidate
        'Netlify-CDN-Cache-Control': `public, max-age=${maxAgeDays * 86_400}, must-revalidate` // Tells Netlify CDN the max allowed cache duration
    };
    if (cacheTags?.length) headers['Cache-Tag'] = cacheTags.join(',');
    return headers;
}

// Cache tags of the /revalidation demo page. Anyone may purge these through /api/revalidate.
export const demoCacheTags = ['/revalidation', 'cats-related', 'all-pets-related'];

export const uploadDisabled = import.meta.env.PUBLIC_DISABLE_UPLOADS?.toLowerCase() === 'true';
