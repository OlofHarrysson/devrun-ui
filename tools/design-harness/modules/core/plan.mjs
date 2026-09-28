const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const metrics = ['vertical-gap', 'horizontal-gap', 'left-delta', 'width-ratio'];

function ids(items, label) {
  if (!Array.isArray(items) || !items.length) throw new Error(`${label} must be a nonempty array`);
  const seen = new Set();
  for (const item of items) {
    if (!ID.test(item.id) || seen.has(item.id)) throw new Error(`Invalid or duplicate ${label} id: ${item.id}`);
    seen.add(item.id);
  }
}

export function parseOptions(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--(config|mode|target|state|viewport|scope|url|output)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw new Error(`Invalid or duplicate argument: ${arg}`);
    options[match[1]] = match[2];
  }
  return options;
}

export function makePlan(config, options = {}) {
  const mode = options.mode ?? 'all';
  if (!['all', 'capture', 'geometry', 'tokens'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  if (options.scope && ['capture', 'tokens'].includes(mode)) throw new Error('--scope applies to geometry; use --mode=geometry');
  ids(config.targets, 'target');
  const views = Object.entries(config.viewports ?? {});
  ids(views.map(([id]) => ({ id })), 'viewport');
  for (const [, view] of views) {
    if (![view.width, view.height].every(n => Number.isInteger(n) && n > 0)) throw new Error('Viewport dimensions must be positive integers');
  }
  for (const target of config.targets) {
    if (typeof target.path !== 'string') throw new Error(`Missing path: ${target.id}`);
    ids(target.states, 'state');
    if (target.scopes?.length) ids(target.scopes, 'scope');
    for (const scope of target.scopes ?? []) {
      if (typeof scope.root !== 'string') throw new Error(`Missing root: ${scope.id}`);
      ids(scope.regions, 'region');
      for (const region of scope.regions) {
        if (typeof region.selector !== 'string') throw new Error(`Missing selector: ${region.id}`);
      }
      if (scope.relationships?.length) ids(scope.relationships, 'relationship');
      for (const relation of scope.relationships ?? []) {
        if (!metrics.includes(relation.metric)) throw new Error(`Unknown metric: ${relation.metric}`);
        if (![relation.from, relation.to].every(id => scope.regions.some(r => r.id === id))) throw new Error(`Unknown region in relationship: ${relation.id}`);
        const range = relation.range;
        if (range && (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1])) throw new Error(`Invalid range: ${relation.id}`);
      }
    }
  }
  const plan = [];
  for (const target of config.targets) {
    if (options.target && options.target !== target.id) continue;
    for (const state of target.states) {
      if (options.state && options.state !== state.id) continue;
      for (const [viewport, size] of views) {
        if (options.viewport && options.viewport !== viewport) continue;
        const scopes = ['all', 'geometry'].includes(mode) ? (target.scopes ?? []).filter(s => !options.scope || s.id === options.scope) : [];
        const capture = ['all', 'capture'].includes(mode) && !options.scope && target.capture !== false;
        const tokens = ['all', 'tokens'].includes(mode) && !options.scope ? target.tokens : null;
        if (!capture && !scopes.length && !tokens) continue;
        plan.push({ target, state, viewport, size, capture, scopes, tokens });
      }
    }
  }
  if (!plan.length) throw new Error('No evidence matches the requested target/state/viewport/scope selection');
  return plan;
}
