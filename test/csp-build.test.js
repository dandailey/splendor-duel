import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));

test('production build uses local external scripts and relative existing assets under CSP', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'splendor-csp-dist-'));
  let dom;
  try {
    await promisify(execFile)(process.execPath,
      [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'],
      { cwd: root, timeout: 30_000 });
    const html = await readFile(join(dist, 'index.html'), 'utf8');
    const app = await readFile(join(dist, 'assets/app.js'), 'utf8');
    dom = new JSDOM(html);
    const document = dom.window.document;
    const scripts = [...document.querySelectorAll('script')];
    assert.ok(scripts.length > 0, 'app script exists');
    assert.equal(document.querySelectorAll('script:not([src])').length, 0, 'no inline scripts');
    assert.ok(scripts.some(script => script.type === 'module' && script.getAttribute('src') === './assets/app.js'));
    assert.doesNotMatch(html, /\bon[a-z]+\s*=/i, 'no inline event attributes');
    assert.doesNotMatch(app, /\bon(click|change|input|submit|keydown)="/i, 'no handlers in JS templates');
    // Also catch escaped attribute quotes in emitted string literals.
    assert.doesNotMatch(app, /\bon(click|change|input|submit|keydown)=\\?['"]/i);
    assert.doesNotMatch(html + app, /qrserver\.com/i, 'QR generation stays local');
    assert.doesNotMatch(app, /\beval\s*\(|\bnew\s+Function\s*\(/, 'no CSP-unsafe evaluation');
    for (const element of document.querySelectorAll('script[src], link[href]')) {
      const url = element.getAttribute(element.tagName === 'SCRIPT' ? 'src' : 'href');
      assert.ok(url && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url), `relative asset: ${url}`);
      const path = resolve(dist, url);
      assert.ok(path.startsWith(dist + sep), `asset stays inside dist: ${url}`);
      await access(path);
    }
    for (const excluded of ['splendor_cards.csv', 'vite.svg']) {
      await assert.rejects(access(join(dist, excluded)), { code: 'ENOENT' });
    }
    const sw = await readFile(join(dist, 'sw.js'), 'utf8');
    assert.match(sw, /splendor-duel-shell-v3/);
    for (const asset of ['assets/app.js', 'assets/app.css']) {
      assert.ok(sw.includes(`'${asset}'`), `precache includes ${asset}`);
      await access(join(dist, asset));
    }
  } finally {
    dom?.window.close();
    await rm(dist, { recursive: true, force: true });
  }
});
