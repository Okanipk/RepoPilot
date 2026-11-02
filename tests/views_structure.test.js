const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('HTML View Hierarchy: Tüm görünüm konteynerleri views-viewport altında bağımsız kardeş olmalı', () => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const lines = html.split('\n');

  const stack = [];
  const containerParents = {};

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const tagRegex = /<(\/)?([a-zA-Z0-9\-]+)([^>]*)>/g;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
      const isClosing = match[1] === '/';
      const tag = match[2].toLowerCase();
      const attrs = match[3];

      if (['input','img','br','hr','meta','link','source','polygon','polyline','line','circle','path','rect','svg'].includes(tag)) continue;

      if (tag === 'div' || tag === 'main' || tag === 'section') {
        if (isClosing) {
          if (stack.length > 0) {
            stack.pop();
          }
        } else {
          const idMatch = attrs.match(/id=["']([^"']+)["']/);
          const id = idMatch ? idMatch[1] : null;
          if (id && id.startsWith('view-container-')) {
            const parent = stack[stack.length - 1];
            containerParents[id] = parent ? (parent.id || parent.tag) : 'none';
          }
          stack.push({ tag, id, lineNum });
        }
      }
    }
  });

  const expectedContainers = [
    'view-container-home',
    'view-container-grid',
    'view-container-kanban',
    'view-container-calendar',
    'view-container-focus',
    'view-container-scanner',
    'view-container-settings',
    'view-container-analytics',
    'view-container-insights'
  ];

  expectedContainers.forEach(containerId => {
    assert.equal(
      containerParents[containerId],
      'views-viewport',
      `${containerId} doğrudan views-viewport altında olmalı, başka bir konteyner içine gömülü olmamalı!`
    );
  });
});
