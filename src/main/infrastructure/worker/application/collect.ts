import type { ISignalRepo, Collector } from './ports.js';
import type { Signal, CollectorStat } from '../domain/types.js';

export async function runCollect(
  repo: ISignalRepo,
  collectors: Collector[],
): Promise<{ signals: Signal[]; stats: CollectorStat[] }> {
  const saved: Signal[] = [];
  const stats: CollectorStat[] = [];

  for (const collector of collectors) {
    try {
      const collected = await collector.collect();
      for (const signal of collected) {
        const isNew = await repo.save(signal);
        if (isNew) saved.push(signal);
      }
      stats.push({ id: collector.id, count: collected.length });
    } catch (e) {
      stats.push({
        id:    collector.id,
        count: 0,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  }

  return { signals: saved, stats };
}
