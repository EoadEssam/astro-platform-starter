import { isDemoEnabled } from './enabled.mjs';
import { demoRoutes } from './routes.mjs';

/**
 * Registers the demo pages and API routes, and only when the demo is enabled at build time.
 * A build without DEMO_ENABLED=true contains none of them.
 *
 * @param {{ enabled?: boolean }} [options]
 * @returns {import('astro').AstroIntegration}
 */
export default function demo({ enabled = isDemoEnabled() } = {}) {
    return {
        name: 'demo-routes',
        hooks: {
            'astro:config:setup': ({ injectRoute, logger }) => {
                if (!enabled) {
                    logger.info('demo is off: no demo page or API route is built (set DEMO_ENABLED=true to include them)');
                    return;
                }
                for (const route of demoRoutes) injectRoute(route);
                logger.warn(`demo is ON: ${demoRoutes.length} demo routes are built`);
            }
        }
    };
}
