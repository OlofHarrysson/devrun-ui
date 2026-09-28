import { collectScope } from './collect.mjs';
import { relationshipsFor } from './report.mjs';

// Observe the caller's current state. Never navigate, scroll, close, or mock it.
export async function measurePage(page, scope) {
  const observation = await page.evaluate(collectScope, scope);
  const relationships = relationshipsFor(observation, scope);
  observation.missing.push(...relationships.filter(r => r.status === 'unavailable').map(r => `Relationship unavailable: ${r.id}`));
  return {
    ...observation, relationships, observedAt: new Date().toISOString(),
    coordinateSystem: 'viewport',
  };
}
