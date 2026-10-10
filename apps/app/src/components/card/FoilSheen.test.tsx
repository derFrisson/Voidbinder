import { fireEvent, render } from '@testing-library/react';
import { View } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoilSheen } from './FoilSheen';

vi.mock('./foil-flag', () => ({ FOIL_SHEEN_ENABLED: true }));

const sheen = (container: HTMLElement) => container.querySelector('.vb-foil') as HTMLElement;
const motion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));

afterEach(() => vi.unstubAllGlobals());

describe('FoilSheen (VB-112)', () => {
  it('is a static, hidden layer in grids', () => {
    motion(false);
    const { container } = render(<FoilSheen />);
    expect(sheen(container).className).toBe('vb-foil');
    expect(sheen(container).getAttribute('aria-hidden')).toBe('true');
  });

  it('sweeps on the card page and follows the pointer over the image box', () => {
    motion(false);
    const { container } = render(
      <View>
        <FoilSheen live />
      </View>,
    );
    const layer = sheen(container);
    expect(layer.className).toBe('vb-foil vb-foil-live');
    const box = layer.parentElement as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 400 }) as DOMRect;
    fireEvent.pointerMove(box, { clientX: 50, clientY: 300 });
    expect(layer.classList.contains('vb-foil-tracking')).toBe(true);
    expect(layer.style.getPropertyValue('--foil-x')).toBe('25.0%');
    expect(layer.style.getPropertyValue('--foil-y')).toBe('75.0%');
    fireEvent.pointerLeave(box);
    expect(layer.classList.contains('vb-foil-tracking')).toBe(false);
    expect(layer.style.getPropertyValue('--foil-x')).toBe('');
  });

  it('neither sweeps nor tracks when the viewer prefers reduced motion; the sheen stays', () => {
    motion(true);
    const { container } = render(
      <View>
        <FoilSheen live />
      </View>,
    );
    const layer = sheen(container);
    expect(layer.className).toBe('vb-foil');
    fireEvent.pointerMove(layer.parentElement as HTMLElement, { clientX: 5, clientY: 5 });
    expect(layer.classList.contains('vb-foil-tracking')).toBe(false);
  });
});
