/**
 * Frontmatter stringification helper that preserves Unicode characters.
 *
 * gray-matter's default YAML engine binds `js-yaml`'s `safeDump`/`dump`
 * with no options, which writes non-BMP Unicode (e.g. the 🤖 / 👤 reviewer
 * icons used by confidence annotations) as YAML 1.1 `\U0001F916`-style
 * escapes inside double-quoted scalars. Setting `noCompatMode: true` on
 * the `js-yaml` dump options disables YAML 1.1 compatibility so the
 * literal Unicode character is emitted in a plain scalar.
 *
 * @implements {S003.§4.AC.04} bare payload value, dated and no-date
 */

import matter from 'gray-matter';
import yaml from 'js-yaml';

const yamlEngine = {
  parse: (input: string) => (yaml.load(input) ?? {}) as object,
  stringify: (obj: unknown) => yaml.dump(obj, { noCompatMode: true }),
};

export function stringifyFrontmatter(
  content: string,
  data: Record<string, unknown>,
): string {
  return matter.stringify(content, data, { engines: { yaml: yamlEngine } });
}
