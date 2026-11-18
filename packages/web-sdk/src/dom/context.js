export function currentRoute(host) {
  return host.querySelector('[data-route]')?.dataset.route;
}

export function findTarget(host, step) {
  if (!step || currentRoute(host) !== step.route) return null;
  return [...host.querySelectorAll('[data-lara]')].find(element =>
    element.dataset.lara === step.target && element.getClientRects().length && getComputedStyle(element).visibility === 'visible'
  ) ?? null;
}
