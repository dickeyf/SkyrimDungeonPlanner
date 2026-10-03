// npm audit with a reviewed ignore list (.audit-ignore.json): fails on any high or critical
// advisory that is not listed, and on a listed one whose review date has passed.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ignore = JSON.parse(readFileSync(new URL('../.audit-ignore.json', import.meta.url), 'utf8'));
let report;
try {
  report = execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  report = e.stdout; // npm audit exits non-zero when it finds something
}
const advisories = new Map();
for (const v of Object.values(JSON.parse(report).vulnerabilities ?? {}))
  for (const via of v.via)
    if (typeof via === 'object' && ['high', 'critical'].includes(via.severity))
      advisories.set(via.url, via);

const today = new Date().toISOString().slice(0, 10);
let failed = false;
for (const [url, via] of advisories) {
  const entry = ignore.find((i) => i.advisory === url);
  if (!entry) {
    console.error(`${via.severity}: ${via.name}: ${via.title} (${url})`);
    failed = true;
  } else if (entry.review < today) {
    console.error(`ignored advisory past its review date (${entry.review}): ${url}`);
    failed = true;
  } else console.log(`ignored until ${entry.review}: ${via.name}: ${url} (${entry.reason})`);
}
if (failed) process.exit(1);
console.log(`npm audit: no high or critical advisory left (${advisories.size} ignored).`);
