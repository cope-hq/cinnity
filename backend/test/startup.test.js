import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const main = new URL('../src/main.js', import.meta.url);
function launch(env) {
  const child = spawn(process.execPath, [main.pathname], {
    env: {
      ...process.env,
      ORIGIN: 'https://cinny.example',
      PORT: '8787',
      ...env,
    },
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

test('standalone startup fails closed for invalid origin/port without reflecting values', async () => {
  for (const env of [
    { ORIGIN: 'http://cinny.example' },
    { ORIGIN: 'https://cinny.example/' },
    { ORIGIN: 'https://127.0.0.1' },
    { PORT: '0' },
  ]) {
    const { child, output } = launch(env);
    const [code] = await once(child, 'close');
    assert.equal(code, 1);
    assert.equal(output(), 'Preview backend requires Node 24 and valid ORIGIN and PORT.\n');
  }
});

test('standalone Node 24 process listens on configured loopback port without request logs', async (t) => {
  const temporary = net.createServer();
  temporary.listen(0, '127.0.0.1');
  await once(temporary, 'listening');
  const port = temporary.address().port;
  await new Promise((resolve) => temporary.close(resolve));
  const { child, output } = launch({ PORT: String(port) });
  t.after(() => {
    child.kill('SIGTERM');
  });
  let response;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/_cinny/preview`, {
        method: 'POST',
      });
      break;
    } catch {
      await delay(20);
    }
  }
  assert.equal(response?.status, 403);
  assert.equal(await response.json(), null);
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  assert.equal((await closed)[0], 0);
  assert.equal(output(), '');
});
