import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from '../../../src/contracts';

const schemaDirectory = fileURLToPath(new URL('../../../src/contracts/schema/', import.meta.url));

describe('public contract schemas', () => {
  it('matches every checked-in JSON schema byte for byte', async () => {
    const names = (await readdir(schemaDirectory)).filter((name) => name.endsWith('.json')).sort();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const schema = (contracts as Record<string, unknown>)[`${name.slice(0, -5)}Schema`];
      expect(schema, name).toBeDefined();
      const generated = `${JSON.stringify(z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }), null, 2)}\n`;
      expect(generated, name).toBe(await readFile(resolve(schemaDirectory, name), 'utf8'));
    }
  });
});
