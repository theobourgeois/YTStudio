/**
 * Limit how many async tasks run at once: `const limit = createLimiter(2);
 * await limit(() => work())`. Tasks start in FIFO order.
 */
export function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active < concurrency) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next task so nobody can jump the queue.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
