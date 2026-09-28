import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 1_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const idPattern = /^[a-z][a-z0-9-]{0,79}$/;
const validId = value => typeof value === 'string' && idPattern.test(value);
const text = (value, name) => assert.ok(typeof value === 'string' && value.trim(), `${name} must be nonempty text`);
const named = (items, name) => {
  assert.ok(Array.isArray(items) && items.length, `${name} must be a nonempty array`);
  const ids = new Set();
  for (const item of items) {
    assert.ok(validId(item?.id) && !ids.has(item.id), `${name} needs unique lowercase IDs`);
    text(item.label, `${name} label`);
    ids.add(item.id);
  }
};

// Pure presentation: read indexes or explicitly selected page-writer records.
export async function buildReview(config, { baseDir = process.cwd() } = {}) {
  assert.equal(config.schemaVersion, 1, 'Unsupported review configuration version');
  assert.ok(validId(config.id), 'Review needs a lowercase ID');
  named(config.targets, 'targets');
  named(config.views, 'views');
  const indexes = {};
  for (const version of ['before', 'after']) {
    const input = config[version];
    if (typeof input === 'string') {
      text(input, `${version} index`);
      const file = path.resolve(baseDir, input);
      indexes[version] = { directory: path.dirname(file), value: JSON.parse(await readFile(file, 'utf8')) };
      assert.equal(indexes[version].value.schemaVersion, 1, 'Unsupported capture index version');
    } else {
      assert.ok(input && typeof input.records === 'object' && input.records !== null && !Array.isArray(input.records) && Object.keys(input.records).length, `${version}: provide an index path or nonempty records map`);
      for (const file of Object.values(input.records)) text(file, `${version} record path`);
      indexes[version] = { directory: baseDir, records: input.records };
    }
  }
  const assets = {};
  async function capture(version, key) {
    text(key, `${version} capture key`);
    const { directory, value, records } = indexes[version];
    const entry = value?.entries?.[key];
    const recordPath = records ? (Object.hasOwn(records, key) ? records[key] : null) : entry?.json;
    if (!records) {
      assert.equal(entry?.status, 'complete', `${version}/${key}: expected complete capture`);
      text(entry.png, 'Capture PNG path');
    }
    text(recordPath, `${version}/${key} record path`);
    const assetId = `${version}:${key}`;
    if (assets[assetId]) return assetId;
    const file = path.resolve(directory, recordPath);
    const report = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(report.schemaVersion, 1, `${key}: unsupported capture schema`);
    assert.ok((records ? ['capture', 'geometry', 'tokens'] : ['capture']).includes(report.kind), `${key}: expected screenshot evidence record`);
    assert.equal(report.status, 'complete', `${key}: capture record is not complete`);
    text(report.runId, `${key} run ID`);
    let pngPath;
    if (records) {
      const png = report.artifacts?.png;
      text(png, `${key}: needs record-relative artifacts.png; recapture with the current page writer and screenshot enabled`);
      assert.ok(!path.isAbsolute(png) && path.basename(png) === png && png === path.basename(report.png ?? ''), `${key}: inconsistent record-relative PNG`);
      pngPath = path.resolve(path.dirname(file), png);
    } else {
      assert.equal(report.runId, entry.runId, `${key}: run identity differs from index`);
      assert.equal(report.png, entry.png, `${key}: PNG differs from index`);
      pngPath = path.resolve(directory, entry.png);
    }
    for (const problem of ['errors', 'behaviorFailures', 'missing', 'issues']) {
      assert.ok(Array.isArray(report[problem]) && report[problem].length === 0, `${key}: unresolved ${problem}`);
    }
    const png = await readFile(pngPath);
    assert.ok(png.length >= 33 && png.subarray(0, 8).equals(PNG_SIGNATURE) && png.subarray(12, 16).toString() === 'IHDR', `${key}: expected PNG`);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.ok(width > 0 && height > 0, `${key}: invalid PNG dimensions`);
    const viewport = report.viewport;
    assert.ok(viewport?.width > 0 && viewport?.height > 0 && report.deviceScaleFactor > 0, `${key}: missing viewport metadata`);
    assets[assetId] = { src: `data:image/png;base64,${png.toString('base64')}`, width, height,
      viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: report.deviceScaleFactor,
      runId: report.runId, observedAt: report.observedAt, source: report.source ?? null,
      toolkit: report.toolkit ?? null, kind: report.kind, details: report.details ?? null };
    return assetId;
  }
  const views = [];
  for (const view of config.views) {
    const url = view.liveUrl === undefined || view.liveUrl === null ? null : new URL(view.liveUrl);
    if (url) assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, `${view.id}: live URL must be HTTP(S) without credentials`);
    assert.deepEqual(Object.keys(view.captures ?? {}).sort(), config.targets.map(t => t.id).sort(), `${view.id}: provide every declared target exactly once`);
    const pairs = {};
    for (const target of config.targets) {
      const refs = view.captures[target.id];
      const before = await capture('before', refs.before), after = await capture('after', refs.after);
      assert.deepEqual(assets[before].viewport, assets[after].viewport, `${view.id}/${target.id}: viewport mismatch`);
      assert.equal(assets[before].deviceScaleFactor, assets[after].deviceScaleFactor, `${view.id}/${target.id}: scale mismatch`);
      pairs[target.id] = { before, after };
    }
    views.push({ id: view.id, label: view.label, liveUrl: url?.href ?? null, pairs });
  }
  const data = { id: config.id, targets: config.targets.map(({ id, label }) => ({ id, label })), views, assets };
  const template = await readFile(new URL('./template.html', import.meta.url), 'utf8');
  const html = template.replaceAll('__ROOT_ID__', `review-${config.id}`)
    .replace('__REVIEW_DATA__', () => JSON.stringify(data).replaceAll('<', '\\u003c'));
  assert.ok(Buffer.byteLength(html) < MAX_BYTES, 'Review exceeds 1 MB; select fewer captures');
  return html;
}

export async function writeReview(configFile, output) {
  const file = path.resolve(configFile);
  const config = JSON.parse(await readFile(file, 'utf8'));
  const html = await buildReview(config, { baseDir: path.dirname(file) });
  // Validate and load everything before replacing an existing presentation.
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, html);
  return { output: path.resolve(output), bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 4, 'Usage: node modules/review/build.mjs <review.json> <output.html>');
    console.log(await writeReview(process.argv[2], process.argv[3]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
