import { fail } from '../errors';
import { supabaseStorage, type StorageUploader } from '../storage';

export function resolveStorage(options: {
  storage?: StorageUploader;
  storageUrl?: string;
  storageKey?: string;
}): StorageUploader {
  if (options.storage) return options.storage;
  const url = options.storageUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = options.storageKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail('STORAGE_CONFIG_REQUIRED', 503);
  return supabaseStorage(url, key);
}
