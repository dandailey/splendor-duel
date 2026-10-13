// Attribute values are decoded by the DOM before being passed to an action.
export const escapeActionAttribute = value => String(value).replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Use the bubble phase so existing capture-phase input blockers run first.
// Return a disposer to make isolated DOM tests and teardown straightforward.
export function installActions(document, registry) {
  const dispatch = event => {
    const element = event.target.closest?.('[data-action]');
    if (!element || element.matches(':disabled')) return;
    const name = element.getAttribute('data-action');
    if (!Object.hasOwn(registry, name) || typeof registry[name] !== 'function') return;
    const args = [];
    if (element.hasAttribute('data-arg')) args.push(element.getAttribute('data-arg'));
    else {
      for (let index = 1; element.hasAttribute(`data-arg-${index}`); index++) {
        args.push(element.getAttribute(`data-arg-${index}`));
      }
    }
    registry[name].call(element, ...args, event);
  };
  document.addEventListener('click', dispatch);
  return () => document.removeEventListener('click', dispatch);
}
