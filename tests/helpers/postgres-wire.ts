import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createRepository } from '../../src/backend/database';
import { postgresDriver } from '../../src/backend/database/driver';
import { createTestDatabase, seedFixtureData } from './postgres';

/** Real postgres.js protocol/serialization against the repository's PostgreSQL DDL. */
export async function createWireTestRepository() {
  const pg = await createTestDatabase();
  const server = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0 });
  await server.start();
  // PGlite has one session: serialize transactions, retaining production codecs.
  const driver = postgresDriver(`postgres://postgres@${server.getServerConn()}/postgres`, {
    max: 1,
  });
  try {
    const repo = await createRepository({ driver });
    await seedFixtureData(driver);
    return {
      repo,
      driver,
      close: async () => {
        await driver.close();
        await server.stop();
        await pg.close();
      },
    };
  } catch (error) {
    await driver.close();
    await server.stop();
    await pg.close();
    throw error;
  }
}
