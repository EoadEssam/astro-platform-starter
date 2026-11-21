// Whether the caller's permission list (GET /company → my_permissions) holds a permission. The interface uses it only
// to disable a control and say why; the server stays the judge (contract 1.1.0, review round 5 item 5).
export const allowed = (perms: readonly string[], permission: string) => perms.includes(permission);
