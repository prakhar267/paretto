import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const FRENCH_AUDIO_MANIFEST_MODULE =
  "virtual:pas-a-pas-french-audio-manifest";

const resolvedModuleId = `\0${FRENCH_AUDIO_MANIFEST_MODULE}`;

type ManifestPluginContext = {
  addWatchFile(path: string): void;
};

type ManifestPlugin = {
  name: string;
  configResolved(config: { root: string }): void;
  resolveId(id: string): string | null;
  load(this: ManifestPluginContext, id: string): Promise<string | null>;
};

/**
 * Exposes the public audio manifest to application code without importing a
 * public-directory file, which Vite intentionally forbids. The public JSON
 * remains the single release source of truth and is watched during development.
 */
export function frenchAudioManifest(): ManifestPlugin {
  let root = process.cwd();

  return {
    name: "pas-a-pas-french-audio-manifest",
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === FRENCH_AUDIO_MANIFEST_MODULE ? resolvedModuleId : null;
    },
    async load(id) {
      if (id !== resolvedModuleId) return null;
      const manifestPath = resolve(root, "public/audio/fr/manifest.json");
      this.addWatchFile(manifestPath);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      return `export default ${JSON.stringify(manifest)};`;
    },
  };
}
