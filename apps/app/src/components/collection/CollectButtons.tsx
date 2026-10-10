import type { Locale } from '@voidbinder/shared';
import { router, usePathname } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useAddEntries, useAddWishes, useOwned } from '../../api/queries/collection';
import { ApiError } from '../../api/queries/http';
import { useSession } from '../../api/queries/me';
import { fmt, useLocale, useT } from '../../i18n';

/** What a print needs to be added: its id, finishes and the languages it has names in. */
export type Collectable = { id: string; finishes: string[]; langs: string[] };

/** A new entry's language: the user's when the print exists in it, else English. */
export const entryLanguage = (print: Collectable, locale: Locale) =>
  print.langs.includes(locale) ? locale : 'en';

/**
 * "In Sammlung" (blue) and "Auf Wunschliste" (outlined) on the card page, with the owned line
 * ("Du hast 2× in deiner Sammlung"). Signed out, both lead to sign-in and come back here.
 */
export function CollectButtons({ print, wide }: { print: Collectable; wide: boolean }) {
  const t = useT();
  const locale = useLocale();
  const pathname = usePathname();
  const { data: me } = useSession();
  const owned = useOwned([print.id], !!me);
  const add = useAddEntries();
  const wish = useAddWishes();
  const c = t.collection;
  const copies = owned.data?.owned[print.id] ?? 0;
  const wishes = owned.data?.wished[print.id] ?? 0;
  // A wish for this print exists already: the API answers 409, which reads as "on the list".
  const wished = wishes > 0 || (wish.error instanceof ApiError && wish.error.status === 409);
  const signIn = () => router.push({ pathname: '/sign-in', params: { next: pathname } });

  const onAdd = () =>
    me
      ? add.mutate([
          {
            printId: print.id,
            finish: print.finishes[0] ?? 'normal',
            language: entryLanguage(print, locale),
          },
        ])
      : signIn();
  const onWish = () => (me ? wish.mutate([{ printId: print.id }]) : signIn());

  // flex-1 only side by side (phone); in the desktop column it would collapse the height.
  const button = `h-11 flex-row items-center justify-center rounded-xl px-4 ${wide ? '' : 'flex-1'}`;
  const line = [
    copies > 0 && fmt(c.owned, { count: copies }),
    wishes > 0 && fmt(c.wished, { count: wishes }),
  ].filter(Boolean);
  return (
    <View className={wide ? 'w-full max-w-[250px] gap-2.5' : 'gap-2'}>
      <View className={wide ? 'gap-2.5' : 'flex-row gap-2'}>
        <Pressable
          role="button"
          aria-busy={add.isPending}
          disabled={add.isPending}
          onPress={onAdd}
          className={`${button} bg-blue ${add.isPending ? 'opacity-60' : ''}`}
        >
          <Text className="font-display text-[15px] font-semibold text-on-blue">
            + {t.card.addToCollection}
          </Text>
        </Pressable>
        <Pressable
          role="button"
          aria-busy={wish.isPending}
          aria-pressed={wished}
          disabled={wish.isPending || wished}
          onPress={onWish}
          className={`${button} border border-line bg-surface`}
        >
          <Text className="font-display text-[15px] font-semibold text-ink">
            {wished ? c.wishAdded : t.card.addToWishlist}
          </Text>
        </Pressable>
      </View>
      <Text role="status" className="font-body text-[12.5px] text-ink-3">
        {!me
          ? c.signInHint
          : add.isError || (wish.isError && !wished)
            ? c.addFailed
            : line.join(' · ')}
      </Text>
    </View>
  );
}

/**
 * The search's "add to collection" under a result: one copy in `language`, into `binderId` when
 * the search was opened from a binder. Says so when it is in.
 */
export function QuickAdd({
  printId,
  name,
  finish,
  language,
  binderId,
}: {
  printId: string;
  name: string;
  finish: string;
  language: string;
  binderId?: string | undefined;
}) {
  const t = useT();
  const add = useAddEntries();
  const c = t.collection;
  return (
    <Pressable
      role="button"
      aria-label={`${t.card.addToCollection}: ${name}`}
      aria-busy={add.isPending}
      disabled={add.isPending}
      onPress={() => add.mutate([{ printId, finish, language, ...(binderId && { binderId }) }])}
      className="h-9 flex-row items-center justify-center rounded-lg border border-line bg-surface px-2"
    >
      <Text
        numberOfLines={1}
        className={`font-display text-[13px] font-semibold ${add.isSuccess ? 'text-ok-ink' : 'text-ink'}`}
      >
        {add.isSuccess ? `✓ ${c.added}` : add.isError ? c.addFailed : c.add}
      </Text>
    </Pressable>
  );
}
