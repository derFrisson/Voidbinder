import { Heading, Page } from '../../components/Shell';
import { Empty } from '../../components/ui';
import { useT } from '../../i18n';

// VB-31: the collection (have and want lists, binders, value). The API has no collection
// endpoint yet, so no data hook here.
export default function Collection() {
  const t = useT();
  return (
    <Page title={t.collection.title}>
      <Heading>{t.collection.title}</Heading>
      <Empty>{t.collection.soon}</Empty>
    </Page>
  );
}
