import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useCard } from '../../api/queries/catalog';
import { Heading, Page } from '../../components/Shell';
import { QueryState } from '../../components/ui';
import { fmt, useT } from '../../i18n';

// VB-35: the final card page (image, prints, rights notice, prices, legality, card text).
export default function CardPage() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useCard(id);
  const name = card.data?.card.name ?? '';
  return (
    <Page
      title={name}
      back
      crumbs={
        card.data
          ? [
              { label: t.games[card.data.card.game], href: `/${card.data.card.game}` },
              { label: name },
            ]
          : [{ label: ' ' }]
      }
    >
      <QueryState query={card}>
        {(data) => (
          <>
            <Heading>{data.card.name}</Heading>
            <Text className="font-body text-ink-2">
              {fmt(t.card.prints, { count: data.prints.length })}
            </Text>
          </>
        )}
      </QueryState>
    </Page>
  );
}
