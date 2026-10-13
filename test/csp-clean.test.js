import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}

test('source JavaScript and index.html contain no inline event attributes or javascript URLs', async () => {
  const files = [...await sourceFiles(new URL('../src/', import.meta.url)), new URL('../index.html', import.meta.url)];
  const violations = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (/\bon[a-z]+\s*=\s*["']/i.test(line) || /javascript\s*:/i.test(line)
        || /\.setAttribute\s*\(\s*["']on[a-z]+["']/i.test(line)) {
        violations.push(`${fileURLToPath(file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, [], `CSP regressions:\n${violations.join('\n')}`);
});
