import { Worker } from 'node:worker_threads';
import { fail } from './network.js';

// Parsing hostile markup must not block the HTTP event loop or its total deadline.
export function parseMetadata(bytes, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse-worker.js', import.meta.url), {
      workerData: bytes.toString('utf8'),
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 2,
      },
    });
    let settled = false;
    const abort = () => finish(fail());
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(fail()) : resolve(value);
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (value) => finish(null, value));
    worker.once('error', () => finish(fail()));
    worker.once('exit', () => finish(fail()));
  });
}
