const test = require('node:test');
const assert = require('node:assert/strict');
const parserService = require('../services/parserService');

test('ParserService: Markdown görevlerini ve öncelikleri doğru ayrıştırmalı', () => {
  const markdown = `
# Yapılacaklar Listesi

- [ ] [P1] iOS mikrofon izni hatasını çöz ~2026-11-15 #bug
- [ ] [P2] SQLite offline sync tamamla #feature (est: 3h)
- [x] [P3] Karanlık mod renklerini düzenle
`;

  const tasks = parserService.parseTasks(markdown);
  assert.equal(tasks.length, 3, '3 görev ayrıştırılmalı');

  // Görev 1
  assert.equal(tasks[0].priorityRank, 1);
  assert.equal(tasks[0].completed, false);
  assert.equal(tasks[0].dueDate, '2026-11-15');
  assert.ok(tasks[0].tags.includes('#bug'));

  // Görev 2
  assert.equal(tasks[1].priorityRank, 2);
  assert.equal(tasks[1].completed, false);

  // Görev 3
  assert.equal(tasks[2].priorityRank, 3);
  assert.equal(tasks[2].completed, true);
});

test('ParserService: Görev tamamlama durumunu doğru güncellemeli', () => {
  const initial = '- [ ] [P1] Ödeme webhook hatasını düzelt';
  const completed = parserService.updateTaskInMarkdown(initial, { title: 'Ödeme webhook hatasını düzelt' }, true);
  assert.ok(completed.includes('- [x]'), 'Görev [x] olarak işaretlenmeli');

  const reopened = parserService.updateTaskInMarkdown(completed, { title: 'Ödeme webhook hatasını düzelt' }, false);
  assert.ok(reopened.includes('- [ ]'), 'Görev tekrar [ ] olarak açılmalı');
});

test('ParserService: Öncelik kodunu doğru değiştirmeli', () => {
  const initial = '- [ ] [P3] Performans testlerini tamamla';
  const updated = parserService.changePriorityInMarkdown(initial, { title: 'Performans testlerini tamamla' }, 'P1');
  assert.ok(updated.includes('[P1]'), 'Öncelik [P1] olarak güncellenmeli');
});
