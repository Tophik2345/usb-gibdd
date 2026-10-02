import { useSyncExternalStore } from 'react';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type PwaState = { canInstall: boolean; installed: boolean; updateAvailable: boolean; online: boolean; message: string };
let state: PwaState = { canInstall: false, installed: window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone, updateAvailable: false, online: navigator.onLine, message: '' };
let prompt: InstallPrompt | null = null, waiting: ServiceWorker | null = null, applying = false, started = false;
const listeners = new Set<() => void>();
function update(patch: Partial<PwaState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(); }
export function usePwa() { return useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => state); }
export async function installApp() {
  if (!prompt) return; const event = prompt; prompt = null; update({ canInstall: false, message: '' });
  try { await event.prompt(); const choice = await event.userChoice; update({ message: choice.outcome === 'accepted' ? 'Установка подтверждена в браузере.' : 'Установка отменена. Сайт можно добавить через меню браузера.' }); }
  catch { update({ message: 'Откройте меню браузера, чтобы добавить сайт на главный экран.' }); }
}
export function applyAppUpdate() { if (waiting) { applying = true; waiting.postMessage({ type: 'APPLY_UPDATE' }); } }
export function startPwa() {
  if (started) return; started = true;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event as InstallPrompt; update({ canInstall: true }); });
  window.addEventListener('appinstalled', () => { prompt = null; update({ installed: true, canInstall: false, message: 'Сайт установлен.' }); });
  window.addEventListener('online', () => update({ online: true })); window.addEventListener('offline', () => update({ online: false }));
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) window.location.reload(); });
  const register = () => navigator.serviceWorker.register(new URL('sw.js', new URL(import.meta.env.BASE_URL, window.location.href)).href, { updateViaCache: 'none' }).then(registration => {
    const check = () => { waiting = registration.waiting; update({ updateAvailable: !!waiting }); };
    check(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check)); void registration.update().catch(() => {});
  }).catch(() => {});
  if (document.readyState === 'complete') void register(); else window.addEventListener('load', register, { once: true });
}
