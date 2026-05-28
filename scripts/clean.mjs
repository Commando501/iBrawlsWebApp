import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = ['dist', 'server.js'].map(target => resolve(process.cwd(), target));

for (const target of targets) {
  try {
    await rm(target, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to remove ${target}`);
    throw error;
  }
}
