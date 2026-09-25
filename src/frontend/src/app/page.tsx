import { redirect } from 'next/navigation';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ org_id?: string }>;
}) {
  const { org_id: orgId } = await searchParams;
  redirect(orgId ? `/workspace?org_id=${encodeURIComponent(orgId)}` : '/workspace');
}
