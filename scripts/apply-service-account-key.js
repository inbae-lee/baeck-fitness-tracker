#!/usr/bin/env node
/**
 * Patches an .env file's GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY from a
 * downloaded service-account JSON key file — useful whenever
 * GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is marked "Sensitive" in Vercel (which
 * makes `vercel env pull` write a "[SENSITIVE]" placeholder instead of the
 * real value, since Sensitive vars are write-only from the dashboard) or
 * whenever the key gets rotated.
 *
 * Usage:
 *   node scripts/apply-service-account-key.js /path/to/service-account.json [.env.migration]
 *
 * Writes the private key wrapped in double quotes with its real embedded
 * newlines (not \n escapes) — the same shape `vercel env pull` uses for
 * other multi-line secrets, which the migration script's .env loader
 * already handles.
 */

const fs = require('fs');
const path = require('path');

const jsonPath = process.argv[2];
const envPath = path.resolve(process.cwd(), process.argv[3] || '.env.migration');

if (!jsonPath) {
  console.error('Usage: node scripts/apply-service-account-key.js /path/to/service-account.json [.env.migration]');
  process.exit(1);
}

const keyFile = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
if (!keyFile.client_email || !keyFile.private_key) {
  console.error('That JSON file is missing client_email or private_key — is it the right service-account key file?');
  process.exit(1);
}

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

function setVar(text, key, value) {
  const escaped = value.replace(/"/g, '\\"');
  const line = `${key}="${escaped}"`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  // A multi-line value (the private key) breaks a single-line regex match,
  // so fall back to a manual scan for the key's start/end when replacing.
  const startIdx = text.indexOf(`${key}=`);
  if (startIdx === -1) {
    return text + (text.endsWith('\n') || text === '' ? '' : '\n') + line + '\n';
  }
  const valueStart = startIdx + key.length + 1;
  const quote = text[valueStart];
  let endIdx;
  if (quote === '"' || quote === "'") {
    const closeIdx = text.indexOf(quote, valueStart + 1);
    endIdx = closeIdx === -1 ? text.length : closeIdx + 1;
  } else {
    const eol = text.indexOf('\n', valueStart);
    endIdx = eol === -1 ? text.length : eol;
  }
  return text.slice(0, startIdx) + line + text.slice(endIdx);
}

env = setVar(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL', keyFile.client_email);
env = setVar(env, 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', keyFile.private_key);

fs.writeFileSync(envPath, env);
console.log(`Wrote GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY into ${envPath} from ${jsonPath}.`);
