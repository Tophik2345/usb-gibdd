import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export default defineConfig(({ mode, command }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const env = { ...loadEnv(mode, root, 'VITE_'), ...process.env };
  if (command === 'build') {
    if (!env.VITE_SUPABASE_URL) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the repository Actions variables before publishing.');
    const url = new URL(env.VITE_SUPABASE_URL);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('VITE_SUPABASE_URL must be the Supabase HTTPS project origin.');
    const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
    let safe = key.startsWith('sb_publishable_');
    if (key.startsWith('eyJ')) {
      try { safe = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { safe = false; }
    }
    if (!safe) throw new Error('Use a Supabase publishable or legacy anon key. Secret and service_role keys must never be used in GitHub Pages.');
  }
  return { base: process.env.BASE_PATH || './', resolve: { alias: { '@': root } }, plugins: [react()], build: { outDir: 'dist', target: 'es2022', sourcemap: false } };
});
