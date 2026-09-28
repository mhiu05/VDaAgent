import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createRepository } from '../../packages/db/src/index';
import { postgresDriver } from '../../packages/db/src/driver';
import { createTestDatabase } from './postgres';

/** Real postgres.js protocol/serialization against the repository's PostgreSQL DDL. */
export async function createWireTestRepository() {
  const pg = await createTestDatabase();
  const server = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
  await server.start();
  // PGlite has one session: serialize transactions, retaining production codecs.
  const driver = postgresDriver(`postgres://postgres@${server.getServerConn()}/postgres`, { max: 1 });
  try {
    const repo = await createRepository({ driver, seedTestData: true });
    return { repo, driver, close: async () => {
      await driver.close();
      await server.stop();
      await pg.close();
    } };
  } catch (error) {
    await driver.close();
    await server.stop();
    await pg.close();
    throw error;
  }
}
