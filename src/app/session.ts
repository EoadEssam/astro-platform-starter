// The tab-only session of the walkable prototypes (procurement, inventory): sessionStorage, never sent anywhere.
// Owner decision (2026-11-21): what is done stays in the tab and is wiped on closing it or with "Reset the sample".
// The modules share one reset because inventory balances read procurement receipts.
export const SESSION_KEYS = {
    procurement: 'ambs.prototype.procurement.v1',
    inventory: 'ambs.prototype.inventory.v1',
    flash: 'ambs.prototype.flash'
} as const;

export function readJSON<T>(key: string, valid: (v: unknown) => v is T): T | null {
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const v: unknown = JSON.parse(raw);
        return valid(v) ? v : null;
    } catch {
        return null; // blocked or broken storage: the caller starts from the sample
    }
}
export function writeJSON(key: string, v: unknown) {
    try {
        sessionStorage.setItem(key, JSON.stringify(v));
    } catch {
        /* the current view still works */
    }
}
export function resetAll() {
    try {
        for (const k of Object.values(SESSION_KEYS)) sessionStorage.removeItem(k);
    } catch {
        /* ignore */
    }
}
export function setFlash(msg: string) {
    writeJSON(SESSION_KEYS.flash, msg);
}
export function takeFlash(): string | null {
    const m = readJSON(SESSION_KEYS.flash, (v): v is string => typeof v === 'string');
    try {
        sessionStorage.removeItem(SESSION_KEYS.flash);
    } catch {
        /* ignore */
    }
    return m;
}
