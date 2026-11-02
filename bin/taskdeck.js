#!/usr/bin/env node

/**
 * Repo Pilot CLI - Terminalden Proje ve Görev Yönetimi
 */

const BASE_URL = process.env.REPOPILOT_URL || process.env.TASKDECK_URL || 'http://localhost:3000';

let sessionCookie = '';
async function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  const token = process.env.REPOPILOT_API_TOKEN || process.env.TASKDECK_API_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    if (!sessionCookie) {
      let response;
      try {
        response = await fetch(`${BASE_URL}/api/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        throw new Error(`Repo Pilot sunucusuna bağlanılamadı (${BASE_URL}): ${err.message}`);
      }
      if (!response.ok) throw new Error('Repo Pilot oturumu açılamadı. REPOPILOT_API_TOKEN ayarını kontrol edin.');
      sessionCookie = (response.headers.get('set-cookie') || '').split(';')[0];
      if (!sessionCookie) throw new Error('Repo Pilot oturum bilgisi alınamadı.');
    }
    headers.Cookie = sessionCookie;
  }
  if (options.method && options.method !== 'GET') headers['Content-Type'] = 'application/json';
  
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new Error(`İstek başarısız (${url}): ${err.message}`);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response;
}

const args = process.argv.slice(2);
const command = args[0] || 'list';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

async function main() {
  try {
    switch (command) {
      case 'list':
      case 'ls':
        await listProjects();
        break;
      case 'p1':
      case 'urgent':
        await listUrgent();
        break;
      case 'focus':
      case 'today':
        await listFocusTasks();
        break;
      case 'done':
      case 'toggle':
        await toggleTask(args.slice(1).join(' '));
        break;
      case 'priority':
      case 'pri':
        await changePriority(args.slice(1));
        break;
      case 'add':
        await addTask(args[1], args[2], args.slice(3).join(' '));
        break;
      case 'digest':
        await sendDigest();
        break;
      case 'cal':
      case 'calendar':
      case 'schedule':
        await listCalendarSchedule();
        break;
      case 'help':
        printHelp();
        break;
      default:
        console.error(`${colors.red}Bilinmeyen komut:${colors.reset} "${command}"\n`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`${colors.red}Hata:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

async function listProjects() {
  try {
    const res = await apiFetch(`${BASE_URL}/api/projects`);
    const data = await res.json();

    console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}  🚀 Repo Pilot · Proje Durum Raporu (${data.mode.toUpperCase()} MODU)${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

    data.projects.forEach(repo => {
      const healthColor = repo.health.score > 80 ? colors.green : repo.health.score > 50 ? colors.yellow : colors.red;
      const staleBadge = repo.isStale ? ` ${colors.red}[⚠️ İHMAL: ${repo.daysSinceUpdate} gün]${colors.reset}` : '';

      console.log(`${colors.bold}${repo.name}${colors.reset} (${repo.language})${staleBadge}`);
      console.log(`  Sağlık Skoru: ${healthColor}${repo.health.grade} (%${repo.health.score})${colors.reset} | İlerleme: ${colors.green}%${repo.stats.completionPercentage}${colors.reset}`);
      console.log(`  🚨 P1 Acil: ${colors.red}${repo.stats.p1Count}${colors.reset} | Bekleyen: ${colors.yellow}${repo.stats.pending}${colors.reset} | Biten: ${colors.gray}${repo.stats.completed}${colors.reset}`);
      
      const p1s = (repo.tasks || []).filter(t => !t.completed && t.priorityRank === 1);
      if (p1s.length > 0) {
        p1s.forEach(t => console.log(`    ${colors.red}• [P1]${colors.reset} ${t.title}`));
      }
      console.log('');
    });

    console.log(`${colors.gray}Toplam: ${data.summary.totalProjects} Proje | ${data.summary.totalTasks} Görev | ${data.summary.totalP1} Acil İş${colors.reset}\n`);
  } catch (err) {
    console.error(`${colors.red}Hata:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

async function listUrgent() {
  try {
    const res = await apiFetch(`${BASE_URL}/api/projects`);
    const data = await res.json();

    console.log(`\n${colors.bold}${colors.red}🚨 TÜM PROJELERDEKİ ACİL (P1) GÖREVLER:${colors.reset}\n`);
    let count = 0;

    data.projects.forEach(repo => {
      const p1s = (repo.tasks || []).filter(t => !t.completed && t.priorityRank === 1);
      if (p1s.length > 0) {
        console.log(`${colors.bold}${colors.blue}📂 ${repo.name}:${colors.reset}`);
        p1s.forEach(t => {
          count++;
          console.log(`  ${colors.red}✗${colors.reset} ${t.title}`);
        });
        console.log('');
      }
    });

    if (count === 0) {
      console.log(`${colors.green}🎉 Harika! Bekleyen hiçbir P1 acil görev bulunmuyor.${colors.reset}\n`);
    }
  } catch (err) {
    console.error(`${colors.red}Hata:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

async function addTask(repoName, priority, taskText) {
  if (!repoName || !priority || !taskText) {
    console.error(`\n${colors.yellow}Kullanım:${colors.reset} node bin/taskdeck.js add <repo-adı> <P1|P2|P3> <görev metni>`);
    console.error(`Örnek:   node bin/taskdeck.js add e-ticaret-api-gateway P1 "Redis token hatasını düzelt"\n`);
    process.exit(1);
  }

  try {
    const resList = await apiFetch(`${BASE_URL}/api/projects`);
    const data = await resList.json();
    const target = repoName.toLowerCase().trim();

    // 1. Exact match priority
    let repo = data.projects.find(r => r.name.toLowerCase() === target || r.fullName.toLowerCase() === target);

    // 2. Substring matching if no exact match
    if (!repo) {
      const matches = data.projects.filter(r => r.name.toLowerCase().includes(target) || r.fullName.toLowerCase().includes(target));
      if (matches.length === 1) {
        repo = matches[0];
      } else if (matches.length > 1) {
        console.error(`${colors.red}Hata:${colors.reset} "${repoName}" için birden fazla proje eşleşti (belirsiz seçim):`);
        matches.forEach(m => console.error(`  - ${m.fullName || m.name}`));
        console.error(`Lütfen tam proje adını girin.\n`);
        process.exit(1);
      }
    }

    if (!repo) {
      console.error(`${colors.red}Hata:${colors.reset} "${repoName}" adında bir proje bulunamadı.`);
      process.exit(1);
    }

    const res = await apiFetch(`${BASE_URL}/api/tasks/add`, {
      method: 'POST',
      body: JSON.stringify({
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        title: taskText,
        priorityCode: priority.toUpperCase()
      })
    });

    await res.json();
    console.log(`\n${colors.green}✓ Görev Başarıyla Eklendi:${colors.reset}`);
    console.log(`  Proje:   ${repo.name}`);
    console.log(`  Öncelik: [${priority.toUpperCase()}]`);
    console.log(`  Görev:   ${taskText}\n`);
  } catch (err) {
    console.error(`${colors.red}Hata:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

async function sendDigest() {
  try {
    console.log(`Telegram sabah özeti tetikleniyor...`);
    const res = await apiFetch(`${BASE_URL}/api/telegram/send-digest`, { method: 'POST' });
    await res.json();
    console.log(`${colors.green}✓ Telegram özeti başarıyla iletildi!${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}Telegram Hatası:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

async function listCalendarSchedule() {
  try {
    const res = await apiFetch(`${BASE_URL}/api/schedule`);
    const data = await res.json();

    console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}  📅 Repo Pilot · Zaman Çizelgesi ve Takvim Raporu${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

    if (data.overdueTasks && data.overdueTasks.length > 0) {
      console.log(`${colors.bold}${colors.red}⚠️ GECİKMİŞ GÖREVLER (${data.overdueTasks.length}):${colors.reset}`);
      data.overdueTasks.forEach(t => {
        console.log(`  ${colors.red}✗ [${t.dueDate}] [${t.repoName}]${colors.reset} [${t.priorityCode}] ${t.title}`);
      });
      console.log('');
    }

    if (data.todayTasks && data.todayTasks.length > 0) {
      console.log(`${colors.bold}${colors.green}📌 BUGÜNÜN GÖREVLERİ (${data.todayTasks.length}):${colors.reset}`);
      data.todayTasks.forEach(t => {
        console.log(`  ${colors.green}• [${t.priorityCode}] [${t.repoName}]${colors.reset} ${t.title} (${t.estimate || 'Süre yok'})`);
      });
      console.log('');
    }

    if (data.next7DaysTasks && data.next7DaysTasks.length > 0) {
      console.log(`${colors.bold}${colors.yellow}⏳ ÖNÜMÜZDEKİ 7 GÜN İÇİNDEKİ İŞLER (${data.next7DaysTasks.length}):${colors.reset}`);
      data.next7DaysTasks.forEach(t => {
        console.log(`  ${colors.yellow}• [${t.dueDate}] [${t.repoName}]${colors.reset} [${t.priorityCode}] ${t.title}`);
      });
      console.log('');
    }

    if (data.milestones && data.milestones.length > 0) {
      console.log(`${colors.bold}${colors.blue}🎯 SÜRÜM & SPRINT YOL HARİTASI (MILESTONES):${colors.reset}`);
      data.milestones.forEach(ms => {
        console.log(`  [${ms.repoName}] ${colors.bold}${ms.milestone}${colors.reset}: %${ms.percentage} (${ms.completed}/${ms.total} görev - ${ms.totalHours} saat tahmini)`);
      });
      console.log('');
    }

    // Try to get tokenized subscription URL from /api/status
    let calFeedUrl = `${BASE_URL}/api/calendar.ics`;
    try {
      const statusRes = await apiFetch(`${BASE_URL}/api/status`);
      const statusData = await statusRes.json();
      if (statusData.calendarSubscriptionUrl) {
        calFeedUrl = statusData.calendarSubscriptionUrl.startsWith('http')
          ? statusData.calendarSubscriptionUrl
          : `${BASE_URL}${statusData.calendarSubscriptionUrl}`;
      } else if (statusData.calendarToken) {
        calFeedUrl = `${BASE_URL}/api/calendar.ics?token=${statusData.calendarToken}`;
      }
    } catch {
      // ignore
    }

    console.log(`${colors.gray}Takvime Abone Ol (iCal Feed): ${calFeedUrl}${colors.reset}\n`);
  } catch (err) {
    console.error(`${colors.red}Hata:${colors.reset} ${err.message}`);
    process.exit(1);
  }
}

async function findTaskAcrossProjects(query) {
  const res = await apiFetch(`${BASE_URL}/api/projects`);
  const data = await res.json();
  const q = (query || '').toLowerCase().trim();

  const matches = [];
  data.projects.forEach(repo => {
    (repo.tasks || []).forEach(task => {
      if (task.id === q || (task.title && task.title.toLowerCase().includes(q))) {
        matches.push({ repo, task });
      }
    });
  });

  return { projectsData: data, matches };
}

async function toggleTask(query) {
  if (!query || !query.trim()) {
    console.error(`\n${colors.yellow}Kullanım:${colors.reset} node bin/taskdeck.js done <görev adı veya id>`);
    console.error(`Örnek:   node bin/taskdeck.js done "API entegrasyon"\n`);
    process.exit(1);
  }

  const { matches } = await findTaskAcrossProjects(query);

  if (matches.length === 0) {
    console.error(`\n${colors.red}Hata:${colors.reset} "${query}" içeren herhangi bir görev bulunamadı.\n`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.warn(`\n${colors.yellow}Birden fazla görev eşleşti. Lütfen daha belirgin bir başlık girin:${colors.reset}`);
    matches.forEach(m => {
      console.log(`  - [${m.repo.name}] [${m.task.priorityCode || 'P2'}] ${m.task.title}`);
    });
    console.log('');
    process.exit(1);
  }

  const { repo, task } = matches[0];
  const newCompletedState = !task.completed;

  const res = await apiFetch(`${BASE_URL}/api/tasks/toggle`, {
    method: 'POST',
    body: JSON.stringify({
      repoId: repo.id,
      repoFullName: repo.fullName,
      filePath: repo.filePath || 'yapilacaklar.md',
      taskId: task.id,
      taskTitle: task.title,
      completed: newCompletedState
    })
  });

  await res.json();

  const statusLabel = newCompletedState 
    ? `${colors.green}✓ TAMAMLANDI${colors.reset}` 
    : `${colors.yellow}⏳ BEKLEMEDE (AÇIK)${colors.reset}`;

  console.log(`\n${colors.bold}Görev Durumu Güncellendi:${colors.reset}`);
  console.log(`  Proje:  ${repo.name}`);
  console.log(`  Durum:  ${statusLabel}`);
  console.log(`  Görev:  ${task.title}\n`);
}

async function changePriority(argsList) {
  if (!argsList || argsList.length < 2) {
    console.error(`\n${colors.yellow}Kullanım:${colors.reset} node bin/taskdeck.js priority <görev adı> <P1|P2|P3>`);
    console.error(`Örnek:   node bin/taskdeck.js priority "UI iyileştirmeleri" P1`);
    console.error(`         node bin/taskdeck.js priority P1 "UI iyileştirmeleri"\n`);
    process.exit(1);
  }

  const pCodes = ['P1', 'P2', 'P3'];
  let priority = '';
  let taskQuery = '';

  const firstArg = argsList[0].toUpperCase();
  const lastArg = argsList[argsList.length - 1].toUpperCase();

  if (pCodes.includes(firstArg)) {
    priority = firstArg;
    taskQuery = argsList.slice(1).join(' ');
  } else if (pCodes.includes(lastArg)) {
    priority = lastArg;
    taskQuery = argsList.slice(0, -1).join(' ');
  } else {
    console.error(`\n${colors.red}Hata:${colors.reset} Geçersiz öncelik kodu. Lütfen P1, P2 veya P3 girin.\n`);
    process.exit(1);
  }

  const { matches } = await findTaskAcrossProjects(taskQuery);

  if (matches.length === 0) {
    console.error(`\n${colors.red}Hata:${colors.reset} "${taskQuery}" içeren herhangi bir görev bulunamadı.\n`);
    process.exit(1);
  }

  if (matches.length > 1) {
    console.warn(`\n${colors.yellow}Birden fazla görev eşleşti. Lütfen daha belirgin bir başlık girin:${colors.reset}`);
    matches.forEach(m => {
      console.log(`  - [${m.repo.name}] [${m.task.priorityCode || 'P2'}] ${m.task.title}`);
    });
    console.log('');
    process.exit(1);
  }

  const { repo, task } = matches[0];

  const res = await apiFetch(`${BASE_URL}/api/tasks/priority`, {
    method: 'POST',
    body: JSON.stringify({
      repoId: repo.id,
      repoFullName: repo.fullName,
      filePath: repo.filePath || 'yapilacaklar.md',
      taskId: task.id,
      taskTitle: task.title,
      newPriorityCode: priority
    })
  });

  await res.json();

  const colorTag = priority === 'P1' ? colors.red : priority === 'P2' ? colors.yellow : colors.cyan;

  console.log(`\n${colors.bold}Görev Önceliği Güncellendi:${colors.reset}`);
  console.log(`  Proje:   ${repo.name}`);
  console.log(`  Öncelik: ${colorTag}[${priority}]${colors.reset}`);
  console.log(`  Görev:   ${task.title}\n`);
}

async function listFocusTasks() {
  const res = await apiFetch(`${BASE_URL}/api/projects`);
  const data = await res.json();

  console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}  🎯 Repo Pilot · Günlük Odak & En Öncelikli Görevler${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

  let p1Tasks = [];
  let otherTasks = [];

  data.projects.forEach(repo => {
    (repo.tasks || []).forEach(t => {
      if (!t.completed) {
        if (t.priorityRank === 1 || t.priorityCode === 'P1') {
          p1Tasks.push({ repo, task: t });
        } else {
          otherTasks.push({ repo, task: t });
        }
      }
    });
  });

  if (p1Tasks.length === 0 && otherTasks.length === 0) {
    console.log(`${colors.green}🎉 Tebrikler! Bekleyen açık hiçbir görev bulunmuyor.${colors.reset}\n`);
    return;
  }

  console.log(`${colors.bold}${colors.red}🔥 GÜNÜN KRİTİK ODAK İŞLERİ (P1):${colors.reset}`);
  if (p1Tasks.length > 0) {
    p1Tasks.forEach((item, idx) => {
      console.log(`  ${idx + 1}. ${colors.red}[P1]${colors.reset} ${colors.bold}${item.task.title}${colors.reset} (${colors.cyan}${item.repo.name}${colors.reset})`);
    });
  } else {
    console.log(`  ${colors.green}✓ Bekleyen acil P1 iş yok.${colors.reset}`);
  }
  console.log('');

  if (otherTasks.length > 0) {
    console.log(`${colors.bold}${colors.yellow}📋 SIRADAKİ ÖNCELİKLİ GÖREVLER (P2/P3):${colors.reset}`);
    otherTasks.slice(0, 5).forEach((item, idx) => {
      const pColor = item.task.priorityRank === 2 ? colors.yellow : colors.cyan;
      console.log(`  • ${pColor}[${item.task.priorityCode || 'P2'}]${colors.reset} ${item.task.title} (${colors.gray}${item.repo.name}${colors.reset})`);
    });
    if (otherTasks.length > 5) {
      console.log(`  ${colors.gray}... ve ${otherTasks.length - 5} diğer görev${colors.reset}`);
    }
    console.log('');
  }

  console.log(`${colors.gray}İpucu: Bir görevi tamamlamak için: node bin/taskdeck.js done "görev başlığı"${colors.reset}\n`);
}

function printHelp() {
  console.log(`
${colors.bold}${colors.cyan}Repo Pilot CLI - Kullanım Rehberi${colors.reset}

Komutlar:
  ${colors.bold}list, ls${colors.reset}                       Tüm projelerin sağlık raporunu ve görev sayılarını listeler
  ${colors.bold}p1, urgent${colors.reset}                     Tüm projelerdeki sadece P1 acil görevleri listeler
  ${colors.bold}focus, today${colors.reset}                   Günün kritik odak görevlerini ve sıradaki işleri listeler
  ${colors.bold}done, toggle <görev>${colors.reset}         Belirtilen görevin durumunu tamamlandı/beklemede yapar
  ${colors.bold}priority <görev> <P1|P2|P3>${colors.reset}  Görevin öncelik seviyesini değiştirir
  ${colors.bold}add <repo> <P1|P2|P3> <görev>${colors.reset}  Belirtilen projeye yeni bir görev ekler
  ${colors.bold}digest${colors.reset}                         Telegram sabah özetini anında telefonunuza gönderir
  ${colors.bold}cal, schedule${colors.reset}                  Takvim ve teslim tarihi raporunu listeler
  ${colors.bold}help${colors.reset}                           Bu yardım menüsünü görüntüler

Örnekler:
  node bin/taskdeck.js list  (veya: repopilot list)
  node bin/taskdeck.js focus
  node bin/taskdeck.js done "API entegrasyon"
  node bin/taskdeck.js priority "UI iyileştirmeleri" P1
  node bin/taskdeck.js add FamApp P1 "Bildirim servisini onar"
  node bin/taskdeck.js cal
`);
}

main();
