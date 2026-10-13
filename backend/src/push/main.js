import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from '../network.js';
import { createPushServer } from './server.js';
import { loadVapidKey } from './vapid.js';

export function config(env) {
  const origin = new URL(env.ORIGIN);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== env.ORIGIN ||
    origin.username ||
    origin.password
  )
    throw new Error();
  hostname(origin.hostname);
  const port = env.PORT === undefined ? 8788 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  const keyFile =
    env.VAPID_KEY_FILE ??
    (env.CREDENTIALS_DIRECTORY ? join(env.CREDENTIALS_DIRECTORY, 'vapid.pem') : undefined);
  if (!keyFile) throw new Error();
  return { origin: origin.origin, port, vapid: loadVapidKey(readFileSync(keyFile)) };
}

// Deliberately no interpolated errors: configuration values can contain sensitive data.
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error();
  const options = config(process.env);
  const server = createPushServer(options);
  server.on('error', () => {
    process.stderr.write('Push gateway failed to listen.\n');
    process.exitCode = 1;
  });
  server.listen(options.port, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
} catch {
  process.stderr.write(
    'Push gateway requires Node 24, valid ORIGIN and PORT, and a P-256 VAPID key.\n'
  );
  process.exitCode = 1;
}
