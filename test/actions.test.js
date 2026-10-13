import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installActions, escapeActionAttribute } from '../src/ui/actions.js';

function fixture(t, html, registry) {
  const dom = new JSDOM(html);
  const dispose = installActions(dom.window.document, registry);
  t.after(() => { dispose(); dom.window.close(); });
  return { window: dom.window, document: dom.window.document, dispose };
}

test('dispatches string arguments to the named function with this and event', t => {
  const calls = [];
  const { document } = fixture(t, '<button data-action="reserve" data-arg="3">Reserve</button>', {
    reserve: function (...args) { calls.push({ element: this, args }); },
    other: () => assert.fail('wrong action'),
  });
  const button = document.querySelector('button');
  button.click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].element, button);
  assert.equal(calls[0].args[0], '3');
  assert.equal(calls[0].args[1].target, button);
  assert.equal(calls[0].args[1].type, 'click');
});

test('nested closest dispatches numbered arguments in order', t => {
  const calls = [];
  const { document } = fixture(t,
    '<div data-action="discard" data-arg-2="blue" data-arg-1="token-7"><span>Token</span></div>',
    { discard: (...args) => calls.push(args) });
  document.querySelector('span').click();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, -1), ['token-7', 'blue']);
  assert.equal(calls[0].at(-1).target, document.querySelector('span'));
});

test('ignores missing, unknown, inherited and nonfunction actions', t => {
  const { document } = fixture(t,
    '<button>Plain</button><button data-action="missing"></button><button data-action="toString"></button><button data-action="bad"></button>',
    { bad: 'code is not executable' });
  let clicks = 0;
  document.addEventListener('click', () => clicks++);
  for (const button of document.querySelectorAll('button')) button.click();
  assert.equal(clicks, 4);
});

test('action stopPropagation prevents propagation to window and ancestor action dispatch', t => {
  let actions = 0;
  let windowClicks = 0;
  const { document, window } = fixture(t,
    '<div data-action="outside"><button data-action="inside"><span>Inside</span></button></div>', {
      outside: () => assert.fail('ancestor action must not run'),
      inside: event => { actions++; event.stopPropagation(); },
    });
  window.addEventListener('click', () => windowClicks++);
  document.querySelector('span').click();
  assert.equal(actions, 1);
  assert.equal(windowClicks, 0);
});

test('capture input blocker prevents delegated action', t => {
  let calls = 0;
  const { document } = fixture(t, '<button data-action="play">Play</button>', { play: () => calls++ });
  document.addEventListener('click', event => event.stopPropagation(), true);
  document.querySelector('button').click();
  assert.equal(calls, 0);
});

test('disabled conditional scroll has no action, enabled scroll dispatches from its child', t => {
  let calls = 0;
  const scroll = disabled => `<div class="scroll-icon ${disabled ? 'disabled' : ''}" ${disabled ? '' : 'data-action="enterScrollSelectionMode"'}><span>Scroll</span></div>`;
  const { document } = fixture(t, scroll(true) + scroll(false), { enterScrollSelectionMode: () => calls++ });
  const [disabled, enabled] = document.querySelectorAll('.scroll-icon');
  assert.equal(disabled.hasAttribute('data-action'), false);
  disabled.querySelector('span').click();
  assert.equal(calls, 0);
  enabled.querySelector('span').click();
  assert.equal(calls, 1);
});

test('disabled buttons and disabled fieldset controls ignore synthetic clicks', t => {
  let calls = 0;
  const { document, window } = fixture(t,
    '<button disabled data-action="play"><span>Play</span></button><fieldset disabled><button data-action="play">Play</button></fieldset>',
    { play: () => calls++ });
  document.querySelector('span').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  document.querySelector('fieldset button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls, 0);
});

test('escaped attribute arguments round-trip without injecting markup', t => {
  const value = `card<&>"' data-action="injected`;
  let received;
  const { document } = fixture(t,
    `<button data-action="select" data-arg="${escapeActionAttribute(value)}">Select</button>`,
    { select: arg => { received = arg; } });
  document.querySelector('button').click();
  assert.equal(received, value);
  assert.equal(document.querySelectorAll('[data-action]').length, 1);
});

test('disposer removes the document listener', t => {
  let calls = 0;
  const { document, dispose } = fixture(t, '<button data-action="play">Play</button>', { play: () => calls++ });
  dispose();
  document.querySelector('button').click();
  assert.equal(calls, 0);
});
