export interface StorageUploader {
  upload(input: {
    bucket: 'source-imports' | 'report-exports';
    path: string;
    body: string;
    contentType: string;
    allowExisting?: boolean;
  }): Promise<void>;
}

export class StorageError extends Error {
  constructor(public code: 'STORAGE_CONFIG_REQUIRED' | 'STORAGE_UPLOAD_FAILED') {
    super(code);
  }
}

export function supabaseStorage(url: string, key: string): StorageUploader {
  const endpoint = new URL('/storage/v1/object/', url).toString();
  return {
    async upload({ bucket, path, body, contentType, allowExisting = false }) {
      const response = await fetch(`${endpoint}${bucket}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          'Content-Type': contentType,
          'x-upsert': 'false',
        },
        body,
      });
      if (response.ok || (allowExisting && response.status === 409)) return;
      throw new StorageError('STORAGE_UPLOAD_FAILED');
    },
  };
}
