import type { ISignalRepo } from './ports.js';
import type { Signal } from '../domain/types.js';

export async function runCollect(
  repo: ISignalRepo,
  collectors: Array<() => Promise<Signal[]>>,
): Promise<void> {
  for (const collector of collectors) {
    const signals = await collector();
    for (const signal of signals) {
      await repo.save(signal);
    }
  }
}
