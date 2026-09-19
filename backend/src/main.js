import { hostname } from './network.js';
import { createServer } from './server.js';

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
  const port = env.PORT === undefined ? 8787 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  return {
    origin: origin.origin,
    port,
  };
}

// Deliberately no interpolated errors: configuration values can contain sensitive data.
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error();
  const options = config(process.env);
  const server = createServer(options);
  server.on('error', () => {
    process.stderr.write('Preview backend failed to listen.\n');
    process.exitCode = 1;
  });
  server.listen(options.port, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
} catch {
  process.stderr.write('Preview backend requires Node 24 and valid ORIGIN and PORT.\n');
  process.exitCode = 1;
}
