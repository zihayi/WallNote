// Maintainer-only: update the bundled receiver sources from a CalendarBridge checkout.
// Deliberately enumerate files; profiles, keys, calendar snapshots and local build settings never belong here.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Usage: node scripts/import-receiver.mjs <CalendarBridge checkout>');
const into = fileURLToPath(new URL('../receiver/', import.meta.url));
await mkdir(path.join(into, 'dev'), { recursive: true });
for (const file of ['server.py', 'pairing.py', 'discovery.py', 'command_store.py', 'setup_receiver.py', 'requirements-build.txt', 'dev/build_receiver.py']) {
  await copyFile(path.resolve(process.argv[2], file), path.join(into, file));
}
