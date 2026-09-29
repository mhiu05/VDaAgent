import { Workspace } from '../../../features/workspace/workspace';

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <Workspace route={{ page: 'chat', conversationId }} />;
}
