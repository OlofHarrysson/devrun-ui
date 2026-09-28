#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parseOptions } from '../modules/core/plan.mjs';
import { runHarness } from '../modules/core/run.mjs';

try {
  const options = parseOptions(process.argv.slice(2));
  if (!options.config) throw new Error('Usage: node bin/design-harness.mjs --config=path/to/config.mjs [--mode=capture|geometry|tokens|all] [--target=id] [--state=id] [--viewport=id] [--scope=id] [--url=http://...] [--output=path]');
  const configPath = path.resolve(options.config);
  const { default: config } = await import(pathToFileURL(configPath).href);
  const result = await runHarness(config, { ...options, sourceRoot: path.dirname(configPath) });
  const output = path.resolve(options.output ?? config.output ?? 'artifacts/design');
  console.log(`${result.status}: ${result.entries.length} evidence records; run ${result.runId}`);
  console.log('Status describes collection, not design approval. Advisory findings do not fail the run.');
  console.log(`Attempt: ${path.join(output, 'latest-run.json')}`);
  if (result.entries.length) console.log(`Index: ${path.join(output, 'index.json')}`);
  for (const entry of result.entries) {
    console.log(`  ${entry.status}: ${entry.key}`);
    const record = JSON.parse(await readFile(path.join(output, entry.json), 'utf8'));
    const details = [
      ...(record.errors ?? []).map(message => `Execution error: ${message}`),
      ...(record.issues ?? []).map(issue => `Browser ${issue.type}: ${issue.message}`),
      ...(record.behaviorFailures ?? []).map(message => `Behavior failure: ${message}`),
      ...(record.missing ?? []).map(message => `Incomplete: ${message}`),
      ...(record.pairs ?? []).filter(p => p.status === 'review').map(p =>
        `${p.exceptionStatus === 'accepted' ? 'Accepted exception' : 'Advisory'}: ${p.id} contrast ${p.ratio}; local minimum ${p.minimum}`
        + (p.exception ? `; ${p.exception.id} (${p.exceptionStatus}) — ${p.exception.reason} Decision: ${p.exception.decision}` : '')),
      ...(record.relationships ?? []).filter(r => r.status === 'review').map(r => `Advisory: ${r.id} (${r.metric}) observed ${r.value}; local range ${r.range.join(' … ')}`),
    ];
    if (record.diagnostics?.horizontalOverflow > 0) details.push(`Advisory: page horizontal overflow is ${record.diagnostics.horizontalOverflow} CSS px`);
    for (const detail of details) console.log(`    ${detail}`);
    if (details.length) console.log(`    Report: ${path.join(output, entry.markdown ?? entry.json)}`);
  }
  for (const error of result.errors) console.error(error);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
