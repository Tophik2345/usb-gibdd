import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const target = new URL('../public/background-wall.png', import.meta.url);
const source = 'https://tophik2345.github.io/up9-memo/background-wall.png';
const expected = '88c095ee1674ecf17b81f2671d257b5232cec6fecd05812983623612534d73b9';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let bytes;
try { bytes = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (bytes && digest(bytes) !== expected) throw new Error('The background file has changed; review its checksum before building.');
if (!bytes) {
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Background download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error('The downloaded background does not match the approved image.');
  await mkdir(new URL('../public/', import.meta.url), { recursive: true });
  await writeFile(target, bytes);
}
console.log('Background image verified.');
