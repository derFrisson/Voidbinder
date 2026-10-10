import { Pressable, Text, View } from 'react-native';
import { fmt, useT } from '../../i18n';
import { Icon } from '../Icon';
import { usePalette } from '../palette';
import { pageWindow } from './model';

/** Previous, numbered pages with gaps, next. The current page is `aria-current`. */
export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const t = useT();
  const palette = usePalette();
  if (pages <= 1) return null;
  const step = (to: number, name: string, icon: 'chevronLeft' | 'chevronRight') => (
    <Pressable
      role="button"
      aria-label={name}
      aria-disabled={to < 1 || to > pages}
      disabled={to < 1 || to > pages}
      onPress={() => onPage(to)}
      className={`h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface ${to < 1 || to > pages ? 'opacity-50' : ''}`}
    >
      <Icon name={icon} size={18} color={palette.ink} />
    </Pressable>
  );
  return (
    <View
      role="navigation"
      aria-label={t.set.pageNav}
      className="flex-row flex-wrap items-center justify-center gap-2 pt-2"
    >
      {step(page - 1, t.set.prev, 'chevronLeft')}
      {pageWindow(page, pages).map((p, i) =>
        p === 'gap' ? (
          <Text key={`gap${i}`} aria-hidden className="px-1 font-mono text-ink-3">
            …
          </Text>
        ) : (
          <Pressable
            key={p}
            role="button"
            aria-label={fmt(t.set.page, { page: p })}
            aria-current={p === page ? 'page' : undefined}
            onPress={() => onPage(p)}
            className={`h-11 min-w-[44px] items-center justify-center rounded-xl border px-2 ${p === page ? 'border-ink bg-ink' : 'border-line bg-surface'}`}
          >
            <Text className={`font-mono text-sm ${p === page ? 'text-page' : 'text-ink'}`}>
              {p}
            </Text>
          </Pressable>
        ),
      )}
      {step(page + 1, t.set.next, 'chevronRight')}
    </View>
  );
}
