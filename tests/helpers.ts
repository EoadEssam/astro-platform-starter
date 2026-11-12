import type { APIContext, APIRoute } from 'astro';

/** Calls an Astro API route handler the way the server would, with just the parts of the context the routes use. */
export async function callRoute(handler: APIRoute, url: string, init?: RequestInit) {
    const request = new Request(url, init);
    const response = await handler({ request, url: new URL(request.url) } as unknown as APIContext);
    return { status: response.status, contentType: response.headers.get('content-type'), body: await response.json() };
}

export const postJson = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
});
