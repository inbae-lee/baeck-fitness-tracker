/**
 * Minimal .env loader for scripts/ one-off scripts (not used by the
 * deployed api/ functions, which get real env vars from Vercel directly).
 * One KEY=value per entry, value optionally wrapped in matching quotes.
 * `vercel env pull` writes multi-line secrets (like a PEM private key)
 * with the real newlines preserved INSIDE the quotes rather than as \n
 * escapes, so this scans char-by-char for the matching closing quote
 * instead of splitting on '\n' first (a naive per-line split would
 * silently truncate the key at its first embedded newline). Doesn't
 * overwrite a var already set in the real environment.
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lineStartRe = /^([A-Za-z_][A-Za-z0-9_]*)=/gm;
  let match;
  while ((match = lineStartRe.exec(raw))) {
    const key = match[1];
    const valueStart = lineStartRe.lastIndex;
    const quote = raw[valueStart];
    let value, nextSearchFrom;
    if (quote === '"' || quote === "'") {
      const closeIdx = raw.indexOf(quote, valueStart + 1);
      value = raw.slice(valueStart + 1, closeIdx === -1 ? undefined : closeIdx);
      nextSearchFrom = closeIdx === -1 ? raw.length : closeIdx + 1;
    } else {
      const eol = raw.indexOf('\n', valueStart);
      value = raw.slice(valueStart, eol === -1 ? undefined : eol);
      nextSearchFrom = eol === -1 ? raw.length : eol;
    }
    if (process.env[key] === undefined) process.env[key] = value;
    lineStartRe.lastIndex = nextSearchFrom;
  }
}

// Loads process.env.ENV_FILE (or the given default filename, resolved
// against cwd) — call once at the top of a script before requiring
// anything that reads GOOGLE_* env vars.
function loadDefaultEnvFile(defaultFileName) {
  loadEnvFile(path.resolve(process.cwd(), process.env.ENV_FILE || defaultFileName));
}

module.exports = { loadEnvFile, loadDefaultEnvFile };
