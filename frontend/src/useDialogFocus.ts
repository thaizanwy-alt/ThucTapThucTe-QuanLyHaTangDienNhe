import { useEffect, useRef } from 'react';
export function dialogFocusable(root: HTMLElement, fieldsOnly = false): HTMLElement[] {
  const selector = fieldsOnly ? 'input,select,textarea' : 'button,input,select,textarea,a[href],[tabindex]';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(node => {
    if (node.matches(':disabled') || node.tabIndex < 0 || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && node.getClientRects().length > 0;
  });
}
export function useDialogFocus(title: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (ref.current) (dialogFocusable(ref.current, true)[0] ?? ref.current).focus(); }, [title]);
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = ref.current ? dialogFocusable(ref.current) : [];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { e.preventDefault(); ref.current?.focus(); }
      else if (!nodes.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', trap); return () => window.removeEventListener('keydown', trap);
  }, []);
  return ref;
}
