// A minimal stand-in for the real supabase-js query builder, used to unit
// test API routes without a real database. Every `.from(table)` call starts
// a fresh chain that records every method called on it (for assertions like
// "did the insert set status: booked?") and resolves -- whenever it's
// awaited, from any point in the chain, matching how the real builder is
// thenable at every step -- to the next queued { data, error } response.
//
// Responses are consumed in the same order the route calls `.from()`, so a
// test configures them in call order: the first `.from()` in the route gets
// the first queued response, the second gets the second, and so on.
export function createSupabaseMock() {
  const queue = [];
  const callLog = [];

  const CHAIN_METHODS = ["select", "insert", "update", "eq", "neq", "order", "single", "maybeSingle"];

  function from(table) {
    const record = { table, calls: [] };
    callLog.push(record);

    const resolveValue = () => (queue.length ? queue.shift() : { data: null, error: null });

    const chain = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = (...args) => {
        record.calls.push({ method, args });
        return chain;
      };
    }
    chain.then = (onFulfilled, onRejected) => Promise.resolve(resolveValue()).then(onFulfilled, onRejected);
    chain.catch = (onRejected) => Promise.resolve(resolveValue()).catch(onRejected);
    return chain;
  }

  return {
    from,
    /** Queue the { data, error } the next `.from()` call chain resolves to. */
    mockResponse(response) {
      queue.push(response);
    },
    /** One entry per `.from()` call, in order, with every chained method + its args. */
    callLog,
  };
}
