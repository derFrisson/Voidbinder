import { Heading, Page } from '../../components/Shell';
import { Empty } from '../../components/ui';
import { useT } from '../../i18n';

// VB-34: the deck builder. The API has no deck endpoint yet, so no data hook here.
export default function Decks() {
  const t = useT();
  return (
    <Page title={t.decks.title}>
      <Heading>{t.decks.title}</Heading>
      <Empty>{t.decks.soon}</Empty>
    </Page>
  );
}
