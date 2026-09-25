import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index';

describe('published JSON Schema compatibility', () => {
  it('matches every checked-in schema byte for byte', async () => {
    const directory = resolve('src/backend/packages/contracts/schema');
    const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const exportName = `${name.slice(0, -5)}Schema`;
      const schema = (contracts as Record<string, unknown>)[exportName];
      expect(schema, exportName).toBeDefined();
      const generated = `${JSON.stringify(z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }), null, 2)}\n`;
      expect(generated, name).toBe(await readFile(resolve(directory, name), 'utf8'));
    }
  });
});
