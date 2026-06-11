// Substrate OS — event bus (contract §6).
// Plain Map-of-Sets. emit() is synchronous; handlers are isolated by try/catch.

const handlers = new Map();

export const bus = {
  on(evt, fn) {
    let set = handlers.get(evt);
    if (!set) {
      set = new Set();
      handlers.set(evt, set);
    }
    set.add(fn);
  },

  off(evt, fn) {
    const set = handlers.get(evt);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) handlers.delete(evt);
  },

  emit(evt, payload) {
    const set = handlers.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`bus: handler for "${evt}" threw`, err);
      }
    }
  },
};
