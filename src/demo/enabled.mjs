// The single switch for everything under src/demo and for the demo edge function.
// Off unless DEMO_ENABLED is "true": an unset, empty or misspelled value keeps the demo off.

/** @param {Record<string, string | undefined>} [env] */
export function isDemoEnabled(env = process.env) {
    return env.DEMO_ENABLED?.toLowerCase() === 'true';
}

/** What a demo API route answers while the demo is off: the same as a route that does not exist. */
export function demoDisabledResponse() {
    return Response.json({ error: 'Not Found' }, { status: 404 });
}
