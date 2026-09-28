// Self-contained browser payload, adapted from Guilty Pleasure's collectScope.
// No token discovery, pseudo-element background policy, or inferred roles.
export function collectScope(scope) {
  const rectOf = element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
  };
  const box = (style, prefix) => Object.fromEntries(['Top', 'Right', 'Bottom', 'Left'].map(side => [side.toLowerCase(), parseFloat(style[`${prefix}${side}${prefix === 'border' ? 'Width' : ''}`]) || 0]));
  // Character Range rectangles observe wrapping across inline text nodes. Keep
  // raw line text/boxes rather than guessing line count from element height.
  const linesOf = element => {
    const lines = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (['SCRIPT', 'STYLE'].includes(parent.tagName) || !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      let offset = 0;
      for (const char of node.textContent) {
        range.setStart(node, offset);
        offset += char.length;
        range.setEnd(node, offset);
        for (const r of range.getClientRects()) {
          if (!r.width || !r.height) continue;
          let line = lines.find(line => Math.abs(line.top - r.top) < 1);
          if (!line) { line = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, text: '', characters: 0 }; lines.push(line); }
          line.left = Math.min(line.left, r.left);
          line.right = Math.max(line.right, r.right);
          line.bottom = Math.max(line.bottom, r.bottom);
          line.text += char;
          line.characters++;
        }
      }
    }
    return lines.sort((a, b) => a.top - b.top);
  };
  const roots = document.querySelectorAll(scope.root);
  const root = roots.length === 1 ? roots[0] : null;
  const missing = [];
  if (!root) missing.push(`Scope ${scope.id}: expected one root ${scope.root}, found ${roots.length}`);
  const regions = scope.regions.map(region => {
    // Selectors are scoped to the declared root; :scope measures the root itself.
    const elements = !root ? [] : region.selector === ':scope' ? [root] : root.querySelectorAll(region.selector);
    const el = elements.length === 1 ? elements[0] : null;
    const visible = Boolean(el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width && el.getBoundingClientRect().height);
    if ((!el && !(region.optional && elements.length === 0)) || (el && !visible && !region.allowHidden)) missing.push(`Region ${region.id}: ${el ? 'hidden or zero-sized' : `expected one match, found ${elements.length}`} (${region.selector})`);
    if (!el) return { ...region, exists: false, count: elements.length, visible: false, rect: null, textRect: null, style: null, typography: null };
    const style = getComputedStyle(el);
    const rect = rectOf(el);
    let textRect = null;
    if (region.textBounds) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      textRect = { x: r.x, y: r.y, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
    const lines = region.typography && visible ? linesOf(el) : null;
    return {
      ...region, exists: true, count: elements.length, visible, rect, textRect,
      style: Object.fromEntries((region.styles ?? []).map(name => [name, style.getPropertyValue(name)])),
      viewport: { widthRatio: rect.width / innerWidth, heightRatio: rect.height / innerHeight, fold: rect.top >= innerHeight ? 'below' : rect.bottom <= 0 ? 'above' : rect.top >= 0 && rect.bottom <= innerHeight ? 'inside' : 'crosses' },
      box: { margin: box(style, 'margin'), padding: box(style, 'padding'), border: box(style, 'border') },
      typography: region.typography ? {
        fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textWrap: style.textWrap,
        lines, lineCount: lines?.length ?? null,
        firstLineCharacters: lines && lines.length > 1 ? lines[0].characters : null,
      } : null,
    };
  });
  return {
    scopeId: scope.id, root: scope.root, rootRect: root ? rectOf(root) : null, regions, missing,
    // Capture offsets in the same browser turn as rectangles, including during smooth scroll.
    diagnostics: {
      url: location.href, scroll: { x: scrollX, y: scrollY },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    },
  };
}
