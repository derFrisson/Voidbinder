import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { FOIL_SHEEN_ENABLED } from './foil-flag';

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The light on a foil card (VB-112, `isFoil`): a soft holographic sheen over the whole image box,
 * which must clip it (overflow hidden, rounded). Static in grids and lists; `live` (the card page's
 * large image) sweeps slowly while idle and follows the pointer over the box, both off for
 * reduced motion. The look is in global.css (`.vb-foil`). Decorative: hidden from assistive tech
 * and never takes a pointer event.
 */
export function FoilSheen({ live = false }: { live?: boolean }) {
  // ponytail: web only for now; native (Sprint 3) gets a static gradient View once it ships.
  if (!FOIL_SHEEN_ENABLED || Platform.OS !== 'web') return null;
  return <WebSheen live={live} />;
}

function WebSheen({ live }: { live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const moving = live && !reducedMotion();
  useEffect(() => {
    const sheen = ref.current;
    const box = sheen?.parentElement;
    if (!moving || !sheen || !box) return;
    const move = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100)).toFixed(1)}%`;
      sheen.style.setProperty('--foil-x', pct((e.clientX - r.left) / r.width));
      sheen.style.setProperty('--foil-y', pct((e.clientY - r.top) / r.height));
      sheen.classList.add('vb-foil-tracking');
    };
    const leave = () => {
      sheen.classList.remove('vb-foil-tracking');
      sheen.style.removeProperty('--foil-x');
      sheen.style.removeProperty('--foil-y');
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerleave', leave);
    return () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerleave', leave);
    };
  }, [moving]);
  return <div ref={ref} aria-hidden className={moving ? 'vb-foil vb-foil-live' : 'vb-foil'} />;
}
