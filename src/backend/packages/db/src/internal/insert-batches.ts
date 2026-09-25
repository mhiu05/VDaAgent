import type { Driver } from '../driver';

export async function insertBatches(
  tx: Driver,
  prefix: string,
  rows: unknown[][],
  batchSize = 500,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const width = batch[0]?.length ?? 0;
    const values = batch
      .map(
        (_, rowIndex) =>
          `(${Array.from(
            { length: width },
            (_unused, columnIndex) => `$${rowIndex * width + columnIndex + 1}`,
          ).join(',')})`,
      )
      .join(',');
    await tx.query(`${prefix} VALUES ${values}`, batch.flat());
  }
}
