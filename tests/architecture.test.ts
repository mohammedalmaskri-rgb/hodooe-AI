import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard rail: face DETECTION (live scan) must stay separate from identity data.
// The scanning code may not import students, reference photos or any matching code.

const ROOT = join(__dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f: string) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

const scanFiles = [...files(join(ROOT, 'vision')), ...files(join(ROOT, 'camera')), ...files(join(ROOT, 'pages', 'teacher'))];

describe('detection is separate from identity', () => {
  it('has scanning files to check', () => expect(scanFiles.length).toBeGreaterThan(5));

  it.each(scanFiles.map((f) => [f.slice(ROOT.length + 1), f]))('%s does not touch student identity data', (_n, file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).not.toMatch(/from ['"][./]*(db\/)?(students|photos)['"]/);
    expect(src).not.toMatch(/db\/(students|photos)/);
    expect(src).not.toMatch(/\b(getPhoto|listStudents|getStudent)\b/);
    expect(src).not.toMatch(/getAll\(\s*['"](students|photos)['"]/);
  });

  it('vision engine has no storage access at all', () => {
    for (const f of files(join(ROOT, 'vision'))) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/indexedDB|localStorage|from ['"].*\/db\//);
    }
  });
});
