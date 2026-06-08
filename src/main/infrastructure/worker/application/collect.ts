import type { ISignalRepo, Collector } from './ports.js';
import type { Signal } from '../domain/types.js';

export async function runCollect(
  repo: ISignalRepo,
  collectors: Collector[],
): Promise<Signal[]> {
  const saved: Signal[] = [];
  for (const collector of collectors) {
    const signals = await collector.collect();
    for (const signal of signals) {
      const isNew = await repo.save(signal);
      if (isNew) saved.push(signal);
    }
  }
  return saved;
}
