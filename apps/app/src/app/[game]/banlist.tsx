import { GameSchema, isFoil } from '@voidbinder/shared';
import {
  banStatus,
  type BanlistCard,
  type BanlistFormat,
  type BanlistImpactResponse,
  type BanlistResponse,
} from '@voidbinder/shared/api';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useBanlist } from '../../api/queries/catalog';
import { useBanlistImpact, useSession } from '../../api/queries/me';
import { BanBadge } from '../../components/banlist/BanBadge';
import { CardImage } from '../../components/catalog/CardImage';
import { day } from '../../components/collection/format';
import { Heading, Page } from '../../components/Shell';
import { Empty, Panel, QueryState, Segmented } from '../../components/ui';
import { fmt, useLocale, useT } from '../../i18n';
import { hitHref, useBrowsingLanguage } from '../../hooks/browsing-language';

// `/yugioh/banlist` (VB-81): the Forbidden & Limited List of the TCG or the OCG, what changed in the
// last 90 days and, for a signed-in user, which of their cards and deck lines it touches.

type Dict = ReturnType<typeof useT>;
const GROUPS = ['forbidden', 'limited', 'semiLimited'] as const;
const small = 'font-display text-xs font-semibold uppercase tracking-wider text-ink-2';

const statusWord = (t: Dict, status: string | null) =>
  status === null ? t.banlist.notInFormat : (t.banlist.status[status] ?? status);

/** One card: thumbnail, name, set code; opens the card page with that print. */
function CardLine({ card, children }: { card: BanlistCard; children?: ReactNode }) {
  const locale = useLocale();
  const lang = useBrowsingLanguage();
  const code =
    card.setCode && card.displayNumber
      ? `${card.setCode.toUpperCase()} ${card.displayNumber}`
      : null;
  return (
    <View role="listitem" className="flex-row items-center gap-3 border-t border-line py-2">
      <Link href={hitHref({ cardId: card.id, id: card.printId, lang }, locale)} asChild>
        <Pressable className="min-w-0 flex-1 flex-row items-center gap-3">
          <View className="w-[30px]">
            <CardImage
              uri={card.imageUrl}
              alt=""
              game="yugioh"
              format={card.cardFormat}
              foil={isFoil('yugioh', card.rarity)}
            />
          </View>
          <View className="min-w-0 flex-1">
            <Text
              numberOfLines={2}
              className="font-display text-[15px] font-semibold leading-5 text-ink"
            >
              {card.name}
            </Text>
            {code && <Text className="font-mono text-xs text-ink-2">{code}</Text>}
          </View>
        </Pressable>
      </Link>
      {children}
    </View>
  );
}

function Groups({ list }: { list: BanlistResponse }) {
  const t = useT();
  const status = {
    forbidden: 'Forbidden',
    limited: 'Limited',
    semiLimited: 'Semi-Limited',
  } as const;
  return (
    <View className="flex-row flex-wrap gap-6">
      {GROUPS.map((g) => (
        <View key={g} className="min-w-[280px] flex-1">
          <Panel>
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Text
                  role="heading"
                  aria-level={2}
                  className="font-display text-lg font-bold text-ink"
                >
                  {t.banlist.groups[g]}
                </Text>
                <BanBadge status={status[g]} />
                <Text className="font-mono text-[13px] text-ink-2">{list.groups[g].length}</Text>
              </View>
              <Text className="font-body text-[13px] text-ink-2">{t.banlist.groupHint[g]}</Text>
            </View>
            {list.groups[g].length ? (
              <View role="list" aria-label={t.banlist.groups[g]}>
                {list.groups[g].map((c) => (
                  <CardLine key={c.id} card={c} />
                ))}
              </View>
            ) : (
              <Text className="font-body text-[15px] text-ink-2">{t.banlist.groupEmpty}</Text>
            )}
          </Panel>
        </View>
      ))}
    </View>
  );
}

/** "Limitiert → Verboten", the new status as a badge where it is a restricted one. */
function Change({ from, to }: { from: string | null; to: string | null }) {
  const t = useT();
  const next = banStatus(to);
  return (
    <View className="flex-row flex-wrap items-center justify-end gap-1.5">
      <Text className="font-body text-[13px] text-ink-2">{statusWord(t, from)} →</Text>
      {next ? (
        <BanBadge status={next} />
      ) : (
        <Text className="font-display text-[13px] font-semibold text-ink">{statusWord(t, to)}</Text>
      )}
    </View>
  );
}

function Changes({ list }: { list: BanlistResponse }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Panel>
      <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
        {t.banlist.changesTitle}
      </Text>
      {list.changes.length ? (
        <View role="list" aria-label={t.banlist.changesTitle}>
          {list.changes.map((c, i) => (
            <CardLine key={`${c.card.id}-${i}`} card={c.card}>
              <View className="items-end gap-0.5">
                <Change from={c.from} to={c.to} />
                <Text className="font-body text-xs text-ink-3">
                  {fmt(t.banlist.seen, { date: day(c.seenAt, locale) })}
                </Text>
              </View>
            </CardLine>
          ))}
        </View>
      ) : (
        <Text className="font-body text-[15px] text-ink-2">{t.banlist.changesNone}</Text>
      )}
    </Panel>
  );
}

function Impact({ impact }: { impact: BanlistImpactResponse }) {
  const t = useT();
  const b = t.banlist;
  if (!impact.collection.length && !impact.decks.length)
    return <Text className="font-body text-[15px] text-ink-2">{b.yoursNone}</Text>;
  return (
    <View className="gap-5">
      {impact.collection.length > 0 && (
        <View className="gap-1">
          <Text className={small}>{b.yoursCollection}</Text>
          <View role="list" aria-label={b.yoursCollection}>
            {impact.collection.map((c) => (
              <CardLine key={c.card.id} card={c.card}>
                <View className="items-end gap-0.5">
                  <Change from={c.change.from} to={c.change.to} />
                  <Text className="font-body text-xs text-ink-2">
                    {fmt(b.owned, { count: c.owned })}
                  </Text>
                </View>
              </CardLine>
            ))}
          </View>
        </View>
      )}
      {impact.decks.length > 0 && (
        <View className="gap-1">
          <Text className={small}>{b.yoursDecks}</Text>
          <View role="list" aria-label={b.yoursDecks}>
            {impact.decks.map((d) => (
              <CardLine key={`${d.deck.id}-${d.card.id}`} card={d.card}>
                <View className="items-end gap-0.5">
                  {d.change && <Change from={d.change.from} to={d.change.to} />}
                  <Link href={`/decks/${d.deck.id}`}>
                    <Text className="font-body text-xs font-semibold text-blue-ink underline">
                      {fmt(b.inDeck, {
                        deck: d.deck.name,
                        count: d.copies,
                        limit: d.limit ?? 0,
                      })}
                    </Text>
                  </Link>
                </View>
              </CardLine>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function Yours({ format }: { format: BanlistFormat }) {
  const t = useT();
  const impact = useBanlistImpact(format, useLocale(), true);
  return (
    <Panel>
      <Text role="heading" aria-level={2} className="font-display text-lg font-bold text-ink">
        {t.banlist.yoursTitle}
      </Text>
      <QueryState query={impact}>{(data) => <Impact impact={data} />}</QueryState>
    </Panel>
  );
}

function Banlist() {
  const t = useT();
  const locale = useLocale();
  const [format, setFormat] = useState<BanlistFormat>('tcg');
  const list = useBanlist(format, locale);
  const { data: me } = useSession();
  const b = t.banlist;
  return (
    <>
      <Heading lede={b.lede}>{b.title}</Heading>
      <Segmented
        label={b.format}
        options={[
          { value: 'tcg', label: 'TCG' },
          { value: 'ocg', label: 'OCG' },
        ]}
        value={format}
        onChange={setFormat}
      />
      <QueryState query={list}>
        {(data) => (
          <View className="gap-6">
            <Text className="font-body text-[15px] text-ink-2">
              {[
                data.effectiveDate
                  ? fmt(b.effective, { date: day(data.effectiveDate, locale) })
                  : data.asOf && fmt(b.asOf, { date: day(data.asOf, locale) }),
                b.source,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {me && <Yours format={format} />}
            <Changes list={data} />
            <Groups list={data} />
          </View>
        )}
      </QueryState>
    </>
  );
}

/** `/[game]/banlist`: Yu-Gi-Oh! has the list; every other game says so. */
export default function BanlistPage() {
  const t = useT();
  const parsed = GameSchema.safeParse(useLocalSearchParams<{ game: string }>().game);
  if (!parsed.success) {
    return (
      <Page title={t.state.notFound} back>
        <Empty>{t.state.notFound}</Empty>
      </Page>
    );
  }
  const game = parsed.data;
  return (
    <Page
      title={t.banlist.title}
      back
      catalog
      crumbs={[{ label: t.games[game], href: `/${game}` }, { label: t.banlist.title }]}
    >
      {game === 'yugioh' ? <Banlist /> : <Empty>{t.banlist.onlyYugioh}</Empty>}
    </Page>
  );
}
