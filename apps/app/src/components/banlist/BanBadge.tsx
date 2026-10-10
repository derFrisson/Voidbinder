import type { Game } from '@voidbinder/shared';
import {
  BAN_STATUSES,
  banStatus,
  type BanlistFormat,
  type BanlistResponse,
  type BanStatus,
} from '@voidbinder/shared/api';
import { Text, View } from 'react-native';
import { useBanlist } from '../../api/queries/catalog';
import { fmt, useLocale, useT } from '../../i18n';

// Ban list badges (VB-81): Forbidden in ink, Limited outlined, Semi-Limited quiet, so the strictest
// reads first without a second action colour (docs/app/design.md).

const TONE: Record<BanStatus, string> = {
  Forbidden: 'bg-ink text-page',
  Limited: 'border border-ink bg-surface text-ink',
  'Semi-Limited': 'border border-line bg-surface-2 text-ink',
};

/** The status of each listed card, built once per answer, shared by every tile. */
const statuses = new WeakMap<BanlistResponse, Map<string, BanStatus>>();
function statusOf(list: BanlistResponse, cardId: string): BanStatus | null {
  let map = statuses.get(list);
  if (!map) {
    const { forbidden, limited, semiLimited } = list.groups;
    map = new Map<string, BanStatus>([
      ...forbidden.map((c) => [c.id, 'Forbidden'] as const),
      ...limited.map((c) => [c.id, 'Limited'] as const),
      ...semiLimited.map((c) => [c.id, 'Semi-Limited'] as const),
    ]);
    statuses.set(list, map);
  }
  return map.get(cardId) ?? null;
}

/**
 * A card's restricted status on the ban list of `format` (TCG by default), from the one cached
 * list; null for every other game and for an unrestricted card.
 */
export function useBanStatus(
  game: Game,
  cardId: string,
  format: BanlistFormat = 'tcg',
): BanStatus | null {
  const list = useBanlist(game === 'yugioh' ? format : null, useLocale());
  return list.data ? statusOf(list.data, cardId) : null;
}

/** A deck line's status from the copies its format allows (Yu-Gi-Oh!: 0, 1, 2). */
export const statusFromLimit = (limit: number | null): BanStatus | null =>
  limit === null ? null : (BAN_STATUSES[limit] ?? null);

/** "TCG: Limitiert" for screen readers and wherever the list is not obvious. */
export function useBanLabel() {
  const t = useT();
  return (status: BanStatus, format: BanlistFormat = 'tcg') =>
    fmt(t.banlist.badge, {
      format: format.toUpperCase(),
      status: t.banlist.status[status] ?? status,
    });
}

/** The badge; `format` adds the list's name ("OCG: Verboten"). */
export function BanBadge({
  status,
  format,
  size = 'sm',
}: {
  status: BanStatus;
  format?: BanlistFormat | undefined;
  size?: 'sm' | 'md';
}) {
  const t = useT();
  const label = useBanLabel();
  const text = t.banlist.status[status] ?? status;
  return (
    <Text
      className={`self-start rounded-md font-display font-semibold ${size === 'md' ? 'px-2.5 py-1 text-[13px]' : 'px-1.5 py-0.5 text-[11px]'} ${TONE[status]}`}
    >
      {format ? label(status, format) : text}
    </Text>
  );
}

/** The badges of a card page: TCG and OCG when they differ, one badge when they agree. */
export function CardBanBadges({ legalities }: { legalities: Record<string, string> }) {
  const tcg = banStatus(legalities.tcg);
  const ocg = banStatus(legalities.ocg);
  if (!tcg && !ocg) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {tcg === ocg && tcg ? (
        <BanBadge status={tcg} size="md" />
      ) : (
        <>
          {tcg && <BanBadge status={tcg} format="tcg" size="md" />}
          {ocg && <BanBadge status={ocg} format="ocg" size="md" />}
        </>
      )}
    </View>
  );
}
