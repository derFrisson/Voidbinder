import { vi } from 'vitest';

/**
 * Stands in for Cloudflare's `window.turnstile` (the real script needs the network). By default a
 * rendered widget is solved at once with `test-token`, so forms can be submitted; `auto = false`
 * leaves it unsolved, and `solve` / `fail` then play the user or Cloudflare.
 */
export const turnstileFake = {
  auto: true,
  renders: [] as { element: HTMLElement; options: Record<string, unknown> }[],
  reset: vi.fn<(id: string) => void>(),
  remove: vi.fn<(id: string) => void>(),
  tokenN: 0,
  install() {
    this.auto = true;
    this.renders = [];
    this.reset.mockClear();
    this.remove.mockClear();
    this.tokenN = 0;
    window.turnstile = {
      render: (element, options) => {
        this.renders.push({ element, options });
        // Cloudflare calls back after render() returned; a form is only ever submitted after that.
        if (this.auto) this.solve(`test-token-${++this.tokenN}`);
        return `widget-${this.renders.length}`;
      },
      reset: (id) => {
        this.reset(id);
        if (this.auto) this.solve(`test-token-${++this.tokenN}`);
      },
      remove: (id) => this.remove(id),
    };
  },
  /** The last widget's success callback. */
  solve(token: string) {
    (this.renders.at(-1)?.options.callback as (t: string) => void)(token);
  },
  fail() {
    (this.renders.at(-1)?.options['error-callback'] as () => void)();
  },
};
