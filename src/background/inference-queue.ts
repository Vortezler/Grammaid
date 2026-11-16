// All local engines share the single WASM runtime. A failed job never blocks later work.
let chain: Promise<unknown> = Promise.resolve();
export function inferenceJob<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.catch(() => undefined);
  return run;
}
