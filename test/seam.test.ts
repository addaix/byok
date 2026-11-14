/**
 * The entry boundaries: the core entry (`byok`) loads no AI SDK and no React, so a settings page
 * and a host's schema can import it for free; only `call.ts` and the drivers import the SDK.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
const imports = (text: string, name: string) =>
  new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*|\\bimport\\(\\s*|\\brequire\\(\\s*)['"]${name}['"]`).test(text);

describe('the entries', () => {
  const sources = files(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

  it('only call.ts and the drivers import an AI SDK', () => {
    const offenders = sources.filter((s) => imports(s.text, `(?:ai|@ai-sdk/[^'"]+)`)).map((s) => s.path);
    expect(offenders.sort()).toEqual(['call.ts', 'services/anthropic.ts', 'services/driver.ts', 'services/google.ts', 'services/openai.ts']);
  });

  it('only the React entry imports React', () => {
    const offenders = sources.filter((s) => imports(s.text, 'react(?:-dom)?(?:/[^\'"]*)?')).map((s) => s.path);
    expect(offenders).toEqual(['react/index.tsx']);
  });
});
