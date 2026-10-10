import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Platform, Text, useWindowDimensions, View } from 'react-native';
import { useLocale, useT } from '../../i18n';

// Cloudflare Turnstile on the web build (VB-72). `EXPO_PUBLIC_TURNSTILE_SITE_KEY` is inlined by
// `expo export`; without it the widget is Cloudflare's always-passes test key, which the API's
// real secret rejects, so a build that forgot the key fails closed (docs/environments.md).
export const TURNSTILE_SITE_KEY =
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

/** Loads Cloudflare's script once (it must come from this exact URL, never a copy). */
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('x')));
    script.onerror = () => reject(new Error('Turnstile script failed to load'));
    // appendChild: worker-configuration.d.ts adds an `append` overload that does not take nodes.
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    // A later widget (another form, a retry) tries again.
    loading = undefined;
    throw err;
  });
  return loading;
}

/**
 * The widget, in a box as high as the `normal` size (65 px, or 140 px for the compact size on narrow phones, fixed: the line box around the iframe cannot add pixels) from the first paint, so
 * nothing shifts when it appears. `onToken` gets the token when the challenge is solved and null when it expires or
 * errors; `resetKey` changing starts a new challenge (a token works once). Renders nothing on
 * native, where the API's `TURNSTILE_NATIVE_BYPASS` is the interim (Sprint 3: the RN SDK).
 */
export function Turnstile({
  onToken,
  resetKey,
  showRequired,
}: {
  onToken(token: string | null): void;
  resetKey: number;
  /** The user pressed submit before the challenge was solved. */
  showRequired: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const box = useRef<View>(null);
  const widget = useRef<{ api: TurnstileApi; id: string }>(undefined);
  const [failed, setFailed] = useState(false);
  // The `normal` widget is 300 px wide; in a narrower box (phones under ~375 px) it would spill out
  // of the panel, so those get the `compact` one (150 x 140). The box's own width decides, once:
  // the first layout fixes the size for good (a later flip would draw a second challenge) and the
  // widget is not drawn before it. Until then the window width only guesses the reserved height.
  const windowWidth = useWindowDimensions().width;
  const [compact, setCompact] = useState<boolean>();
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (Platform.OS !== 'web' || compact === undefined) return;
    let cancelled = false;
    const start = (api: TurnstileApi) => {
      const element = box.current as unknown as HTMLElement | null;
      if (cancelled || !element) return;
      const id = api.render(element, {
        sitekey: TURNSTILE_SITE_KEY,
        size: compact ? 'compact' : 'normal',
        theme: 'auto',
        language: locale,
        callback: (token: string) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      });
      widget.current = { api, id };
    };
    // Already loaded (a second form, or a test's fake): render at once.
    if (window.turnstile) start(window.turnstile);
    else loadTurnstile().then(start, () => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = undefined;
    };
  }, [locale, compact]);

  const firstReset = useRef(resetKey);
  useEffect(() => {
    if (resetKey === firstReset.current) return;
    widget.current?.api.reset(widget.current.id);
  }, [resetKey]);

  if (Platform.OS !== 'web') return null;
  return (
    <View>
      {failed ? (
        <Text role="alert" className="font-body text-sm text-ink">
          {t.turnstile.unavailable}
        </Text>
      ) : (
        <View
          ref={box}
          role="group"
          aria-label={t.turnstile.label}
          onLayout={(e) => {
            const { width } = e.nativeEvent.layout;
            // Width 0: not laid out yet (hidden), no basis for a decision.
            if (width > 0) setCompact((decided) => decided ?? width < 300);
          }}
          className={(compact ?? windowWidth < 380) ? 'h-[140px]' : 'h-[65px]'}
        />
      )}
      {showRequired && !failed && (
        <Text role="alert" className="mt-2 font-body text-sm text-ink">
          {t.errors.turnstileRequired}
        </Text>
      )}
    </View>
  );
}

/**
 * The state of the widget of one form: `widget` goes into the form, `take()` is called on submit
 * and returns the token (shows the "complete the check" message when there is none yet), and
 * `renew()` after a failed request, since Cloudflare accepts a token once. On native there is no
 * widget: `take()` returns null and the form sends the request without a token.
 */
export function useTurnstile(): {
  widget: ReactElement;
  take(): { token: string | null; ok: boolean };
  renew(): void;
} {
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [required, setRequired] = useState(false);
  const isWeb = Platform.OS === 'web';
  return {
    widget: (
      <Turnstile
        onToken={(next) => {
          setToken(next);
          if (next) setRequired(false);
        }}
        resetKey={resetKey}
        showRequired={required && token === null}
      />
    ),
    take: () => {
      if (!isWeb) return { token: null, ok: true };
      setRequired(token === null);
      return { token, ok: token !== null };
    },
    renew: () => {
      setToken(null);
      setResetKey((k) => k + 1);
    },
  };
}
