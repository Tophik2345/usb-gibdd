import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const background = await readFile(new URL('../public/usb-gibdd-background.webp', import.meta.url));
if (digest(background) !== '52f2d2c8fe59e397796b3cbb5665c67e99f20f0f471f144d2eec10a2eddaee1b') {
  throw new Error('The generated GIBDD background does not match the approved asset.');
}
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
console.log('Generated GIBDD background verified.');

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
