import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = new URL('../src/push/main.js', import.meta.url);
const MESSAGE = 'Push gateway requires Node 24, valid ORIGIN and PORT, and a P-256 VAPID key.\n';

const dir = mkdtempSync(join(tmpdir(), 'cinny-push-'));
const keyFile = join(dir, 'vapid.pem');
writeFileSync(
  keyFile,
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  })
);
const badKey = join(dir, 'bad.pem');
writeFileSync(badKey, 'not a key');

function launch(env) {
  const merged = {
    ...process.env,
    ORIGIN: 'https://cinny.example',
    PORT: String(20000 + Math.floor(Math.random() * 20000)),
    VAPID_KEY_FILE: keyFile,
    ...env,
  };
  Object.keys(merged).forEach((key) => merged[key] === undefined && delete merged[key]);
  const child = spawn(process.execPath, [main.pathname], {
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  return { child, output: () => output };
}

test('startup fails closed with a fixed message', async () => {
  for (const env of [
    { ORIGIN: 'http://cinny.example' },
    { ORIGIN: 'https://cinny.example/' },
    { PORT: '70000' },
    { VAPID_KEY_FILE: join(dir, 'missing.pem') },
    { VAPID_KEY_FILE: badKey },
  ]) {
    const { child, output } = launch(env);
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(output(), MESSAGE);
  }
});

test('reads the key from the systemd credentials directory', async () => {
  const { child, output } = launch({
    VAPID_KEY_FILE: undefined,
    CREDENTIALS_DIRECTORY: dir,
  });
  // Starts listening without output; stop it.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(child.exitCode, null);
  child.kill('SIGTERM');
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.equal(output(), '');
});
