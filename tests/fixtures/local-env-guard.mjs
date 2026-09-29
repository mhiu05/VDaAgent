const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

for (const name of ['SUPABASE_DB_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const value = process.env[name];
  if (!value || !localHosts.has(new URL(value).hostname)) {
    throw new Error(`E2E_REQUIRES_LOCAL_${name}`);
  }
}
