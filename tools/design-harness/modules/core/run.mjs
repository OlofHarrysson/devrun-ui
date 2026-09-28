import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { sourceAt } from './source.mjs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { makePlan } from './plan.mjs';
import { watchIssues, settle, pageDiagnostics } from './browser.mjs';

async function json(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}
function statusOf(report) {
  if (report.errors.length || report.issues.length) return 'execution-error';
  if (report.behaviorFailures.length) return 'behavior-failure';
  if (report.missing.length) return 'incomplete';
  return 'complete';
}

// Public entry point. A provided URL is externally owned. Only a resource
// returned by startServer is closed here, including launch/navigation failures.
export async function runHarness(config, options = {}) {
  const output = path.resolve(options.output ?? config.output ?? 'artifacts/design');
  await mkdir(output, { recursive: true });
  const runId = randomUUID();
  const runDirectory = path.join(output, 'runs', runId);
  await mkdir(runDirectory, { recursive: true });
  const summary = { runId, startedAt: new Date().toISOString(), status: 'running', selection: options, entries: [], errors: [], exitCode: null };
  await json(path.join(output, 'latest-run.json'), summary);
  let browser, ownedServer;
  let index = { schemaVersion: 1, entries: {} };
  try {
    try { index = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const plan = makePlan(config, options);
    const capture = plan.some(p => p.capture) ? await import('../capture/index.mjs') : null;
    const geometry = plan.some(p => p.scopes.length) ? {
      ...await import('../geometry/collect.mjs'), ...await import('../geometry/report.mjs'),
    } : null;
    const tokens = plan.some(p => p.tokens) ? { ...await import('../tokens/observe.mjs'), ...await import('../tokens/report.mjs') } : null;
    for (const item of plan) if (item.tokens) tokens.validateTokens(item.tokens);
    const source = sourceAt(options.sourceRoot ?? process.cwd());
    const timeout = config.timeoutMs ?? 10000;
    let baseURL = options.url ?? config.baseURL;
    if (!baseURL) {
      if (!config.startServer) throw new Error('Supply --url, config.baseURL, or a project-owned startServer hook');
      ownedServer = await config.startServer();
      baseURL = ownedServer.url;
    }
    browser = await chromium.launch();
    for (const item of plan) {
      const { target, state, viewport, size, scopes } = item;
      const base = {
        schemaVersion: 1, runId, attemptStartedAt: new Date().toISOString(), observedAt: null, source,
        target: target.id, state: state.id, url: new URL(state.path ?? target.path, baseURL).href,
        viewport: { name: viewport, ...size }, deviceScaleFactor: 1,
        browser: browser.version(), context: { locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', colorScheme: 'light' },
        errors: [], behaviorFailures: [], missing: [], issues: [],
      };
      let context, page;
      const records = [];
      try {
        context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, ...base.context });
        page = await context.newPage();
        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);
        base.issues = watchIssues(page);
        await target.beforeNavigate?.(page);
        await state.beforeNavigate?.(page);
        const response = await page.goto(base.url, { waitUntil: 'load' });
        if (!response?.ok()) throw new Error(`Navigation failed: HTTP ${response?.status() ?? 'unknown'}`);
        await state.prepare?.(page);
        await settle(page, timeout);
        try { await target.check?.(page); await state.check?.(page); }
        catch (error) { base.behaviorFailures.push(error.message); }
        // Hooks may scroll. Measure in the canonical initial viewport.
        await page.evaluate(() => window.scrollTo(0, 0));
        base.observedAt = new Date().toISOString();
        base.diagnostics = await pageDiagnostics(page);
        base.url = page.url();
        for (const scope of scopes) {
          try {
            const observation = await page.evaluate(geometry.collectScope, scope);
            const relationships = geometry.relationshipsFor(observation, scope);
            observation.missing.push(...relationships.filter(r => r.status === 'unavailable').map(r => `Relationship unavailable: ${r.id}`));
            records.push({ kind: 'geometry', ...base, ...observation, relationships });
          } catch (error) {
            records.push({ kind: 'geometry', ...base, scopeId: scope.id, errors: [error.message] });
          }
        }
        if (item.tokens) {
          try { records.push({ ...base, ...await tokens.inspectTokens(page, item.tokens) }); }
          catch (error) { records.push({ ...base, kind: 'tokens', errors: [error.message] }); }
        }
        if (item.capture) {
          const filename = `${target.id}--${state.id}--${viewport}--capture.png`;
          const captured = await capture.capturePage(page, path.join(runDirectory, filename), state.captureSelector ?? target.captureSelector);
          records.push({ kind: 'capture', ...base, ...captured, png: captured.png ? path.relative(output, captured.png) : null });
        }
      } catch (error) { base.errors.push(error.message); }
      finally { await context?.close(); }
      // If setup failed, replace every selected pointer with a failure record.
      // Existing records share diagnostics, including late browser errors.
      const expected = [
        ...scopes.map(s => ({ kind: 'geometry', scopeId: s.id })),
        ...(item.tokens ? [{ kind: 'tokens' }] : []),
        ...(item.capture ? [{ kind: 'capture', png: null }] : []),
      ];
      for (const identity of expected) {
        const record = records.find(r => r.kind === identity.kind && r.scopeId === identity.scopeId) ?? { ...base, ...identity };
        record.status = statusOf(record);
        const key = [target.id, state.id, viewport, identity.kind, identity.scopeId].filter(Boolean).join('/');
        const stem = key.replaceAll('/', '--');
        const file = path.join(runDirectory, `${stem}.json`);
        await json(file, record);
        const renderer = record.kind === 'geometry' ? geometry : record.kind === 'tokens' ? tokens : null;
        if (renderer) await writeFile(path.join(runDirectory, `${stem}.md`), renderer.renderReport(record));
        index.entries[key] = { runId, observedAt: record.observedAt, status: record.status, json: path.relative(output, file), ...(renderer ? { markdown: path.relative(output, path.join(runDirectory, `${stem}.md`)) } : { png: record.png }) };
        summary.entries.push({ key, ...index.entries[key] });
        await json(path.join(output, 'index.json'), index);
      }
    }
  } catch (error) { summary.errors.push(error.message); }
  finally {
    try { await browser?.close(); } catch (error) { summary.errors.push(`Browser cleanup: ${error.message}`); }
    try { await ownedServer?.close(); } catch (error) { summary.errors.push(`Server cleanup: ${error.message}`); }
    const states = summary.entries.map(e => e.status);
    summary.exitCode = summary.errors.length || states.some(s => ['execution-error', 'behavior-failure'].includes(s)) ? 1 : states.includes('incomplete') ? 2 : 0;
    summary.status = summary.exitCode === 1 ? 'failed' : summary.exitCode === 2 ? 'incomplete' : 'complete';
    summary.finishedAt = new Date().toISOString();
    await json(path.join(runDirectory, 'run.json'), summary);
    await json(path.join(output, 'latest-run.json'), summary);
  }
  return summary;
}
