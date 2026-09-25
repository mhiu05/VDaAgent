import { Workspace } from '../../../features/workspace/workspace';

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <Workspace route={{ page: 'runs', runId }} />;
}
