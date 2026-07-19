export const env: Record<string, unknown> = {};

export function setCloudflareEnv(bindings: Record<string, unknown>) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, bindings);
}
