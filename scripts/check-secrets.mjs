// Fails if git tracks a secret-bearing file. Runs in CI (.github/workflows/ci.yml) and locally:
//   node scripts/check-secrets.mjs
// Checks the files git tracks or has staged (git ls-files), not the working directory, so ignored local files
// such as a real .env never trip it. Prints file NAMES only, never their content.
//
// Refused by name:  .env (any folder), userlist.txt, credentials.json, *.pem, *.key
// Refused by text:  a PEM private-key header ("-----BEGIN ... PRIVATE KEY-----")
// The owner's rules (CLAUDE.md): .env, userlist.txt and credentials.json stay local and are never committed.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const BY_NAME = new Set(['.env', 'userlist.txt', 'credentials.json']);
const BY_EXTENSION = ['.pem', '.key'];
// Built from parts so this file does not match itself
const PRIVATE_KEY = new RegExp('-----BEGIN [A-Z0-9 ]*PRIVATE' + ' KEY-----');
const MAX_BYTES = 5 * 1024 * 1024; // larger tracked files are not read

const files = execFileSync('git', ['ls-files', '-z', '--cached'], { encoding: 'utf8' }).split('\0').filter(Boolean);

const found = [];
for (const file of files) {
    const name = basename(file).toLowerCase();
    if (BY_NAME.has(name) || BY_EXTENSION.some((ext) => name.endsWith(ext))) {
        found.push(`${file}  (file name)`);
        continue;
    }
    let size;
    try {
        size = statSync(file).size;
    } catch {
        continue; // tracked but deleted in the working tree
    }
    if (size > MAX_BYTES) continue;
    if (PRIVATE_KEY.test(readFileSync(file, 'latin1'))) found.push(`${file}  (private key text)`);
}

if (found.length) {
    console.error(`check-secrets: ${found.length} tracked file(s) must not be in the repository:`);
    for (const f of found) console.error(`  ${f}`);
    console.error('Remove them from git (git rm --cached <file>) and keep them local.');
    process.exit(1);
}
console.log(`check-secrets: OK (${files.length} tracked files, none refused)`);
