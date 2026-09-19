import { parentPort, workerData } from 'node:worker_threads';
import { metadata } from './metadata.js';
parentPort.postMessage(metadata(workerData));
