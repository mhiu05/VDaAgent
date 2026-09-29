import { Workspace } from '../../../features/workspace/workspace';

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  return <Workspace route={{ page: 'reports', reportId }} />;
}
