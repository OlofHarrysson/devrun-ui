import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sourceAt } from './source.mjs';
import { pageDiagnostics } from './browser.mjs';

// For test-runner integrations: caller owns page lifecycle, readiness, assertions,
// issue collection, file naming, and test attachments. Selected files are replaced.
export async function writeEvidence(page, options) {
  const { basePath, observation, identity, sourceRoot = process.cwd(), details = null,
    issues = [], screenshot = true, crop } = options;
  await mkdir(path.dirname(basePath), { recursive: true });
  let toolkit = { sourceRevision: null };
  try {
    const installed = JSON.parse(await readFile(new URL('../../installation.json', import.meta.url), 'utf8'));
    toolkit = { sourceRevision: installed.sourceRevision };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const context = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio, userAgent: navigator.userAgent }));
  const report = {
    schemaVersion: 1, kind: observation ? 'geometry' : 'capture',
    runId: randomUUID(), source: sourceAt(sourceRoot), toolkit,
    target: identity.target, state: identity.state,
    viewport: { name: identity.viewport, width: context.width, height: context.height },
    deviceScaleFactor: context.deviceScaleFactor, context: { userAgent: context.userAgent },
    browser: page.context().browser()?.version() ?? 'unknown', url: page.url(),
    observedAt: new Date().toISOString(), diagnostics: await pageDiagnostics(page),
    ...observation, issues, details, errors: [], behaviorFailures: [],
    missing: [...(observation?.missing ?? [])], png: null,
    diagnosticCoverage: 'Caller-supplied issues; behavioral assertions belong to the test runner.',
  };
  // Remove any prior screenshot even for a geometry-only or failed refresh.
  await rm(`${basePath}.png`, { force: true });
  if (!observation) await rm(`${basePath}.md`, { force: true });
  if (screenshot) {
    try {
      const { capturePage } = await import('../capture/index.mjs');
      const captured = await capturePage(page, `${basePath}.png`, crop);
      report.png = captured.png;
      report.missing.push(...captured.missing);
    } catch (error) { report.errors.push(error.message); }
  }
  report.status = report.errors.length || issues.length ? 'execution-error' : report.missing.length ? 'incomplete' : 'complete';
  // Portable artifact reference relative to this JSON, independent of caller cwd.
  // Keep png unchanged for existing adapters that use its caller-relative path.
  report.artifacts = { png: report.png ? path.basename(report.png) : null };
  await writeFile(`${basePath}.json`, JSON.stringify(report, null, 2) + '\n');
  if (observation) {
    const { renderReport } = observation.kind === 'tokens' ? await import('../tokens/report.mjs') : await import('../geometry/report.mjs');
    await writeFile(`${basePath}.md`, renderReport(report) + '\n## Consumer details\n\n```json\n' + JSON.stringify(details, null, 2) + '\n```\n');
  }
  if (report.errors.length) throw new Error(`Evidence capture failed: ${report.errors.join('; ')} (see ${basePath}.json)`);
  return report;
}
