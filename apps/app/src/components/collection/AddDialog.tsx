import { TCG_LANGUAGES_BY_GAME, type Game } from '@voidbinder/shared';
import type { CardResponse, CollectionCondition } from '@voidbinder/shared/api';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cardOptions } from '../../api/queries/catalog';
import {
  useAddEntries,
  useAddWishes,
  useBinders,
  useUpdateEntry,
} from '../../api/queries/collection';
import { ApiError } from '../../api/queries/http';
import { useBrowsingLanguage } from '../../hooks/browsing-language';
import { useT } from '../../i18n';
import { label } from '../card/attributes';
import { useWide } from '../Shell';
import { Button, ErrorState, Loading, Note, Segmented } from '../ui';
import { FieldLabel, IconButton, Select, Stepper } from './Controls';
import { CONDITIONS } from './format';

// VB-80: what a copy is (language, finish, condition, quantity, binder, note), chosen while
// adding it. A sheet on phones, a centred dialog on wider screens; React Native's Modal is the
// dialog on the web too (role="dialog", aria-modal, focus trap, Escape, focus back on close).

/**
 * The languages a copy of a print can be added in. Yu-Gi-Oh! keeps one print per set number with
 * the languages as localizations, so every TCG language is offered, the localized ones first;
 * the other games offer the print's localizations. English when nothing is known.
 */
export function languageOptions(game: Game | undefined, langs: readonly string[]): string[] {
  const tcg = game ? TCG_LANGUAGES_BY_GAME[game] : undefined;
  const list = tcg ? [...tcg.filter((l) => langs.includes(l)), ...langs, ...tcg] : langs;
  const unique = [...new Set(list)];
  return unique.length > 0 ? unique : ['en'];
}

/** The language last added in, for the next add; lives as long as the tab (this session). */
export const session: { language: string | undefined } = { language: undefined };

/** The first of: the last used language, the browsing language, English, that the print has. */
export const defaultLanguage = (options: readonly string[], browsing: string) =>
  [session.language, browsing, 'en'].find((l) => l !== undefined && options.includes(l)) ??
  options[0] ??
  'en';

export type EntryValues = {
  language: string;
  finish: string;
  condition: CollectionCondition;
  quantity: number;
  binderId?: string | undefined;
};

/** The finishes and languages of one print of a loaded card. */
export function printOptions(data: CardResponse | undefined, printId: string) {
  const print = data?.prints.find((p) => p.id === printId);
  return {
    languages: languageOptions(data?.card.game, print?.localizations.map((l) => l.lang) ?? []),
    finishes: print?.finishes.length ? print.finishes : ['normal'],
  };
}

const ANY = 'any';
const orNull = (v: string) => (v === ANY ? null : v);

type Props = {
  printId: string;
  cardId: string;
  kind: 'entry' | 'wish';
  /** Change the entry just added (the toast's "Ändern") instead of adding one. */
  edit?: { id: string; values: EntryValues } | undefined;
  /** The binder preselected (the search opened from a binder). */
  binderId?: string | undefined;
  onClose: () => void;
};

export function AddDialog(props: Props) {
  const t = useT();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const titleId = useId();
  const card = useQuery(cardOptions(props.cardId));
  const d = t.collection.dialog;
  const title = props.edit ? d.editTitle : props.kind === 'wish' ? d.wishTitle : d.title;
  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={props.onClose}
      aria-labelledby={titleId}
    >
      {/* The phone's sheet stays below the status bar and, on iOS, rises above the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={wide ? undefined : { paddingTop: insets.top }}
        className={`flex-1 ${wide ? 'items-center justify-center p-6' : 'justify-end'}`}
      >
        <View
          className={`z-10 max-h-full w-full border border-line bg-surface ${wide ? 'max-w-[520px] rounded-2xl' : 'rounded-t-2xl'}`}
        >
          <View className="flex-row items-center justify-between gap-3 border-b border-line px-5 py-3">
            <Text
              nativeID={titleId}
              role="heading"
              aria-level={2}
              className="flex-1 font-display text-lg font-bold text-ink"
            >
              {title}
            </Text>
            <IconButton icon="close" label={t.collection.edit.close} onPress={props.onClose} />
          </View>
          {card.data ? (
            <Form {...props} data={card.data} />
          ) : (
            <View className="px-5">
              {card.isError ? <ErrorState onRetry={() => void card.refetch()} /> : <Loading />}
            </View>
          )}
        </View>
        {/* The scrim: a tap outside closes, like Escape; not a tab stop (the close button is). */}
        <Pressable
          aria-hidden
          tabIndex={-1}
          onPress={props.onClose}
          className="absolute inset-0 bg-phone opacity-50"
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Form({ printId, kind, edit, binderId, onClose, data }: Props & { data: CardResponse }) {
  const t = useT();
  const wide = useWide();
  const browsing = useBrowsingLanguage();
  const insets = useSafeAreaInsets();
  const binders = useBinders();
  const add = useAddEntries();
  const addWish = useAddWishes();
  const update = useUpdateEntry();
  const c = t.collection;
  const e = c.edit;
  const wish = kind === 'wish';
  const start = edit?.values;
  const options = printOptions(data, printId);
  const languages = [...new Set([...options.languages, ...(start ? [start.language] : [])])];
  const finishes = [...new Set([...options.finishes, ...(start ? [start.finish] : [])])];
  const [language, setLanguage] = useState(
    start?.language ?? (wish ? ANY : defaultLanguage(languages, browsing)),
  );
  const [finish, setFinish] = useState(start?.finish ?? (wish ? ANY : (finishes[0] ?? 'normal')));
  const [condition, setCondition] = useState<string>(start?.condition ?? (wish ? ANY : 'NM'));
  const [quantity, setQuantity] = useState(start?.quantity ?? 1);
  const [binder, setBinder] = useState(start?.binderId ?? binderId ?? '');
  const [note, setNote] = useState('');
  // One client id per dialog: pressing "Hinzufügen" again after an error adds nothing twice.
  const [id] = useState(() => crypto.randomUUID());

  const wishTaken = addWish.error instanceof ApiError && addWish.error.status === 409;
  const failed = add.isError || update.isError || (addWish.isError && !wishTaken);
  const busy = add.isPending || update.isPending || addWish.isPending;
  const text = note.trim();
  const added = () => {
    session.language = language;
    onClose();
  };
  const submit = () => {
    if (wish) {
      addWish.mutate(
        [
          {
            id,
            printId,
            quantity,
            language: orNull(language),
            finish: finishes.length > 1 ? orNull(finish) : null,
            minCondition: orNull(condition) as CollectionCondition | null,
            ...(text && { note: text }),
          },
        ],
        // A wish for this print exists already (409): it is on the list, which is what was asked.
        {
          onSuccess: onClose,
          onError: (err) => err instanceof ApiError && err.status === 409 && onClose(),
        },
      );
    } else if (edit) {
      update.mutate(
        {
          id: edit.id,
          language,
          finish,
          condition: condition as CollectionCondition,
          quantity,
          binderId: binder || null,
          ...(text && { note: text }),
        },
        { onSuccess: added },
      );
    } else {
      add.mutate(
        [
          {
            id,
            printId,
            language,
            finish,
            condition: condition as CollectionCondition,
            quantity,
            ...(binder && { binderId: binder }),
            ...(text && { note: text }),
          },
        ],
        { onSuccess: added },
      );
    }
  };

  const any = wish ? [{ value: ANY, label: c.languages.any ?? ANY }] : [];
  return (
    <>
      <ScrollView contentContainerClassName="gap-4 px-5 py-4">
        <Segmented
          label={e.language}
          value={language}
          onChange={setLanguage}
          options={[
            ...any,
            ...languages.map((l) => ({
              value: l,
              label: l.toUpperCase(),
              // Full name plus the visible code, so voice control finds "ES" too (WCAG 2.5.3).
              name: `${c.languages[l] ?? l.toUpperCase()} (${l.toUpperCase()})`,
            })),
          ]}
        />
        {finishes.length > 1 && (
          <Segmented
            label={e.finish}
            value={finish}
            onChange={setFinish}
            options={[
              ...(wish ? [{ value: ANY, label: c.anyFinish }] : []),
              ...finishes.map((f) => ({ value: f, label: label(t.card.finishes, f) })),
            ]}
          />
        )}
        <Segmented
          label={wish ? c.wish.minCondition : e.condition}
          value={condition}
          onChange={setCondition}
          options={[
            ...(wish ? [{ value: ANY, label: c.anyFinish }] : []),
            ...CONDITIONS.map((v) => ({ value: v, label: v })),
          ]}
        />
        <View className={wide ? 'flex-row flex-wrap gap-x-6 gap-y-4' : 'gap-4'}>
          <View className="gap-1.5">
            <FieldLabel>{e.quantity}</FieldLabel>
            <Stepper
              value={quantity}
              onChange={setQuantity}
              max={99}
              label={{ less: e.less, more: e.more }}
            />
          </View>
          {!wish && (binders.data?.binders.length ?? 0) > 0 && (
            <Select
              label={e.binder}
              value={binder}
              onChange={setBinder}
              options={[
                { value: '', label: e.noBinder },
                ...(binders.data?.binders ?? []).map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          )}
        </View>
        {!edit && (
          <View className="gap-1.5">
            <FieldLabel>{e.note}</FieldLabel>
            <TextInput
              aria-label={e.note}
              value={note}
              onChangeText={setNote}
              maxLength={500}
              className="h-11 rounded-xl border border-line bg-surface px-3 font-body text-[15px] text-ink"
            />
          </View>
        )}
        {failed && <Note tone="error">{c.addFailed}</Note>}
      </ScrollView>
      <View
        // The sheet ends at the screen's edge: clear of the home indicator.
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        className={`border-t border-line px-5 pt-3 ${wide ? 'flex-row justify-end gap-2' : 'gap-2'}`}
      >
        {wide && <Button variant="ghost" label={e.cancel} onPress={onClose} />}
        <Button
          label={edit ? e.save : wish ? c.dialog.wish : c.dialog.add}
          onPress={submit}
          busy={busy}
          wide={!wide}
        />
      </View>
    </>
  );
}
