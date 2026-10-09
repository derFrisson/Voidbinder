import { Heading, Page } from '../components/Shell';
import { Empty } from '../components/ui';
import { useT } from '../i18n';

// VB-35: search with filters. The API has no search endpoint yet, so no data hook here.
export default function Search() {
  const t = useT();
  return (
    <Page title={t.search.title}>
      <Heading>{t.search.title}</Heading>
      <Empty>{t.search.soon}</Empty>
    </Page>
  );
}
