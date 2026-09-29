import type { Role } from '@vda/contracts/common/primitives';
import type { Session } from '@vda/contracts/auth/session';
import type { Driver } from '../driver';
import { fail } from '../errors';

export async function authorizeInTransaction(
  tx: Driver,
  user: string,
  org: string,
  write = false,
): Promise<Role> {
  const rows = await tx.query(
    'SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2 FOR SHARE',
    [org, user],
  );
  const role = rows[0]?.role as Role | undefined;
  if (!role) fail('WORKSPACE_FORBIDDEN', 403);
  if (write && role === 'viewer') fail('VIEWER_READ_ONLY', 403);
  if (!write) {
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
    await tx.query('SET LOCAL ROLE authenticated');
  }
  return role;
}

export function readSession(db: Driver, user: string, email: string): Promise<Session> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
    await tx.query('SET LOCAL ROLE authenticated');
    const rows = await tx.query(
      'SELECT m.org_id,m.role,o.name FROM organization_members m JOIN organizations o ON o.org_id=m.org_id WHERE m.user_id=$1',
      [user],
    );
    if (!rows.length) fail('NO_WORKSPACE', 403);
    return {
      user_id: user,
      email,
      mode: 'supabase',
      organizations: rows as Session['organizations'],
    };
  });
}
