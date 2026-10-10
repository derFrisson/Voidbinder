import type { Locale } from '@voidbinder/shared';
import { router, usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cardOptions } from '../../api/queries/catalog';
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
 * A client id for the next add that survives a failed try: pressing the button again after an
 * error sends the same id (the API adds nothing twice), a press after a success gets a new one.
 */
function useRetryId(forId: string) {
  // The pending id belongs to one print: picking another print on the same page starts fresh.
  const ref = useRef<{ forId: string; id: string } | undefined>(undefined);
  return {
    take: () => {
      if (ref.current?.forId !== forId) ref.current = { forId, id: crypto.randomUUID() };
      return ref.current.id;
    },
    done: () => {
      ref.current = undefined;
    },
  };
}

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
  const entryId = useRetryId(print.id);
  const wishId = useRetryId(print.id);
  const c = t.collection;
  const copies = owned.data?.owned[print.id] ?? 0;
  const wishes = owned.data?.wished[print.id] ?? 0;
  // A wish for this print exists already: the API answers 409, which reads as "on the list".
  const wished = wishes > 0 || (wish.error instanceof ApiError && wish.error.status === 409);
  const signIn = () => router.push({ pathname: '/sign-in', params: { next: pathname } });

  const onAdd = () =>
    me
      ? add.mutate(
          [
            {
              id: entryId.take(),
              printId: print.id,
              finish: print.finishes[0] ?? 'normal',
              language: entryLanguage(print, locale),
            },
          ],
          { onSuccess: entryId.done },
        )
      : signIn();
  const onWish = () =>
    me
      ? wish.mutate([{ id: wishId.take(), printId: print.id }], { onSuccess: wishId.done })
      : signIn();

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
 * The search's "add to collection" under a result: one copy, into `binderId` when the search was
 * opened from a binder. Says so when it is in. The language follows the card page's rule (the
 * user's when the print has it, else English), which needs the card's localizations: read once
 * when the button is pressed (the card page shares that query).
 */
export function QuickAdd({
  printId,
  cardId,
  name,
  finish,
  binderId,
}: {
  printId: string;
  cardId: string;
  name: string;
  finish: string;
  binderId?: string | undefined;
}) {
  const t = useT();
  const locale = useLocale();
  const client = useQueryClient();
  const add = useAddEntries();
  const entryId = useRetryId(printId);
  const [looking, setLooking] = useState(false);
  const c = t.collection;
  const busy = looking || add.isPending;
  const onAdd = async () => {
    setLooking(true);
    // Without the card (offline, error) English is the safe language.
    const langs = await client
      .fetchQuery(cardOptions(cardId))
      .then((d) => d.prints.find((p) => p.id === printId)?.localizations.map((l) => l.lang) ?? [])
      .catch(() => []);
    setLooking(false);
    add.mutate(
      [
        {
          id: entryId.take(),
          printId,
          finish,
          language: entryLanguage({ id: printId, finishes: [finish], langs }, locale),
          ...(binderId && { binderId }),
        },
      ],
      { onSuccess: entryId.done },
    );
  };
  return (
    <Pressable
      role="button"
      aria-label={`${t.card.addToCollection}: ${name}`}
      aria-busy={busy}
      disabled={busy}
      onPress={onAdd}
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
