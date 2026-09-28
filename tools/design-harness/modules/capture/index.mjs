export async function capturePage(page, file, selector) {
  const options = { path: file, animations: 'disabled', caret: 'hide', scale: 'css' };
  if (!selector) {
    await page.screenshot({ ...options, fullPage: true });
    return { png: file, region: null, missing: [] };
  }
  const region = typeof selector === 'string' ? page.locator(selector) : selector;
  const count = await region.count();
  if (count !== 1 || !await region.isVisible()) {
    return { png: null, region: null, missing: [`Capture selector ${selector}: expected one visible element, found ${count}`] };
  }
  await region.screenshot(options);
  return { png: file, region: await region.boundingBox(), missing: [] };
}
