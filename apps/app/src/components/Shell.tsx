import { Link, router, usePathname, type Href } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOTICES, SCRYFALL_ATTRIBUTION } from '@voidbinder/shared/notices';
import { useSession } from '../api/queries/me';
import { useLocale, useT } from '../i18n';
import { Icon, Mark, type IconName } from './Icon';
import { usePalette } from './palette';

/**
 * Rail and top bar from 768 px, bottom tabs below. Decision: design.md says rail >= 1024 and tabs
 * < 768 and leaves 768 to 1023 open; that gap gets the rail (a tablet is closer to a desktop window).
 */
export function useWide() {
  return useWindowDimensions().width >= 768;
}

type Tab = {
  key: 'collection' | 'decks' | 'search' | 'profile';
  href: Href;
  icon: IconName;
  match: RegExp;
};

const tabs: Tab[] = [
  { key: 'collection', href: '/collection', icon: 'binder', match: /^\/collection/ },
  { key: 'decks', href: '/decks', icon: 'deck', match: /^\/decks/ },
  // Browsing the catalog (a game, a set, a card) belongs to the search tab, as in the mockups.
  {
    key: 'search',
    href: '/search',
    icon: 'search',
    match: /^\/(search|cards|pokemon|yugioh|mtg|onepiece)(\/|$)/,
  },
  {
    key: 'profile',
    href: '/profile',
    icon: 'user',
    match: /^\/(profile|sign-in|sign-up|verify|reset-password)/,
  },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function NavItem({ tab, rail }: { tab: Tab; rail: boolean }) {
  const t = useT();
  const palette = usePalette();
  const pathname = usePathname();
  const { data: me } = useSession();
  const active = tab.match.test(pathname);
  const signedOutProfile = tab.key === 'profile' && !me;
  const label = signedOutProfile ? t.nav.signIn : t.nav[tab.key];
  const color = active ? palette.blueInk : palette.ink3;
  return (
    <Link href={signedOutProfile ? '/sign-in' : tab.href} asChild>
      <Pressable
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        className={
          rail
            ? `w-16 items-center gap-1.5 rounded-2xl py-2.5 ${active ? 'bg-blue-soft' : ''} ${tab.key === 'profile' ? 'mt-auto' : ''}`
            : 'min-w-[70px] items-center gap-1 py-1'
        }
      >
        {tab.key === 'profile' && me ? (
          <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-ink">
            <Text className="font-display text-[11px] font-bold text-page">
              {initials(me.displayName ?? me.name)}
            </Text>
          </View>
        ) : (
          <Icon name={tab.icon} size={rail ? 22 : 24} color={color} />
        )}
        <Text
          className={`font-display text-[11.5px] font-semibold ${active ? 'text-blue-ink' : 'text-ink-3'}`}
        >
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}

/**
 * The app frame: left rail on wide screens, bottom tabs on phones, the page in between. The page
 * keeps its place in the tree when the width crosses the breakpoint; moving it would remount the
 * router's navigators and lose the current route.
 */
export function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  return (
    <View className={`flex-1 bg-page ${wide ? 'flex-row' : ''}`}>
      {wide && (
        <View
          role="navigation"
          aria-label={t.nav.main}
          className="w-20 items-center gap-1 border-r border-line bg-surface pb-[18px] pt-3.5"
        >
          <Link href="/" aria-label={t.nav.home} className="mb-3 rounded-xl p-1">
            <Mark />
          </Link>
          {tabs.map((tab) => (
            <NavItem key={tab.key} tab={tab} rail />
          ))}
        </View>
      )}
      <View className="flex-1">{children}</View>
      {!wide && (
        <View
          role="navigation"
          aria-label={t.nav.tabs}
          style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          className="flex-row justify-around border-t border-line bg-surface px-2 pt-2"
        >
          {tabs.map((tab) => (
            <NavItem key={tab.key} tab={tab} rail={false} />
          ))}
        </View>
      )}
    </View>
  );
}

export type Crumb = { label: string; href?: Href };

/** Global search with the `/` shortcut on the web; submitting opens /search. */
function GlobalSearch() {
  const t = useT();
  const palette = usePalette();
  const [q, setQ] = useState('');
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <View className="ml-auto h-10 w-[min(440px,36vw)] flex-row items-center gap-2.5 rounded-xl border border-line bg-surface pl-3 pr-2.5">
      <Icon name="search" size={18} color={palette.ink3} />
      <TextInput
        ref={input}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() =>
          router.push({ pathname: '/search', params: q.trim() ? { q: q.trim() } : {} })
        }
        placeholder={t.top.search}
        aria-label={t.top.search}
        placeholderTextColor={palette.ink3}
        enterKeyHint="search"
        className="h-full flex-1 font-body text-sm text-ink"
      />
      <Text
        aria-hidden
        className="rounded-md border border-line px-1.5 py-1 font-mono text-[11.5px] text-ink-3"
      >
        /
      </Text>
    </View>
  );
}

function TopBar({ crumbs }: { crumbs: Crumb[] }) {
  const t = useT();
  const palette = usePalette();
  return (
    <View
      role="banner"
      className="h-16 flex-row items-center gap-3.5 border-b border-line bg-page px-8"
    >
      <View
        role="navigation"
        aria-label={t.nav.breadcrumb}
        className="shrink flex-row items-center gap-2"
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <View key={i} className="flex-row items-center gap-2">
              {i > 0 && <Icon name="chevronRight" size={14} color={palette.ink3} />}
              {c.href && !last ? (
                <Link href={c.href} className="font-body text-sm font-medium text-ink-3">
                  {c.label}
                </Link>
              ) : (
                <Text
                  numberOfLines={1}
                  aria-current={last ? 'page' : undefined}
                  className={`font-body text-sm ${last ? 'font-semibold text-ink' : 'font-medium text-ink-3'}`}
                >
                  {c.label}
                </Text>
              )}
            </View>
          );
        })}
      </View>
      <GlobalSearch />
      {/* Placeholder until the scanner (Sprint 3). */}
      <Pressable
        role="button"
        disabled
        aria-disabled
        aria-label={`${t.top.scanPile}. ${t.top.scanPileHint}`}
        className="h-10 flex-row items-center gap-2 rounded-xl border border-line bg-surface px-3 opacity-60"
      >
        <Icon name="scan" size={18} color={palette.ink} />
        <Text className="font-display text-sm font-semibold text-ink">{t.top.scanPile}</Text>
      </Pressable>
    </View>
  );
}

function PhoneHeader({ title, back }: { title: string; back: boolean }) {
  const t = useT();
  const palette = usePalette();
  return (
    <View
      role="banner"
      className="h-14 flex-row items-center gap-1 border-b border-line bg-page px-2.5"
    >
      {back && (
        <Pressable
          role="button"
          aria-label={t.nav.back}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          className="h-11 w-11 items-center justify-center rounded-xl"
        >
          <Icon name="chevronLeft" size={22} color={palette.ink} />
        </Pressable>
      )}
      {/* The page's h1 on phones; Heading shows only its lede there. */}
      <Text
        role="heading"
        aria-level={1}
        numberOfLines={1}
        className={`flex-1 font-display text-base font-bold text-ink ${back ? '' : 'pl-2'}`}
      >
        {title}
      </Text>
      <Link href="/search" asChild>
        <Pressable
          aria-label={t.nav.search}
          className="h-11 w-11 items-center justify-center rounded-xl"
        >
          <Icon name="search" size={22} color={palette.ink2} />
        </Pressable>
      </Link>
    </View>
  );
}

/**
 * Rights notices of every game (@voidbinder/shared/notices, VB-57), then Powered by Voidcom,
 * Impressum, Datenschutz and the source code.
 */
export function Footer() {
  const t = useT();
  const locale = useLocale();
  const link = 'font-body text-sm font-semibold text-ink-2 underline';
  return (
    <View
      role="contentinfo"
      aria-label={t.footer.label}
      className="mt-12 w-full max-w-content gap-4 border-t border-line pt-6"
    >
      <Text
        role="heading"
        aria-level={2}
        className="font-display text-xs font-semibold uppercase tracking-wider text-ink-2"
      >
        {t.footer.notices}
      </Text>
      <View className="gap-2">
        {(['mtg', 'pokemon', 'yugioh', 'onepiece'] as const).map((game) => (
          // Wizards' notice is English in both locales (Fan Content Policy, verbatim).
          <Text
            key={game}
            lang={game === 'mtg' ? 'en' : locale}
            className="font-body text-xs leading-5 text-ink-3"
          >
            {NOTICES[game][locale]}
          </Text>
        ))}
        <Text className="font-body text-xs leading-5 text-ink-3">
          {SCRYFALL_ATTRIBUTION[locale]}
        </Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-x-5 gap-y-2">
        <Text className="font-body text-sm text-ink-3">
          {t.footer.poweredBy}{' '}
          <Link href="https://voidcom.app" className={link}>
            Voidcom
          </Link>
        </Text>
        <Link href={t.links.imprint} className={link}>
          {t.footer.imprint}
        </Link>
        <Link href={t.links.privacy} className={link}>
          {t.footer.privacy}
        </Link>
        <Link href="https://github.com/derFrisson/Voidbinder" className={link}>
          {t.footer.source}
        </Link>
      </View>
    </View>
  );
}

/**
 * One screen: the top bar (crumbs, search, scan pile) on wide screens or the phone header, then
 * the content up to 1240 px wide. The footer shows on wide screens; on phones only where
 * `phoneFooter` is set (profile, sign-in), as the design asks.
 */
export function Page({
  title,
  crumbs,
  back = false,
  phoneFooter = false,
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  back?: boolean;
  phoneFooter?: boolean;
  children: ReactNode;
}) {
  const wide = useWide();
  return (
    <View className="flex-1">
      {wide ? (
        <TopBar crumbs={crumbs ?? [{ label: title }]} />
      ) : (
        <PhoneHeader title={title} back={back} />
      )}
      <ScrollView
        className="flex-1"
        contentContainerClassName={wide ? 'px-8 pb-16 pt-7' : 'px-4 pb-8 pt-4'}
      >
        <View role="main" className="w-full max-w-content gap-6">
          {children}
        </View>
        {(wide || phoneFooter) && <Footer />}
      </ScrollView>
    </View>
  );
}

/**
 * The page heading: Sora, tight, as in the mockups. On phones the header carries the title (and
 * the h1), so only the lede shows here.
 */
export function Heading({ children, lede }: { children: ReactNode; lede?: string }) {
  const wide = useWide();
  if (!wide)
    return lede ? <Text className="font-body text-base leading-6 text-ink-2">{lede}</Text> : null;
  return (
    <View className="gap-2">
      <Text
        role="heading"
        aria-level={1}
        className="font-display text-[34px] font-bold leading-tight tracking-tight text-ink"
      >
        {children}
      </Text>
      {lede && (
        <Text className="max-w-[640px] font-body text-base leading-6 text-ink-2">{lede}</Text>
      )}
    </View>
  );
}
