/** Serializes filesystem work and throttles automatic checks per exact source. */
export function createLocalRefreshScheduler(intervalMs: number, now = () => Date.now()) {
  const checked = new Map<string, number>();
  const running = new Map<string, Promise<boolean>>();
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(key: string, manual: boolean, current: () => boolean, work: () => Promise<boolean>): Promise<boolean> {
      // A manual rescan waits for a running automatic check, then still performs
      // its own stat/tag/image pass. Automatic callers can share one check.
      if (!manual && running.has(key)) return running.get(key)!;
      const run = tail.catch(() => {}).then(async () => {
        if (!current()) return false;
        if (!manual && now() - (checked.get(key) ?? -Infinity) < intervalMs) return false;
        checked.set(key, now());
        if (checked.size > 32) checked.delete(checked.keys().next().value!);
        return work();
      });
      tail = run;
      running.set(key, run);
      void run.finally(() => { if (running.get(key) === run) running.delete(key); }).catch(() => {});
      return run;
    },
  };
}
