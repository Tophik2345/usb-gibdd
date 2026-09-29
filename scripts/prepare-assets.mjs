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

const emblemTarget = new URL('../public/gibdd-emblem.svg', import.meta.url);
const emblemSource = 'https://upload.wikimedia.org/wikipedia/commons/8/88/Emblem_of_the_traffic_police_of_Russia.svg';
const emblemHash = '63828f7970e1e48d3925a624db2ebcbf3d54c28817b2b6cf8002d1b78f920972';
let emblem;
try { emblem = await readFile(emblemTarget); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!emblem) {
  const response = await fetch(emblemSource, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Emblem download failed: ${response.status}`);
  emblem = Buffer.from(await response.arrayBuffer());
}
if (digest(emblem) !== emblemHash) throw new Error('The emblem does not match the approved original SVG.');
await writeFile(emblemTarget, emblem);
console.log('Original GIBDD emblem verified.');
