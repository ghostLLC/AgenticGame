import { createRequire } from 'node:module';
import { getWorkerPath } from './sandbox.js';

/** pkg executables re-enter their own CLI, not the Node command line. */
export function runPackagedBotChild():boolean {
  if (process.argv[2] !== '--agentic-bot-child') return false;
  if (!process.send) throw new Error('Bot child requires a private IPC channel');
  createRequire(process.execPath)(getWorkerPath());
  return true;
}
