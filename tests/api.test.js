const test = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.REPOPILOT_URL || process.env.TASKDECK_URL || 'http://localhost:3000';

test('API Integration: Oturum açma ve temel endpointler başarılı dönmeli', async (t) => {
  // 1. Session Auth
  const sessRes = await fetch(`${BASE_URL}/api/session`, { method: 'POST' });
  assert.equal(sessRes.status, 200, 'Session açılabilmeli');
  const cookie = sessRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Session cookie dönmeli');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  // 2. Status
  const statusRes = await fetch(`${BASE_URL}/api/status`, { headers });
  assert.equal(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.ok(statusData.mode, 'Mod bilgisi dönmeli');

  // 3. Analytics
  const analRes = await fetch(`${BASE_URL}/api/analytics`, { headers });
  assert.equal(analRes.status, 200);
  const analData = await analRes.json();
  assert.equal(analData.success, true);
  assert.ok(typeof analData.metrics?.totalTasks === 'number');

  // 4. Schedule
  const schedRes = await fetch(`${BASE_URL}/api/schedule`, { headers });
  assert.equal(schedRes.status, 200);
  const schedData = await schedRes.json();
  assert.equal(schedData.success, true);
});

test('API Integration: Takvim zamanlama (schedule) ve tamamlama (toggle) çalışmalı', async () => {
  const sessRes = await fetch(`${BASE_URL}/api/session`, { method: 'POST' });
  const cookie = sessRes.headers.get('set-cookie')?.split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  // Demo moduna geçildiğinden emin ol
  await fetch(`${BASE_URL}/api/mode`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'demo' })
  });

  // Sürükle bırak takvim zamanlama testi
  const scheduleRes = await fetch(`${BASE_URL}/api/tasks/schedule`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      repoId: 'demo-repo-2',
      repoName: 'FamApp',
      taskTitle: 'iOS izin sorununu incele',
      date: '2026-11-20',
      timeSlot: '14:00'
    })
  });

  assert.equal(scheduleRes.status, 200);
  const scheduleData = await scheduleRes.json();
  assert.equal(scheduleData.success, true);

  // Görev tamamlama durumu testi
  const toggleRes = await fetch(`${BASE_URL}/api/tasks/toggle`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      repoId: 'demo-repo-2',
      taskTitle: 'iOS izin sorununu incele',
      completed: true
    })
  });

  assert.equal(toggleRes.status, 200);
  const toggleData = await toggleRes.json();
  assert.equal(toggleData.success, true);

  // Takvim Sürükle-Bırak Yeniden Planlama Testi (17 Kasım 2026)
  const dragDropScheduleRes = await fetch(`${BASE_URL}/api/tasks/schedule`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      repoId: 'demo-repo-1',
      repoName: 'TenderAgent',
      taskTitle: 'API entegrasyon testi',
      date: '2026-11-17'
    })
  });

  assert.equal(dragDropScheduleRes.status, 200);
  const dragDropData = await dragDropScheduleRes.json();
  assert.equal(dragDropData.success, true);
  assert.equal(dragDropData.issue.dueDate, '2026-11-17');
  assert.equal(dragDropData.issue.title, 'API entegrasyon testi');
});

test('API Integration: Proje Radarı Fikir ekleme (P4) ve Kanban sprintine yükseltme (P2)', async () => {
  const sessRes = await fetch(`${BASE_URL}/api/session`, { method: 'POST' });
  const cookie = sessRes.headers.get('set-cookie')?.split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  // 1. Yeni fikir ekle (P4)
  const addRes = await fetch(`${BASE_URL}/api/tasks/add`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      repoId: 'demo-repo-1',
      repoFullName: 'test-org/TenderAgent',
      filePath: 'yapilacaklar.md',
      title: '💡 Yenilik: AI teklif analiz modülü',
      description: 'Proje Yol Haritası & Fikir Havuzu',
      priorityCode: 'P4'
    })
  });

  assert.equal(addRes.status, 200);
  const addData = await addRes.json();
  assert.equal(addData.success, true);
  assert.equal(addData.issue.priorityCode, 'P4');

  // 2. Fikri Kanban'a taşı / önceliğini P2 yap
  const priorityRes = await fetch(`${BASE_URL}/api/tasks/priority`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      repoId: 'demo-repo-1',
      taskTitle: '💡 Yenilik: AI teklif analiz modülü',
      newPriorityCode: 'P2'
    })
  });

  assert.equal(priorityRes.status, 200);
  const priorityData = await priorityRes.json();
  assert.equal(priorityData.success, true);
  assert.equal(priorityData.issue.priorityCode, 'P2');
});
