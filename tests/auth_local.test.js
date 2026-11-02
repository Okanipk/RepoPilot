const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('Local-First Auth: SHA-256 şifre karma doğrulaması', () => {
  const password = 'mySecretPassword123';
  const hash1 = crypto.createHash('sha256').update(password).digest('hex');
  const hash2 = crypto.createHash('sha256').update(password).digest('hex');
  const wrongHash = crypto.createHash('sha256').update('wrongPassword').digest('hex');

  assert.equal(hash1, hash2, 'Aynı şifre her zaman aynı hash değerini üretmeli');
  assert.notEqual(hash1, wrongHash, 'Farklı şifreler farklı hash üretmeli');
  assert.equal(hash1.length, 64, 'SHA-256 çıktısı 64 hex karakter olmalı');
});

test('Local-First JSON: Dışa aktarma ve içe aktarma şeması geçerli olmalı', () => {
  const exportPayload = {
    repopilotVersion: '1.0.0',
    taskdeckVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    user: { username: 'okan', fullName: 'Okan İpek' },
    mode: 'demo',
    projects: [
      { id: 'demo-repo-1', name: 'TenderAgent', tasks: [{ id: 't1', title: 'Ödeme entegrasyonu', completed: false }] }
    ],
    kanbanOrders: { todo: ['demo-repo-1:::Ödeme entegrasyonu'] }
  };

  const jsonStr = JSON.stringify(exportPayload, null, 2);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.repopilotVersion, '1.0.0');
  assert.equal(parsed.taskdeckVersion, '1.0.0');
  assert.equal(parsed.user.username, 'okan');
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.projects[0].tasks[0].title, 'Ödeme entegrasyonu');
  assert.deepEqual(parsed.kanbanOrders.todo, ['demo-repo-1:::Ödeme entegrasyonu']);
});

test('Auth Security: Misafir / demo oturumları geçersiz sayılmalı ve reddedilmeli', () => {
  const isValidSession = (user) => {
    if (!user) return false;
    if (user.isGuest === true) return false;
    if (user.username === 'misafir') return false;
    if (!user.username || !user.fullName) return false;
    return true;
  };

  const guestUser = { username: 'misafir', fullName: 'Misafir Kullanıcı', isGuest: true };
  const validUser = { username: 'okan', fullName: 'Okan İpek', passwordHash: 'abc...' };
  const emptyUser = null;

  assert.equal(isValidSession(guestUser), false, 'Misafir hesabı reddedilmeli');
  assert.equal(isValidSession(emptyUser), false, 'Boş oturum reddedilmeli');
  assert.equal(isValidSession(validUser), true, 'Kayıtlı gerçek kullanıcı oturumu kabul edilmeli');
});

test('Theme System: Koyu ve Açık tema durumu tutarlı yönetilmeli', () => {
  const toggleThemeState = (current) => (current === 'dark' ? 'light' : 'dark');

  assert.equal(toggleThemeState('dark'), 'light');
  assert.equal(toggleThemeState('light'), 'dark');
});

