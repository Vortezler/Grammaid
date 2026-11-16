import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { send, type ModelStatus } from '../shared/types';
export const formatBytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(0)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`;
export function useModelStatus(enabled = true): [ModelStatus | null, () => void] {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const timer = useRef(0); const alive = useRef(true);
  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!enabled || document.hidden) return;
    void send({ type: 'model-status' }).then((res) => {
      if (!alive.current || !enabled || document.hidden) return;
      if (res.ok) setStatus(res.data);
      timer.current = window.setTimeout(refresh, res.ok && (res.data.gpt2 === 'loading' || res.data.t5 === 'loading') ? 500 : 4000);
    });
  }, [enabled]);
  useEffect(() => { alive.current = true; refresh(); document.addEventListener('visibilitychange', refresh); return () => { alive.current = false; window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', refresh); }; }, [refresh]);
  return [status, refresh];
}
