// Adapted from both source harnesses; no site mocks or framework chrome rules.
export function watchIssues(page) {
  const issues = [];
  page.on('console', message => {
    if (message.type() === 'error') issues.push({ type: 'console', message: message.text() });
  });
  page.on('pageerror', error => issues.push({ type: 'pageerror', message: error.message }));
  page.on('requestfailed', request => issues.push({ type: 'requestfailed', message: `${request.url()}: ${request.failure()?.errorText}` }));
  page.on('response', response => {
    if (response.status() >= 400) issues.push({ type: 'http', message: `${response.status()} ${response.url()}` });
  });
  return issues;
}

export async function settle(page, timeout) {
  await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout });
  // Load lazy images too; do not silently suppress a failed decode as the source did.
  await page.evaluate(() => { for (const img of document.images) img.loading = 'eager'; });
  await page.waitForFunction(() => [...document.images].every(img => img.complete), null, { timeout });
  const broken = await page.evaluate(() => [...document.images].filter(img => !img.naturalWidth).map(img => img.currentSrc || img.src));
  if (broken.length) throw new Error(`Images failed to load: ${broken.join(', ')}`);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(img => img.decode()));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.scrollTo(0, 0);
  });
}

export async function pageDiagnostics(page) {
  return page.evaluate(() => ({
    url: location.href,
    scroll: { x: scrollX, y: scrollY },
    page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  }));
}
