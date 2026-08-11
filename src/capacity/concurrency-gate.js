"use strict";

function createConcurrencyGate({ globalLimit, perKeyLimit = 1 }) {
  const globalMax = Math.max(1, Number(globalLimit) || 1);
  const keyMax = Math.max(1, Number(perKeyLimit) || 1);
  const activeByKey = new Map();
  let active = 0;

  return Object.freeze({
    tryAcquire(key) {
      const normalized = String(key || "anonymous");
      const keyActive = activeByKey.get(normalized) || 0;
      if (active >= globalMax || keyActive >= keyMax) return null;
      active += 1;
      activeByKey.set(normalized, keyActive + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        const remaining = Math.max(0, (activeByKey.get(normalized) || 1) - 1);
        if (remaining) activeByKey.set(normalized, remaining);
        else activeByKey.delete(normalized);
      };
    },
    snapshot() {
      return { active, globalLimit: globalMax, activeKeys: activeByKey.size, perKeyLimit: keyMax };
    }
  });
}

module.exports = { createConcurrencyGate };
