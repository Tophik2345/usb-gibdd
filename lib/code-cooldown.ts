import { useEffect, useState } from 'react';
const prefix = 'usb-code-wait:';
export function cooldownRemaining(deadline: number, now = Date.now()) { return Math.max(0, Math.ceil((deadline - now) / 1000)); }
function deadlineFor(key: string) { try { return Number(sessionStorage.getItem(prefix + key)) || 0; } catch { return 0; } }
export function useCodeCooldown(kind: 'signup' | 'recovery', email: string) {
  const key = kind + ':' + email.trim().toLowerCase();
  const [tick, setTick] = useState(0);
  const [memory, setMemory] = useState<Record<string, number>>({});
  const remaining = cooldownRemaining(Math.max(memory[key] || 0, deadlineFor(key)));
  useEffect(() => {
    if (!remaining) return;
    const timer = window.setInterval(() => setTick(value => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [key, remaining > 0]);
  void tick;
  return { remaining, start: () => {
    const deadline = Date.now() + 60_000;
    try { sessionStorage.setItem(prefix + key, String(deadline)); } catch { /* In-memory fallback. */ }
    setMemory(value => ({ ...value, [key]: deadline }));
  } };
}
