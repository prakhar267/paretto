export const env: Record<string, unknown> = {};
export const waitUntilPromises: Promise<unknown>[] = [];

export function setCloudflareEnv(bindings: Record<string, unknown>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, bindings);
  waitUntilPromises.splice(0);
}

export function waitUntil(promise: Promise<unknown>) {
  waitUntilPromises.push(promise);
}
