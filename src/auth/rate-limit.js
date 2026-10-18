// In-memory failed-login limiter. Counts failures per key within a window;
// a successful login clears the key. Single-process only — enough for one
// Render instance; a multi-instance deploy would need a shared store.

function createLimiter({ max, windowMs, now = () => Date.now() }) {
  let entries = new Map();

  const live = (key) => {
    const e = entries.get(key);
    return e && e.resetAt > now() ? e : null;
  };

  return {
    isBlocked(key) {
      const e = live(key);
      return Boolean(e && e.count >= max);
    },
    retryAfterSeconds(key) {
      const e = live(key);
      return e ? Math.ceil((e.resetAt - now()) / 1000) : 0;
    },
    fail(key) {
      const e = live(key);
      const next = e ? { ...e, count: e.count + 1 } : { count: 1, resetAt: now() + windowMs };
      entries = new Map(entries).set(key, next);
    },
    reset(key) {
      const next = new Map(entries);
      next.delete(key);
      entries = next;
    },
  };
}

module.exports = { createLimiter };
