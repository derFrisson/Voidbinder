import { router, usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cardOptions } from '../../api/queries/catalog';
import { useAddEntries, useOwned } from '../../api/queries/collection';
import { useSession } from '../../api/queries/me';
import { useBrowsingLanguage } from '../../hooks/browsing-language';
import { fmt, useT } from '../../i18n';
import { label } from '../card/attributes';
import { useWide } from '../Shell';
import { hideToast, showToast } from '../Toast';
import { AddDialog, defaultLanguage, printOptions, session, type EntryValues } from './AddDialog';
import { IconButton } from './Controls';

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
 * ("Du hast 2× in deiner Sammlung"). Each opens the add dialog (language, finish, condition,
 * quantity, binder). Signed out, both lead to sign-in and come back here.
 */
export function CollectButtons({
  printId,
  cardId,
  wide,
}: {
  printId: string;
  cardId: string;
  wide: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const { data: me } = useSession();
  const owned = useOwned([printId], !!me);
  const [dialog, setDialog] = useState<'entry' | 'wish' | null>(null);
  const c = t.collection;
  const copies = owned.data?.owned[printId] ?? 0;
  const wishes = owned.data?.wished[printId] ?? 0;
  const wished = wishes > 0;
  const signIn = () => router.push({ pathname: '/sign-in', params: { next: pathname } });
  const open = (kind: 'entry' | 'wish') => (me ? setDialog(kind) : signIn());

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
          aria-haspopup="dialog"
          onPress={() => open('entry')}
          className={`${button} bg-blue`}
        >
          <Text className="font-display text-[15px] font-semibold text-on-blue">
            + {t.card.addToCollection}
          </Text>
        </Pressable>
        <Pressable
          role="button"
          aria-haspopup="dialog"
          aria-pressed={wished}
          disabled={wished}
          onPress={() => open('wish')}
          className={`${button} border border-line bg-surface`}
        >
          <Text className="font-display text-[15px] font-semibold text-ink">
            {wished ? c.wishAdded : t.card.addToWishlist}
          </Text>
        </Pressable>
      </View>
      <Text role="status" className="font-body text-[12.5px] text-ink-3">
        {!me ? c.signInHint : line.join(' · ')}
      </Text>
      {dialog && (
        <AddDialog
          kind={dialog}
          printId={printId}
          cardId={cardId}
          onClose={() => setDialog(null)}
        />
      )}
    </View>
  );
}

/**
 * The quick "add to collection" under a tile (search, set page): one press adds one copy with the
 * defaults (the last used language, else the tile's or the browsing one, when the print has it, else English; the first
 * finish; NM), into `binderId` when the search was opened from a binder, and says so in a toast
 * whose "Ändern" opens the add dialog for that entry. The chevron beside it (wide screens) and a
 * long press open the dialog before adding. The print's languages come from the card, read once
 * when the button is pressed (the card page shares that query).
 */
export function QuickAdd({
  printId,
  cardId,
  name,
  finish,
  binderId,
  lang,
}: {
  printId: string;
  cardId: string;
  name: string;
  finish: string;
  binderId?: string | undefined;
  /** The language the tile shows (a search hit's match, VB-102), in place of the browsing one. */
  lang?: string | undefined;
}) {
  const t = useT();
  const wide = useWide();
  const browsing = useBrowsingLanguage();
  const client = useQueryClient();
  const add = useAddEntries();
  const entryId = useRetryId(printId);
  const [looking, setLooking] = useState(false);
  const [dialog, setDialog] = useState<{ edit?: { id: string; values: EntryValues } } | null>(null);
  const c = t.collection;
  const busy = looking || add.isPending;
  // The toast's "Ändern" opens the dialog of this tile: when the tile goes (next page, filter,
  // navigation) the toast goes with it, instead of a button that does nothing.
  const toastKey = useRef<number | undefined>(undefined);
  // Only the toast this tile showed: without a key, hideToast() would hide any tile's toast.
  useEffect(
    () => () => {
      if (toastKey.current !== undefined) hideToast(toastKey.current);
    },
    [],
  );
  // The toast's button is gone once "Ändern" is pressed, so the dialog opened from it has nothing
  // to return focus to: it goes to this tile's button. (After a tick, so the dialog's own focus
  // trap has let go first.)
  const button = useRef<View>(null);
  const closeDialog = () => {
    const fromToast = !!dialog?.edit;
    setDialog(null);
    if (fromToast) setTimeout(() => button.current?.focus(), 0);
  };
  const onAdd = async () => {
    setLooking(true);
    // Without the card (offline, error) English is the safe language.
    const data = await client.fetchQuery(cardOptions(cardId)).catch(() => undefined);
    setLooking(false);
    const values: EntryValues = {
      language: defaultLanguage(printOptions(data, printId).languages, lang ?? browsing),
      finish,
      condition: 'NM',
      quantity: 1,
      binderId,
    };
    const id = entryId.take();
    add.mutate([{ id, printId, ...values }], {
      onSuccess: () => {
        entryId.done();
        session.language = values.language;
        toastKey.current = showToast({
          text: fmt(c.dialog.addedAs, {
            details: `${values.language.toUpperCase()} · ${label(t.card.finishes, finish)} · ${values.condition}`,
          }),
          action: { label: c.dialog.change, onPress: () => setDialog({ edit: { id, values } }) },
        });
      },
    });
  };
  return (
    <View className="flex-row gap-1">
      <Pressable
        ref={button}
        role="button"
        aria-label={`${t.card.addToCollection}: ${name}`}
        aria-busy={busy}
        disabled={busy}
        onPress={onAdd}
        onLongPress={() => setDialog({})}
        className="h-9 flex-1 flex-row items-center justify-center rounded-lg border border-line bg-surface px-2"
      >
        <Text
          numberOfLines={1}
          className={`font-display text-[13px] font-semibold ${add.isSuccess ? 'text-ok-ink' : 'text-ink'}`}
        >
          {add.isSuccess ? `✓ ${c.added}` : add.isError ? c.addFailed : c.add}
        </Text>
      </Pressable>
      {wide && (
        <IconButton
          icon="down"
          label={fmt(c.dialog.options, { name })}
          haspopup
          onPress={() => setDialog({})}
        />
      )}
      {dialog && (
        <AddDialog
          kind="entry"
          printId={printId}
          cardId={cardId}
          binderId={binderId}
          edit={dialog.edit}
          onClose={closeDialog}
        />
      )}
    </View>
  );
}
