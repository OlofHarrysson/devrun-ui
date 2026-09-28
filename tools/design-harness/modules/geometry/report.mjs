export function relationshipsFor(observation, scope) {
  const regions = new Map(observation.regions.map(r => [r.id, r]));
  return (scope.relationships ?? []).map(relation => {
    const a = regions.get(relation.from), b = regions.get(relation.to);
    let value = null;
    if (a?.visible && b?.visible) {
      if (relation.metric === 'vertical-gap') value = b.rect.top - a.rect.bottom;
      if (relation.metric === 'horizontal-gap') value = b.rect.left - a.rect.right;
      if (relation.metric === 'left-delta') value = b.rect.left - a.rect.left;
      if (relation.metric === 'width-ratio' && a.rect.width > 0) value = b.rect.width / a.rect.width;
    }
    return { ...relation, value, status: value === null ? 'unavailable' : relation.range && (value < relation.range[0] || value > relation.range[1]) ? 'review' : 'observed' };
  });
}

const cell = value => String(value ?? 'unavailable').replaceAll('|', '\\|').replaceAll('\n', ' ');
const number = value => typeof value === 'number' ? Math.round(value * 1000) / 1000 : 'unavailable';
export function renderReport(report) {
  const lines = [
    `# ${report.target} / ${report.state} / ${report.scopeId} — ${report.viewport.name}`, '',
    `Status: **${report.status}**. Human acceptance: **not recorded**.`, '',
    `Run: ${report.runId}. Observed: ${report.observedAt}.`,
    `Source: ${report.source.revision ?? 'unknown'}; dirty: ${report.source.dirty ?? 'unknown'}.`,
    `URL: ${report.url}. Browser: Chromium ${report.browser}.`,
    `Viewport: ${report.viewport.width} × ${report.viewport.height}, scale ${report.deviceScaleFactor}.`, '',
    '## Coverage and diagnostics', '',
    ...(report.missing ?? []).map(x => `- Incomplete: ${x}`),
    ...(report.errors ?? []).map(x => `- Execution error: ${x}`),
    ...(report.behaviorFailures ?? []).map(x => `- Behavior failure: ${x}`),
    ...(report.issues ?? []).map(x => `- Browser ${x.type}: ${x.message}`),
    `- Page horizontal overflow: ${report.diagnostics?.horizontalOverflow ?? 'unavailable'} CSS px.`, '',
    '## Declared relationships', '',
    'Ranges are local review preferences. Differences are advisory, not test failures.', '',
    '| Relationship | Metric | Observed | Local range | Status |', '| --- | --- | ---: | --- | --- |',
    ...(report.relationships ?? []).map(r => `| ${cell(r.id)} | ${r.metric} | ${number(r.value)} | ${r.range?.join(' … ') ?? 'none'} | ${r.status} |`), '',
    '## Regions', '',
    '| Region (role) | Visible | x / y | Width × height | Font / leading | Rendered lines |', '| --- | --- | --- | --- | --- | --- |',
    ...(report.regions ?? []).map(r => `| ${cell(r.id)} (${cell(r.role ?? 'undeclared')}) | ${r.visible} | ${number(r.rect?.x)} / ${number(r.rect?.y)} | ${number(r.rect?.width)} × ${number(r.rect?.height)} | ${cell(r.typography?.fontSize ?? r.style?.['font-size'])} / ${cell(r.typography?.lineHeight ?? r.style?.['line-height'])} | ${r.typography?.lineCount ?? 'unmeasured'} |`), '',
    'Coordinates are viewport-relative CSS pixels at observation time. JSON retains unrounded geometry, box edges, viewport ratios, and text line rectangles. Only declared regions and relationships are measured.', '',
  ];
  for (const region of report.regions ?? []) {
    if (!region.typography?.lines?.length) continue;
    lines.push(`### ${region.id}: rendered line text`, '', ...region.typography.lines.map(l => `- ${cell(l.text)} (${l.characters} code points)`), '');
  }
  return lines.join('\n');
}
