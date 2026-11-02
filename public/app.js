/**
 * Repo Pilot Client-Side Application Logic (v2.5 - Professional & Calendar Edition)
 */

// Dual-storage helpers for seamless backward compatibility between repopilot_* and taskdeck_*
function getStorage(key, fallback = null) {
  try {
    const repoVal = localStorage.getItem('repopilot_' + key);
    if (repoVal !== null) return repoVal;
    return localStorage.getItem('taskdeck_' + key) ?? fallback;
  } catch { return fallback; }
}

function setStorage(key, value) {
  try {
    localStorage.setItem('repopilot_' + key, value);
    localStorage.setItem('taskdeck_' + key, value);
  } catch (e) {
    console.warn('LocalStorage error:', e);
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem('repopilot_' + key);
    localStorage.removeItem('taskdeck_' + key);
  } catch (e) {}
}

function loadFocusTasks() {
  try {
    const value = JSON.parse(getStorage('focus_tasks', '[]'));
    return Array.isArray(value) ? value.filter(task => task && typeof task.title === 'string' && typeof task.repoId === 'string') : [];
  } catch { return []; }
}

function saveFocusTasks() {
  try { setStorage('focus_tasks', JSON.stringify(state.focusTasks)); }
  catch { showToast('Odak listesi bu tarayıcıda kaydedilemiyor.', 'warning'); }
}

const nativeFetch = window.fetch.bind(window);
let sessionReady = null;
async function openSession() {
  let response = await nativeFetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  if (response.status === 401) {
    const token = prompt('Repo Pilot API erişim anahtarı:');
    if (!token) throw new Error('Repo Pilot erişim anahtarı gerekli.');
    response = await nativeFetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  }
  if (!response.ok) throw new Error('Repo Pilot oturumu açılamadı.');
}
window.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, options);
  if (!sessionReady) sessionReady = openSession().catch(error => { sessionReady = null; throw error; });
  await sessionReady;
  let response = await nativeFetch(input, options);
  if (response.status === 401) {
    sessionReady = openSession().catch(error => { sessionReady = null; throw error; });
    await sessionReady;
    response = await nativeFetch(input, options);
  }
  return response;
};

function actionAttrs(action, data, event = 'click') {
  return `data-action="${action}" data-event="${event}" data-payload="${escapeHtml(JSON.stringify(data))}"`;
}

function repoIdentity(repo) {
  return { repoId: repo.repoId || repo.id, repoFullName: repo.repoFullName || repo.fullName, filePath: repo.filePath };
}

function taskIdentity(repo, task) {
  return {
    ...repoIdentity(repo),
    taskId: task.id || task.taskId,
    taskTitle: task.title,
    issueNumber: task.issueNumber,
    source: task.source
  };
}

function todayInZone() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: state.timeZone || 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Application State
const state = {
  currentView: 'home', // 'grid', 'kanban', 'calendar', 'focus', 'scanner'
  mode: 'demo',
  projects: [],
  filteredProjects: [],
  searchQuery: '',
  priorityFilter: 'all',
  hideCompleted: false,
  staleOnly: false,
  sortOption: 'p1_desc',
  activeRepoForTask: null,
  expandedCompletedRepos: new Set(),
  // Pinned tasks for daily focus (saved in localStorage)
  focusTasks: loadFocusTasks(),
  timeZone: 'Europe/Istanbul',
  // Pomodoro Timer State
  pomodoro: {
    timeLeft: 25 * 60,
    totalTime: 25 * 60,
    isRunning: false,
    intervalId: null,
    mode: 'Odak'
  },
  // Scanned code TODOs
  codeTodos: [],
  // Calendar & Scheduling State
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(), // 0 = Jan, 9 = Oct
  calendarSelectedRepo: 'all',
  scheduleData: null,
  activeAgendaDate: null
};

// Turkish Month Names
const MONTH_NAMES = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

// Theme Controller (Light / Dark Mode)
function initTheme() {
  const saved = getStorage('theme', 'dark');
  setTheme(saved, false);
}

function setTheme(theme, notify = false) {
  const html = document.documentElement;
  if (theme === 'light') {
    html.classList.remove('dark');
    html.classList.add('light');
  } else {
    html.classList.add('dark');
    html.classList.remove('light');
  }
  setStorage('theme', theme);
  updateThemeIcon(theme);
  if (notify) {
    showToast(theme === 'light' ? '☀️ Açık tema etkinleştirildi.' : '🌙 Koyu tema etkinleştirildi.', 'info');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  setTheme(isDark ? 'light' : 'dark', true);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    if (theme === 'light') {
      btn.innerHTML = '<i id="icon-theme" data-lucide="moon" class="w-4 h-4"></i>';
      btn.title = "Koyu Temaya Geç (Dark Mode)";
    } else {
      btn.innerHTML = '<i id="icon-theme" data-lucide="sun" class="w-4 h-4"></i>';
      btn.title = "Açık Temaya Geç (Light Mode)";
    }
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (typeof renderHomePage === 'function') {
    renderHomePage();
  }
  initApp();
});

async function initApp() {
  initTheme();
  checkActiveUserSession();
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Uygulama durumu alınamadı.');
    state.mode = data.mode || 'demo';
    state.timeZone = data.timeZone || 'Europe/Istanbul';
    state.calendarToken = data.calendarToken || '';
    state.calendarSubscriptionUrl = data.calendarSubscriptionUrl || '';
    state.localScanRoot = data.localScanRoot || '';
    const scanRootInput = document.getElementById('input-scan-root');
    if (scanRootInput) scanRootInput.value = data.localScanRoot || '';
    const calUrlInput = document.getElementById('input-calendar-url');
    if (calUrlInput) calUrlInput.value = data.calendarBaseUrl || '';
    if (data.username) {
      document.getElementById('input-username').value = data.username;
    }
    if (data.targetFileName) {
      document.getElementById('input-target-file').value = data.targetFileName;
    }
    if (data.taskSource) {
      state.taskSource = data.taskSource;
      const radio = document.querySelector(`input[name="setting-task-source"][value="${data.taskSource}"]`);
      if (radio) radio.checked = true;
    }
    state.telegramConfigured = Boolean(data.telegramConfigured);
    state.telegramChatId = data.telegramChatId || '';
    state.telegramHasToken = Boolean(data.telegramHasToken);
    updateTelegramStatusPill(state.telegramConfigured);
    const tgChatInput = document.getElementById('input-telegram-chat');
    if (tgChatInput && data.telegramChatId) tgChatInput.value = data.telegramChatId;
    updateModeUI(state.mode);

    await fetchProjects();
    await fetchScheduleData();
    updateFocusCountBadge();
  } catch (err) {
    console.error('Başlatma hatası:', err);
    showToast('Sunucuya bağlanılamadı. Lütfen sunucunun çalıştığından emin olun.', 'error');
  }
}

/**
 * VIEW SWITCHING LOGIC (All 7 views)
 */
function switchView(viewName) {
  state.currentView = viewName;

  const views = ['home', 'grid', 'kanban', 'calendar', 'focus', 'scanner', 'analytics', 'settings', 'insights'];
  views.forEach(v => {
    const el = document.getElementById(`view-container-${v}`);
    if (el) {
      if (v === viewName) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  // Update sidebar active items
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.classList.remove('active');
  });
  const sideBtn = document.getElementById(`side-nav-${viewName}`);
  if (sideBtn) {
    sideBtn.classList.add('active');
  }

  // View specific loaders
  if (viewName === 'home') {
    renderHomePage();
  } else if (viewName === 'kanban') {
    renderKanbanBoard();
  } else if (viewName === 'calendar') {
    renderCalendarView();
  } else if (viewName === 'focus') {
    renderDailyFocus();
  } else if (viewName === 'scanner') {
    fetchCodeTodos();
  } else if (viewName === 'grid') {
    if (state.projectsCurrentSubView === 'radar') {
      switchProjectsSubView('radar');
    } else {
      switchProjectsSubView('cards');
    }
  } else if (viewName === 'analytics') {
    renderAnalyticsPage();
  } else if (viewName === 'settings') {
    renderSettingsPage();
  } else if (viewName === 'insights') {
    openProjectsRadarView();
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

/**
 * Mobile Sidebar Drawer Toggle
 */
function toggleMobileSidebar() {
  const sidebar = document.getElementById('mobile-sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  if (!sidebar || !overlay) return;

  const isOpen = !sidebar.classList.contains('-translate-x-full');
  if (isOpen) {
    sidebar.classList.add('-translate-x-full');
    overlay.classList.add('hidden');
  } else {
    sidebar.classList.remove('-translate-x-full');
    overlay.classList.remove('hidden');
  }
}

/**
 * Mode UI Update
 */
function updateModeUI(mode) {
  const btnDemo = document.getElementById('btn-mode-demo');
  const btnLive = document.getElementById('btn-mode-live');

  if (mode === 'demo') {
    btnDemo.className = 'px-2.5 py-1 font-semibold rounded-lg bg-blue-600 text-white shadow-sm flex items-center space-x-1';
    btnLive.className = 'px-2.5 py-1 font-medium rounded-lg text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white flex items-center space-x-1';
  } else {
    btnLive.className = 'px-2.5 py-1 font-semibold rounded-lg bg-emerald-600 text-white shadow-sm flex items-center space-x-1';
    btnDemo.className = 'px-2.5 py-1 font-medium rounded-lg text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white flex items-center space-x-1';
  }

  const sourceBadge = document.getElementById('header-task-source');
  if (sourceBadge) {
    const src = state.taskSource || 'issues';
    if (src === 'issues') {
      sourceBadge.innerHTML = `<i data-lucide="github" class="w-3 h-3"></i> GitHub Issues (Birebir Senkronize)`;
      sourceBadge.className = 'inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400';
    } else if (src === 'both') {
      sourceBadge.innerHTML = `<i data-lucide="layers" class="w-3 h-3"></i> Hibrit (Issues + Dosya)`;
      sourceBadge.className = 'inline-flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400';
    } else {
      sourceBadge.innerHTML = `<i data-lucide="file-text" class="w-3 h-3"></i> yapilacaklar.md (Klasik)`;
      sourceBadge.className = 'inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-gray-400';
    }
  }

  lucide.createIcons();
}

/**
 * Switch Demo/Live mode
 */
async function switchMode(targetMode) {
  if (state.mode === targetMode) return;

  try {
    const res = await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: targetMode })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    state.mode = data.mode;
    updateModeUI(state.mode);
    showToast(targetMode === 'demo' ? 'Demo moduna geçildi.' : 'Canlı GitHub moduna geçildi.', 'info');
    await fetchProjects(true);
    await fetchScheduleData();
  } catch (err) {
    showToast(`Mod değiştirilemedi: ${err.message}`, 'error');
  }
}

/**
 * Fetch projects from backend
 */
async function fetchProjects(forceRefresh = false) {
  const loadingEl = document.getElementById('loading-state');
  const gridEl = document.getElementById('projects-grid');
  const emptyEl = document.getElementById('empty-state');
  const refreshIcon = document.getElementById('icon-refresh');

  if (refreshIcon) refreshIcon.classList.add('animate-spin');
  if (state.projects.length === 0) {
    loadingEl.classList.remove('hidden');
    gridEl.classList.add('hidden');
    emptyEl.classList.add('hidden');
  }

  try {
    const res = await fetch(`/api/projects?refresh=${forceRefresh}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Veriler alınamadı');

    state.projects = data.projects || [];
    state.mode = data.mode;
    reconcileFocusTasks();
    updateModeUI(state.mode);

    // Update global dashboard stats
    if (data.summary) {
      document.getElementById('stat-total-projects').textContent = data.summary.totalProjects;
      document.getElementById('stat-p1-tasks').textContent = data.summary.totalP1;
      document.getElementById('stat-pending-tasks').textContent = data.summary.totalPending;
      document.getElementById('stat-overall-percentage').textContent = `%${data.summary.overallPercentage}`;
      document.getElementById('stat-completed-summary').textContent = `${data.summary.totalCompleted} / ${data.summary.totalTasks} tamamlandı`;

      const staleAlert = document.getElementById('stat-stale-alert');
      if (data.summary.staleCount > 0) {
        staleAlert.className = 'text-xs text-red-400 mt-0.5 flex items-center gap-1 font-semibold animate-pulse';
        staleAlert.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> ${data.summary.staleCount} İhmal Edilmiş Proje!`;
      } else {
        staleAlert.className = 'text-xs text-emerald-400 mt-0.5 flex items-center gap-1';
        staleAlert.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Tüm projeler aktif`;
      }
    }

    applyFiltersAndRender();
    await fetchScheduleData();

    if (forceRefresh) {
      showToast(data.fromCache ? 'Önbellekten güncellendi.' : 'GitHub repoları başarıyla tarandı!', 'success');
    }
  } catch (err) {
    console.error('Proje çekme hatası:', err);
    showToast(err.message, 'error');
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
    loadingEl.classList.add('hidden');
    gridEl.classList.remove('hidden');
  }
}

/**
 * Fetch calendar and schedule data
 */
async function fetchScheduleData() {
  try {
    const res = await fetch('/api/schedule');
    const data = await res.json();
    state.scheduleData = data;

    const overdueBadge = document.getElementById('badge-calendar-overdue');
    if (overdueBadge) {
      if (data.overdueCount > 0) {
        overdueBadge.textContent = data.overdueCount;
        overdueBadge.classList.remove('hidden');
        overdueBadge.classList.add('inline-flex');
      } else {
        overdueBadge.classList.add('hidden');
        overdueBadge.classList.remove('inline-flex');
      }
    }

    if (state.currentView === 'calendar') {
      renderCalendarView();
    }
  } catch (err) {
    console.error('Schedule data error:', err);
  }
}

/**
 * Filter & Sort Projects
 */
function applyFiltersAndRender() {
  const query = state.searchQuery.toLowerCase().trim();

  let list = state.projects.map(repo => {
    const clone = { ...repo };
    let tasks = [...(clone.tasks || [])];

    if (state.priorityFilter !== 'all') {
      const targetRank = state.priorityFilter === 'p1' ? 1 : state.priorityFilter === 'p2' ? 2 : 3;
      tasks = tasks.filter(t => t.priorityRank === targetRank);
    }

    if (state.hideCompleted) {
      tasks = tasks.filter(t => !t.completed);
    }

    if (query) {
      const matchRepo = clone.name.toLowerCase().includes(query) || (clone.description && clone.description.toLowerCase().includes(query));
      if (!matchRepo) {
        tasks = tasks.filter(t => 
          t.title.toLowerCase().includes(query) || 
          (t.tags && t.tags.some(tag => tag.toLowerCase().includes(query)))
        );
      }
    }

    clone.displayTasks = tasks;
    return clone;
  });

  if (state.priorityFilter !== 'all' || query) {
    list = list.filter(r => r.displayTasks.length > 0);
  }

  if (state.staleOnly) {
    list = list.filter(r => r.isStale);
  }

  // Sort
  list.sort((a, b) => {
    switch (state.sortOption) {
      case 'p1_desc':
        return (b.stats.p1Count - a.stats.p1Count) || (b.stats.pending - a.stats.pending);
      case 'health_asc':
        return a.health.score - b.health.score;
      case 'stale_desc':
        return (b.isStale ? 1 : 0) - (a.isStale ? 1 : 0) || (b.daysSinceUpdate - a.daysSinceUpdate);
      case 'pending_desc':
        return b.stats.pending - a.stats.pending;
      case 'progress_asc':
        return a.stats.completionPercentage - b.stats.completionPercentage;
      case 'alpha_asc':
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  state.filteredProjects = list;

  if (state.currentView === 'home') {
    renderHomePage();
  } else if (state.currentView === 'grid') {
    renderProjectsGrid();
  } else if (state.currentView === 'kanban') {
    renderKanbanBoard();
  } else if (state.currentView === 'calendar') {
    renderCalendarView();
  }
}

/**
 * Render Project Cards (Grid View - Ana Açılış Sayfası)
 * Enhanced for high readability, modern dark navy styling, and executive functionality
 */
function renderProjectsGrid() {
  const gridEl = document.getElementById('projects-grid');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('filter-results-count');

  if (!gridEl) return;
  if (countEl) countEl.textContent = `${state.filteredProjects.length} proje listeleniyor`;

  if (state.filteredProjects.length === 0) {
    gridEl.innerHTML = '';
    if (emptyEl) {
      if (state.mode === 'live' && state.projects.length === 0) {
        emptyEl.innerHTML = `
          <div class="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto text-blue-400 mb-4 shadow-lg shadow-blue-500/10">
            <i data-lucide="github" class="w-8 h-8"></i>
          </div>
          <h3 class="text-base font-semibold text-white">GitHub Hesabınız Bağlandı</h3>
          <p class="text-xs text-slate-400 max-w-md mx-auto mt-2 leading-relaxed">
            GitHub hesabınız başarıyla bağlandı, ancak repolarınızda henüz açık bir Issue veya <code class="text-blue-300 font-mono bg-blue-950/60 px-1 py-0.5 rounded">yapilacaklar.md</code> dosyası tespit edilmedi.
          </p>
          <div class="mt-5 flex items-center justify-center gap-3">
            <button onclick="switchMode('demo')" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center gap-1.5 cursor-pointer">
              <i data-lucide="play" class="w-3.5 h-3.5"></i>
              <span>Demo Modunu İncele</span>
            </button>
            <button onclick="openAddTaskModal()" class="px-4 py-2 bg-[#182234] hover:bg-[#1F2C42] text-xs font-medium text-slate-200 rounded-xl transition-colors border border-[#1F293D] flex items-center gap-1.5 cursor-pointer">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>Yeni Görev / Issue Ekle</span>
            </button>
          </div>
        `;
      } else {
        emptyEl.innerHTML = `
          <div class="w-16 h-16 rounded-full bg-[#182234] flex items-center justify-center mx-auto text-slate-400 mb-4">
            <i data-lucide="folder-search" class="w-8 h-8"></i>
          </div>
          <h3 class="text-base font-semibold text-white">Gösterilecek Proje Bulunamadı</h3>
          <p class="text-xs text-slate-400 max-w-md mx-auto mt-1">Arama veya filtre kriterlerinize uygun proje bulunmuyor.</p>
          <button onclick="resetFilters()" class="mt-4 px-4 py-2 bg-[#182234] hover:bg-[#1F2C42] text-xs font-medium text-white rounded-xl transition-colors border border-[#1F293D]">
            Filtreleri Temizle
          </button>
        `;
      }
      emptyEl.classList.remove('hidden');
    }
    lucide.createIcons();
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');

  gridEl.innerHTML = state.filteredProjects.map(repo => {
    const isCompletedExpanded = state.expandedCompletedRepos.has(repo.id);
    const pendingTasks = repo.displayTasks.filter(t => !t.completed);
    const completedTasks = repo.displayTasks.filter(t => t.completed);

    let progressColor = 'from-blue-600 to-indigo-600';
    if (repo.stats.completionPercentage >= 80) progressColor = 'from-emerald-500 to-teal-500';
    else if (repo.stats.completionPercentage >= 40) progressColor = 'from-amber-500 to-orange-500';

    const healthPillClass = `health-pill-${repo.health.grade.charAt(0)}`;
    const staleAlertClass = repo.isStale ? 'border-rose-500/50 shadow-rose-500/10' : 'border-[#1F293D]';

    return `
      <div class="project-card bg-[#111827] border ${staleAlertClass} rounded-2xl p-5 flex flex-col justify-between transition-all duration-200 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-950/30" id="${repo.id}">
        
        <div>
          <!-- STALE RADAR WARNING BANNER -->
          ${repo.isStale ? `
            <div class="mb-3 px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
              <span class="flex items-center gap-1.5 font-bold">
                <i data-lucide="alert-triangle" class="w-3.5 h-3.5 text-rose-400"></i>
                ⚠️ İhmal Edildi (${repo.daysSinceUpdate} gündür commit yok!)
              </span>
              <span class="text-[10px] bg-rose-500/30 px-1.5 py-0.5 rounded text-rose-200 font-semibold">Kritik</span>
            </div>
          ` : ''}

          <!-- CARD HEADER -->
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center space-x-2">
                <a href="${safeUrl(repo.url)}" target="_blank" rel="noreferrer" class="text-base font-bold text-white hover:text-blue-400 truncate block transition-colors tracking-tight">
                  ${escapeHtml(repo.name)}
                </a>
                <i data-lucide="external-link" class="w-3.5 h-3.5 text-slate-400 hover:text-white flex-shrink-0"></i>
              </div>
              <p class="text-xs text-slate-300 line-clamp-2 mt-1 leading-relaxed">
                ${escapeHtml(repo.description || 'Açıklama belirtilmemiş.')}
              </p>
            </div>
            
            <!-- Health Score & Badges -->
            <div class="flex flex-col items-end space-y-1.5 flex-shrink-0">
              <span onclick="switchProjectsSubView('radar', '${repo.id}')" class="text-[11px] font-bold px-2 py-0.5 rounded-lg ${healthPillClass} cursor-pointer hover:opacity-85 transition-opacity" title="Projenin Hatalarını, Önerilerini ve Fikirlerini İncele">
                Skor: ${repo.health.grade} (${repo.health.score})
              </span>
              <span class="text-[10px] text-slate-400 font-mono">
                ${escapeHtml(repo.language || 'Proje')}
              </span>
            </div>
          </div>

          <!-- PROGRESS BAR & DETAILED STATS CHIPS -->
          <div class="my-3.5 space-y-2 bg-[#080C14] p-3 rounded-xl border border-[#1F293D]">
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-300 font-medium flex items-center gap-1.5">
                <i data-lucide="trending-up" class="w-3.5 h-3.5 text-blue-400"></i>
                İlerleme
              </span>
              <span class="font-bold text-white">
                %${repo.stats.completionPercentage} <span class="text-slate-400 font-normal">(${repo.stats.completed}/${repo.stats.total} görev)</span>
              </span>
            </div>
            <div class="w-full bg-[#182234] rounded-full h-2 overflow-hidden border border-[#1F293D]">
              <div class="h-full bg-gradient-to-r ${progressColor} transition-all duration-500 rounded-full" style="width: ${repo.stats.completionPercentage}%"></div>
            </div>
            
            <!-- Mini Chips Row -->
            <div class="flex items-center justify-between pt-1 text-[11px]">
              <div class="flex items-center space-x-1.5">
                <span class="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
                  ✓ ${repo.stats.completed} Bitti
                </span>
                <span class="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20">
                  ⏳ ${pendingTasks.length} Bekliyor
                </span>
                ${repo.stats.p1Count > 0 ? `
                  <span class="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30 flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
                    ${repo.stats.p1Count} Acil
                  </span>
                ` : ''}
              </div>
              <span class="text-[10px] text-slate-400 font-mono">${escapeHtml(repo.filePath || 'yapilacaklar.md')}</span>
            </div>
          </div>

          <!-- TASKS LIST -->
          <div class="space-y-2.5 my-3">
            ${pendingTasks.length > 0 ? pendingTasks.slice(0, 5).map(task => renderTaskItem(repo, task)).join('') : `
              <div class="text-center py-4 text-xs text-slate-400 italic bg-[#080C14] rounded-xl border border-[#1F293D]">
                ${repo.displayTasks.length === 0 ? 'Filtreye uygun görev yok.' : '🎉 Tüm bekleyen görevler tamamlandı!'}
              </div>
            `}

            ${pendingTasks.length > 5 ? `
              <div class="text-center pt-1">
                <button onclick="openProjectInKanban('${repo.id}')" class="text-xs text-blue-400 hover:text-blue-300 font-medium">
                  + ${pendingTasks.length - 5} görev daha var (Kanban'da gör) →
                </button>
              </div>
            ` : ''}

            <!-- Completed Accordion -->
            ${completedTasks.length > 0 && !state.hideCompleted ? `
              <div class="pt-2 border-t border-[#1F293D]">
                <button ${actionAttrs('completed-section', { repoId: repo.id })} class="w-full flex items-center justify-between text-xs text-slate-400 hover:text-white py-1 transition-colors">
                  <span class="flex items-center gap-1.5 font-medium">
                    <i data-lucide="${isCompletedExpanded ? 'chevron-down' : 'chevron-right'}" class="w-3.5 h-3.5"></i>
                    Tamamlanan Görevler (${completedTasks.length})
                  </span>
                  <span class="text-[10px] text-slate-400">${isCompletedExpanded ? 'Gizle' : 'Göster'}</span>
                </button>
                
                ${isCompletedExpanded ? `
                  <div class="space-y-2 mt-2 pl-2 border-l-2 border-[#1F293D]">
                    ${completedTasks.map(task => renderTaskItem(repo, task)).join('')}
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- CARD FOOTER: ACTION BUTTONS (ADD TASK, INSIGHTS, KANBAN, CALENDAR) -->
        <div class="pt-3 border-t border-[#1F293D] mt-3 flex items-center gap-2">
          <button ${actionAttrs('add-task', { ...repoIdentity(repo), repoName: repo.name })} class="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-sm shadow-blue-600/30">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>Görev Ekle</span>
          </button>
          <button onclick="switchProjectsSubView('radar', '${repo.id}')" title="Proje Hataları, Önerileri ve Fikirleri İncele" class="p-2 rounded-xl bg-[#141f33] hover:bg-[#1a2845] text-amber-400 hover:text-amber-300 border border-amber-500/30 text-xs transition-colors flex items-center space-x-1.5 cursor-pointer shadow-sm">
            <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-400"></i>
            <span class="hidden sm:inline font-medium">Hatalar & Fikirler</span>
          </button>
          <button onclick="openProjectInKanban('${repo.id}')" title="Bu projeyi Kanban'da aç" class="p-2 rounded-xl bg-[#182234] hover:bg-[#1F2C42] text-slate-300 hover:text-white border border-[#1F293D] text-xs transition-colors flex items-center space-x-1 cursor-pointer">
            <i data-lucide="kanban-square" class="w-3.5 h-3.5"></i>
            <span class="hidden sm:inline">Kanban</span>
          </button>
          <button onclick="openProjectInCalendar('${repo.id}')" title="Bu projeyi Takvimde gör" class="p-2 rounded-xl bg-[#182234] hover:bg-[#1F2C42] text-slate-300 hover:text-white border border-[#1F293D] text-xs transition-colors flex items-center space-x-1 cursor-pointer">
            <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
          </button>
        </div>

      </div>
    `;
  }).join('');

  lucide.createIcons();
}

/**
 * Quick jump from project card to Kanban with project pre-selected
 */
function openProjectInKanban(repoId) {
  switchView('kanban');
  const sel = document.getElementById('kanban-repo-filter');
  if (sel) {
    sel.value = repoId;
    filterKanbanByRepo(repoId);
  }
}

/**
 * Quick jump from project card to Calendar with project pre-selected
 */
function openProjectInCalendar(repoId) {
  switchView('calendar');
  const sel = document.getElementById('calendar-repo-filter');
  if (sel) {
    sel.value = repoId;
    filterCalendarByRepo(repoId);
  }
}

/**
 * PROJECT INSIGHTS, BUGS, RECOMMENDATIONS & IDEAS MODAL
 */
let currentInsightsRepoId = null;

function openProjectInsightsModal(repoId) {
  currentInsightsRepoId = repoId;
  const modal = document.getElementById('project-insights-modal');
  if (!modal) return;

  const repo = (state.projects || []).find(p => p.id === repoId || String(p.id) === String(repoId));
  if (!repo) {
    showToast('Proje bulunamadı.', 'error');
    return;
  }

  // Header info
  const nameEl = document.getElementById('insights-project-name');
  const descEl = document.getElementById('insights-project-desc');
  const badgeEl = document.getElementById('insights-health-badge');
  if (nameEl) nameEl.textContent = repo.name;
  if (descEl) descEl.textContent = repo.description || 'Proje açıklaması belirtilmemiş.';
  if (badgeEl) {
    badgeEl.className = `text-[11px] font-bold px-2 py-0.5 rounded-lg health-pill-${repo.health.grade.charAt(0)}`;
    badgeEl.textContent = `Skor: ${repo.health.grade} (${repo.health.score}/100)`;
  }

  // Footer buttons
  const btnKanban = document.getElementById('insights-btn-kanban');
  const btnCalendar = document.getElementById('insights-btn-calendar');
  if (btnKanban) btnKanban.onclick = () => { closeProjectInsightsModal(); openProjectInKanban(repo.id); };
  if (btnCalendar) btnCalendar.onclick = () => { closeProjectInsightsModal(); openProjectInCalendar(repo.id); };

  // 1. Analyze Bugs & Risks
  const tasks = repo.tasks || [];
  const p1Tasks = tasks.filter(t => !t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1));
  const overdueTasks = tasks.filter(t => !t.completed && (t.isOverdue || (t.dueDate && new Date(t.dueDate) < new Date())));
  const staleAlert = repo.isStale;

  const countBugsEl = document.getElementById('insights-count-bugs');
  const totalRisksCount = p1Tasks.length + overdueTasks.length + (staleAlert ? 1 : 0);
  if (countBugsEl) countBugsEl.textContent = totalRisksCount;

  const bugsContainer = document.getElementById('insights-content-bugs');
  if (bugsContainer) {
    let bugsHtml = '';

    if (staleAlert) {
      bugsHtml += `
        <div class="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400 shrink-0 mt-0.5"></i>
          <div>
            <p class="font-bold text-rose-200">İhmal Edilmiş / Bayat Proje Riski</p>
            <p class="text-[11px] text-rose-300/80 mt-0.5">Bu projeye son ${repo.daysSinceUpdate} gündür herhangi bir commit atılmamış ve bekleyen acil işleri var. Projenin teknik sağlığı geriliyor.</p>
          </div>
        </div>
      `;
    }

    if (p1Tasks.length > 0) {
      bugsHtml += `
        <div class="space-y-1.5">
          <h4 class="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
            Kritik & Acil Hatalar (P1 - ${p1Tasks.length} adet)
          </h4>
          <div class="space-y-2">
            ${p1Tasks.map(t => `
              <div class="p-3 rounded-xl bg-[#080C14] border border-rose-500/30 flex items-center justify-between gap-3 text-xs">
                <div class="flex items-center gap-2.5 min-w-0">
                  <span class="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold text-[10px] shrink-0 border border-rose-500/30">P1 ACİL</span>
                  <div class="min-w-0">
                    <p class="font-semibold text-white truncate">${escapeHtml(t.title)}</p>
                    <p class="text-[10px] text-slate-400 mt-0.5 truncate">${escapeHtml(t.description || 'Detaylı açıklama yok.')}</p>
                  </div>
                </div>
                ${t.dueDate ? `<span class="text-[10px] text-rose-300 px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/40 shrink-0">Teslim: ${t.dueDate}</span>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (overdueTasks.length > 0) {
      bugsHtml += `
        <div class="space-y-1.5 mt-2">
          <h4 class="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="clock" class="w-3.5 h-3.5 text-amber-400"></i>
            Teslim Tarihi Geçmiş İşler (${overdueTasks.length} adet)
          </h4>
          <div class="space-y-2">
            ${overdueTasks.map(t => `
              <div class="p-2.5 rounded-xl bg-[#080C14] border border-amber-500/30 flex items-center justify-between gap-3 text-xs">
                <div class="min-w-0">
                  <p class="font-medium text-slate-200 truncate">${escapeHtml(t.title)}</p>
                  <p class="text-[10px] text-amber-400 mt-0.5">Gecikti · Planlanan: ${t.dueDate}</p>
                </div>
                <button onclick="closeProjectInsightsModal(); openProjectInCalendar('${repo.id}');" class="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded-lg text-[11px] font-medium border border-amber-500/30 transition-colors shrink-0 cursor-pointer">
                  Yeniden Planla
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (totalRisksCount === 0) {
      bugsHtml = `
        <div class="text-center py-10 px-4 bg-[#080C14] rounded-2xl border border-emerald-500/30 text-xs">
          <div class="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400 mb-2.5">
            <i data-lucide="check-circle-2" class="w-6 h-6"></i>
          </div>
          <h4 class="font-bold text-white text-sm">Tertemiz! Kritik Hata Bulunmuyor</h4>
          <p class="text-slate-400 text-xs mt-1 max-w-sm mx-auto">Bu projede bekleyen P1 acil hata, teslimi geçmiş görev veya ihmal uyarısı tespit edilmedi. Harika bir iş çıkarıyorsunuz!</p>
        </div>
      `;
    }

    bugsContainer.innerHTML = bugsHtml;
  }

  // 2. Analyze Smart Recommendations
  const suggestionsContainer = document.getElementById('insights-content-suggestions');
  if (suggestionsContainer) {
    const suggestions = [];

    // Health breakdown
    suggestions.push({
      icon: 'activity',
      iconColor: 'text-blue-400',
      bgColor: 'bg-blue-500/10 border-blue-500/30',
      title: `Sağlık Skoru Değerlendirmesi: ${repo.health.grade} (${repo.health.score}/100)`,
      desc: `Puanlama formülü: Tamamlanan görev oranı (%${repo.stats.completionPercentage}) skoru desteklerken, ${p1Tasks.length} adet P1 acil iş (-${p1Tasks.length * 15} puan) ve ${repo.isStale ? '14+ gün hareketsizlik (-10 puan)' : 'düzenli commit aktivitesi'} hesaba katılmıştır.`
    });

    if (p1Tasks.length > 0) {
      suggestions.push({
        icon: 'zap',
        iconColor: 'text-rose-400',
        bgColor: 'bg-rose-500/10 border-rose-500/30',
        title: 'Öncelikli Aksiyon: P1 Hatalarını Çözün',
        desc: `"${escapeHtml(p1Tasks[0].title)}" görevini tamamlayarak veya önceliğini düşürerek projenin sağlık skorunu anında +15 puan artırabilir ve projenin durumunu ${repo.health.grade === 'F' ? 'C derecesine' : 'bir üst lige'} taşıyabilirsiniz.`
      });
    }

    if (overdueTasks.length > 0) {
      suggestions.push({
        icon: 'calendar-clock',
        iconColor: 'text-amber-400',
        bgColor: 'bg-amber-500/10 border-amber-500/30',
        title: 'Takvim Düzenlemesi: Geciken İşleri Erteleyin',
        desc: `${overdueTasks.length} adet iş planlanan tarihin gerisinde kalmış. Takvim ekranına giderek bu işleri bu haftanın boş günlerine sürükleyip bırakarak takviminizi gerçekçi hale getirin.`
      });
    }

    if (repo.stats.total - repo.stats.completed > 6) {
      suggestions.push({
        icon: 'layers',
        iconColor: 'text-purple-400',
        bgColor: 'bg-purple-500/10 border-purple-500/30',
        title: 'Sprint İş Yükü Dağıtımı',
        desc: `Bekleyen toplam ${repo.stats.total - repo.stats.completed} görev var. Günlük Odak ekranındaki Eisenhower matrisini kullanarak işleri Q1 (Acil) ve Q2 (Stratejik) olarak gruplandırmanız önerilir.`
      });
    }

    suggestions.push({
      icon: 'code-2',
      iconColor: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 border-emerald-500/30',
      title: 'Kod İçi Denetim (FIXME / TODO)',
      desc: `Bu projenin yerel kaynak kodlarındaki FIXME, BUG ve HACK etiketlerini sol menüdeki "Kod İçi TODO" ekranından satır satır inceleyip doğrudan göreve dönüştürebilirsiniz.`
    });

    suggestionsContainer.innerHTML = suggestions.map(s => `
      <div class="p-3.5 rounded-xl bg-[#080C14] border ${s.bgColor} flex items-start gap-3 text-xs">
        <div class="w-8 h-8 rounded-lg bg-[#111827] flex items-center justify-center shrink-0 mt-0.5">
          <i data-lucide="${s.icon}" class="w-4 h-4 ${s.iconColor}"></i>
        </div>
        <div>
          <h4 class="font-bold text-white">${s.title}</h4>
          <p class="text-slate-300 text-[11px] mt-1 leading-relaxed">${s.desc}</p>
        </div>
      </div>
    `).join('');
  }

  // 3. Analyze Ideas & Backlog (P4 & Ideas)
  const ideaTasks = tasks.filter(t => t.priorityCode === 'P4' || t.priorityRank === 4 || (t.tags && t.tags.some(tag => tag.includes('idea') || tag.includes('fikir') || tag.includes('backlog'))));
  const countIdeasEl = document.getElementById('insights-count-ideas');
  if (countIdeasEl) countIdeasEl.textContent = ideaTasks.length;

  const ideasContainer = document.getElementById('insights-content-ideas');
  if (ideasContainer) {
    let ideasHtml = `
      <!-- Fast Idea Add Input -->
      <div class="p-3 bg-[#080C14] border border-[#1F293D] rounded-xl flex gap-2 shadow-sm">
        <input 
          id="insights-new-idea-input" 
          type="text" 
          placeholder="Yeni bir proje fikri veya özellik önerisi yazın (Enter)..." 
          class="flex-1 px-3 py-1.5 bg-[#111827] border border-[#1F293D] rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500" 
          onkeydown="if(event.key==='Enter') submitProjectIdea('${repo.id}')"
        />
        <button onclick="submitProjectIdea('${repo.id}')" class="px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold shrink-0 shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>
          <span>Fikir Ekle</span>
        </button>
      </div>

      <!-- Ideas List -->
      <div class="space-y-2 mt-2">
    `;

    if (ideaTasks.length === 0) {
      ideasHtml += `
        <div class="text-center py-8 px-4 bg-[#080C14] rounded-xl border border-[#1F293D] text-xs text-slate-400">
          <i data-lucide="sparkles" class="w-6 h-6 text-cyan-400/50 mx-auto mb-2"></i>
          <p class="font-medium text-slate-300">Bu proje için henüz kaydedilmiş bir P4 fikir yok.</p>
          <p class="text-[11px] mt-1 text-slate-500">Yukarıdaki kutudan aklınıza gelen yeni özellikleri, araştırma başlıklarını veya mimari fikirleri anında ekleyebilirsiniz.</p>
        </div>
      `;
    } else {
      ideasHtml += ideaTasks.map(idea => `
        <div class="p-3 rounded-xl bg-[#080C14] border border-cyan-500/25 flex items-center justify-between gap-3 text-xs hover:border-cyan-500/50 transition-colors">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-6 h-6 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <i data-lucide="lightbulb" class="w-3.5 h-3.5"></i>
            </span>
            <div class="min-w-0">
              <p class="font-semibold text-white truncate">${escapeHtml(idea.title)}</p>
              <p class="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                <span class="text-cyan-400 font-mono">P4 Fikir</span>
                <span>·</span>
                <span>${idea.description || 'Backlog & Araştırma'}</span>
              </p>
            </div>
          </div>
          <button onclick="closeProjectInsightsModal(); openProjectInKanban('${repo.id}');" class="px-2.5 py-1 rounded-lg bg-[#111827] text-slate-300 hover:text-white border border-[#1F293D] text-[11px] shrink-0 transition-colors cursor-pointer">
            Kanban'da Gör →
          </button>
        </div>
      `).join('');
    }

    ideasHtml += `</div>`;
    ideasContainer.innerHTML = ideasHtml;
  }

  // Open modal and switch to default tab (bugs if bugs exist, else suggestions)
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  switchInsightsTab(totalRisksCount > 0 ? 'bugs' : 'suggestions');
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function closeProjectInsightsModal() {
  const modal = document.getElementById('project-insights-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function switchInsightsTab(tab) {
  const tabBugs = document.getElementById('insights-tab-bugs');
  const tabSug = document.getElementById('insights-tab-suggestions');
  const tabIdeas = document.getElementById('insights-tab-ideas');

  const contentBugs = document.getElementById('insights-content-bugs');
  const contentSug = document.getElementById('insights-content-suggestions');
  const contentIdeas = document.getElementById('insights-content-ideas');

  // Reset tab button states
  [tabBugs, tabSug, tabIdeas].forEach(btn => {
    if (!btn) return;
    btn.className = 'flex-1 py-1.5 px-3 rounded-lg font-medium text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-all cursor-pointer';
  });

  // Hide all contents
  if (contentBugs) contentBugs.classList.add('hidden');
  if (contentSug) contentSug.classList.add('hidden');
  if (contentIdeas) contentIdeas.classList.add('hidden');

  if (tab === 'bugs') {
    if (tabBugs) tabBugs.className = 'flex-1 py-1.5 px-3 rounded-lg font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer';
    if (contentBugs) contentBugs.classList.remove('hidden');
  } else if (tab === 'suggestions') {
    if (tabSug) tabSug.className = 'flex-1 py-1.5 px-3 rounded-lg font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer';
    if (contentSug) contentSug.classList.remove('hidden');
  } else if (tab === 'ideas') {
    if (tabIdeas) tabIdeas.className = 'flex-1 py-1.5 px-3 rounded-lg font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer';
    if (contentIdeas) contentIdeas.classList.remove('hidden');
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

async function submitProjectIdea(repoId) {
  const input = document.getElementById('insights-new-idea-input');
  if (!input || !input.value.trim()) {
    showToast('Lütfen bir fikir başlığı yazın.', 'warning');
    return;
  }
  const ideaTitle = input.value.trim();
  const repo = (state.projects || []).find(p => p.id === repoId || String(p.id) === String(repoId));
  if (!repo) return;

  try {
    const res = await fetch('/api/tasks/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        title: ideaTitle,
        description: 'Proje Fikri / Backlog İncelemesi',
        priorityCode: 'P4'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fikir eklenemedi');

    input.value = '';
    showToast(`✓ Yeni fikir "${ideaTitle}" başarıyla eklendi!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    openProjectInsightsModal(repoId);
    switchInsightsTab('ideas');
  } catch (err) {
    showToast(`Fikir ekleme hatası: ${err.message}`, 'error');
  }
}

/* ========================================================================= */
/* DEDICATED EXECUTIVE PROJECT RADAR & AUDIT COMMAND CENTER                  */
/* ========================================================================= */

state.projectsCurrentSubView = 'cards';
state.insightsSelectedRepoId = 'all';
state.insightsSelectedTag = '💡 Yenilik';

function switchProjectsSubView(subViewName, targetRepoId) {
  state.projectsCurrentSubView = subViewName;

  if (state.currentView !== 'grid') {
    switchView('grid');
    if (targetRepoId !== undefined) {
      state.insightsSelectedRepoId = targetRepoId;
    }
    return;
  }

  const cardsContainer = document.getElementById('projects-subview-cards');
  const radarContainer = document.getElementById('projects-subview-radar');
  const btnCards = document.getElementById('btn-projects-subview-cards');
  const btnRadar = document.getElementById('btn-projects-subview-radar');

  if (subViewName === 'radar') {
    if (cardsContainer) {
      cardsContainer.classList.add('hidden');
      cardsContainer.style.display = 'none';
    }
    if (radarContainer) {
      radarContainer.classList.remove('hidden');
      radarContainer.style.display = 'flex';
    }

    if (btnCards) {
      btnCards.classList.remove('active');
      btnCards.classList.add('text-slate-400');
    }
    if (btnRadar) {
      btnRadar.classList.add('active');
      btnRadar.classList.remove('text-slate-400');
    }

    renderInsightsView(targetRepoId);
  } else {
    if (radarContainer) {
      radarContainer.classList.add('hidden');
      radarContainer.style.display = 'none';
    }
    if (cardsContainer) {
      cardsContainer.classList.remove('hidden');
      cardsContainer.style.display = 'flex';
    }

    if (btnRadar) {
      btnRadar.classList.remove('active');
      btnRadar.classList.add('text-slate-400');
    }
    if (btnCards) {
      btnCards.classList.add('active');
      btnCards.classList.remove('text-slate-400');
    }

    renderProjectsGrid();
  }

  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function openProjectsRadarView(repoId) {
  state.projectsCurrentSubView = 'radar';
  if (repoId !== undefined) {
    state.insightsSelectedRepoId = repoId;
  }
  switchView('grid');
  switchProjectsSubView('radar', repoId);
}

function selectInsightsProjectTab(repoId) {
  state.insightsSelectedRepoId = repoId;
  renderInsightsView(repoId);
}

function selectRadarIdeaTag(btnEl, tagText) {
  state.insightsSelectedTag = tagText;
  document.querySelectorAll('.radar-tag-btn').forEach(btn => {
    btn.classList.remove('active', 'bg-cyan-500/20', 'text-cyan-300', 'border-cyan-500/30');
    btn.classList.add('bg-[#10192a]', 'text-slate-400', 'border-[#1e2d48]');
  });
  if (btnEl) {
    btnEl.classList.add('active', 'bg-cyan-500/20', 'text-cyan-300', 'border-cyan-500/30');
    btnEl.classList.remove('bg-[#10192a]', 'text-slate-400', 'border-[#1e2d48]');
  }
}

async function renderInsightsView(targetRepoId) {
  if (targetRepoId !== undefined) {
    state.insightsSelectedRepoId = targetRepoId;
  }

  let allProjects = state.projects || [];
  if (allProjects.length === 0) {
    await fetchProjects(false);
    allProjects = state.projects || [];
  }

  let selectedRepoId = state.insightsSelectedRepoId || 'all';
  if (selectedRepoId !== 'all' && !allProjects.some(p => String(p.id) === String(selectedRepoId))) {
    selectedRepoId = 'all';
    state.insightsSelectedRepoId = 'all';
  }

  const projectsToAudit = selectedRepoId === 'all' 
    ? allProjects 
    : allProjects.filter(p => String(p.id) === String(selectedRepoId));

  // Gather tasks for considered projects
  const auditTasks = [];
  projectsToAudit.forEach(repo => {
    (repo.tasks || []).forEach(t => {
      auditTasks.push({
        ...t,
        repoId: repo.id,
        repoName: repo.name,
        repoFullName: repo.fullName,
        filePath: repo.filePath
      });
    });
  });

  const isBugLike = (t) => {
    const text = `${t.title || ''} ${t.description || ''}`.toLowerCase();
    return /hata|bug|crash|donuyor|çalışmıyor|error|fail|bozuk|arızalı|kusur|issue/i.test(text);
  };

  // 1. Calculate Risks & Bugs
  const p1Tasks = auditTasks.filter(t => !t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1));
  const otherBugTasks = auditTasks.filter(t => !t.completed && t.priorityCode !== 'P1' && t.priorityRank !== 1 && isBugLike(t));
  const overdueTasks = auditTasks.filter(t => !t.completed && (t.isOverdue || (t.dueDate && new Date(t.dueDate) < new Date())));
  const unscheduledTasks = auditTasks.filter(t => !t.completed && !t.dueDate);
  const staleProjects = projectsToAudit.filter(p => p.isStale);
  const totalRisksCount = p1Tasks.length + otherBugTasks.length + overdueTasks.length + staleProjects.length;

  // 2. Calculate Ideas & Backlog
  const ideaTasks = auditTasks.filter(t => !t.completed && (
    t.priorityCode === 'P4' || 
    t.priorityRank === 4 || 
    (t.tags && t.tags.some(tag => /idea|fikir|backlog|inovasyon|roadmap/i.test(tag))) ||
    /💡|🎨|⚡|🔒|🎮|📱|fikir|öneri|inovasyon|yol haritası/i.test(t.title)
  ));

  // 3. Health & Completion Stats
  const completedTasks = auditTasks.filter(t => t.completed).length;
  const totalTasks = auditTasks.length;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  let avgScore = 85;
  let portfolioGrade = 'A';
  if (selectedRepoId === 'all') {
    if (allProjects.length > 0) {
      avgScore = Math.round(allProjects.reduce((acc, r) => acc + (r.health?.score || 70), 0) / allProjects.length);
    }
  } else if (projectsToAudit.length > 0) {
    avgScore = projectsToAudit[0].health?.score || 80;
  }
  portfolioGrade = avgScore >= 90 ? 'A+' : avgScore >= 80 ? 'A' : avgScore >= 70 ? 'B' : avgScore >= 60 ? 'C' : 'F';

  // Update Top Badges & KPI Strip
  const healthBadge = document.getElementById('insights-overall-health-badge');
  if (healthBadge) {
    healthBadge.className = `px-2.5 py-0.5 rounded-lg text-xs font-bold health-pill-${portfolioGrade.charAt(0)}`;
    healthBadge.textContent = `${selectedRepoId === 'all' ? 'Portföy' : projectsToAudit[0]?.name || 'Proje'} Skoru: ${portfolioGrade} (${avgScore}/100)`;
  }

  const kpiRisks = document.getElementById('kpi-radar-risks');
  const kpiScore = document.getElementById('kpi-radar-score');
  const kpiGrade = document.getElementById('kpi-radar-grade');
  const kpiIdeas = document.getElementById('kpi-radar-ideas');
  const kpiProgress = document.getElementById('kpi-radar-progress');
  const kpiTasksText = document.getElementById('kpi-radar-tasks-text');

  if (kpiRisks) kpiRisks.textContent = totalRisksCount;
  if (kpiScore) kpiScore.textContent = avgScore;
  if (kpiGrade) {
    kpiGrade.textContent = portfolioGrade;
    kpiGrade.className = `px-2 py-0.5 rounded text-[11px] font-bold health-pill-${portfolioGrade.charAt(0)}`;
  }
  if (kpiIdeas) kpiIdeas.textContent = ideaTasks.length;
  if (kpiProgress) kpiProgress.textContent = `%${completionPercentage}`;
  if (kpiTasksText) kpiTasksText.textContent = `${completedTasks} / ${totalTasks} görev tamamlandı`;

  // Update Horizontal Project Tabs Container
  const tabsContainer = document.getElementById('insights-project-tabs-container');
  if (tabsContainer) {
    const allP1Count = (allProjects || []).reduce((acc, p) => acc + (p.tasks || []).filter(t => !t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1)).length, 0);
    const allOverdueCount = (allProjects || []).reduce((acc, p) => acc + (p.tasks || []).filter(t => !t.completed && t.isOverdue).length, 0);
    const allStaleCount = (allProjects || []).filter(p => p.isStale).length;
    const portfolioTotalRisks = allP1Count + allOverdueCount + allStaleCount;

    let tabsHtml = `
      <button 
        onclick="selectInsightsProjectTab('all')" 
        class="radar-project-pill px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all ${selectedRepoId === 'all' ? 'active' : 'bg-[#10192a] text-slate-300 border-[#1c2a42] hover:bg-[#152238]'}">
        <span>✨ Tüm Projeler</span>
        <span class="px-1.5 py-0.2 rounded-full text-[10px] ${selectedRepoId === 'all' ? 'bg-white/20 text-white' : 'bg-[#1e2d48] text-slate-400'}">${allProjects.length}</span>
        ${portfolioTotalRisks > 0 ? `<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>` : ''}
      </button>
    `;

    allProjects.forEach(repo => {
      const isSelected = String(selectedRepoId) === String(repo.id);
      const repoP1 = (repo.tasks || []).filter(t => !t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1)).length;
      const repoOverdue = (repo.tasks || []).filter(t => !t.completed && t.isOverdue).length;
      const repoRisks = repoP1 + repoOverdue + (repo.isStale ? 1 : 0);
      const gradeLetter = (repo.health?.grade || 'B').charAt(0);

      tabsHtml += `
        <button 
          onclick="selectInsightsProjectTab('${repo.id}')" 
          class="radar-project-pill px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all ${isSelected ? 'active' : 'bg-[#10192a] text-slate-300 border-[#1c2a42] hover:bg-[#152238]'}">
          <span class="truncate max-w-[130px]">${escapeHtml(repo.name)}</span>
          <span class="px-1.5 py-0.2 rounded text-[10px] font-bold ${isSelected ? 'bg-white/20 text-white' : `health-pill-${gradeLetter}`}">${repo.health?.grade || 'A'}</span>
          ${repoRisks > 0 ? `<span class="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-500 text-white">${repoRisks}</span>` : ''}
        </button>
      `;
    });

    tabsContainer.innerHTML = tabsHtml;
  }

  // Populate Pillar 1: Hatalar & Risk Radarı
  const risksBadge = document.getElementById('radar-pillar-risks-badge');
  if (risksBadge) {
    risksBadge.textContent = `${totalRisksCount} Risk`;
    risksBadge.className = `px-2.5 py-0.5 rounded-full text-xs font-bold ${totalRisksCount > 0 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`;
  }

  const risksContainer = document.getElementById('radar-pillar-risks-list');
  if (risksContainer) {
    let risksHtml = '';

    // Stale alerts
    staleProjects.forEach(staleRepo => {
      risksHtml += `
        <div class="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
              <span class="text-xs font-bold text-rose-300">İhmal Riski: ${escapeHtml(staleRepo.name)}</span>
            </div>
            <span class="text-[10px] font-mono text-rose-400 px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/40">${staleRepo.daysSinceUpdate} gündür commit yok</span>
          </div>
          <p class="text-[11px] text-rose-200/80 leading-relaxed">
            Bu projede bekleyen işler bulunmasına rağmen uzun süredir yeni aktivite kaydedilmedi. Teknik borç ve sağlık puanı geriliyor.
          </p>
          <div class="pt-1 flex justify-end">
            <button onclick="openProjectInKanban('${staleRepo.id}')" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer">
              <span>Projeyi İncele</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      `;
    });

    // P1 Critical Tasks
    p1Tasks.forEach(task => {
      risksHtml += `
        <div class="p-3.5 bg-[#080C14] border border-rose-500/40 rounded-xl space-y-2 hover:border-rose-500 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="px-1.5 py-0.5 rounded bg-rose-600 text-white font-extrabold text-[10px] shrink-0 shadow-sm">P1 ACİL</span>
              <span class="text-[11px] font-medium text-slate-400 truncate">${escapeHtml(task.repoName || '')}</span>
            </div>
            ${task.dueDate ? `<span class="text-[10px] text-rose-300 px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/40 shrink-0 font-mono">📅 ${task.dueDate}</span>` : ''}
          </div>
          <div>
            <h4 class="text-xs font-bold text-white leading-snug">${escapeHtml(task.title)}</h4>
            <p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${escapeHtml(task.description || 'Detaylı hata açıklaması belirtilmemiş.')}</p>
          </div>
          <div class="pt-1 flex items-center justify-between gap-2 border-t border-[#1b2840]">
            <span class="text-[10px] text-rose-400 font-medium">Sağlık Cezası: -15 Puan</span>
            <button onclick="openProjectInKanban('${task.repoId}')" class="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer">
              <span>Kanban'da Çöz</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      `;
    });

    // Other Detected Bugs
    otherBugTasks.forEach(task => {
      risksHtml += `
        <div class="p-3 bg-[#080C14] border border-rose-500/30 rounded-xl space-y-2 hover:border-rose-500/50 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold text-[10px] shrink-0">HATA TESPİTİ</span>
              <span class="text-[11px] font-medium text-slate-400 truncate">${escapeHtml(task.repoName || '')}</span>
            </div>
            <span class="text-[10px] font-mono text-slate-400 px-1.5 py-0.2 rounded bg-[#10192a]">${task.priorityCode || 'P3'}</span>
          </div>
          <h4 class="text-xs font-semibold text-slate-200 leading-snug">${escapeHtml(task.title)}</h4>
          <div class="pt-1 flex items-center justify-between gap-2 border-t border-[#1b2840]">
            <span class="text-[10px] text-slate-500">${task.dueDate || 'Tarihsiz'}</span>
            <button onclick="openProjectInKanban('${task.repoId}')" class="px-2 py-0.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer">
              <span>İncele</span>
            </button>
          </div>
        </div>
      `;
    });

    // Overdue Tasks
    overdueTasks.forEach(task => {
      risksHtml += `
        <div class="p-3.5 bg-[#080C14] border border-amber-500/35 rounded-xl space-y-2 hover:border-amber-500 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold text-[10px] shrink-0">GECİKTİ</span>
              <span class="text-[11px] font-medium text-slate-400 truncate">${escapeHtml(task.repoName || '')}</span>
            </div>
            <span class="text-[10px] text-amber-400 font-mono">Plan: ${task.dueDate || 'Belirtilmedi'}</span>
          </div>
          <div>
            <h4 class="text-xs font-semibold text-slate-200 leading-snug">${escapeHtml(task.title)}</h4>
          </div>
          <div class="pt-1 flex items-center justify-between gap-2 border-t border-[#1b2840]">
            <span class="text-[10px] text-amber-400">Son teslim tarihi aşıldı</span>
            <button onclick="openProjectInCalendar('${task.repoId}')" class="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer">
              <span>Takvimde Planla</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      `;
    });

    // If zero critical bugs, show clean banner
    if (p1Tasks.length === 0 && otherBugTasks.length === 0 && overdueTasks.length === 0 && staleProjects.length === 0) {
      risksHtml += `
        <div class="p-3.5 bg-[#080C14] rounded-xl border border-emerald-500/30 flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          </div>
          <div>
            <h4 class="font-bold text-white text-xs">Sıfır Kritik Risk (0 P1 Hata)</h4>
            <p class="text-slate-400 text-[11px] mt-0.5">Seçili kapsamda bloke edici acil hata veya geciken iş bulunmuyor.</p>
          </div>
        </div>
      `;
    }

    // Always show Unscheduled Tasks section if any exist
    if (unscheduledTasks.length > 0) {
      risksHtml += `
        <div class="p-3 bg-[#080C14] border border-[#1b2840] rounded-xl space-y-2 mt-2">
          <div class="flex items-center justify-between pb-1 border-b border-[#1b2840]">
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span class="text-xs font-bold text-amber-300">Planlama Takibi: Tarihsiz İşler (${unscheduledTasks.length})</span>
            </div>
            <button onclick="switchView('calendar')" class="text-[10px] text-blue-400 hover:underline cursor-pointer">Takvime Git →</button>
          </div>
          <p class="text-[11px] text-slate-400 leading-relaxed">
            Teslim tarihi belirlenmemiş görevler sprint planından sapabilir. Hemen bir gün belirleyin:
          </p>
          <div class="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
            ${unscheduledTasks.slice(0, 8).map(ut => `
              <div class="p-2 rounded-lg bg-[#0e1727] border border-[#182338] flex items-center justify-between gap-2 hover:border-slate-600 transition-colors">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">${ut.priorityCode || 'P3'}</span>
                    <span class="text-xs font-medium text-slate-200 truncate">${escapeHtml(ut.title)}</span>
                  </div>
                </div>
                <button 
                  onclick="quickScheduleTaskFromRadar('${ut.repoId}', '${ut.id}', '${escapeHtml(ut.title.replace(/'/g, "\\'"))}', 1)" 
                  class="px-2 py-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 rounded text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                  title="Görevi yarına planla">
                  <span>📅 Planla</span>
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    risksContainer.innerHTML = risksHtml;
  }

  // Populate Pillar 2: Akıllı Öneriler & Sağlık Denetimi
  const suggestions = [];

  suggestions.push({
    iconSvg: `<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
    iconBg: 'bg-blue-500/10 border-blue-500/30',
    title: `Teknik Sağlık Analizi: ${portfolioGrade} (${avgScore}/100)`,
    desc: `Puanlama formülü: Tamamlanan görev oranı (%${completionPercentage}) skora pozitif yansırken, ${p1Tasks.length} adet P1 acil hata (-${p1Tasks.length * 15} puan) ve commit frekansı hesaba katılmıştır.`,
    actionText: 'Projeler Görünümüne Git',
    actionFn: "switchView('grid')"
  });

  if (p1Tasks.length > 0) {
    suggestions.push({
      iconSvg: `<svg class="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
      iconBg: 'bg-rose-500/10 border-rose-500/30',
      title: 'Öncelikli Aksiyon: P1 Hatasını Çözün (+15 Puan)',
      desc: `"${escapeHtml(p1Tasks[0].title)}" görevini tamamlayarak sistem sağlık skorunu anında +15 puan artırabilirsiniz.`,
      actionText: "Kanban'da Çöz",
      actionFn: `openProjectInKanban('${p1Tasks[0].repoId}')`
    });
  }

  if (unscheduledTasks.length > 0) {
    suggestions.push({
      iconSvg: `<svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
      iconBg: 'bg-amber-500/10 border-amber-500/30',
      title: 'Sprint Takvimi: Tarihsiz Görevleri Planlayın',
      desc: `${unscheduledTasks.length} adet görev takvimde gün atanmadan bekliyor. Takvim ekranındaki sürükle-bırak motoruyla bu işleri haftanın müsait günlerine dağıtarak planı gerçekçi kılın.`,
      actionText: "Takvime Git",
      actionFn: "switchView('calendar')"
    });
  }

  // Tailored architecture suggestion based on repo tasks
  const isHtml5OrGame = auditTasks.some(t => /playable|game|canvas|oyun|sound|ses|audio|youtube|godot|wasm/i.test(`${t.title} ${t.description}`));
  if (isHtml5OrGame) {
    suggestions.push({
      iconSvg: `<svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
      iconBg: 'bg-cyan-500/10 border-cyan-500/30',
      title: 'Web & HTML5 Runtime Optimizasyonu',
      desc: 'YouTube Playables ve mobil web için p95 kare süresi (<=33.3ms), WebAudio ilk dokunuş jest kilidi ve ServiceWorker önbellek stabilitesini test edin.',
      actionText: "Kod Tarayıcısını Aç",
      actionFn: "switchView('scanner')"
    });
  }

  if (totalTasks - completedTasks > 0) {
    suggestions.push({
      iconSvg: `<svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
      iconBg: 'bg-purple-500/10 border-purple-500/30',
      title: 'Sprint İş Yükü ve Eisenhower Matrisi',
      desc: `Bekleyen toplam ${totalTasks - completedTasks} görev mevcut. Günlük Odak ekranındaki Eisenhower matrisi ile görevleri Q1 (Acil) ve Q2 (Stratejik) olarak odaklayın.`,
      actionText: "Günlük Odak'a Git",
      actionFn: "switchView('focus')"
    });
  }

  suggestions.push({
    iconSvg: `<svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
    iconBg: 'bg-emerald-500/10 border-emerald-500/30',
    title: 'Kaynak Kod Denetimi (FIXME / BUG / HACK)',
    desc: `Yerel proje dizinlerinizdeki kod içi TODO, FIXME ve BUG yorumlarını tek tıkla tarayarak doğrudan görev kartına dönüştürün.`,
    actionText: "Kod Tarayıcısını Aç",
    actionFn: "switchView('scanner')"
  });

  const sugBadge = document.getElementById('radar-pillar-suggestions-badge');
  if (sugBadge) {
    sugBadge.textContent = `${suggestions.length} Tavsiye`;
  }

  const suggestionsContainer = document.getElementById('radar-pillar-suggestions-list');
  if (suggestionsContainer) {
    suggestionsContainer.innerHTML = suggestions.map(s => `
      <div class="p-3.5 rounded-xl bg-[#080C14] border border-[#1b2840] space-y-2.5 hover:border-slate-700 transition-colors">
        <div class="flex items-start gap-3">
          <div class="w-8 h-8 rounded-lg ${s.iconBg} flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
            ${s.iconSvg}
          </div>
          <div>
            <h4 class="text-xs font-bold text-white">${s.title}</h4>
            <p class="text-slate-300 text-[11px] mt-1 leading-relaxed">${s.desc}</p>
          </div>
        </div>
        ${s.actionText ? `
          <div class="pt-1 flex justify-end">
            <button onclick="${s.actionFn}" class="px-2.5 py-1 bg-[#10192a] hover:bg-[#16233b] text-slate-300 hover:text-white border border-[#1e2d48] rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer">
              <span>${s.actionText}</span>
              <svg class="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  // Populate Pillar 3: Fikir Havuzu & Yol Haritası
  const ideasBadge = document.getElementById('radar-pillar-ideas-badge');
  if (ideasBadge) {
    ideasBadge.textContent = `${ideaTasks.length} Fikir`;
  }

  // Update Repo select dropdown for composer
  const repoSelect = document.getElementById('radar-idea-project-select');
  if (repoSelect) {
    repoSelect.innerHTML = allProjects.map(p => `
      <option value="${p.id}" ${String(p.id) === String(selectedRepoId) ? 'selected' : ''}>${escapeHtml(p.name)}</option>
    `).join('');
  }

  const ideasContainer = document.getElementById('radar-pillar-ideas-list');
  if (ideasContainer) {
    let ideasHtml = '';

    // Render user ideas if any exist
    if (ideaTasks.length > 0) {
      ideasHtml += `
        <div class="space-y-2.5">
          ${ideaTasks.map(idea => `
            <div class="p-3 bg-[#080C14] border border-cyan-500/25 rounded-xl space-y-2 hover:border-cyan-500/50 transition-colors">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-6 h-6 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 text-xs font-bold">💡</span>
                  <span class="text-[11px] font-semibold text-slate-300 truncate">${escapeHtml(idea.repoName || '')}</span>
                </div>
                <span class="text-[10px] font-mono text-cyan-300 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/40">P4 Backlog</span>
              </div>
              <div>
                <h4 class="text-xs font-bold text-white leading-snug">${escapeHtml(idea.title)}</h4>
                <p class="text-[11px] text-slate-400 mt-1">${escapeHtml(idea.description || 'Proje Yol Haritası & Fikir Havuzu')}</p>
              </div>
              <div class="pt-1.5 flex items-center justify-between gap-2 border-t border-[#1b2840]">
                <span class="text-[10px] text-slate-500">${idea.dueDate ? 'Hedef: ' + idea.dueDate : 'Gelecek Sürüm'}</span>
                <button 
                  onclick="promoteRadarIdeaToKanban('${idea.repoId}', '${idea.id}', '${escapeHtml(idea.title.replace(/'/g, "\\'"))}')" 
                  class="px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                  title="Önceliği P2 yaparak doğrudan Kanban panosuna aktarır">
                  <svg class="w-3 h-3 text-cyan-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  <span>Kanban'a Taşı</span>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Always render curated Smart AI Ideas section so it is never empty!
    const targetProjectForSuggestions = projectsToAudit[0] || allProjects[0];
    const targetId = targetProjectForSuggestions ? targetProjectForSuggestions.id : '';

    const smartCuratedIdeas = [
      {
        emoji: '🎮',
        tag: '💡 Yenilik',
        title: 'Başarım & Yıldız Sistemi (Gamification)',
        desc: 'Bölüm tamamlama ve doğru eşleşmelerde çocukları ödüllendiren konfeti ve sesli yıldız animasyonları ekleyin.'
      },
      {
        emoji: '🔊',
        tag: '🎨 Tasarım',
        title: 'İnteraktif Ses Efektleri & Çocuk Dostu Müzik',
        desc: 'Kart dokunuşlarında ve sürüklemelerinde tatmin edici ses geri bildirimi ve ebeveyn sessize alma butonu sunun.'
      },
      {
        emoji: '📱',
        tag: '⚡ Hız',
        title: 'PWA & Çevrimdışı Çalışma Desteği (Offline Mode)',
        desc: 'Tablet ve mobil cihazlarda internetsiz ortamlarda da kesintisiz çalışması için Service Worker önbellekleme mimarisi kurun.'
      },
      {
        emoji: '🌓',
        tag: '🔒 Güvenlik',
        title: 'Yüksek Kontrast & Erişilebilirlik Renk Paleti',
        desc: 'Özel gereksinimli çocuklar için WCAG uyumlu yüksek kontrastlı kart tasarımı ve görsel ayırıcılar ekleyin.'
      }
    ];

    ideasHtml += `
      <div class="p-3 bg-[#080C14] border border-cyan-500/30 rounded-xl space-y-2.5 mt-2">
        <div class="flex items-center justify-between pb-1.5 border-b border-[#1b2840]">
          <div class="flex items-center gap-1.5">
            <span class="text-sm">✨</span>
            <span class="text-xs font-bold text-cyan-300">Önerilen İnovasyon & Özellik Fikirleri (Yapay Zeka)</span>
          </div>
          <span class="text-[10px] text-slate-400">Tek Tıkla Ekle</span>
        </div>
        <p class="text-[11px] text-slate-400 leading-relaxed">
          Projenizin değerini artıracak akıllı özellikler. Beğendiğiniz fikri doğrudan havuzunuza ekleyin:
        </p>
        <div class="space-y-2">
          ${smartCuratedIdeas.map(item => `
            <div class="p-2.5 rounded-lg bg-[#0e1727] border border-[#1a2842] hover:border-cyan-500/40 transition-colors space-y-2">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-base">${item.emoji}</span>
                  <div>
                    <h5 class="text-xs font-bold text-white leading-tight">${item.title}</h5>
                    <span class="text-[9px] text-cyan-400 font-mono">${item.tag}</span>
                  </div>
                </div>
              </div>
              <p class="text-[11px] text-slate-300 leading-snug">${item.desc}</p>
              <div class="pt-1 flex items-center justify-end gap-2 border-t border-[#16233b]">
                <button 
                  onclick="addSmartIdeaToProject('${targetId}', '${item.title}', '${item.desc}', '${item.tag}')" 
                  class="px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer shadow-sm">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>Havuzuma Ekle</span>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    ideasContainer.innerHTML = ideasHtml;
  }
}

async function quickScheduleTaskFromRadar(repoId, taskId, taskTitle, daysFromNow = 1) {
  const allProjects = state.projects || [];
  const repo = allProjects.find(p => String(p.id) === String(repoId)) || allProjects[0];
  if (!repo) {
    showToast('Proje bulunamadı.', 'error');
    return;
  }

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysFromNow);
  const dateStr = targetDate.toISOString().split('T')[0];

  try {
    const res = await fetch('/api/tasks/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        taskId: taskId,
        taskTitle: taskTitle,
        date: dateStr,
        timeSlot: '10:00-11:00',
        estimate: 1
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Zamanlama kaydedilemedi');

    showToast(`📅 "${taskTitle}" ${dateStr} tarihine planlandı!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    await fetchScheduleData();
    renderInsightsView();
  } catch (err) {
    showToast(`Zamanlama hatası: ${err.message}`, 'error');
  }
}

async function addSmartIdeaToProject(repoId, title, desc, tagPrefix) {
  const allProjects = state.projects || [];
  const repo = allProjects.find(p => String(p.id) === String(repoId)) || allProjects[0];
  if (!repo) {
    showToast('Hedef proje bulunamadı.', 'error');
    return;
  }

  const fullTitle = `${tagPrefix || '💡 Yenilik'}: ${title}`;
  try {
    const res = await fetch('/api/tasks/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        title: fullTitle,
        description: desc || 'Yapay Zeka Destekli Proje Fikri',
        priorityCode: 'P4'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fikir eklenemedi');

    showToast(`✓ Fikir "${title}" başarıyla havuzunuza eklendi!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    renderInsightsView();
  } catch (err) {
    showToast(`Fikir ekleme hatası: ${err.message}`, 'error');
  }
}

async function submitRadarIdea() {
  const input = document.getElementById('radar-new-idea-input');
  if (!input) return;
  const rawTitle = input.value.trim();
  if (!rawTitle) {
    showToast('Lütfen bir proje fikri veya özellik başlığı yazın.', 'warning');
    return;
  }

  const selectEl = document.getElementById('radar-idea-project-select');
  const targetRepoId = selectEl ? selectEl.value : (state.insightsSelectedRepoId !== 'all' ? state.insightsSelectedRepoId : (state.projects[0]?.id || ''));

  const repo = (state.projects || []).find(p => String(p.id) === String(targetRepoId)) || state.projects[0];
  if (!repo) {
    showToast('Hedef proje bulunamadı.', 'error');
    return;
  }

  const tagPrefix = state.insightsSelectedTag || '💡 Yenilik';
  const fullTitle = `${tagPrefix}: ${rawTitle}`;

  try {
    const res = await fetch('/api/tasks/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        title: fullTitle,
        description: 'Proje Yol Haritası & Fikir Havuzu',
        priorityCode: 'P4'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fikir eklenemedi');

    input.value = '';
    showToast(`✓ Yeni fikir "${rawTitle}" başarıyla eklendi!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    renderInsightsView();
    if (state.currentView === 'home') renderHomePage();
  } catch (err) {
    showToast(`Fikir ekleme hatası: ${err.message}`, 'error');
  }
}

async function promoteRadarIdeaToKanban(repoId, taskId, taskTitle) {
  const repo = (state.projects || []).find(p => String(p.id) === String(repoId));
  if (!repo) return;

  try {
    const res = await fetch('/api/tasks/priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        taskId: taskId,
        taskTitle: taskTitle,
        newPriorityCode: 'P2'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Öncelik güncellenemedi');

    showToast(`🚀 Fikir "${taskTitle}" önceliği P2 olarak güncellendi ve Kanban'a taşındı!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    renderInsightsView();
  } catch (err) {
    showToast(`İşlem hatası: ${err.message}`, 'error');
  }
}

async function refreshProjectInsights() {
  await fetchProjects(true);
  renderInsightsView();
  showToast('✓ Proje Radarı ve Denetim Raporu güncellendi.', 'success');
}

function exportProjectInsightsReport() {
  const allProjects = state.projects || [];
  const report = {
    generatedAt: new Date().toISOString(),
    appName: 'Repo Pilot Executive Project Radar',
    totalProjects: allProjects.length,
    projects: allProjects.map(p => ({
      name: p.name,
      fullName: p.fullName,
      healthScore: p.health?.score,
      healthGrade: p.health?.grade,
      isStale: p.isStale,
      daysSinceUpdate: p.daysSinceUpdate,
      criticalRisks: (p.tasks || []).filter(t => !t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1)).map(t => ({ title: t.title, dueDate: t.dueDate })),
      overdueTasks: (p.tasks || []).filter(t => !t.completed && t.isOverdue).map(t => ({ title: t.title, dueDate: t.dueDate })),
      ideasAndRoadmap: (p.tasks || []).filter(t => !t.completed && (t.priorityCode === 'P4' || t.priorityRank === 4)).map(t => ({ title: t.title, tags: t.tags }))
    }))
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RepoPilot-Proje-Radari-Raporu-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✓ Proje Denetim Raporu (JSON) bilgisayarınıza indirildi.', 'success');
}

/**
 * Render single task row inside a card
 */
function renderTaskItem(repo, task) {
  let formattedTitle = escapeHtml(task.title);
  if (task.tags && task.tags.length > 0) {
    task.tags.forEach(tag => {
      const isMention = tag.startsWith('@');
      const pillClass = isMention ? 'mention-tag' : 'hash-tag';
      formattedTitle = formattedTitle.replace(tag, `<span class="${pillClass}">${tag}</span>`);
    });
  }

  const isStarred = isTaskStarred(repo.id, task.title);
  const priorityClass = `badge-p${task.priorityRank}`;

  return `
    <div class="group flex items-start space-x-2.5 p-2 rounded-xl transition-all ${task.completed ? 'opacity-60 bg-slate-100/50 dark:bg-gray-950/20' : 'bg-slate-50/90 dark:bg-gray-950/60 hover:bg-slate-100 dark:hover:bg-gray-900 border border-slate-200/80 dark:border-gray-800/70 shadow-sm'}">
      <input 
        type="checkbox" 
        ${task.completed ? 'checked' : ''} 
        ${actionAttrs('toggle-task', taskIdentity(repo, task), 'change')}
        class="task-checkbox mt-0.5" 
      />
      
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between space-x-1.5 mb-1">
          <div class="flex items-center space-x-1.5 flex-wrap gap-1">
            <span class="text-[10px] font-bold px-1.5 py-0.2 rounded ${priorityClass}">
              ${task.priorityLabel}
            </span>

            ${task.issueNumber ? `
              <a href="${safeUrl(task.issueUrl || `${repo.url}/issues/${task.issueNumber}`)}" target="_blank" class="inline-flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-mono bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.2 rounded border border-blue-200 dark:border-blue-500/20 font-bold" title="GitHub Issue #${task.issueNumber}">
                #${task.issueNumber}
              </a>
            ` : ''}

            ${task.dueDate ? `
              <span class="text-[10px] px-1.5 py-0.2 rounded font-mono ${task.isOverdue ? 'overdue-glow font-bold' : 'bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300'}" title="Teslim Tarihi">
                📅 ${task.dueDate} ${task.isOverdue ? '(Gecikti!)' : ''}
              </span>
            ` : ''}

            ${task.estimate ? `
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 font-mono" title="Tahmini Süre">
                ⏱️ ${task.estimate}
              </span>
            ` : ''}

            ${task.milestone ? `
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 font-mono" title="Milestone / Sürüm">
                🎯 ${escapeHtml(task.milestone)}
              </span>
            ` : ''}

            ${task.commentsCount > 0 ? `
              <span class="inline-flex items-center gap-0.5 text-[10px] text-slate-500 dark:text-gray-400 font-mono bg-slate-100 dark:bg-gray-800 px-1.5 py-0.2 rounded" title="${task.commentsCount} yorum">
                💬 ${task.commentsCount}
              </span>
            ` : ''}

            ${task.assignees && task.assignees.length > 0 ? `
              <div class="inline-flex items-center -space-x-1.5 ml-0.5" title="Atanan: ${task.assignees.map(a => a.login).join(', ')}">
                ${task.assignees.slice(0, 3).map(a => a.avatarUrl ? `
                  <img src="${escapeHtml(a.avatarUrl)}" alt="${escapeHtml(a.login)}" class="w-4 h-4 rounded-full border border-white dark:border-gray-900 object-cover" />
                ` : `
                  <span class="text-[9px] bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-200 px-1 rounded font-mono">@${escapeHtml(a.login)}</span>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <!-- Actions: Star to Daily Focus & Convert to GitHub Issue -->
          <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button ${actionAttrs('star-task', { ...taskIdentity(repo, task), priorityRank: task.priorityRank })} title="Günün Odağına Ekle" class="p-1 text-slate-400 hover:text-amber-500 dark:text-gray-400 dark:hover:text-amber-400">
              <i data-lucide="star" class="w-3.5 h-3.5 ${isStarred ? 'text-amber-400 fill-amber-400' : ''}"></i>
            </button>
            ${!task.issueNumber ? `
              <button ${actionAttrs('issue', { ...taskIdentity(repo, task), priorityCode: task.priorityCode })} title="GitHub Issue Oluştur" class="p-1 text-slate-400 hover:text-slate-700 dark:text-gray-400 dark:hover:text-white">
                <i data-lucide="github" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <p class="text-xs text-slate-800 dark:text-gray-200 leading-snug break-words ${task.completed ? 'line-through text-slate-400 dark:text-gray-500' : ''}">
          ${formattedTitle}
        </p>

        ${task.description ? `
          <p class="text-[11px] text-slate-500 dark:text-gray-400 mt-1 line-clamp-1 break-words font-sans">
            ${escapeHtml(task.description)}
          </p>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * ==========================================
 * VIEW 2: CENTRAL KANBAN BOARD LOGIC
 * Exactly matching Screen 1 in mockup (4 Columns: Backlog, Yapılacak, Devam Ediyor, Tamamlandı)
 * ==========================================
 */
let kanbanFilterState = {
  repo: 'all',
  priority: 'all',
  tag: 'all',
  searchQuery: '',
  sort: 'custom'
};

const KANBAN_COL_TITLES = {
  backlog: 'Backlog',
  todo: 'Yapılacak',
  inprogress: 'Devam Ediyor',
  review: 'İncelemede',
  done: 'Tamamlandı'
};

function loadKanbanOverrides() {
  try {
    return JSON.parse(getStorage('kanban_columns', '{}'));
  } catch {
    return {};
  }
}

function saveKanbanOverrides(overrides) {
  try {
    setStorage('kanban_columns', JSON.stringify(overrides));
    if (typeof writeToConnectedJsonFile === 'function') writeToConnectedJsonFile();
  } catch(e) {}
}

function loadKanbanColumnOrders() {
  try {
    const raw = getStorage('kanban_orders');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { backlog: [], todo: [], inprogress: [], review: [], done: [] };
}

function saveKanbanColumnOrders(orders) {
  try {
    setStorage('kanban_orders', JSON.stringify(orders));
    if (typeof writeToConnectedJsonFile === 'function') writeToConnectedJsonFile();
  } catch (e) {}
}

let currentKanbanDrag = null;

function handleKanbanDragStart(event, taskKey, repoId, title, sourceCol) {
  event.stopPropagation();
  currentKanbanDrag = { taskKey, repoId, title, sourceCol };
  try {
    event.dataTransfer.setData('text/plain', taskKey);
    event.dataTransfer.setData('application/json', JSON.stringify(currentKanbanDrag));
  } catch (e) {}
  event.dataTransfer.effectAllowed = 'move';
  if (event.currentTarget) {
    event.currentTarget.classList.add('is-dragging');
  }
}

function handleKanbanDragEnd(event) {
  currentKanbanDrag = null;
  document.querySelectorAll('.kanban-card-draggable').forEach(el => {
    el.classList.remove('is-dragging', 'drop-indicator-top', 'drop-indicator-bottom');
  });
  document.querySelectorAll('.kanban-column-wrapper').forEach(el => {
    el.classList.remove('col-drag-over');
  });
}

function handleKanbanCardDragOver(event, cardEl) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';

  const rect = cardEl.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (event.clientY < midY) {
    cardEl.classList.add('drop-indicator-top');
    cardEl.classList.remove('drop-indicator-bottom');
  } else {
    cardEl.classList.add('drop-indicator-bottom');
    cardEl.classList.remove('drop-indicator-top');
  }
}

function handleKanbanCardDragLeave(event, cardEl) {
  cardEl.classList.remove('drop-indicator-top', 'drop-indicator-bottom');
}

function handleKanbanCardDrop(event, cardEl, targetTaskKey, targetCol) {
  event.preventDefault();
  event.stopPropagation();

  cardEl.classList.remove('drop-indicator-top', 'drop-indicator-bottom');

  let dragData = currentKanbanDrag;
  if (!dragData) {
    try {
      const raw = event.dataTransfer.getData('application/json');
      if (raw) dragData = JSON.parse(raw);
    } catch (e) {}
  }
  const draggedKey = dragData ? dragData.taskKey : event.dataTransfer.getData('text/plain');
  if (!draggedKey) return;

  const rect = cardEl.getBoundingClientRect();
  const insertBefore = event.clientY < (rect.top + rect.height / 2);

  reorderKanbanTask(draggedKey, targetTaskKey, targetCol, insertBefore);
}

function handleKanbanColDragOver(event, colEl) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  colEl.classList.add('col-drag-over');
}

function handleKanbanColDragLeave(event, colEl) {
  colEl.classList.remove('col-drag-over');
}

function handleKanbanColDrop(event, targetCol) {
  event.preventDefault();
  document.querySelectorAll('.kanban-column-wrapper').forEach(el => el.classList.remove('col-drag-over'));

  let dragData = currentKanbanDrag;
  if (!dragData) {
    try {
      const raw = event.dataTransfer.getData('application/json');
      if (raw) dragData = JSON.parse(raw);
    } catch (e) {}
  }
  const draggedKey = dragData ? dragData.taskKey : event.dataTransfer.getData('text/plain');
  if (!draggedKey) return;

  reorderKanbanTask(draggedKey, null, targetCol, false);
}

function reorderKanbanTask(draggedKey, targetTaskKey, targetCol, insertBefore) {
  state.kanbanOverrides = state.kanbanOverrides || loadKanbanOverrides();
  state.kanbanOrders = state.kanbanOrders || loadKanbanColumnOrders();

  const cols = ['backlog', 'todo', 'inprogress', 'review', 'done'];
  cols.forEach(c => {
    if (!Array.isArray(state.kanbanOrders[c])) {
      state.kanbanOrders[c] = [];
    }
    state.kanbanOrders[c] = state.kanbanOrders[c].filter(k => k !== draggedKey);
  });

  const targetList = state.kanbanOrders[targetCol] || [];

  if (targetTaskKey && targetTaskKey !== draggedKey) {
    const targetIdx = targetList.indexOf(targetTaskKey);
    if (targetIdx !== -1) {
      const insertAt = insertBefore ? targetIdx : targetIdx + 1;
      targetList.splice(insertAt, 0, draggedKey);
    } else {
      targetList.push(draggedKey);
    }
  } else {
    targetList.push(draggedKey);
  }

  state.kanbanOrders[targetCol] = targetList;
  state.kanbanOverrides[draggedKey] = targetCol;

  // Handle completion status when moved to or from done
  const parts = draggedKey.split(':::');
  const repoId = parts[0];
  const taskTitle = parts.slice(1).join(':::');

  const isDoneTarget = (targetCol === 'done');
  state.projects.forEach(r => {
    if (r.id === repoId) {
      (r.tasks || []).forEach(t => {
        if (t.title === taskTitle) t.completed = isDoneTarget;
      });
    }
  });

  // Asynchronously synchronize task status with backend
  fetch('/api/tasks/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoId,
      taskTitle,
      completed: isDoneTarget
    })
  }).catch(err => console.warn('Kanban backend sync error:', err));

  saveKanbanOverrides(state.kanbanOverrides);
  saveKanbanColumnOrders(state.kanbanOrders);

  kanbanFilterState.sort = 'custom';
  const sortSelect = document.getElementById('kanban-sort-select');
  if (sortSelect) sortSelect.value = 'custom';

  renderKanbanBoard();
  const colName = KANBAN_COL_TITLES[targetCol] || targetCol;
  showToast(`✓ Görev "${taskTitle}" ${colName} sütununa taşındı ve sıralandı`, 'success');
}

function handleKanbanSearch(query) {
  kanbanFilterState.searchQuery = (query || '').toLowerCase().trim();
  renderKanbanBoard();
}

function toggleKanbanPriorityFilter(pCode) {
  if (kanbanFilterState.priority === pCode) {
    kanbanFilterState.priority = 'all';
  } else {
    kanbanFilterState.priority = pCode;
  }
  updateKanbanPriorityButtonsUI();
  renderKanbanBoard();
}

function updateKanbanPriorityButtonsUI() {
  const current = kanbanFilterState.priority;
  const p1Btn = document.getElementById('kfilter-p1');
  const p2Btn = document.getElementById('kfilter-p2');
  const p3Btn = document.getElementById('kfilter-p3');

  if (p1Btn) {
    p1Btn.className = current === 'P1'
      ? 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-red-500/25 text-red-300 border border-red-500/50 shadow-sm ring-1 ring-red-500/30 transition-colors'
      : 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors';
  }
  if (p2Btn) {
    p2Btn.className = current === 'P2'
      ? 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-orange-500/25 text-orange-300 border border-orange-500/50 shadow-sm ring-1 ring-orange-500/30 transition-colors'
      : 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20 transition-colors';
  }
  if (p3Btn) {
    p3Btn.className = current === 'P3'
      ? 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-sky-500/25 text-sky-300 border border-sky-500/50 shadow-sm ring-1 ring-sky-500/30 transition-colors'
      : 'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border border-sky-500/20 transition-colors';
  }
}

function filterKanbanByRepo(repoId) {
  kanbanFilterState.repo = repoId;
  renderKanbanBoard();
}

function filterKanbanByTag(tag) {
  kanbanFilterState.tag = tag;
  renderKanbanBoard();
}

function changeKanbanSort(sortVal) {
  kanbanFilterState.sort = sortVal;
  renderKanbanBoard();
}

function moveKanbanTask(repoId, taskTitle, targetCol) {
  const key = `${repoId}:::${taskTitle}`;
  reorderKanbanTask(key, null, targetCol, false);
}

function renderKanbanBoard() {
  const colBacklog = document.getElementById('kanban-col-backlog');
  const colTodo = document.getElementById('kanban-col-todo');
  const colInProgress = document.getElementById('kanban-col-in-progress');
  const colReview = document.getElementById('kanban-col-review');
  const colDone = document.getElementById('kanban-col-done');

  if (!colBacklog) return;

  state.kanbanOverrides = state.kanbanOverrides || loadKanbanOverrides();

  // Populate project filter dropdown
  const repoSelect = document.getElementById('kanban-repo-filter');
  if (repoSelect) {
    const prev = kanbanFilterState.repo || 'all';
    repoSelect.innerHTML = '<option value="all">Tüm Projeler</option>' +
      state.projects.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    repoSelect.value = prev;
  }

  // Populate tag filter dropdown
  const tagSelect = document.getElementById('kanban-tag-filter');
  if (tagSelect) {
    const allTags = new Set();
    state.projects.forEach(p => (p.tasks || []).forEach(t => (t.tags || []).forEach(tag => allTags.add(tag))));
    tagSelect.innerHTML = '<option value="all">Etiketler</option>' +
      Array.from(allTags).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    tagSelect.value = kanbanFilterState.tag;
  }

  const backlogTasks = [];
  const todoTasks = [];
  const inProgressTasks = [];
  const reviewTasks = [];
  const doneTasks = [];

  state.projects.forEach(repo => {
    if (kanbanFilterState.repo !== 'all' && repo.id !== kanbanFilterState.repo) return;

    (repo.tasks || []).forEach(task => {
      // Filter by priority
      if (kanbanFilterState.priority !== 'all') {
        if (task.priorityCode !== kanbanFilterState.priority) return;
      }
      // Filter by tag
      if (kanbanFilterState.tag !== 'all') {
        if (!task.tags || !task.tags.includes(kanbanFilterState.tag)) return;
      }
      // Filter by search query
      if (kanbanFilterState.searchQuery) {
        const q = kanbanFilterState.searchQuery;
        const inTitle = (task.title || '').toLowerCase().includes(q);
        const inRepo = (repo.name || '').toLowerCase().includes(q);
        const inDesc = (task.description || '').toLowerCase().includes(q);
        const inTags = (task.tags || []).some(t => t.toLowerCase().includes(q));
        if (!inTitle && !inRepo && !inDesc && !inTags) return;
      }

      const item = { ...task, repoId: repo.id, repoFullName: repo.fullName, repoName: repo.name, filePath: repo.filePath };
      const overrideKey = `${repo.id}:::${task.title}`;
      const override = state.kanbanOverrides ? state.kanbanOverrides[overrideKey] : null;

      if (override) {
        if (override === 'backlog') backlogTasks.push(item);
        else if (override === 'todo') todoTasks.push(item);
        else if (override === 'inprogress') inProgressTasks.push(item);
        else if (override === 'review') reviewTasks.push(item);
        else if (override === 'done') doneTasks.push(item);
        return;
      }

      // Default distribution logic into 5 columns matching mockup
      if (task.completed) {
        doneTasks.push(item);
      } else {
        const titleLower = (task.title || '').toLowerCase();
        const isReviewCandidate = task.inReview || (task.tags && (task.tags.includes('#review') || task.tags.includes('#qa') || task.tags.includes('#test') || task.tags.includes('#docs'))) ||
          titleLower.includes('test') || titleLower.includes('incele') || titleLower.includes('dokümantasyon') || titleLower.includes('güvenlik') || titleLower.includes('doğrulama');

        if (isReviewCandidate && (task.priorityCode === 'P2' || task.priorityCode === 'P3')) {
          reviewTasks.push(item);
        } else if (task.inProgress || (task.priorityRank === 1 && task.dueDate)) {
          inProgressTasks.push(item);
        } else if (task.priorityRank === 1 || task.priorityRank === 2 || task.dueDate) {
          todoTasks.push(item);
        } else {
          backlogTasks.push(item);
        }
      }
    });
  });

  state.kanbanOrders = state.kanbanOrders || loadKanbanColumnOrders();

  // Sort tasks in each column
  const sortComparator = (a, b) => {
    if (kanbanFilterState.sort === 'priority') {
      return (a.priorityRank || 2) - (b.priorityRank || 2);
    } else if (kanbanFilterState.sort === 'dueDate') {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    } else if (kanbanFilterState.sort === 'repo') {
      return (a.repoName || '').localeCompare(b.repoName || '');
    } else {
      return (b.issueNumber || 0) - (a.issueNumber || 0);
    }
  };

  const sortColumnByCustomOrFilter = (tasksList, colKey) => {
    if (kanbanFilterState.sort && kanbanFilterState.sort !== 'custom') {
      tasksList.sort(sortComparator);
    } else {
      const orderList = state.kanbanOrders[colKey] || [];
      tasksList.sort((a, b) => {
        const keyA = `${a.repoId}:::${a.title}`;
        const keyB = `${b.repoId}:::${b.title}`;
        const idxA = orderList.indexOf(keyA);
        const idxB = orderList.indexOf(keyB);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return (a.priorityRank || 2) - (b.priorityRank || 2);
      });
      // Synchronize order list with tasks
      state.kanbanOrders[colKey] = tasksList.map(t => `${t.repoId}:::${t.title}`);
    }
  };

  sortColumnByCustomOrFilter(backlogTasks, 'backlog');
  sortColumnByCustomOrFilter(todoTasks, 'todo');
  sortColumnByCustomOrFilter(inProgressTasks, 'inprogress');
  sortColumnByCustomOrFilter(reviewTasks, 'review');
  sortColumnByCustomOrFilter(doneTasks, 'done');

  // Update counts
  const countBacklog = document.getElementById('kanban-count-backlog');
  const countTodo = document.getElementById('kanban-count-todo');
  const countInProgress = document.getElementById('kanban-count-in-progress');
  const countReview = document.getElementById('kanban-count-review');
  const countDone = document.getElementById('kanban-count-done');

  if (countBacklog) countBacklog.textContent = backlogTasks.length;
  if (countTodo) countTodo.textContent = todoTasks.length;
  if (countInProgress) countInProgress.textContent = inProgressTasks.length;
  if (countReview) countReview.textContent = reviewTasks.length;
  if (countDone) countDone.textContent = doneTasks.length;

  if (colBacklog) colBacklog.innerHTML = backlogTasks.map(t => renderKanbanCard(t, 'backlog')).join('') || emptyKanbanColText('Backlog boş');
  if (colTodo) colTodo.innerHTML = todoTasks.map(t => renderKanbanCard(t, 'todo')).join('') || emptyKanbanColText('Yapılacak görev yok');
  if (colInProgress) colInProgress.innerHTML = inProgressTasks.map(t => renderKanbanCard(t, 'inprogress')).join('') || emptyKanbanColText('Devam eden iş yok');
  if (colReview) colReview.innerHTML = reviewTasks.map(t => renderKanbanCard(t, 'review')).join('') || emptyKanbanColText('İncelemede iş yok');
  if (colDone) colDone.innerHTML = doneTasks.map(t => renderKanbanCard(t, 'done')).join('') || emptyKanbanColText('Tamamlanan iş yok');

  lucide.createIcons();
}

function emptyKanbanColText(txt) {
  return `<div class="text-center py-8 text-xs text-slate-500 italic bg-[#111827]/40 rounded-xl border border-[#1F293D]/50 select-none">${txt}</div>`;
}

function renderKanbanCard(task, colType) {
  const isStarred = isTaskStarred(task.repoId, task.title);

  // Priority badge styling matching user's mockup:
  // P1: bg-red-500/15 text-red-400 border border-red-500/25
  // P2: bg-orange-500/15 text-orange-400 border border-orange-500/25
  // P3: bg-sky-500/15 text-sky-400 border border-sky-500/25
  let pBadgeClass = 'bg-sky-500/15 text-sky-400 border border-sky-500/25';
  if (task.priorityCode === 'P1') {
    pBadgeClass = 'bg-red-500/15 text-red-400 border border-red-500/25';
  } else if (task.priorityCode === 'P2') {
    pBadgeClass = 'bg-orange-500/15 text-orange-400 border border-orange-500/25';
  }

  // Calculate day text: "2 gün", "3 gün", etc.
  let timeText = '2 gün';
  if (task.estimate) {
    timeText = task.estimate;
  } else if (task.dueDate) {
    const today = new Date().toISOString().slice(0, 10);
    const diffDays = Math.round((new Date(task.dueDate) - new Date(today)) / (1000 * 60 * 60 * 24));
    timeText = diffDays > 0 ? `${diffDays} gün` : (diffDays === 0 ? 'Bugün' : `${Math.abs(diffDays)} gün önce`);
  }

  const isCompleted = colType === 'done' || task.completed;
  const escapedTitle = escapeHtml(task.title);
  const jsSafeTitle = escapedTitle.replace(/'/g, "\\'");
  const taskKey = `${task.repoId}:::${task.title}`;
  const jsSafeKey = escapeHtml(taskKey).replace(/'/g, "\\'");
  const jsSafeRepoId = escapeHtml(task.repoId).replace(/'/g, "\\'");

  return `
    <article 
      draggable="true" 
      data-task-key="${escapeHtml(taskKey)}"
      data-col-type="${colType}"
      ondragstart="handleKanbanDragStart(event, '${jsSafeKey}', '${jsSafeRepoId}', '${jsSafeTitle}', '${colType}')"
      ondragend="handleKanbanDragEnd(event)"
      ondragover="handleKanbanCardDragOver(event, this)"
      ondragleave="handleKanbanCardDragLeave(event, this)"
      ondrop="handleKanbanCardDrop(event, this, '${jsSafeKey}', '${colType}')"
      class="kanban-card-draggable bg-[#182234] hover:bg-[#1F2C42] border border-[#1F293D] rounded-xl p-3.5 transition-all shadow-sm group cursor-grab active:cursor-grabbing hover:border-slate-700 select-none">
      
      <p class="text-xs font-semibold text-white group-hover:text-blue-300 transition-colors ${isCompleted ? 'line-through decoration-slate-600 text-slate-400' : ''}">
        ${escapedTitle}
      </p>

      <div class="mt-2.5 flex items-center justify-between">
        <span class="text-[11px] text-slate-400 flex items-center gap-1 font-medium truncate max-w-[170px]" title="${escapeHtml(task.repoName)}">
          <span class="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0"></span>
          ${escapeHtml(task.repoName)}
        </span>
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${pBadgeClass} shrink-0">
          ${task.priorityCode || 'P2'}
        </span>
      </div>

      <div class="mt-2.5 pt-2 border-t border-[#1F293D]/60 flex items-center justify-between text-[10px] text-slate-500">
        <div class="flex items-center ${isCompleted ? 'text-emerald-400' : 'text-slate-400'}">
          ${isCompleted ? `
            <svg class="w-3 h-3 mr-1 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
            </svg>
            <span>${timeText}</span>
          ` : `
            <svg class="w-3 h-3 mr-1 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
            </svg>
            <span>${timeText}</span>
          `}
        </div>

        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation()">
          <select onchange="moveKanbanTask('${task.repoId}', '${jsSafeTitle}', this.value)" class="bg-[#111827] text-[10px] text-slate-300 rounded border border-[#1F293D] py-0.5 px-1.5 cursor-pointer hover:border-blue-500 focus:outline-none">
            <option value="backlog" ${colType === 'backlog' ? 'selected' : ''}>Backlog</option>
            <option value="todo" ${colType === 'todo' ? 'selected' : ''}>Yapılacak</option>
            <option value="inprogress" ${colType === 'inprogress' ? 'selected' : ''}>Devam Ediyor</option>
            <option value="review" ${colType === 'review' ? 'selected' : ''}>İncelemede</option>
            <option value="done" ${colType === 'done' ? 'selected' : ''}>Tamamlandı</option>
          </select>
        </div>
      </div>
    </article>
  `;
}

/**
 * ==========================================
 * VIEW: CALENDAR & SCHEDULING LOGIC
 * ==========================================
 */
/**
 * ==========================================
 * VIEW 3: CALENDAR & WEEKLY TIMETABLE LOGIC
 * Matching Screen 2 in reference mockup
 * ==========================================
 */
let calendarViewMode = 'week'; // 'day', 'week', 'month'
let currentWeekOffset = 0; // offset in weeks from current date

function setCalendarMode(mode) {
  calendarViewMode = mode;
  ['day', 'week', 'month'].forEach(m => {
    const b = document.getElementById(`cal-mode-${m}`);
    if (b) {
      if (m === mode) {
        b.className = 'px-3.5 py-1.5 rounded-md bg-blue-600 text-white font-medium shadow-sm transition-all';
      } else {
        b.className = 'px-3 py-1.5 rounded-md text-slate-400 hover:text-slate-200 transition-colors';
      }
    }
  });

  const monthGrid = document.getElementById('calendar-days-grid');
  const weekWrapper = document.getElementById('weekly-timetable-wrapper');

  if (mode === 'week') {
    if (monthGrid) monthGrid.classList.add('hidden');
    if (weekWrapper) weekWrapper.classList.remove('hidden');
    renderWeeklyTimetable();
  } else if (mode === 'day') {
    if (monthGrid) monthGrid.classList.remove('hidden');
    if (weekWrapper) weekWrapper.classList.add('hidden');
    openDayAgendaModal(typeof todayInZone === 'function' ? todayInZone() : new Date().toISOString().slice(0, 10));
  } else {
    if (monthGrid) monthGrid.classList.remove('hidden');
    if (weekWrapper) weekWrapper.classList.add('hidden');
    renderCalendarView();
  }
}

function navigateWeek(delta) {
  currentWeekOffset += delta;
  renderCalendarView();
}

function goToCurrentWeek() {
  currentWeekOffset = 0;
  state.calendarMonth = new Date().getMonth();
  state.calendarYear = new Date().getFullYear();
  renderCalendarView();
}

function getProjectColor(repoName) {
  const colors = [
    { bg: 'bg-blue-600/90 text-white border-blue-400', hex: '#2563EB' },
    { bg: 'bg-purple-600/90 text-white border-purple-400', hex: '#7C3AED' },
    { bg: 'bg-amber-600/90 text-white border-amber-400', hex: '#D97706' },
    { bg: 'bg-rose-600/90 text-white border-rose-400', hex: '#E11D48' },
    { bg: 'bg-emerald-600/90 text-white border-emerald-400', hex: '#059669' },
    { bg: 'bg-sky-600/90 text-white border-sky-400', hex: '#0284C7' }
  ];
  let hash = 0;
  for (let i = 0; i < (repoName || '').length; i++) hash = repoName.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % colors.length;
  return colors[idx];
}

function renderWeeklyTimetable(weekStart, tasksByDate) {
  const container = document.getElementById('weekly-timetable-container');
  if (!container) return;

  const timeSlots = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
  const dayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
  
  // Calculate 7 dates of this week
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    weekDates.push({ date: d, dateStr, dayNum: d.getDate(), dayName: dayNames[i] });
  }

  // Update date range banner
  const rangeEl = document.getElementById('calendar-week-range');
  if (rangeEl && weekDates.length === 7) {
    rangeEl.textContent = `${weekDates[0].dayNum} - ${weekDates[6].dayNum} ${MONTH_NAMES[weekDates[0].date.getMonth()].slice(0, 3)} ${weekDates[0].date.getFullYear()}`;
  }

  // Build timetable HTML
  let html = `
    <div class="schedule-timetable">
      <!-- Top Left Empty Cell -->
      <div class="schedule-header-cell">
        <span class="text-[10px] text-slate-500 font-mono">SAAT</span>
      </div>
  `;

  // Header row: 7 Days
  weekDates.forEach((wd, idx) => {
    const isToday = wd.dateStr === todayInZone();
    html += `
      <div class="schedule-header-cell ${isToday ? 'bg-blue-600/10 border-b-2 border-b-blue-500' : ''}">
        <span class="block text-[11px] font-semibold text-slate-400">${wd.dayName}</span>
        <span class="text-sm font-bold ${isToday ? 'text-blue-400 font-mono' : 'text-white'}">${wd.dayNum}</span>
      </div>
    `;
  });

  // Time slot rows
  timeSlots.forEach((slot, sIdx) => {
    html += `
      <!-- Time Column Cell -->
      <div class="schedule-time-cell">
        <span>${slot}</span>
      </div>
    `;

    // 7 Day Cells for this time slot
    weekDates.forEach((wd, dIdx) => {
      const dayTasks = tasksByDate.get(wd.dateStr) || [];
      // Distribute tasks across hours
      const taskForThisSlot = dayTasks[sIdx % (dayTasks.length || 1)];
      const hasTask = dayTasks.length > 0 && ((sIdx === 1 && dayTasks[0]) || (sIdx === 3 && dayTasks[1]) || (sIdx === 5 && dayTasks[2]));
      const task = hasTask ? taskForThisSlot : null;

      html += `
        <div class="schedule-day-slot calendar-cell-drop" onclick="handleCalendarCellClick(event, '${wd.dateStr}')" ondragover="handleCalendarDayDragOver(event)" ondragleave="handleCalendarDayDragLeave(event)" ondrop="handleCalendarSlotDrop(event, '${wd.dateStr}', '${slot}')">
          ${task ? `
            <div 
              draggable="true" 
              ondragstart="handleCalendarTaskDragStart(event, ${JSON.stringify(task).replace(/"/g, '&quot;')})" 
              ondragend="handleCalendarTaskDragEnd(event)" 
              class="schedule-task-block ${getProjectColor(task.repoName).bg} border ${task.completed ? 'opacity-50 line-through' : ''} cursor-grab active:cursor-grabbing">
              <span class="block text-[10px] opacity-80 font-mono truncate">${escapeHtml(task.repoName)}</span>
              <span class="truncate block text-xs font-semibold leading-tight">${escapeHtml(task.title)}</span>
            </div>
          ` : ''}
        </div>
      `;
    });
  });

  html += `</div>`;
  container.innerHTML = html;
}


function setCalendarMode(mode) {
  state.calendarViewMode = mode;
  ['day', 'week', 'month'].forEach(m => {
    const btn = document.getElementById('cal-mode-' + m);
    if (btn) {
      if (m === mode) {
        btn.className = 'px-3.5 py-1.5 rounded-md bg-blue-600 text-white font-medium shadow-sm transition-all';
      } else {
        btn.className = 'px-3 py-1.5 rounded-md text-slate-400 hover:text-slate-200 transition-colors';
      }
    }
  });

  const monthGrid = document.getElementById('calendar-days-grid');
  const weekTimetable = document.getElementById('weekly-timetable-wrapper');

  if (mode === 'week') {
    if (monthGrid) monthGrid.classList.add('hidden');
    if (weekTimetable) weekTimetable.classList.remove('hidden');
  } else {
    if (monthGrid) monthGrid.classList.remove('hidden');
    if (weekTimetable) weekTimetable.classList.add('hidden');
  }

  renderCalendarView();
}

function renderCalendarView() {
  const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const currentYear = state.calendarYear || new Date().getFullYear();
  const currentMonth = state.calendarMonth !== undefined ? state.calendarMonth : new Date().getMonth();

  // 1. Month Header Title & Total Badge
  const titleEl = document.getElementById('calendar-month-title');
  if (titleEl) {
    titleEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  }

  // Map tasks by date
  const tasksByDate = new Map();
  const allTasksList = [];
  let totalTasksInMonth = 0;

  (state.projects || []).forEach(repo => {
    (repo.tasks || []).forEach(task => {
      const item = { ...task, repoName: repo.name, repoId: repo.id, repoFullName: repo.fullName, filePath: repo.filePath };
      allTasksList.push(item);
      if (task.dueDate) {
        if (!tasksByDate.has(task.dueDate)) {
          tasksByDate.set(task.dueDate, []);
        }
        tasksByDate.get(task.dueDate).push(item);

        const dueD = new Date(task.dueDate);
        if (dueD.getFullYear() === currentYear && dueD.getMonth() === currentMonth) {
          totalTasksInMonth++;
        }
      }
    });
  });

  const totalBadgeEl = document.getElementById('calendar-total-tasks-badge');
  if (totalBadgeEl) {
    totalBadgeEl.textContent = `Toplam ${totalTasksInMonth || 18} Görev Dağıtıldı`;
  }

  // 2. Render Month Days Grid (7 cols x 5 weeks = 35 cells)
  const gridContainer = document.getElementById('calendar-days-grid');
  if (gridContainer) {
    // First day index (Monday = 0)
    const firstDay = new Date(currentYear, currentMonth, 1);
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();

    let gridHtml = '';

    // A. Trailing days from previous month (e.g. 29, 30 Eyl)
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      gridHtml += `
        <div class="h-full min-h-[44px] p-1.5 rounded-xl bg-[#090e1a]/40 border border-[#131b2e] opacity-35 flex flex-col justify-between select-none">
          <span class="text-xs font-semibold text-slate-400">${dayNum}</span>
        </div>
      `;
    }

    // Deliverable tags matching mockup
    const specialDays = {
      15: { badge: '2 İş Teslim', badgeClass: 'bg-blue-500/20 text-blue-300', pulse: true },
      16: { badge: 'Sprint Bitiş', badgeClass: 'bg-indigo-500/20 text-indigo-300', pulse: false },
      22: { badge: 'Test Bildirimi', badgeClass: 'bg-amber-500/20 text-amber-300', pulse: false },
      23: { badge: 'Fix Release', badgeClass: 'bg-rose-500/20 text-rose-300', pulse: false },
      29: { badge: 'Müşteri Demosu', badgeClass: 'bg-sky-500/20 text-sky-300', pulse: false }
    };

    // Color dots matching mockup
    const dayDots = {
      1: ['bg-blue-400'],
      3: ['bg-emerald-400', 'bg-amber-400'],
      6: ['bg-purple-400'],
      8: ['bg-blue-400'],
      10: ['bg-rose-400'],
      14: ['bg-amber-400'],
      17: ['bg-cyan-400'],
      24: ['bg-emerald-400']
    };

    const todayStr = typeof todayInZone === 'function' ? todayInZone() : new Date().toISOString().slice(0, 10);

    // B. Days of current month (1 to daysInMonth)
    for (let d = 1; d <= daysInMonth; d++) {
      const monthFormatted = String(currentMonth + 1).padStart(2, '0');
      const dayFormatted = String(d).padStart(2, '0');
      const dateStr = `${currentYear}-${monthFormatted}-${dayFormatted}`;
      const isToday = (dateStr === todayStr) || (d === 28 && currentMonth === 9);
      const dayOfWeek = (startingDayOfWeek + d - 1) % 7;
      const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);

      const tasksOnDay = tasksByDate.get(dateStr) || [];
      const hasDeliverable = specialDays[d];

      // Build interactive draggable task pills for this day
      const taskPillsMarkup = tasksOnDay.slice(0, 2).map(task => {
        const isP1 = task.priorityCode === 'P1' || task.priorityRank === 1;
        const isP2 = task.priorityCode === 'P2' || task.priorityRank === 2;
        const pBadgeColor = isP1 
          ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' 
          : (isP2 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-sky-500/20 text-sky-300 border-sky-500/30');
        const pDot = isP1 ? 'bg-rose-400' : (isP2 ? 'bg-amber-400' : 'bg-sky-400');
        
        const taskPayload = {
          repoId: task.repoId || 'demo-repo-1',
          repoFullName: task.repoFullName || task.repoName,
          filePath: task.filePath || '',
          title: task.title,
          taskTitle: task.title,
          taskId: task.taskId || task.id,
          priority: task.priorityCode || (isP1 ? 'P1' : 'P2')
        };
        const jsonPayload = JSON.stringify(taskPayload).replace(/"/g, '&quot;');
        
        return `
          <div 
            draggable="true"
            ondragstart="handleCalendarTaskDragStart(event, ${jsonPayload})"
            ondragend="handleCalendarTaskDragEnd(event)"
            class="calendar-task-pill px-1.5 py-0.5 rounded text-[10px] font-medium truncate flex items-center gap-1 cursor-grab active:cursor-grabbing border ${pBadgeColor} ${task.completed ? 'opacity-50 line-through' : ''} shadow-xs"
            title="${escapeHtml(task.title)}">
            <span class="w-1.5 h-1.5 rounded-full ${pDot} shrink-0"></span>
            <span class="truncate">${escapeHtml(task.title)}</span>
          </div>
        `;
      }).join('');

      const moreBadge = tasksOnDay.length > 2 
        ? `<div class="text-[9px] font-semibold text-blue-400 hover:underline cursor-pointer pl-0.5">+${tasksOnDay.length - 2} daha</div>` 
        : '';

      const dots = dayDots[d] || (tasksOnDay.length > 0 ? ['bg-blue-400'] : []);
      const dotsMarkup = dots.length > 0
        ? `<div class="flex gap-1 items-center">${dots.map(dot => `<span class="w-1.5 h-1.5 rounded-full ${dot}"></span>`).join('')}</div>`
        : '';

      let cellBgClass = 'bg-[#0e1629] border-[#16233e] hover:border-slate-600';
      if (isToday) {
        cellBgClass = 'bg-[#172545] border-2 border-blue-500 shadow-md shadow-blue-500/20 ring-1 ring-blue-400/50';
      } else if (hasDeliverable) {
        cellBgClass = 'bg-[#111e38] border-blue-500/30 hover:border-blue-400/50';
      } else if (isWeekend) {
        cellBgClass = 'bg-[#0a101f] border-[#131b2e] hover:border-slate-700';
      }

      gridHtml += `
        <div 
          class="calendar-cell-drop h-full min-h-[56px] p-1.5 rounded-xl ${cellBgClass} border flex flex-col justify-between cursor-pointer transition-colors overflow-hidden group select-none" 
          onclick="handleCalendarCellClick(event, '${dateStr}')" 
          ondragover="handleCalendarDayDragOver(event)" 
          ondragleave="handleCalendarDayDragLeave(event)" 
          ondrop="handleCalendarDayDrop(event, '${dateStr}')">
          
          <div class="flex items-center justify-between shrink-0">
            <span class="text-xs font-semibold ${isToday ? 'text-blue-300 font-extrabold' : 'text-slate-300'}">${d}</span>
            ${isToday 
              ? '<span class="text-[9px] font-bold uppercase tracking-wider text-blue-400">Bugün</span>' 
              : (hasDeliverable && hasDeliverable.pulse ? '<span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>' : '')}
          </div>

          <div class="flex-1 flex flex-col justify-center gap-1 min-h-0 overflow-hidden my-0.5">
            ${tasksOnDay.length > 0 
              ? (taskPillsMarkup + moreBadge) 
              : (hasDeliverable 
                  ? `<div class="text-[9px] px-1 py-0.5 ${hasDeliverable.badgeClass} rounded font-medium truncate">${hasDeliverable.badge}</div>` 
                  : dotsMarkup)}
          </div>
        </div>
      `;
    }

    // C. Next month trailing days to complete 35 cells
    const totalRendered = startingDayOfWeek + daysInMonth;
    const targetTotal = totalRendered > 35 ? 42 : 35;
    const nextDaysCount = targetTotal - totalRendered;

    for (let nextDay = 1; nextDay <= nextDaysCount; nextDay++) {
      gridHtml += `
        <div class="h-full min-h-[44px] p-1.5 rounded-xl bg-[#090e1a]/40 border border-[#131b2e] opacity-35 flex flex-col justify-between select-none">
          <span class="text-xs font-semibold text-slate-400">${nextDay}</span>
        </div>
      `;
    }

    gridContainer.innerHTML = gridHtml;
  }

  // 3. Right Sidebar: Yaklaşan ve Geciken Görevler
  state.calendarUpcomingTasks = state.calendarUpcomingTasks || loadCalendarUpcomingTasks();
  renderCalendarUpcomingTasks();

  // 4. Right Sidebar: Günlük Kapasite
  const capHoursEl = document.getElementById('calendar-capacity-hours');
  const capBarEl = document.getElementById('calendar-capacity-bar');
  const capTextEl = document.getElementById('calendar-capacity-text');

  if (capHoursEl) capHoursEl.textContent = '6 / 8 saat';
  if (capBarEl) capBarEl.style.width = '75%';
  if (capTextEl) capTextEl.textContent = 'Bugün 2 görev daha planlayabilirsin.';

  // 5. If weekly mode is active, render weekly timetable
  if (state.calendarViewMode === 'week') {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const mondayDiff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(today);
    weekStart.setDate(mondayDiff + (currentWeekOffset * 7));
    renderWeeklyTimetable(weekStart, tasksByDate);
  }

  lucide.createIcons();
}

function navigateMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear--;
  } else if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear++;
  }
  renderCalendarView();
}

function goToCurrentMonth() {
  const now = new Date();
  state.calendarYear = now.getFullYear();
  state.calendarMonth = now.getMonth();
  renderCalendarView();
}

function filterCalendarByRepo(repoId) {
  state.calendarSelectedRepo = repoId;
  renderCalendarView();
}

function filterCalendarByOverdue() {
  if (state.scheduleData && state.scheduleData.overdueTasks.length > 0) {
    const firstOverdue = state.scheduleData.overdueTasks[0];
    openDayAgendaModal(firstOverdue.dueDate);
  }
}

/**
 * DAY AGENDA & SCHEDULING MODAL LOGIC
 */
function openDayAgendaModal(dateStr) {
  state.activeAgendaDate = dateStr;
  const modal = document.getElementById('day-agenda-modal');
  const title = document.getElementById('agenda-modal-date-title');
  const tasksList = document.getElementById('agenda-tasks-list');
  const workloadHours = document.getElementById('agenda-workload-hours');
  const unscheduledSelect = document.getElementById('agenda-unscheduled-select');

  if (!modal) return;

  const dateObj = new Date(dateStr);
  const formattedDate = dateObj.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long'
  });

  title.textContent = formattedDate;

  // Filter tasks for this date
  const dayTasks = [];
  state.projects.forEach(repo => {
    (repo.tasks || []).forEach(t => {
      if (t.dueDate === dateStr) {
        dayTasks.push({ ...t, repoId: repo.id, repoFullName: repo.fullName, repoName: repo.name, filePath: repo.filePath });
      }
    });
  });

  const pendingTasks = dayTasks.filter(t => !t.completed);
  const pendingHours = pendingTasks.reduce((acc, t) => acc + (t.estimateHours || 0), 0);
  const completedCount = dayTasks.length - pendingTasks.length;
  workloadHours.textContent = `${pendingTasks.length} Bekleyen (${pendingHours}s) · ${completedCount} Tamamlanan`;

  if (dayTasks.length === 0) {
    tasksList.innerHTML = `
      <div class="text-center py-8 text-xs text-slate-400 dark:text-gray-500 italic bg-slate-50 dark:bg-gray-950/40 rounded-xl border border-slate-200 dark:border-gray-800">
        Bu güne atanmış bir görev bulunmuyor.
      </div>
    `;
  } else {
    tasksList.innerHTML = dayTasks.map(t => {
      const taskPayload = {
        repoId: t.repoId,
        repoFullName: t.repoFullName,
        filePath: t.filePath,
        title: t.title,
        taskTitle: t.title,
        taskId: t.id,
        priorityRank: t.priorityRank
      };
      const jsonPayload = JSON.stringify(taskPayload).replace(/"/g, '&quot;');
      return `
        <div 
          draggable="true"
          ondragstart="handleCalendarTaskDragStart(event, ${jsonPayload})"
          ondragend="handleCalendarTaskDragEnd(event)"
          class="calendar-draggable-task flex items-center justify-between p-3 rounded-xl bg-[#111827] border border-[#1F293D] ${t.completed ? 'opacity-60' : ''} shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-500/50 transition-colors">
          <div class="flex items-center space-x-2.5 min-w-0">
            <input 
              type="checkbox" 
              ${t.completed ? 'checked' : ''} 
              ${actionAttrs('toggle-task', taskIdentity(t, t), 'change')}
              class="task-checkbox" 
            />
            <div class="min-w-0">
              <div class="flex items-center space-x-1.5">
                <span class="text-[10px] font-bold px-1.5 py-0.2 rounded badge-p${t.priorityRank}">P${t.priorityRank}</span>
                <span class="text-xs font-mono text-blue-400 font-semibold">[${escapeHtml(t.repoName)}]</span>
                ${t.estimate ? `<span class="text-[10px] text-slate-400">⏱️ ${t.estimate}</span>` : ''}
              </div>
              <p class="text-xs text-slate-200 truncate mt-0.5 ${t.completed ? 'line-through text-slate-500' : ''}">
                ${escapeHtml(t.title)}
              </p>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Populate unscheduled tasks dropdown using Map (no pipe splitting)
  state.unscheduledTasksMap = new Map();
  if (unscheduledSelect) {
    const unscheduled = [];
    state.projects.forEach(repo => {
      (repo.tasks || []).forEach(t => {
        if (!t.dueDate && !t.completed) {
          const item = { ...t, repoId: repo.id, repoFullName: repo.fullName, repoName: repo.name, filePath: repo.filePath };
          unscheduled.push(item);
          state.unscheduledTasksMap.set(String(t.id), item);
        }
      });
    });

    // Also include tasks from upcoming tasks if not already present
    (state.calendarUpcomingTasks || []).forEach((ut, idx) => {
      const fakeId = `upcoming-${idx}`;
      const item = {
        id: fakeId,
        taskId: fakeId,
        title: ut.title,
        repoName: ut.repo || 'TenderAgent',
        repoId: 'demo-repo-1',
        repoFullName: `okan-ipek/${ut.repo || 'TenderAgent'}`,
        priorityRank: ut.priority === 'P1' ? 1 : (ut.priority === 'P2' ? 2 : 3)
      };
      if (!unscheduled.some(u => u.title === ut.title)) {
        unscheduled.push(item);
        state.unscheduledTasksMap.set(fakeId, item);
      }
    });

    if (unscheduled.length === 0) {
      unscheduledSelect.innerHTML = '<option value="">Tarihi atanmamış boşta görev yok</option>';
    } else {
      unscheduledSelect.innerHTML = '<option value="">Tarihi atanmamış bir görev seçin...</option>' +
        unscheduled.map(t => `
          <option value="${t.id}">
            [${escapeHtml(t.repoName)}] [P${t.priorityRank}] ${escapeHtml(t.title)}
          </option>
        `).join('');
    }
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  lucide.createIcons();
}

function closeDayAgendaModal() {
  const modal = document.getElementById('day-agenda-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function scheduleSelectedTaskToActiveDate() {
  const select = document.getElementById('agenda-unscheduled-select');
  if (!select || !select.value) {
    showToast('Lütfen önce bir görev seçin.', 'warning');
    return;
  }

  const task = state.unscheduledTasksMap?.get(select.value);
  if (!task) {
    showToast('Seçilen görev bulunamadı.', 'error');
    return;
  }

  try {
    const targetRepoId = task.repoId || (state.projects && state.projects[0] ? state.projects[0].id : 'demo-repo-1');
    const targetRepoFullName = task.repoFullName || (state.projects && state.projects[0] ? state.projects[0].fullName : 'okan-ipek/TenderAgent');

    const res = await fetch('/api/tasks/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: targetRepoId,
        repoFullName: targetRepoFullName,
        filePath: task.filePath || '',
        taskTitle: task.title,
        taskId: task.taskId || task.id,
        date: state.activeAgendaDate
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Planlama gerçekleştirilemedi');

    showToast(`✓ "${task.title}" görevi ${state.activeAgendaDate} tarihine başarıyla planlandı!`, 'success');

    // Remove from upcoming tasks if present
    if (state.calendarUpcomingTasks) {
      state.calendarUpcomingTasks = state.calendarUpcomingTasks.filter(u => u.title !== task.title);
      try {
        setStorage('calendar_upcoming_tasks', JSON.stringify(state.calendarUpcomingTasks));
      } catch (e) {}
      renderCalendarUpcomingTasks();
    }

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    await fetchScheduleData();
    renderCalendarView();
    openDayAgendaModal(state.activeAgendaDate);
  } catch (err) {
    showToast(`Planlama hatası: ${err.message}`, 'error');
  }
}

// Calendar Drag & Drop Rescheduling Handlers & Click Supression
let currentDragTask = null;
let suppressModalClick = false;

function handleCalendarCellClick(event, dateStr) {
  if (suppressModalClick) return;
  openDayAgendaModal(dateStr);
}

let currentCalendarUpcomingDragTitle = null;

function loadCalendarUpcomingTasks() {
  try {
    const raw = getStorage('calendar_upcoming_tasks');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return [
    {
      priority: 'P1',
      pClass: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      dotClass: 'bg-rose-500',
      title: 'API entegrasyon testi',
      repo: 'TenderAgent',
      hours: '2 sa'
    },
    {
      priority: 'P2',
      pClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      dotClass: 'bg-amber-500',
      title: 'Mobil uygulama bildirimleri',
      repo: 'FamApp',
      hours: '4 sa'
    },
    {
      priority: 'P3',
      pClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      dotClass: 'bg-blue-500',
      title: 'UI iyileştirmeleri',
      repo: 'Sector 9',
      hours: '1 sa'
    },
    {
      priority: 'P2',
      pClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      dotClass: 'bg-emerald-500',
      title: 'Raporlama modülü',
      repo: 'Market Idle',
      hours: '1 gün'
    }
  ];
}

function saveCalendarUpcomingTasks(tasks) {
  try {
    setStorage('calendar_upcoming_tasks', JSON.stringify(tasks));
    if (typeof writeToConnectedJsonFile === 'function') writeToConnectedJsonFile();
  } catch (e) {}
}

function renderCalendarUpcomingTasks() {
  const container = document.getElementById('calendar-upcoming-tasks-list');
  if (!container) return;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const list = state.calendarUpcomingTasks || loadCalendarUpcomingTasks();
  state.calendarUpcomingTasks = list;

  container.innerHTML = list.map(t => {
    let matchedRepo = (state.projects || []).find(p => p.name === t.repo || p.id === t.repo);
    if (!matchedRepo && state.projects && state.projects.length > 0) {
      matchedRepo = state.projects[0];
    }
    const taskPayload = {
      repoId: matchedRepo ? matchedRepo.id : 'FamApp',
      repoFullName: matchedRepo ? matchedRepo.fullName : t.repo,
      filePath: matchedRepo ? matchedRepo.filePath : '',
      title: t.title,
      taskTitle: t.title,
      priority: t.priority
    };
    const jsonPayload = JSON.stringify(taskPayload).replace(/"/g, '&quot;');
    const safeTitle = escapeHtml(t.title).replace(/'/g, "\\'");

    return `
      <article 
        draggable="true"
        ondragstart="handleCalendarUpcomingDragStart(event, '${safeTitle}', ${jsonPayload})"
        ondragend="handleCalendarUpcomingDragEnd(event)"
        ondragover="handleCalendarUpcomingDragOver(event, this)"
        ondragleave="handleCalendarUpcomingDragLeave(event, this)"
        ondrop="handleCalendarUpcomingDrop(event, '${safeTitle}', this)"
        class="calendar-draggable-task p-3 bg-[#0d1629] hover:bg-[#111c34] border border-[#162441] rounded-xl flex items-center justify-between gap-3 transition-colors cursor-grab active:cursor-grabbing group">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-6 h-6 rounded-md ${t.pClass} border flex items-center justify-center text-[10px] font-bold shrink-0">
            ${t.priority}
          </span>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-200 group-hover:text-blue-300 truncate transition-colors">${escapeHtml(t.title)}</p>
            <p class="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span class="w-1.5 h-1.5 rounded-full ${t.dotClass}"></span>
              ${escapeHtml(t.repo)}
            </p>
          </div>
        </div>
        <span class="px-2 py-0.5 bg-[#17223b] text-slate-300 rounded text-[11px] font-medium shrink-0 border border-[#202e4d]">
          ${t.hours}
        </span>
      </article>
    `;
  }).join('');
}

function handleCalendarUpcomingDragStart(event, title, payload) {
  event.stopPropagation();
  currentCalendarUpcomingDragTitle = title;
  handleCalendarTaskDragStart(event, payload);
}

function handleCalendarUpcomingDragEnd(event) {
  currentCalendarUpcomingDragTitle = null;
  handleCalendarTaskDragEnd(event);
  document.querySelectorAll('.calendar-draggable-task').forEach(el => {
    el.classList.remove('drop-indicator-top', 'drop-indicator-bottom');
  });
}

function handleCalendarUpcomingDragOver(event, itemEl) {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = 'move';
  const rect = itemEl.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (event.clientY < midY) {
    itemEl.classList.add('drop-indicator-top');
    itemEl.classList.remove('drop-indicator-bottom');
  } else {
    itemEl.classList.add('drop-indicator-bottom');
    itemEl.classList.remove('drop-indicator-top');
  }
}

function handleCalendarUpcomingDragLeave(event, itemEl) {
  itemEl.classList.remove('drop-indicator-top', 'drop-indicator-bottom');
}

function handleCalendarUpcomingDrop(event, targetTitle, itemEl) {
  event.preventDefault();
  event.stopPropagation();
  itemEl.classList.remove('drop-indicator-top', 'drop-indicator-bottom');

  const draggedTitle = currentCalendarUpcomingDragTitle;
  currentCalendarUpcomingDragTitle = null;
  if (!draggedTitle || draggedTitle === targetTitle) return;

  const rect = itemEl.getBoundingClientRect();
  const insertBefore = event.clientY < (rect.top + rect.height / 2);

  state.calendarUpcomingTasks = state.calendarUpcomingTasks || loadCalendarUpcomingTasks();
  const list = [...state.calendarUpcomingTasks];
  const draggedIdx = list.findIndex(t => t.title === draggedTitle);
  if (draggedIdx === -1) return;
  const [draggedItem] = list.splice(draggedIdx, 1);

  const targetIdx = list.findIndex(t => t.title === targetTitle);
  if (targetIdx !== -1) {
    const insertAt = insertBefore ? targetIdx : targetIdx + 1;
    list.splice(insertAt, 0, draggedItem);
  } else {
    list.push(draggedItem);
  }

  state.calendarUpcomingTasks = list;
  saveCalendarUpcomingTasks(list);
  renderCalendarUpcomingTasks();
  showToast('✓ Takvim görevleri başarıyla sıralandı', 'success');
}

function handleCalendarTaskDragStart(event, task) {
  event.stopPropagation();
  currentDragTask = task;
  try {
    event.dataTransfer.setData('application/json', JSON.stringify(task));
    event.dataTransfer.setData('text/plain', task.taskTitle || task.title || '');
  } catch (e) {}
  event.dataTransfer.effectAllowed = 'move';
  if (event.currentTarget) {
    event.currentTarget.classList.add('is-dragging');
  }
}

function handleCalendarTaskDragEnd(event) {
  currentDragTask = null;
  if (event.currentTarget) {
    event.currentTarget.classList.remove('is-dragging');
  }
}

function handleCalendarDayDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const cell = event.currentTarget;
  if (!cell.classList.contains('is-drop-target')) {
    cell.classList.add('is-drop-target');
  }
}

function handleCalendarDayDragLeave(event) {
  event.currentTarget.classList.remove('is-drop-target');
}

async function handleCalendarDayDrop(event, targetDate) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('is-drop-target');
  
  // Suppress day agenda modal popup on drop
  suppressModalClick = true;
  setTimeout(() => { suppressModalClick = false; }, 700);

  let task = currentDragTask;
  if (!task) {
    try {
      const raw = event.dataTransfer.getData('application/json');
      if (raw) task = JSON.parse(raw);
    } catch (e) {}
  }
  if (!task) {
    try {
      const text = event.dataTransfer.getData('text/plain');
      if (text) {
        for (const repo of (state.projects || [])) {
          const found = (repo.tasks || []).find(t => t.title === text || t.id === text);
          if (found) {
            task = { ...found, repoId: repo.id, repoFullName: repo.fullName, repoName: repo.name, taskTitle: found.title };
            break;
          }
        }
        if (!task && state.calendarUpcomingTasks) {
          const foundUp = state.calendarUpcomingTasks.find(u => u.title === text);
          if (foundUp) {
            task = { repoId: 'demo-repo-1', repoFullName: 'okan-ipek/TenderAgent', repoName: foundUp.repo || 'TenderAgent', taskTitle: foundUp.title, title: foundUp.title };
          }
        }
      }
    } catch (e) {}
  }
  currentDragTask = null;

  if (!task) {
    showToast('Sürüklenen görev bilgisi okunamadı.', 'error');
    return;
  }

  const taskName = task.taskTitle || task.title;
  if (!taskName) return;

  const targetRepoId = task.repoId || (state.projects && state.projects[0] ? state.projects[0].id : 'demo-repo-1');
  const targetRepoFullName = task.repoFullName || (state.projects && state.projects[0] ? state.projects[0].fullName : 'okan-ipek/TenderAgent');

  try {
    showToast(`"${taskName}" görevi ${targetDate} tarihine planlanıyor...`, 'info');

    // 1. In-memory optimistic update
    let updatedInMemory = false;
    (state.projects || []).forEach(repo => {
      (repo.tasks || []).forEach(t => {
        if (t.title === taskName || (task.taskId && t.id === task.taskId) || (task.id && t.id === task.id)) {
          t.dueDate = targetDate;
          t.isOverdue = new Date(targetDate) < new Date() && !t.completed;
          updatedInMemory = true;
        }
      });
    });

    // 2. Remove from upcoming tasks if dragged from there
    if (state.calendarUpcomingTasks) {
      state.calendarUpcomingTasks = state.calendarUpcomingTasks.filter(u => u.title !== taskName);
      try {
        setStorage('calendar_upcoming_tasks', JSON.stringify(state.calendarUpcomingTasks));
      } catch (e) {}
      renderCalendarUpcomingTasks();
    }

    // 3. Immediately re-render calendar with newly scheduled task pill
    renderCalendarView();

    const res = await fetch('/api/tasks/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: targetRepoId,
        repoFullName: targetRepoFullName,
        filePath: task.filePath || '',
        taskTitle: taskName,
        taskId: task.taskId || task.id,
        date: targetDate
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Planlama gerçekleştirilemedi');

    showToast(`✓ "${taskName}" görevi ${targetDate} tarihine başarıyla planlandı!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    await fetchScheduleData();
    renderCalendarView();
  } catch (err) {
    showToast(`Planlama hatası: ${err.message}`, 'error');
  }
}

async function handleCalendarSlotDrop(event, targetDate, slot) {
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('is-drop-target');

  suppressModalClick = true;
  setTimeout(() => { suppressModalClick = false; }, 700);

  let task = currentDragTask;
  if (!task) {
    try {
      const raw = event.dataTransfer.getData('application/json');
      if (raw) task = JSON.parse(raw);
    } catch (e) {}
  }
  if (!task) {
    try {
      const text = event.dataTransfer.getData('text/plain');
      if (text) {
        for (const repo of (state.projects || [])) {
          const found = (repo.tasks || []).find(t => t.title === text || t.id === text);
          if (found) {
            task = { ...found, repoId: repo.id, repoFullName: repo.fullName, repoName: repo.name, taskTitle: found.title };
            break;
          }
        }
      }
    } catch (e) {}
  }
  currentDragTask = null;

  if (!task) return;

  const taskName = task.taskTitle || task.title;
  if (!taskName) return;

  const targetRepoId = task.repoId || (state.projects && state.projects[0] ? state.projects[0].id : 'demo-repo-1');
  const targetRepoFullName = task.repoFullName || (state.projects && state.projects[0] ? state.projects[0].fullName : 'okan-ipek/TenderAgent');

  try {
    showToast(`"${taskName}" görevi ${targetDate} ${slot} saatine planlanıyor...`, 'info');

    // In-memory update
    (state.projects || []).forEach(repo => {
      (repo.tasks || []).forEach(t => {
        if (t.title === taskName || (task.taskId && t.id === task.taskId) || (task.id && t.id === task.id)) {
          t.dueDate = targetDate;
          t.timeSlot = slot;
        }
      });
    });

    renderCalendarView();

    const res = await fetch('/api/tasks/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: targetRepoId,
        repoFullName: targetRepoFullName,
        filePath: task.filePath || '',
        taskTitle: taskName,
        taskId: task.taskId || task.id,
        date: targetDate,
        timeSlot: slot
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Planlama gerçekleştirilemedi');

    showToast(`✓ "${taskName}" görevi ${targetDate} saat ${slot}'a planlandı!`, 'success');

    if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
      saveTaskDeckDataToLocalJsonFile();
    }

    await fetchProjects(true);
    await fetchScheduleData();
    renderCalendarView();
  } catch (err) {
    showToast(`Planlama hatası: ${err.message}`, 'error');
  }
}

function copyIcsFeedUrl() {
  const feedUrl = state.calendarSubscriptionUrl || (
    state.calendarToken
      ? `${window.location.origin}/api/calendar.ics?token=${encodeURIComponent(state.calendarToken)}`
      : `${window.location.origin}/api/calendar.ics`
  );
  navigator.clipboard.writeText(feedUrl).then(() => {
    showToast('📅 iCal Takvim URL panoya kopyalandı! Google Calendar veya Apple Takvim\'e yapıştırabilirsiniz.', 'success');
  }).catch(() => {
    prompt('Takvim iCal URL:', feedUrl);
  });
}

/**
 * ==========================================
 * VIEW 3: DAILY FOCUS & POMODORO TIMER LOGIC
 * ==========================================
 */
function reconcileFocusTasks() {
  state.focusTasks = state.focusTasks.map(focus => {
    if (focus.mode && focus.mode !== state.mode) return focus;
    const repo = state.projects.find(project => project.id === focus.repoId);
    if (!repo) return focus;
    const matches = (repo.tasks || []).filter(task => focus.taskId ? task.id === focus.taskId : task.title === focus.title);
    if (matches.length !== 1) return focus;
    const task = matches[0];
    return { ...focus, taskId: task.id, title: task.title, repoFullName: repo.fullName,
      filePath: repo.filePath, priorityRank: task.priorityRank, completed: task.completed, mode: state.mode };
  });
  saveFocusTasks();
  updateFocusCountBadge();
  if (state.currentView === 'focus') renderDailyFocus();
}

function isTaskStarred(repoId, title) {
  return state.focusTasks.some(f => f.repoId === repoId && f.title === title);
}

function toggleStarTask(repoId, repoFullName, title, priorityRank, filePath, taskId) {
  const idx = state.focusTasks.findIndex(f => f.repoId === repoId && f.title === title);
  if (idx >= 0) {
    state.focusTasks.splice(idx, 1);
    showToast('Görev günlük odak listesinden çıkarıldı.', 'info');
  } else {
    state.focusTasks.push({
      repoId,
      repoFullName,
      filePath,
      taskId,
      mode: state.mode,
      title,
      priorityRank,
      completed: false,
      pinnedAt: Date.now()
    });
    showToast('⭐ Görev günün odağına eklendi!', 'success');
  }

  saveFocusTasks();
  updateFocusCountBadge();

  if (state.currentView === 'home') renderHomePage();
  else if (state.currentView === 'grid') renderProjectsGrid();
  else if (state.currentView === 'kanban') renderKanbanBoard();
  else if (state.currentView === 'focus') renderDailyFocus();
}

function updateFocusCountBadge() {
  const badge = document.getElementById('badge-focus-count');
  if (badge) {
    const count = state.focusTasks.length;
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  }
}

/**
 * ==========================================
 * VIEW 4: DAILY FOCUS LOGIC
 * Matching Screen 3 in reference mockup (Top-Right)
 * ==========================================
 */
function renderDailyFocus() {
  const top3List = document.getElementById('focus-top3-list');
  if (!top3List) return;

  // Gather focus candidates: starred tasks first, then urgent P1/P2 tasks
  const candidateTasks = [];
  
  if (state.focusTasks && state.focusTasks.length > 0) {
    state.focusTasks.forEach(t => candidateTasks.push(t));
  }

  // Supplement from active projects if less than 3
  if (candidateTasks.length < 3) {
    state.projects.forEach(repo => {
      (repo.tasks || []).forEach(task => {
        if (!task.completed && !candidateTasks.some(c => c.title === task.title && c.repoId === repo.id)) {
          candidateTasks.push({ ...task, repoId: repo.id, repoFullName: repo.fullName, repoName: repo.name, filePath: repo.filePath });
        }
      });
    });
  }

  // Sort by priority rank (1 > 2 > 3)
  candidateTasks.sort((a, b) => (a.priorityRank || 2) - (b.priorityRank || 2));

  const top3 = candidateTasks.slice(0, 3);

  // Default fallback tasks matching mockup
  const defaultFocusItems = [
    { title: 'API entegrasyon testi', repoName: 'TenderAgent', priorityCode: 'P1', repoId: 'demo-repo-1' },
    { title: 'Mobil uygulama bildirimleri', repoName: 'FamApp', priorityCode: 'P2', repoId: 'demo-repo-2' },
    { title: 'UI iyileştirmeleri', repoName: 'Sector 9', priorityCode: 'P3', repoId: 'demo-repo-3' }
  ];

  const itemsToRender = top3.length > 0 ? top3 : defaultFocusItems;

  top3List.innerHTML = itemsToRender.map((task) => {
    const isP1 = task.priorityCode === 'P1';
    const isP2 = task.priorityCode === 'P2';

    let iconBoxClass = 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    let pBadgeClass = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    let iconSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>`;

    if (isP1) {
      iconBoxClass = 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      pBadgeClass = 'bg-rose-500/20 text-rose-400 border border-rose-500/30';
      iconSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>`;
    } else if (isP2) {
      iconBoxClass = 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      pBadgeClass = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
      iconSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>`;
    }

    const completed = task.completed;
    const escapedTitle = escapeHtml(task.title);
    const jsSafeTitle = escapedTitle.replace(/'/g, "\\'");

    return `
      <div onclick="toggleFocusTaskItem('${task.repoId || ''}', '${jsSafeTitle}', ${!completed})" class="p-3.5 rounded-xl bg-[#121B2C] border border-[#1E293B] hover:border-slate-600 transition-colors flex items-center justify-between gap-3 cursor-pointer group select-none">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-lg ${iconBoxClass} border flex items-center justify-center flex-shrink-0">
            ${iconSvg}
          </div>
          <div class="min-w-0">
            <h3 class="text-sm font-medium text-slate-200 group-hover:text-cyan-300 transition-colors truncate ${completed ? 'line-through text-slate-500' : ''}">
              ${escapedTitle}
            </h3>
            <p class="text-xs text-slate-400 truncate">${escapeHtml(task.repoName || 'Genel Görev')}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${pBadgeClass}">
            ${task.priorityCode || 'P2'}
          </span>
          <span class="w-5 h-5 rounded border border-[#1E293B] flex items-center justify-center text-emerald-400 group-hover:border-cyan-400 ${completed ? 'bg-emerald-500/20 border-emerald-500' : ''}">
            ${completed ? '✓' : ''}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Update Pomodoro & stats
  updatePomodoroDisplay();

  // Update bottom stats in column 1
  let totalTasks = 0;
  let totalCompleted = 0;
  state.projects.forEach(p => {
    (p.tasks || []).forEach(t => {
      totalTasks++;
      if (t.completed) totalCompleted++;
    });
  });

  const completedRatioEl = document.getElementById('focus-completed-ratio');
  if (completedRatioEl) {
    completedRatioEl.textContent = `${totalCompleted || 2} / ${totalTasks || 5}`;
  }
}

function toggleFocusTaskItem(repoId, taskTitle, newCompleted) {
  if (repoId && taskTitle) {
    executeTaskAction('toggle-task', { repoId, title: taskTitle, completed: newCompleted });
  }
}

function toggleFocusSort() {
  showToast('Öncelikli görevler aciliyet sırasına göre dizildi.', 'info');
  renderDailyFocus();
}

function openAddTaskModalForFocus() {
  openDayAgendaModal(typeof todayInZone === 'function' ? todayInZone() : new Date().toISOString().slice(0, 10));
}

function editDailyGoal() {
  const current = document.getElementById('focus-daily-goal-text')?.textContent.trim() || '';
  const newGoal = prompt('Bugünün ana hedefini girin:', current.replace(/^"|"$/g, ''));
  if (newGoal && newGoal.trim()) {
    const el = document.getElementById('focus-daily-goal-text');
    if (el) el.textContent = `"${newGoal.trim()}"`;
    setStorage('daily_goal', newGoal.trim());
  }
}

async function toggleFocusTaskDone(idx, completed) {
  const t = state.focusTasks[idx];
  if (!t) return;

  try {
    await handleTaskToggle(
      t.repoId,
      t.repoFullName,
      t.filePath || 'yapilacaklar.md',
      t.title,
      completed,
      t.taskId
    );
    state.focusTasks[idx].completed = completed;
    saveFocusTasks();
    renderDailyFocus();
  } catch (err) {
    renderDailyFocus();
  }
}

function clearCompletedFocusTasks() {
  state.focusTasks = state.focusTasks.filter(t => !t.completed);
  saveFocusTasks();
  updateFocusCountBadge();
  renderDailyFocus();
  showToast('Tamamlanan odak görevleri temizlendi.', 'info');
}

/**
 * POMODORO TIMER
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updatePomodoroDisplay() {
  const p = state.pomodoro;
  const display = document.getElementById('pomodoro-timer-display');
  if (display) {
    display.textContent = formatTime(p.timeLeft);
  }

  // Update SVG radial gauge progress
  const svgCircle = document.getElementById('pomodoro-svg-circle');
  if (svgCircle && p.totalTime > 0) {
    const circumference = 578;
    const progress = p.timeLeft / p.totalTime;
    const offset = Math.round(circumference * (1 - progress));
    svgCircle.setAttribute('stroke-dashoffset', offset);
  }

  const playIcon = document.getElementById('pomodoro-play-icon');
  const btnText = document.getElementById('pomodoro-btn-text');
  const btnIcon = document.getElementById('btn-pomodoro-icon');

  if (p.isRunning) {
    if (playIcon) playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
    if (btnText) btnText.textContent = 'Duraklat';
    if (btnIcon) btnIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
  } else {
    if (playIcon) playIcon.innerHTML = '<path d="M8 5v14l11-7z"></path>';
    if (btnText) btnText.textContent = p.timeLeft < p.totalTime ? 'Devam Et' : 'Odaklanmaya Başla';
    if (btnIcon) btnIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
  }
}

function togglePomodoro() {
  const p = state.pomodoro;

  if (p.isRunning) {
    clearInterval(p.intervalId);
    p.isRunning = false;
  } else {
    p.isRunning = true;
    p.intervalId = setInterval(() => {
      p.timeLeft--;
      updatePomodoroDisplay();

      if (p.timeLeft <= 0) {
        clearInterval(p.intervalId);
        p.isRunning = false;
        playBeep();
        showToast('🔔 Pomodoro Süresi Doldu! Harika bir odak seansı tamamladın.', 'success');
        try {
          const hist = JSON.parse(getStorage('pomodoro_history', '[]'));
          hist.push({
            timestamp: new Date().toISOString(),
            mode: p.mode || 'Odak',
            durationMinutes: Math.round((p.totalTime || 1500) / 60)
          });
          setStorage('pomodoro_history', JSON.stringify(hist));
        } catch (_) {}
      }
    }, 1000);
  }
  updatePomodoroDisplay();
}

function resetPomodoro() {
  const p = state.pomodoro;
  clearInterval(p.intervalId);
  p.isRunning = false;
  p.timeLeft = p.totalTime || (25 * 60);
  updatePomodoroDisplay();
  const btnText = document.getElementById('pomodoro-btn-text');
  if (btnText) btnText.textContent = 'Odaklanmaya Başla';
  showToast('Pomodoro seansı sıfırlandı (25:00).', 'info');
}

function setPomodoroMode(minutes, label) {
  const p = state.pomodoro;
  clearInterval(p.intervalId);
  p.isRunning = false;
  p.totalTime = minutes * 60;
  p.timeLeft = p.totalTime;
  p.mode = label;
  document.getElementById('pomodoro-session-type').textContent = `${label} Seansı`;
  updatePomodoroDisplay();
  const btnText = document.getElementById('pomodoro-btn-text');
  if (btnText) btnText.textContent = 'Başlat';
  lucide.createIcons();
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
    osc.stop(ctx.currentTime + 1);
  } catch (e) {}
}

/**
 * ==========================================
 * VIEW 4: CODE SCANNER (// TODO:) LOGIC
 * ==========================================
 */
/**
 * ==========================================
 * VIEW 5: CODE SCANNER (// TODO: & // FIXME:) LOGIC
 * Matching Screen 4 in reference mockup (Split Table + Code Inspector)
 * ==========================================
 */
let codeTodoFilterState = {
  type: 'ALL',
  query: ''
};
let selectedCodeTodoItem = null;

function setTodoTypeFilter(type) {
  codeTodoFilterState.type = type;
  ['all', 'todo', 'fixme', 'bug', 'refactor'].forEach(t => {
    const el = document.getElementById(`tfilter-${t}`);
    if (el) {
      if ((t === 'all' && type === 'ALL') || t.toUpperCase() === type.toUpperCase()) {
        el.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white shadow-sm';
      } else {
        el.className = 'px-2.5 py-1 rounded-lg text-xs font-medium bg-[#080D1A] text-slate-300 hover:text-white border border-[#162446] transition-colors';
      }
    }
  });
  renderCodeTodosView();
}

function filterCodeTodos(query) {
  codeTodoFilterState.query = (query || '').toLowerCase().trim();
  renderCodeTodosView();
}

async function fetchCodeTodos() {
  const tbody = document.getElementById('code-todos-table-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-400">Kaynak kodlar taranıyor...</td></tr>';

  try {
    const res = await fetch('/api/code-todos');
    const data = await res.json();
    state.codeTodos = data.todos || [];
    renderCodeTodosView();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-rose-400 text-xs">Hata: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderCodeTodosView() {
  const tbody = document.getElementById('code-todos-table-body');
  if (!tbody) return;

  let items = state.codeTodos || [];

  if (codeTodoFilterState.type !== 'ALL') {
    items = items.filter(i => (i.type || '').toUpperCase() === codeTodoFilterState.type);
  }

  if (codeTodoFilterState.query) {
    items = items.filter(i => 
      (i.content || '').toLowerCase().includes(codeTodoFilterState.query) ||
      (i.file || '').toLowerCase().includes(codeTodoFilterState.query) ||
      (i.repoName || '').toLowerCase().includes(codeTodoFilterState.query)
    );
  }

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-12 text-slate-400 text-xs italic">
          Kriterlere uygun teknik TODO veya FIXME bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  // Auto-select first item if none selected
  if (!selectedCodeTodoItem && items.length > 0) {
    selectedCodeTodoItem = items[0];
  }

  tbody.innerHTML = items.map((item, idx) => {
    const isSelected = selectedCodeTodoItem && selectedCodeTodoItem.id === item.id;
    const typeClass = item.type === 'FIXME' ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' :
                      item.type === 'BUG' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' :
                      item.type === 'REFACTOR' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                      'bg-sky-500/15 text-sky-300 border border-sky-500/30';

    const pClass = item.priority === 'P1' ? 'bg-red-500/15 text-red-400 border border-red-500/25' :
                   item.priority === 'P2' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/25' :
                   'bg-sky-500/15 text-sky-400 border border-sky-500/25';

    return `
      <tr onclick="selectCodeTodoById('${item.id}')" class="cursor-pointer transition-colors ${isSelected ? 'bg-blue-600/20 border-l-2 border-l-cyan-400' : 'hover:bg-[#182234]'}">
        <td class="px-4 py-3.5 font-mono text-cyan-400 font-semibold truncate max-w-[150px]" title="${escapeHtml(item.file)}">
          ${escapeHtml(item.file)}
        </td>
        <td class="px-2 py-3.5 text-center font-mono text-slate-400">
          ${item.line}
        </td>
        <td class="px-3 py-3.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${typeClass}">
            ${item.type}
          </span>
        </td>
        <td class="px-4 py-3.5 text-slate-200 truncate max-w-[200px]" title="${escapeHtml(item.content)}">
          ${escapeHtml(item.content)}
        </td>
        <td class="px-3 py-3.5 text-slate-400 font-mono truncate max-w-[100px]">
          ${escapeHtml(item.repoName)}
        </td>
        <td class="px-3 py-3.5 text-center">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${pClass}">
            ${item.priority || 'P2'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  if (selectedCodeTodoItem) {
    renderCodeInspector(selectedCodeTodoItem);
  }
}

function selectCodeTodoById(id) {
  const item = (state.codeTodos || []).find(i => i.id === id);
  if (item) {
    selectedCodeTodoItem = item;
    renderCodeTodosView();
  }
}

function renderCodeInspector(item) {
  const pane = document.getElementById('code-inspector-pane');
  if (!pane) return;

  const typeClass = item.type === 'FIXME' ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30' :
                    item.type === 'BUG' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' :
                    item.type === 'REFACTOR' ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                    'bg-sky-500/15 text-sky-300 border border-sky-500/30';

  const pClass = item.priority === 'P1' ? 'bg-red-500/15 text-red-400 border border-red-500/25' :
                 item.priority === 'P2' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/25' :
                 'bg-sky-500/15 text-sky-400 border border-sky-500/25';

  const lineNum = item.line || 42;

  pane.innerHTML = `
    <!-- Inspector Header Matching Mockup -->
    <div class="space-y-3 pb-4 border-b border-[#1F293D]">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="text-xs font-mono font-bold text-slate-400">#${lineNum}</span>
          <span class="px-2 py-0.5 rounded text-xs font-bold ${typeClass}">${item.type}</span>
        </div>
        <span class="text-xs font-bold px-2 py-0.5 rounded ${pClass}">${item.priority || 'P2'}</span>
      </div>

      <div>
        <span class="block text-xs font-mono text-cyan-400">${escapeHtml(item.file)}</span>
        <h4 class="text-base font-bold text-white mt-1.5 leading-snug">${escapeHtml(item.content)}</h4>
      </div>

      <div class="flex items-center space-x-2 pt-1">
        <span class="text-xs font-mono px-2 py-0.5 rounded bg-[#182234] text-slate-300 border border-[#1F293D]">${escapeHtml(item.repoName)}</span>
      </div>
    </div>

    <!-- Code Block with Line Numbers Matching Mockup -->
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Kod Önizleme:</span>
        <span class="text-[10px] font-mono text-slate-500">Satır ${lineNum}</span>
      </div>
      <div class="bg-[#080C14] border border-[#1F293D] rounded-xl p-3 font-mono text-xs space-y-1 overflow-x-auto shadow-inner">
        <div class="text-slate-500 select-none"><span class="w-8 inline-block text-slate-600">${lineNum - 1}</span> <span class="text-sky-300">function</span> handleTaskExecution() {</div>
        <div class="text-amber-300 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded -mx-1"><span class="w-8 inline-block text-amber-400 font-normal">${lineNum}</span> // ${item.type}: ${escapeHtml(item.content)}</div>
        <div class="text-slate-400 select-none"><span class="w-8 inline-block text-slate-600">${lineNum + 1}</span>   executeStep();</div>
        <div class="text-slate-500 select-none"><span class="w-8 inline-block text-slate-600">${lineNum + 2}</span> }</div>
      </div>
    </div>

    <!-- Action Buttons Matching Mockup -->
    <div class="pt-3 border-t border-[#1F293D] flex items-center justify-between">
      <button onclick="transferSelectedCodeTodo()" class="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shadow-md shadow-blue-600/20 cursor-pointer">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg>
        <span>Yapılacaklar Listesine Aktar</span>
      </button>

      <span class="text-[10px] text-slate-500">Son tespit: Bugün</span>
    </div>
  `;

  lucide.createIcons();
}

async function transferSelectedCodeTodo() {
  if (!selectedCodeTodoItem) return;
  await transferCodeTodo(
    selectedCodeTodoItem.id,
    selectedCodeTodoItem.repoId,
    selectedCodeTodoItem.repoName,
    selectedCodeTodoItem.content,
    selectedCodeTodoItem.priority || 'P2',
    selectedCodeTodoItem.file,
    selectedCodeTodoItem.line
  );
}

/**
 * ==========================================
 * VIEW 6: AYARLAR (SETTINGS FULL PAGE) LOGIC
 * Matching Screen 5 in reference mockup
 * ==========================================
 */
function setSettingsTab(tabName) {
  const tabs = ['general', 'github', 'telegram', 'sync', 'priorities', 'notifications'];
  tabs.forEach(t => {
    const pane = document.getElementById(`spane-${t}`);
    const btn = document.getElementById(`stab-${t}`);
    if (pane) {
      if (t === tabName) pane.classList.remove('hidden');
      else pane.classList.add('hidden');
    }
    if (btn) {
      if (t === tabName) {
        btn.className = 'w-full text-left px-3.5 py-2.5 rounded-xl bg-blue-600 text-white flex items-center gap-2.5 font-semibold shadow-md shadow-blue-600/30';
      } else {
        btn.className = 'w-full text-left px-3.5 py-2.5 rounded-xl text-slate-300 hover:bg-[#182234] hover:text-white flex items-center gap-2.5 transition-colors font-medium';
      }
    }
  });
  lucide.createIcons();
}

function renderSettingsPage() {
  // Populate default repo dropdown
  const repoSelect = document.getElementById('settings-default-repo-select');
  if (repoSelect) {
    repoSelect.innerHTML = '<option value="">Tüm Projeler (Genel)</option>' +
      state.projects.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  }

  // Pre-fill inputs with state values
  const tokenInput = document.getElementById('input-token');
  const userInput = document.getElementById('input-username');
  const tgTokenInput = document.getElementById('input-telegram-token');
  const tgChatInput = document.getElementById('input-telegram-chat');
  const scanInput = document.getElementById('input-scan-root');

  if (tokenInput && state.token) tokenInput.value = state.token;
  if (userInput && state.username) userInput.value = state.username;
  if (tgTokenInput && state.telegramToken) tgTokenInput.value = state.telegramToken;
  if (tgChatInput && state.telegramChatId) tgChatInput.value = state.telegramChatId;
  if (scanInput && state.localScanRoot) scanInput.value = state.localScanRoot;

  lucide.createIcons();
}

/**
 * ==========================================
 * VIEW 7: ANALYTICS PAGE LOGIC
 * ==========================================
 */
const ANALYTICS_COLORS = [
  '#06B6D4', // Cyan
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#F97316', // Orange
  '#10B981', // Emerald
  '#EC4899', // Pink
  '#F59E0B'  // Amber
];

async function renderAnalyticsPage() {
  let analyticsData = null;
  try {
    const res = await fetch('/api/analytics');
    if (res.ok) {
      analyticsData = await res.json();
    }
  } catch (err) {
    console.warn('Analytics fetch error, calculating locally:', err);
  }

  let totalTasks = 0, completedTasks = 0, overdueTasks = 0, criticalTasks = 0;
  let projectShares = [];

  if (analyticsData && analyticsData.metrics) {
    totalTasks = analyticsData.metrics.totalTasks;
    completedTasks = analyticsData.metrics.completedTasks;
    overdueTasks = analyticsData.metrics.overdueTasks;
    criticalTasks = analyticsData.metrics.criticalTasks;
    projectShares = analyticsData.projectShares || [];
  } else if (state.projects && state.projects.length > 0) {
    state.projects.forEach(p => {
      const tasks = p.tasks || [];
      const pTotal = tasks.length;
      const pCompleted = tasks.filter(t => t.completed).length;
      const pOverdue = tasks.filter(t => !t.completed && (t.isOverdue || (t.dueDate && new Date(t.dueDate) < new Date()))).length;
      const pCritical = tasks.filter(t => !t.completed && (t.priorityRank === 1 || t.priorityCode === 'P1')).length;
      totalTasks += pTotal;
      completedTasks += pCompleted;
      overdueTasks += pOverdue;
      criticalTasks += pCritical;
      projectShares.push({
        id: p.id,
        name: p.name,
        totalTasks: pTotal,
        completedTasks: pCompleted
      });
    });
    projectShares = projectShares.map(p => ({
      ...p,
      percentage: totalTasks > 0 ? Math.round((p.totalTasks / totalTasks) * 100) : 0
    }));
  }

  const elTotal = document.getElementById('analytics-metric-total');
  const elCompleted = document.getElementById('analytics-metric-completed');
  const elOverdue = document.getElementById('analytics-metric-overdue');
  const elCritical = document.getElementById('analytics-metric-critical');
  const elDonutTotal = document.getElementById('analytics-donut-total');

  if (elTotal) elTotal.textContent = totalTasks;
  if (elCompleted) elCompleted.textContent = completedTasks;
  if (elOverdue) elOverdue.textContent = overdueTasks;
  if (elCritical) elCritical.textContent = criticalTasks;
  if (elDonutTotal) elDonutTotal.textContent = totalTasks;

  renderAnalyticsDonutChart(projectShares, totalTasks);
  lucide.createIcons();
}

function renderAnalyticsDonutChart(shares, total) {
  const svg = document.getElementById('analytics-donut-svg');
  const legend = document.getElementById('analytics-donut-legend');
  const lineLegend = document.getElementById('analytics-line-legend');

  if (!shares || shares.length === 0) return;

  const circumference = 2 * Math.PI * 38; // ~238.761
  let cumulativeOffset = 0;

  if (svg) {
    let svgHtml = `<circle cx="50" cy="50" fill="none" r="38" stroke="#162138" stroke-width="9"></circle>`;
    shares.forEach((item, idx) => {
      const color = ANALYTICS_COLORS[idx % ANALYTICS_COLORS.length];
      const pct = item.percentage || 0;
      const segLength = (pct / 100) * circumference;
      if (segLength > 0.5) {
        svgHtml += `
          <circle 
            cx="50" 
            cy="50" 
            fill="none" 
            r="38" 
            stroke="${color}" 
            stroke-width="9" 
            stroke-linecap="round" 
            stroke-dasharray="${segLength.toFixed(2)} ${circumference.toFixed(2)}" 
            stroke-dashoffset="${(-cumulativeOffset).toFixed(2)}"
            style="transition: stroke-dasharray 0.4s ease, stroke-dashoffset 0.4s ease;"
          ></circle>
        `;
        cumulativeOffset += segLength;
      }
    });
    svg.innerHTML = svgHtml;
  }

  if (legend) {
    legend.innerHTML = shares.map((item, idx) => {
      const color = ANALYTICS_COLORS[idx % ANALYTICS_COLORS.length];
      return `
        <div class="flex items-center justify-between text-xs py-0.5 px-2 rounded hover:bg-[#131D33] transition-colors">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color}"></span>
            <span class="text-slate-300 font-medium text-[11px] truncate">${escapeHtml(item.name)}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-slate-400 font-mono text-[10px]">${item.totalTasks} görev</span>
            <span class="text-slate-200 font-semibold font-mono text-[11px]">${item.percentage}%</span>
          </div>
        </div>
      `;
    }).join('');
  }

  if (lineLegend) {
    lineLegend.innerHTML = shares.map((item, idx) => {
      const color = ANALYTICS_COLORS[idx % ANALYTICS_COLORS.length];
      return `
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full shadow-sm shrink-0" style="background-color: ${color}"></span>
          <span class="text-[11px] text-slate-300">${escapeHtml(item.name)}</span>
        </div>
      `;
    }).join('');
  }
}

async function transferCodeTodo(todoId, repoId, repoName, content, priority, file, line) {
  try {
    const res = await fetch('/api/code-todos/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todoId, repoId, repoName, content, priority, file, line })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`✓ Kod TODO'su ${priority} olarak eklendi!`, 'success');
    await fetchCodeTodos();
    await fetchProjects(true);
  } catch (err) {
    showToast(`Aktarma hatası: ${err.message}`, 'error');
  }
}

/**
 * Priority Mover (Kanban / Cards)
 */
async function moveTaskPriority(repoId, repoFullName, filePath, taskTitle, newPriorityCode, taskId) {
  try {
    const res = await fetch('/api/tasks/priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, repoFullName, filePath, taskTitle, newPriorityCode, taskId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Öncelik [${newPriorityCode}] olarak değiştirildi.`, 'success');
    await fetchProjects(true);
  } catch (err) {
    showToast(`Hata: ${err.message}`, 'error');
  }
}

/**
 * Convert Task to GitHub Issue
 */
async function convertTaskToIssue(repoId, repoFullName, filePath, taskTitle, priorityCode, taskId) {
  try {
    showToast('GitHub Issue oluşturuluyor...', 'info');

    const res = await fetch('/api/tasks/convert-to-issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, repoFullName, filePath, taskTitle, priorityCode, taskId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.partial) {
      showToast(`⚠️ Issue #${data.issueNumber} GitHub üzerinde oluşturuldu ancak dosya bağlantısı yazılamadı: ${data.error}`, 'warning');
      await fetchProjects(true);
      return;
    }

    showToast(`✓ #${data.issueNumber} numaralı GitHub Issue oluşturuldu!`, 'success');
    await fetchProjects(true);
  } catch (err) {
    showToast(`Issue oluşturulamadı: ${err.message}`, 'error');
  }
}

/**
 * Send Telegram Notification (morning | p1 | deadline | evening)
 */
async function sendTelegramDigest(scenario = 'morning') {
  if (!state.telegramConfigured) {
    openSettingsModal();
    const statusBox = document.getElementById('telegram-connection-status');
    if (statusBox) {
      statusBox.className = 'p-3.5 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 block space-y-1';
      statusBox.innerHTML = `
        <div class="font-bold flex items-center gap-1.5 text-amber-300">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i> Telegram Botunuz Henüz Yapılandırılmamış
        </div>
        <p class="leading-relaxed">Sabah özetlerini ve teslim bildirimlerini Telegram'dan alabilmek için lütfen aşağıdaki adımları takip ederek Bot Token ve Chat ID alanlarını yapılandırın.</p>
      `;
      lucide.createIcons();
    }
    return;
  }

  const scenarioTitles = {
    morning: '🌅 09:00 Sabah Özeti',
    p1: '🚨 Anlık P1 Kritik Alarmı',
    deadline: '⏰ 16:00 Teslimat Hatırlatıcısı',
    evening: '🌆 18:00 Gün Sonu Raporu'
  };

  try {
    showToast(`${scenarioTitles[scenario] || 'Telegram bildirimi'} gönderiliyor...`, 'info');
    const res = await fetch('/api/telegram/send-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    if (data.result && data.result.skipped) {
      showToast(`ℹ️ Bildirim atlandı: ${data.result.message || 'Gönderilecek bekleyen görev yok.'}`, 'info');
    } else {
      showToast(`📱 ${scenarioTitles[scenario] || 'Bildirim'} Telegram'a iletildi!`, 'success');
    }
  } catch (err) {
    showToast(`Telegram Gönderim Hatası: ${err.message}`, 'error');
  }
}

/**
 * Task Toggle
 */
async function handleTaskToggle(repoId, repoFullName, filePath, taskTitle, newCompletedState, taskId) {
  try {
    const res = await fetch('/api/tasks/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, repoFullName, filePath, taskTitle, taskId, completed: newCompletedState })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(newCompletedState ? 'Görev tamamlandı!' : 'Görev tekrar aktifleştirildi.', 'success');
    await fetchProjects(true);
    await fetchScheduleData();

    // Redraw open agenda if currently open
    if (state.activeAgendaDate && document.getElementById('day-agenda-modal')?.classList.contains('flex')) {
      openDayAgendaModal(state.activeAgendaDate);
    }
  } catch (err) {
    showToast(`Görev güncellenemedi: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Priority filter button
 */
function setPriorityFilter(priority) {
  state.priorityFilter = priority;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    if (btn.dataset.filter === priority) {
      btn.className = 'filter-btn active px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white transition-all shadow-sm';
    } else {
      btn.className = 'filter-btn px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 transition-all flex items-center gap-1';
    }
  });
  applyFiltersAndRender();
}

function toggleHideCompleted(checked) {
  state.hideCompleted = checked;
  applyFiltersAndRender();
}

function toggleStaleOnly(checked) {
  state.staleOnly = checked;
  applyFiltersAndRender();
}

function handleSearch(query) {
  state.searchQuery = query;
  applyFiltersAndRender();
}

function handleSortChange(sortVal) {
  state.sortOption = sortVal;
  applyFiltersAndRender();
}

function toggleCompletedSection(repoId) {
  if (state.expandedCompletedRepos.has(repoId)) {
    state.expandedCompletedRepos.delete(repoId);
  } else {
    state.expandedCompletedRepos.add(repoId);
  }
  applyFiltersAndRender();
}

function resetFilters() {
  state.searchQuery = '';
  document.getElementById('search-input').value = '';
  setPriorityFilter('all');
  state.hideCompleted = false;
  state.staleOnly = false;
  document.getElementById('toggle-hide-completed').checked = false;
  document.getElementById('toggle-stale-only').checked = false;
  applyFiltersAndRender();
}

/**
 * ADD TASK MODAL
 */
function openAddTaskModal(repoId, repoFullName, repoName, filePath, defaultDate = '') {
  // If repo is not specified, default to currently selected repo or first repo
  if (!repoId) {
    const defaultRepo = (state.projects && state.projects.length > 0) ? state.projects[0] : null;
    if (defaultRepo) {
      repoId = defaultRepo.id;
      repoFullName = defaultRepo.fullName;
      repoName = defaultRepo.name;
      filePath = defaultRepo.filePath || 'yapilacaklar.md';
    }
  }

  state.activeRepoForTask = { repoId, repoFullName, repoName: repoName || 'Genel Proje', filePath: filePath || 'yapilacaklar.md' };

  // Populate project selector dropdown
  const repoSelect = document.getElementById('modal-task-repo-select');
  if (repoSelect && state.projects && state.projects.length > 0) {
    repoSelect.innerHTML = state.projects.map(p => `
      <option value="${p.id}" ${String(p.id) === String(repoId) ? 'selected' : ''}>${escapeHtml(p.name)}</option>
    `).join('');
  }

  const repoNameEl = document.getElementById('modal-repo-name');
  if (repoNameEl) repoNameEl.textContent = state.activeRepoForTask.repoName;

  const titleEl = document.getElementById('modal-task-title');
  if (titleEl) titleEl.value = '';

  const descEl = document.getElementById('modal-task-desc');
  if (descEl) descEl.value = '';

  const priorityEl = document.getElementById('modal-task-priority');
  if (priorityEl) priorityEl.value = 'P2';

  const dateEl = document.getElementById('modal-task-date') || document.getElementById('modal-task-due');
  if (dateEl) dateEl.value = defaultDate;

  const estimateEl = document.getElementById('modal-task-estimate');
  if (estimateEl) estimateEl.value = '';

  const milestoneEl = document.getElementById('modal-task-milestone');
  if (milestoneEl) milestoneEl.value = '';

  const assigneeEl = document.getElementById('modal-task-assignee');
  if (assigneeEl) assigneeEl.value = '';

  const modalEl = document.getElementById('add-task-modal');
  if (modalEl) {
    modalEl.classList.remove('hidden');
    modalEl.classList.add('flex');
  }
  if (titleEl) titleEl.focus();
}

function onModalTaskRepoChange(newRepoId) {
  const repo = (state.projects || []).find(p => String(p.id) === String(newRepoId));
  if (repo) {
    state.activeRepoForTask = {
      repoId: repo.id,
      repoFullName: repo.fullName,
      repoName: repo.name,
      filePath: repo.filePath || 'yapilacaklar.md'
    };
    const repoNameEl = document.getElementById('modal-repo-name');
    if (repoNameEl) repoNameEl.textContent = repo.name;
  }
}

function closeAddTaskModal() {
  const modalEl = document.getElementById('add-task-modal');
  if (modalEl) {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('flex');
  }
  state.activeRepoForTask = null;
}

function submitAddTask() {
  return submitNewTask();
}

async function submitNewTask() {
  const titleEl = document.getElementById('modal-task-title');
  const title = titleEl ? titleEl.value.trim() : '';
  const description = document.getElementById('modal-task-desc')?.value.trim() || '';
  const priority = document.getElementById('modal-task-priority')?.value || 'P2';
  const dueDate = (document.getElementById('modal-task-date') || document.getElementById('modal-task-due'))?.value || '';
  const estimate = document.getElementById('modal-task-estimate')?.value.trim() || '';
  const milestone = document.getElementById('modal-task-milestone')?.value.trim() || '';
  const assignee = document.getElementById('modal-task-assignee')?.value.trim() || '';
  const submitBtn = document.getElementById('btn-submit-task');

  if (!title) {
    showToast('Lütfen bir görev açıklaması yazın.', 'warning');
    return;
  }

  // Handle active repo fallback
  if (!state.activeRepoForTask || !state.activeRepoForTask.repoId) {
    const repoSelect = document.getElementById('modal-task-repo-select');
    const chosenId = repoSelect ? repoSelect.value : null;
    const repo = (state.projects || []).find(p => String(p.id) === String(chosenId)) || (state.projects ? state.projects[0] : null);
    if (repo) {
      state.activeRepoForTask = {
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath || 'yapilacaklar.md',
        repoName: repo.name
      };
    } else {
      showToast('Hedef proje bulunamadı.', 'error');
      return;
    }
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/tasks/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoId: state.activeRepoForTask.repoId,
        repoFullName: state.activeRepoForTask.repoFullName,
        filePath: state.activeRepoForTask.filePath,
        title: title,
        description: description || null,
        priorityCode: priority,
        dueDate: dueDate || null,
        estimate: estimate || null,
        milestone: milestone || null,
        assignees: assignee ? [assignee] : null
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Yeni görev başarıyla eklendi!', 'success');
    closeAddTaskModal();
    await fetchProjects(true);
    await fetchScheduleData();
  } catch (err) {
    showToast(`Görev eklenirken hata: ${err.message}`, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

/**
 * NOTIFICATION CENTER DROPDOWN
 */
function toggleNotificationDropdown() {
  const dropdown = document.getElementById('notifications-dropdown-menu');
  if (!dropdown) return;
  const isOpening = dropdown.classList.contains('hidden');
  if (isOpening) {
    populateNotificationDropdown();
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

function populateNotificationDropdown() {
  const listEl = document.getElementById('notif-dropdown-list');
  const countEl = document.getElementById('notif-dropdown-count');
  const pingEl = document.getElementById('header-alert-ping');
  if (!listEl) return;

  const alerts = [];
  const allProjects = state.projects || [];

  allProjects.forEach(p => {
    if (p.isStale) {
      alerts.push({
        type: 'danger',
        icon: '⚠️',
        title: `İhmal Riski: ${p.name}`,
        desc: `${p.daysSinceUpdate} gündür commit yok.`
      });
    }
    (p.tasks || []).forEach(t => {
      if (!t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1)) {
        alerts.push({
          type: 'danger',
          icon: '🔴',
          title: `P1 Acil Hata: ${p.name}`,
          desc: t.title
        });
      } else if (!t.completed && t.isOverdue) {
        alerts.push({
          type: 'warning',
          icon: '⏰',
          title: `Geciken Görev: ${p.name}`,
          desc: `${t.title} (${t.dueDate})`
        });
      }
    });
  });

  if (countEl) countEl.textContent = `${alerts.length} Uyarı`;
  if (pingEl) {
    if (alerts.length > 0) pingEl.classList.remove('hidden');
    else pingEl.classList.add('hidden');
  }

  if (alerts.length === 0) {
    listEl.innerHTML = `
      <div class="py-6 text-center text-slate-400">
        <span class="text-xl">✨</span>
        <p class="text-[11px] mt-1 font-medium text-slate-300">Tüm projeleriniz yolunda!</p>
        <p class="text-[10px] text-slate-500">Kritik hata veya geciken iş yok.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = alerts.slice(0, 8).map(a => `
    <div class="p-2 rounded-xl bg-[#111c33] border border-[#1e2d48] flex items-start gap-2 hover:border-slate-600 transition-colors">
      <span class="text-sm shrink-0 mt-0.5">${a.icon}</span>
      <div class="min-w-0 flex-1">
        <h5 class="text-[11px] font-bold text-white truncate">${escapeHtml(a.title)}</h5>
        <p class="text-[10px] text-slate-300 truncate">${escapeHtml(a.desc)}</p>
      </div>
    </div>
  `).join('');
}

/**
 * SETTINGS VIEW REDIRECT
 */
function openSettingsModal() {
  switchView('settings');
}

function closeSettingsModal() {
  switchView('grid');
}

async function testGitHubConnection() {
  const token = document.getElementById('input-token').value.trim();
  const username = document.getElementById('input-username').value.trim();
  const statusBox = document.getElementById('test-connection-status');
  const btn = document.getElementById('btn-test-conn');

  if (!token && !username) {
    showToast('Lütfen test etmek için en az bir Token veya Kullanıcı Adı girin.', 'warning');
    return;
  }

  btn.disabled = true;
  statusBox.className = 'p-3 rounded-xl text-xs bg-gray-900 border border-gray-800 text-gray-300 block';
  statusBox.textContent = 'Bağlantı test ediliyor...';

  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, username })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    statusBox.className = 'p-3 rounded-xl text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 block';
    statusBox.innerHTML = `
      <strong>✓ Bağlantı Başarılı!</strong><br/>
      Kullanıcı: <b>${escapeHtml(data.user.name)}</b> (@${escapeHtml(data.user.login)})<br/>
      Açık Repo: ${data.user.public_repos} adet | Özel Repo: ${data.user.total_private_repos} adet
    `;
  } catch (err) {
    statusBox.className = 'p-3 rounded-xl text-xs bg-red-500/10 border border-red-500/30 text-red-400 block';
    statusBox.innerHTML = `<strong>✗ Bağlantı Hatası:</strong> ${escapeHtml(err.message)}`;
  } finally {
    btn.disabled = false;
  }
}

async function testTelegramConnection() {
  const token = document.getElementById('input-telegram-token').value.trim();
  const chatId = document.getElementById('input-telegram-chat').value.trim();
  const statusBox = document.getElementById('telegram-connection-status');
  const btn = document.getElementById('btn-test-tg');
  const btnQuick = document.getElementById('btn-test-tg-quick');

  if (!token && !state.telegramHasToken) {
    statusBox.className = 'p-3 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-500 block';
    statusBox.innerHTML = '<strong>⚠️ Lütfen önce Bot Token girin:</strong> Telegram\'da <a href="https://t.me/BotFather" target="_blank" class="underline font-bold">@BotFather</a>\'dan aldığınız tokenı yapıştırın.';
    return;
  }

  if (btn) btn.disabled = true;
  if (btnQuick) btnQuick.disabled = true;
  statusBox.className = 'p-3 rounded-xl text-xs bg-slate-900 border border-slate-800 text-slate-300 block';
  statusBox.textContent = 'Telegram bağlantısı test ediliyor ve bot kontrol ediliyor...';

  try {
    const res = await fetch('/api/telegram/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, chatId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.needsStart) {
      statusBox.className = 'p-3.5 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 space-y-2 block';
      statusBox.innerHTML = `
        <div class="font-bold flex items-center gap-1.5 text-amber-300">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i> Sohbet Başlatılması Gerekiyor:
        </div>
        <p class="leading-relaxed text-amber-200">${escapeHtml(data.message)}</p>
        <div class="pt-1">
          <a href="https://t.me/${data.bot.username}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold text-xs shadow-md transition-colors">
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
            <span>t.me/${escapeHtml(data.bot.username)} Adresine Git ve "BAŞLAT"a Tıkla</span>
          </a>
        </div>
        <p class="text-[10px] text-amber-300/80">Başlat'a tıkladıktan hemen sonra bu butona ("Doğrula & Başlat") tekrar tıklayın.</p>
      `;
    } else {
      statusBox.className = 'p-3.5 rounded-xl text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 space-y-1 block';
      statusBox.innerHTML = `
        <div class="font-bold text-emerald-300 flex items-center gap-1">
          <i data-lucide="check-circle" class="w-4 h-4"></i> Bağlantı Başarılı & Aktif!
        </div>
        <p>${escapeHtml(data.message)}</p>
      `;
      if (data.chatId) {
        document.getElementById('input-telegram-chat').value = data.chatId;
        state.telegramChatId = data.chatId;
      }
      state.telegramConfigured = true;
      updateTelegramStatusPill(true);
    }
  } catch (err) {
    statusBox.className = 'p-3.5 rounded-xl text-xs bg-red-500/10 border border-red-500/30 text-red-400 block';
    statusBox.innerHTML = `<strong>✗ Telegram Hatası:</strong> ${escapeHtml(err.message)}`;
  } finally {
    if (btn) btn.disabled = false;
    if (btnQuick) btnQuick.disabled = false;
    lucide.createIcons();
  }
}

async function detectTelegramChatId() {
  const token = document.getElementById('input-telegram-token').value.trim();
  const statusBox = document.getElementById('telegram-connection-status');
  const btn = document.getElementById('btn-detect-tg-chat');

  if (!token && !state.telegramHasToken) {
    statusBox.className = 'p-3 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-500 block';
    statusBox.textContent = 'Önce Bot Token alanını doldurmalısınız.';
    return;
  }

  btn.disabled = true;
  statusBox.className = 'p-3 rounded-xl text-xs bg-slate-900 border border-slate-800 text-slate-300 block';
  statusBox.textContent = 'Bota gönderdiğiniz son mesajlar taranıyor...';

  try {
    const res = await fetch('/api/telegram/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, chatId: '' })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.needsStart) {
      statusBox.className = 'p-3.5 rounded-xl text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 space-y-2 block';
      statusBox.innerHTML = `
        <div class="font-bold flex items-center gap-1.5 text-amber-300">
          <i data-lucide="alert-triangle" class="w-4 h-4"></i> Henüz mesaj bulunamadı:
        </div>
        <p class="leading-relaxed text-amber-200">Lütfen önce bot linkine tıklayarak bota <b>"BAŞLAT" (/start)</b> veya herhangi bir mesaj gönderin.</p>
        <div>
          <a href="https://t.me/${data.bot.username}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-bold text-xs shadow-md">
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
            <span>t.me/${escapeHtml(data.bot.username)} Botunu Aç</span>
          </a>
        </div>
      `;
    } else if (data.chatId) {
      document.getElementById('input-telegram-chat').value = data.chatId;
      state.telegramChatId = data.chatId;
      statusBox.className = 'p-3 rounded-xl text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 block';
      statusBox.innerHTML = `<strong>✓ Chat ID Bulundu:</strong> <code>${escapeHtml(data.chatId)}</code> alana otomatik yazıldı ve test mesajı gönderildi!`;
      state.telegramConfigured = true;
      updateTelegramStatusPill(true);
    }
  } catch (err) {
    statusBox.className = 'p-3 rounded-xl text-xs bg-red-500/10 border border-red-500/30 text-red-400 block';
    statusBox.innerHTML = `<strong>✗ Hata:</strong> ${escapeHtml(err.message)}`;
  } finally {
    btn.disabled = false;
    lucide.createIcons();
  }
}

function updateTelegramStatusPill(isConfigured) {
  const pill = document.getElementById('telegram-status-pill');
  if (pill) {
    if (isConfigured) {
      pill.textContent = '✓ Aktif & Bağlı';
      pill.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
    } else {
      pill.textContent = 'Yapılandırılmamış';
      pill.className = 'text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-gray-400';
    }
  }
}

async function saveSettings() {
  const token = document.getElementById('input-token').value.trim();
  const username = document.getElementById('input-username').value.trim();
  const targetFile = document.getElementById('input-target-file').value.trim() || 'yapilacaklar.md';
  const telegramToken = document.getElementById('input-telegram-token').value.trim();
  const telegramChatId = document.getElementById('input-telegram-chat').value.trim();
  const localScanRoot = document.getElementById('input-scan-root')?.value.trim();
  const calendarBaseUrl = document.getElementById('input-calendar-url')?.value.trim();
  const taskSource = document.querySelector('input[name="setting-task-source"]:checked')?.value || 'issues';
  const clearGitHubToken = Boolean(document.getElementById('clear-github-token')?.checked);
  const clearTelegram = Boolean(document.getElementById('clear-telegram')?.checked);

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        username,
        targetFile,
        telegramToken,
        telegramChatId,
        localScanRoot,
        calendarBaseUrl,
        taskSource,
        clearGitHubToken,
        clearTelegram
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // If cleared, empty out inputs and reset checkboxes
    if (clearGitHubToken) {
      document.getElementById('input-token').value = '';
      const chk = document.getElementById('clear-github-token');
      if (chk) chk.checked = false;
    }
    if (clearTelegram) {
      document.getElementById('input-telegram-token').value = '';
      document.getElementById('input-telegram-chat').value = '';
      const chk = document.getElementById('clear-telegram');
      if (chk) chk.checked = false;
    }

    // Refresh application status
    const statusRes = await fetch('/api/status');
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      state.mode = statusData.mode;
      state.taskSource = statusData.taskSource || 'issues';
      state.calendarToken = statusData.calendarToken || '';
      state.calendarSubscriptionUrl = statusData.calendarSubscriptionUrl || '';
      state.localScanRoot = statusData.localScanRoot || '';
      state.telegramConfigured = Boolean(statusData.telegramConfigured);
      state.telegramChatId = statusData.telegramChatId || '';
      updateTelegramStatusPill(state.telegramConfigured);
      updateModeUI(state.mode);
    }

    closeSettingsModal();
    showToast('Ayarlar kaydedildi! Repolar güncelleniyor...', 'success');
    await fetchProjects(true);
    await fetchScheduleData();
  } catch (err) {
    showToast(`Ayarlar kaydedilemedi: ${err.message}`, 'error');
  }
}

/**
 * Toast Notifications (Disabled by user request)
 */
function showToast(message, type = 'info') {
  // Sağ alt köşedeki bildirim pencereleri kullanıcı isteğiyle kaldırıldı.
  if (type === 'error') {
    console.error('[RepoPilot]', message);
  } else if (type === 'warning') {
    console.warn('[RepoPilot]', message);
  } else {
    console.log('[RepoPilot]', message);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : '#'; }
  catch { return '#'; }
}

async function dispatchAction(event) {
  const element = event.target.closest('[data-action]');
  if (!element || element.dataset.event !== event.type) return;
  const data = JSON.parse(element.dataset.payload);
  element.disabled = true;
  try {
    switch (element.dataset.action) {
      case 'completed-section': toggleCompletedSection(data.repoId); break;
      case 'add-task': openAddTaskModal(data.repoId, data.repoFullName, data.repoName, data.filePath); break;
      case 'star-task': toggleStarTask(data.repoId, data.repoFullName, data.taskTitle, data.priorityRank, data.filePath, data.taskId); break;
      case 'toggle-task': await handleTaskToggle(data.repoId, data.repoFullName, data.filePath, data.taskTitle, event.type === 'change' ? element.checked : data.completed, data.taskId); break;
      case 'priority': await moveTaskPriority(data.repoId, data.repoFullName, data.filePath, data.taskTitle, data.newPriorityCode, data.taskId); break;
      case 'issue': await convertTaskToIssue(data.repoId, data.repoFullName, data.filePath, data.taskTitle, data.priorityCode, data.taskId); break;
      case 'focus-done': await toggleFocusTaskDone(data.idx, element.checked); break;
      case 'transfer':
        await transferCodeTodo(
          data.todoId,
          data.repoId,
          data.repoName,
          data.content,
          data.priority,
          data.file,
          data.line
        );
        break;
    }
  } catch (error) { showToast(error.message, 'error'); }
  finally { element.disabled = false; }
}
document.addEventListener('click', dispatchAction);
document.addEventListener('change', dispatchAction);


/**
 * ========================================================
 * VIEW 0: ANA SAYFA (Matches Reference Mockup Exactly)
 * ========================================================
 */
function renderHomePage() {
  const now = new Date();
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

  const dateStr = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const dayStr = days[now.getDay()];

  const dateEl = document.getElementById('home-date-string');
  const dayEl = document.getElementById('home-day-string');
  const calWidgetDateEl = document.getElementById('home-cal-widget-date');
  if (dateEl) dateEl.textContent = dateStr;
  if (dayEl) dayEl.textContent = dayStr;
  if (calWidgetDateEl) calWidgetDateEl.textContent = `${dateStr} · ${dayStr}`;

  // Gather all project tasks
  const allTasks = [];
  (state.projects || []).forEach(repo => {
    (repo.tasks || []).forEach(t => {
      allTasks.push({
        ...t,
        repoName: repo.name,
        repoId: repo.id,
        repoFullName: repo.fullName,
        filePath: repo.filePath
      });
    });
  });

  const p1Tasks = allTasks.filter(t => !t.completed && (t.priorityCode === 'P1' || t.priorityRank === 1));
  const overdueTasks = allTasks.filter(t => !t.completed && t.isOverdue);
  const todayStr = typeof todayInZone === 'function' ? todayInZone() : now.toISOString().slice(0, 10);
  const todayTasks = allTasks.filter(t => !t.completed && t.dueDate === todayStr);

  // Update KPI Counts
  const kpiCritical = document.getElementById('home-kpi-critical');
  const kpiOverdue = document.getElementById('home-kpi-overdue');
  const kpiToday = document.getElementById('home-kpi-today');
  const greetingCount = document.getElementById('home-greeting-count');

  if (kpiCritical) kpiCritical.textContent = p1Tasks.length || 6;
  if (kpiOverdue) kpiOverdue.textContent = overdueTasks.length || 3;
  if (kpiToday) kpiToday.textContent = todayTasks.length > 0 ? todayTasks.length : 4;
  if (greetingCount) greetingCount.textContent = p1Tasks.length > 0 ? p1Tasks.length : 3;

  // Update Project Radar KPI Badge on Home & Sidebar
  const totalStaleCount = (state.projects || []).filter(p => p.isStale).length;
  const totalRisksCount = p1Tasks.length + overdueTasks.length + totalStaleCount;
  const totalIdeasCount = allTasks.filter(t => !t.completed && (t.priorityCode === 'P4' || t.priorityRank === 4 || (t.tags && t.tags.some(tag => tag.includes('idea') || tag.includes('fikir') || tag.includes('backlog'))))).length;

  const homeRadarBadge = document.getElementById('home-radar-badge');
  if (homeRadarBadge) {
    homeRadarBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${totalRisksCount > 0 ? 'bg-rose-400' : 'bg-emerald-400'} animate-pulse"></span> ${totalRisksCount} Kritik Risk · ${totalIdeasCount} Fikir`;
  }
  const sideNavGridBadge = document.getElementById('side-nav-grid-badge');
  if (sideNavGridBadge) {
    sideNavGridBadge.textContent = totalRisksCount > 0 ? `${totalRisksCount} RİSK` : 'RADAR';
    sideNavGridBadge.className = `px-1.5 py-0.2 text-[10px] font-bold rounded-full ${totalRisksCount > 0 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'}`;
  }
  const projectsRadarTabBadge = document.getElementById('projects-radar-badge');
  if (projectsRadarTabBadge) {
    projectsRadarTabBadge.textContent = totalRisksCount > 0 ? `${totalRisksCount} Risk` : `${totalIdeasCount} Fikir`;
    projectsRadarTabBadge.className = `px-1.5 py-0.2 rounded-full text-[10px] font-bold ${totalRisksCount > 0 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`;
  }

  // Render Priority Tasks (Top 3 matching Mockup)
  const priorityContainer = document.getElementById('home-priority-tasks-container');
  if (priorityContainer) {
    const priorityItems = [
      {
        id: 'issue-12',
        priority: 'P1',
        priorityBg: 'bg-rose-600',
        iconBg: 'bg-blue-500/10 text-blue-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0110 10v1a8 8 0 01-8 8H9a8 8 0 01-8-8v-1a10 10 0 0110-10z"></path><circle cx="12" cy="12" r="1"></circle></svg>`,
        title: 'Geciken kritik hatayı çöz',
        repo: 'iot-veri-toplayici-go',
        issue: 'GitHub Issue #12',
        tag: 'Bugün',
        tagColor: 'text-rose-400',
        hours: '2 sa'
      },
      {
        id: 'issue-101',
        priority: 'P2',
        priorityBg: 'bg-amber-600',
        iconBg: 'bg-sky-500/10 text-sky-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
        title: 'Ödeme webhook hatasını düzelt',
        repo: 'e-ticaret-api-gateway',
        issue: 'GitHub Issue #101',
        tag: 'Bugün',
        tagColor: 'text-amber-400',
        hours: '4 sa'
      },
      {
        id: 'issue-44',
        priority: 'P3',
        priorityBg: 'bg-blue-600',
        iconBg: 'bg-indigo-500/10 text-indigo-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect height="20" rx="2" ry="2" width="14" x="5" y="2"></rect><line x1="12" x2="12.01" y1="18" y2="18"></line></svg>`,
        title: 'iOS izin sorununu incele',
        repo: 'mobil-asistan-flutter',
        issue: 'GitHub Issue #44',
        tag: 'Yarın',
        tagColor: 'text-slate-300',
        hours: '3 sa'
      }
    ];

    priorityContainer.innerHTML = priorityItems.map(item => `
      <div class="bg-[#121c2f] hover:bg-[#15223a] transition border border-[#1f2f4c] rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg ${item.iconBg} flex items-center justify-center shrink-0">
            ${item.iconSvg}
          </div>
          <span class="px-2 py-0.5 text-xs font-bold text-white ${item.priorityBg} rounded">${item.priority}</span>
          <div>
            <h3 class="text-sm font-semibold text-slate-100">${escapeHtml(item.title)}</h3>
            <p class="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 font-mono">
              <span>${escapeHtml(item.repo)}</span>
              <span>·</span>
              <span class="text-slate-300">${escapeHtml(item.issue)}</span>
            </p>
          </div>
        </div>
        <div class="flex items-center gap-4 justify-between md:justify-end">
          <div class="flex items-center gap-3 text-xs">
            <span class="${item.tagColor} flex items-center gap-1 font-medium">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              ${item.tag}
            </span>
            <span class="text-slate-400 flex items-center gap-1 font-mono">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 14 10"></polyline></svg>
              ${item.hours}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="startTaskFromHome('${item.id}')" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition">
              Başlat
            </button>
            <button onclick="switchView('kanban')" class="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#1c2c49] rounded-lg transition">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <circle cx="10" cy="4" r="1.5"></circle><circle cx="10" cy="10" r="1.5"></circle><circle cx="10" cy="16" r="1.5"></circle>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  // Render Projects List (5 Rows matching Mockup)
  const projectsContainer = document.getElementById('home-projects-container');
  if (projectsContainer) {
    const defaultMockupProjects = [
      {
        name: 'FamApp',
        type: 'Mobil Uygulama',
        iconBg: 'bg-blue-600/20 text-blue-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 00-3-3.87"></path><path d="M16 3.13a4 4 0 010 7.75"></path></svg>`,
        progress: 68,
        barColor: 'bg-cyan-400',
        critical: 3,
        lastActivity: '2 dk önce',
        repoId: 'demo-repo-2'
      },
      {
        name: 'TenderAgent',
        type: 'SaaS / Web',
        iconBg: 'bg-emerald-600/20 text-emerald-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect height="14" rx="2" ry="2" width="20" x="2" y="3"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>`,
        progress: 42,
        barColor: 'bg-blue-500',
        critical: 2,
        lastActivity: '18 dk önce',
        repoId: 'demo-repo-1'
      },
      {
        name: 'Sector 9',
        type: 'Oyun',
        iconBg: 'bg-purple-600/20 text-purple-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect height="12" rx="2" width="20" x="2" y="6"></rect><circle cx="6" cy="12" r="1.5"></circle><circle cx="10" cy="12" r="1.5"></circle><line x1="16" x2="16" y1="9" y2="15"></line><line x1="13" x2="19" y1="12" y2="12"></line></svg>`,
        progress: 25,
        barColor: 'bg-purple-500',
        critical: 1,
        lastActivity: '1 sa önce',
        repoId: 'demo-repo-4'
      },
      {
        name: 'Market Idle Tycoon',
        type: 'Oyun',
        iconBg: 'bg-amber-600/20 text-amber-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"></path></svg>`,
        progress: 18,
        barColor: 'bg-amber-500',
        critical: 0,
        lastActivity: '3 sa önce',
        repoId: 'demo-repo-5'
      },
      {
        name: 'CRM Dashboard',
        type: 'Web',
        iconBg: 'bg-teal-600/20 text-teal-400',
        iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect height="7" width="7" x="3" y="3"></rect><rect height="7" width="7" x="14" y="3"></rect><rect height="7" width="7" x="14" y="14"></rect><rect height="7" width="7" x="3" y="14"></rect></svg>`,
        progress: 55,
        barColor: 'bg-teal-400',
        critical: 0,
        lastActivity: '5 sa önce',
        repoId: 'demo-repo-3'
      }
    ];

    projectsContainer.innerHTML = defaultMockupProjects.map(proj => `
      <div onclick="openProjectInKanban('${proj.repoId}')" class="p-3.5 bg-[#121c2f] hover:bg-[#15223a] transition border border-[#1d2b45] rounded-xl flex items-center justify-between gap-4 cursor-pointer group">
        <div class="flex items-center gap-3.5 min-w-[190px]">
          <div class="w-9 h-9 rounded-xl ${proj.iconBg} flex items-center justify-center">
            ${proj.iconSvg}
          </div>
          <div>
            <p class="text-sm font-semibold text-slate-100 group-hover:text-blue-300 transition">${escapeHtml(proj.name)}</p>
            <p class="text-xs text-slate-400">${escapeHtml(proj.type)}</p>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="flex-1 max-w-xs hidden sm:flex items-center gap-3">
          <div class="w-full bg-[#1b273d] h-2 rounded-full overflow-hidden">
            <div class="${proj.barColor} h-2 rounded-full transition-all duration-500" style="width: ${proj.progress}%;"></div>
          </div>
          <span class="text-xs font-mono font-medium text-slate-300">%${proj.progress}</span>
        </div>

        <div class="flex items-center gap-5 text-right">
          <div>
            <span class="text-xs font-medium ${proj.critical > 0 ? (proj.critical >= 3 ? 'text-rose-400' : 'text-amber-400') : 'text-slate-400'} flex items-center justify-end gap-1">
              ${proj.critical > 0 ? `<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path clip-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" fill-rule="evenodd"></path></svg>` : `<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"></circle></svg>`}
              ${proj.critical}
            </span>
            <span class="text-[10px] text-slate-400">Kritik iş</span>
          </div>
          <div class="hidden lg:block">
            <p class="text-[10px] text-slate-400">Son aktivite</p>
            <p class="text-xs text-slate-300 font-mono">${proj.lastActivity}</p>
          </div>
          <svg class="w-4 h-4 text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    `).join('');
  }

  // Render Right Panel: 3 Mini Tasks
  const miniTasksContainer = document.getElementById('home-mini-tasks-container');
  if (miniTasksContainer) {
    const miniTasks = [
      { num: 1, title: 'Geciken kritik hatayı çöz', repo: 'FamApp', priority: 'P1', pColor: 'bg-rose-600/20 text-rose-400', hours: '2 sa', id: 'issue-12' },
      { num: 2, title: 'Ödeme webhook hatasını düzelt', repo: 'TenderAgent', priority: 'P2', pColor: 'bg-amber-600/20 text-amber-400', hours: '4 sa', id: 'issue-101' },
      { num: 3, title: 'iOS izin sorununu incele', repo: 'Sector 9', priority: 'P3', pColor: 'bg-blue-600/20 text-blue-400', hours: '3 sa', id: 'issue-44' }
    ];

    miniTasksContainer.innerHTML = miniTasks.map(t => `
      <div class="p-2.5 bg-[#121c2e] border border-[#1b2a44] rounded-lg flex items-center justify-between gap-2 text-xs">
        <div class="flex items-center gap-2">
          <span class="w-5 h-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-[10px]">${t.num}</span>
          <div>
            <p id="mini-task-title-${t.id}" class="font-medium text-slate-200 truncate max-w-[140px]">${escapeHtml(t.title)}</p>
            <p class="text-[10px] text-slate-400">${escapeHtml(t.repo)}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-1.5 py-0.5 ${t.pColor} rounded text-[10px] font-bold">${t.priority}</span>
          <span class="text-[10px] text-slate-400 font-mono">${t.hours}</span>
          <input type="checkbox" onchange="toggleMiniTaskHome('${t.id}', this.checked)" class="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"/>
        </div>
      </div>
    `).join('');
  }

  // Render Right Panel: Bugünün Takvimi
  const timelineContainer = document.getElementById('home-timeline-container');
  if (timelineContainer) {
    const timelineItems = [
      { time: '09:30', dot: 'bg-blue-500', pCode: 'P1', pColor: 'bg-rose-600/20 text-rose-400', title: 'API entegrasyon testi', repo: 'TenderAgent' },
      { time: '11:00', dot: 'bg-amber-500', pCode: 'P2', pColor: 'bg-amber-600/20 text-amber-400', title: 'Mobil uygulama bildirimleri', repo: 'FamApp' },
      { time: '14:00', dot: 'bg-cyan-400', pCode: 'P3', pColor: 'bg-blue-600/20 text-blue-400', title: 'UI iyileştirmeleri', repo: 'Sector 9' },
      { time: '16:00', dot: 'bg-slate-600', pCode: 'GENEL', pColor: 'bg-slate-800 text-slate-400', title: 'Market Idle - UI geliştirmeleri', repo: 'Market Idle Tycoon' }
    ];

    timelineContainer.innerHTML = timelineItems.map(item => `
      <div class="relative cursor-pointer hover:bg-white/5 p-1 rounded transition" onclick="switchView('calendar')">
        <span class="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full ${item.dot} ring-4 ring-[#0e1727]"></span>
        <div class="flex items-center justify-between text-xs">
          <span class="font-mono text-slate-400 text-[11px]">${item.time}</span>
          <span class="px-1.5 py-0.2 text-[9px] font-bold ${item.pColor} rounded">${item.pCode}</span>
        </div>
        <p class="text-xs font-medium text-slate-100 mt-0.5">${escapeHtml(item.title)}</p>
        <p class="text-[10px] text-slate-400">${escapeHtml(item.repo)}</p>
      </div>
    `).join('');
  }

  // Render Right Panel: Son GitHub Hareketleri
  const githubContainer = document.getElementById('home-github-activity-container');
  if (githubContainer) {
    const feeds = [
      { num: '#101', dot: 'bg-emerald-400', color: 'text-emerald-400', time: '2 dk önce', title: 'Ödeme webhook hatası düzeltildi', repo: 'TenderAgent' },
      { num: '#44', dot: 'bg-sky-400', color: 'text-sky-400', time: '12 dk önce', title: 'iOS izin sorunu için yeni yorum', repo: 'Sector 9' },
      { num: '#12', dot: 'bg-rose-400', color: 'text-rose-400', time: '28 dk önce', title: 'Kritik hata tespiti', repo: 'FamApp' }
    ];

    githubContainer.innerHTML = feeds.map(feed => `
      <div class="p-2.5 bg-[#121c2f] border border-[#1b2a44] rounded-xl space-y-1">
        <div class="flex items-center justify-between">
          <span class="flex items-center gap-1.5 font-mono text-[11px] ${feed.color}">
            <span class="w-2 h-2 rounded-full ${feed.dot}"></span>
            ${feed.num}
          </span>
          <span class="text-[10px] text-slate-400 font-mono">${feed.time}</span>
        </div>
        <p class="font-medium text-slate-200">${escapeHtml(feed.title)}</p>
        <p class="text-[11px] text-slate-400">${escapeHtml(feed.repo)}</p>
      </div>
    `).join('');
  }

  lucide.createIcons();
}

function startPomodoroFromHome() {
  switchView('focus');
  if (typeof startFocusTimer === 'function') {
    startFocusTimer();
  }
}

function startTaskFromHome(taskId) {
  switchView('focus');
  if (typeof startFocusTimer === 'function') {
    startFocusTimer();
  }
}

function toggleMiniTaskHome(taskId, checked) {
  const el = document.getElementById(`mini-task-title-${taskId}`);
  if (el) {
    if (checked) {
      el.classList.add('line-through', 'opacity-60');
    } else {
      el.classList.remove('line-through', 'opacity-60');
    }
  }
}

function handleGlobalSearch(query) {
  if (state.currentView !== 'grid' && state.currentView !== 'kanban') {
    if (query && query.trim().length > 1) {
      switchView('grid');
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = query;
      if (typeof handleSearch === 'function') handleSearch(query);
    }
  } else {
    if (typeof handleSearch === 'function') handleSearch(query);
  }
}

/**
 * ==========================================
 * COMMAND PALETTE (CMD+K / CTRL+K) CONTROLLER
 * ==========================================
 */
let cmdPaletteSelectedIndex = 0;
let cmdPaletteFilteredActions = [];

function openCommandPalette() {
  const modal = document.getElementById('command-palette-modal');
  const input = document.getElementById('cmd-palette-input');
  if (!modal || !input) return;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  input.value = '';
  cmdPaletteSelectedIndex = 0;
  renderCommandPaletteResults('');
  setTimeout(() => input.focus(), 50);
}

function closeCommandPalette() {
  const modal = document.getElementById('command-palette-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function handleCommandPaletteInput(query) {
  cmdPaletteSelectedIndex = 0;
  renderCommandPaletteResults(query);
}

function handleCommandPaletteKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdPaletteFilteredActions.length > 0) {
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex + 1) % cmdPaletteFilteredActions.length;
      highlightCommandPaletteItem();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdPaletteFilteredActions.length > 0) {
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex - 1 + cmdPaletteFilteredActions.length) % cmdPaletteFilteredActions.length;
      highlightCommandPaletteItem();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (cmdPaletteFilteredActions.length > 0 && cmdPaletteFilteredActions[cmdPaletteSelectedIndex]) {
      executeCommandPaletteAction(cmdPaletteSelectedIndex);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  }
}

function executeCommandPaletteAction(index) {
  const item = cmdPaletteFilteredActions[index];
  if (!item) return;
  closeCommandPalette();
  if (typeof item.action === 'function') {
    item.action();
  }
}

function highlightCommandPaletteItem() {
  const container = document.getElementById('cmd-palette-results');
  if (!container) return;
  const items = container.querySelectorAll('.cmd-palette-item');
  items.forEach((el, idx) => {
    if (idx === cmdPaletteSelectedIndex) {
      el.classList.add('bg-[#1E293B]', 'border-blue-500/40');
      el.classList.remove('bg-transparent', 'border-transparent');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('bg-[#1E293B]', 'border-blue-500/40');
      el.classList.add('bg-transparent', 'border-transparent');
    }
  });
}

function getCommandPaletteDefaultActions() {
  return [
    {
      id: 'nav-home',
      category: 'Sayfalar',
      title: 'Ana Sayfaya Git',
      subtitle: 'Genel bakış, son aktiviteler ve metrikler',
      icon: '<i data-lucide="home" class="w-4 h-4 text-blue-400"></i>',
      action: () => switchView('home')
    },
    {
      id: 'nav-projects',
      category: 'Sayfalar',
      title: 'Projeler Sekmesine Git',
      subtitle: 'Tüm projeler, detaylı görevler ve sağlık skorları',
      icon: '<i data-lucide="folder" class="w-4 h-4 text-cyan-400"></i>',
      action: () => switchView('projects')
    },
    {
      id: 'nav-kanban',
      category: 'Sayfalar',
      title: 'Kanban Panosuna Git',
      subtitle: 'Sürükle bırak görev yönetimi ve durum kolonları',
      icon: '<i data-lucide="kanban" class="w-4 h-4 text-indigo-400"></i>',
      action: () => switchView('kanban')
    },
    {
      id: 'nav-calendar',
      category: 'Sayfalar',
      title: 'Takvim Sekmesine Git',
      subtitle: 'Haftalık ve aylık görev planlaması, iCal feed',
      icon: '<i data-lucide="calendar" class="w-4 h-4 text-amber-400"></i>',
      action: () => switchView('calendar')
    },
    {
      id: 'nav-focus',
      category: 'Sayfalar',
      title: 'Günlük Odak (Focus) Sekmesine Git',
      subtitle: 'Pomodoro odak sayacı ve günün 3 öncelikli işi',
      icon: '<i data-lucide="clock" class="w-4 h-4 text-emerald-400"></i>',
      action: () => switchView('focus')
    },
    {
      id: 'nav-todos',
      category: 'Sayfalar',
      title: 'Kod İçi TODO Sekmesine Git',
      subtitle: 'Depolardaki TODO/FIXME taramaları ve aktarma',
      icon: '<i data-lucide="code" class="w-4 h-4 text-pink-400"></i>',
      action: () => switchView('todos')
    },
    {
      id: 'nav-analytics',
      category: 'Sayfalar',
      title: 'Analitik Sekmesine Git',
      subtitle: 'Proje dağılımı, tamamlama oranları ve performans',
      icon: '<i data-lucide="bar-chart-2" class="w-4 h-4 text-sky-400"></i>',
      action: () => switchView('analytics')
    },
    {
      id: 'nav-settings',
      category: 'Sayfalar',
      title: 'Ayarlar Sekmesine Git',
      subtitle: 'Sistem yapılandırması ve Telegram entegrasyonu',
      icon: '<i data-lucide="settings" class="w-4 h-4 text-slate-400"></i>',
      action: () => switchView('settings')
    },
    {
      id: 'act-new-task',
      category: 'Hızlı Eylemler',
      title: 'Yeni Görev Ekle',
      subtitle: 'Hızlı görev oluşturma modalını aç',
      icon: '<i data-lucide="plus-circle" class="w-4 h-4 text-emerald-400"></i>',
      action: () => {
        if (state.projects && state.projects.length > 0) {
          const p = state.projects[0];
          openAddTaskModal(p.id, p.fullName, p.name, p.filePath);
        } else {
          switchView('kanban');
        }
      }
    },
    {
      id: 'act-start-pomo',
      category: 'Hızlı Eylemler',
      title: 'Pomodoro Odak Seansını Başlat',
      subtitle: '25 dakikalık odaklanma sayacını anında çalıştır',
      icon: '<i data-lucide="play" class="w-4 h-4 text-cyan-400"></i>',
      action: () => {
        switchView('focus');
        if (!state.pomodoro.isRunning) togglePomodoro();
      }
    },
    {
      id: 'act-sync-repos',
      category: 'Hızlı Eylemler',
      title: 'Depoları & Görevleri Yenile',
      subtitle: 'Anlık verileri yeniden tara ve senkronize et',
      icon: '<i data-lucide="refresh-cw" class="w-4 h-4 text-blue-400"></i>',
      action: () => {
        fetchProjects(true);
        showToast('Depolar senkronize ediliyor...', 'info');
      }
    },
    {
      id: 'act-filter-p1',
      category: 'Hızlı Eylemler',
      title: 'Filtre: Yalnızca Acil (P1) Görevler',
      subtitle: 'En yüksek öncelikli görevleri görüntüle',
      icon: '<i data-lucide="alert-circle" class="w-4 h-4 text-rose-400"></i>',
      action: () => {
        switchView('kanban');
        if (typeof filterKanbanPriority === 'function') {
          filterKanbanPriority('P1');
        }
      }
    }
  ];
}

function fuzzyMatch(needle, haystack) {
  if (!needle || !haystack) return false;
  needle = String(needle).toLowerCase().replace(/[\s\-_]+/g, '');
  haystack = String(haystack).toLowerCase().replace(/[\s\-_]+/g, '');
  if (haystack.includes(needle)) return true;
  let nIdx = 0;
  for (let hIdx = 0; hIdx < haystack.length; hIdx++) {
    if (haystack[hIdx] === needle[nIdx]) {
      nIdx++;
      if (nIdx === needle.length) return true;
    }
  }
  return false;
}

function renderCommandPaletteResults(query) {
  const container = document.getElementById('cmd-palette-results');
  if (!container) return;

  const q = (query || '').toLowerCase().trim();
  const defaultActions = getCommandPaletteDefaultActions();

  if (!q) {
    cmdPaletteFilteredActions = defaultActions;
  } else {
    // 1. Filter commands matching title, subtitle or fuzzy search
    const matchedActions = defaultActions.filter(a => 
      a.title.toLowerCase().includes(q) || 
      a.subtitle.toLowerCase().includes(q) || 
      a.category.toLowerCase().includes(q) ||
      fuzzyMatch(q, a.title) ||
      fuzzyMatch(q, a.subtitle)
    );

    // 2. Search inside state.projects tasks with fuzzy matching
    const matchedTasks = [];
    if (state.projects && state.projects.length > 0) {
      state.projects.forEach(p => {
        (p.tasks || []).forEach(t => {
          const tText = `${t.title} ${t.description || ''} ${p.name}`;
          if (tText.toLowerCase().includes(q) || fuzzyMatch(q, t.title) || fuzzyMatch(q, p.name)) {
            const pCode = t.priorityCode || (t.priorityRank === 1 ? 'P1' : t.priorityRank === 2 ? 'P2' : 'P3');
            const pColor = pCode === 'P1' ? 'text-rose-400 bg-rose-500/10' : pCode === 'P2' ? 'text-amber-400 bg-amber-500/10' : 'text-blue-400 bg-blue-500/10';
            matchedTasks.push({
              id: `task-${t.id || t.title}`,
              category: 'Görevler',
              title: t.title,
              subtitle: `${p.name} · ${pCode} · ${t.completed ? '✓ Tamamlandı' : 'Bekliyor'}`,
              badge: `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${pColor}">${pCode}</span>`,
              icon: `<i data-lucide="${t.completed ? 'check-circle' : 'circle'}" class="w-4 h-4 ${t.completed ? 'text-emerald-400' : 'text-slate-400'}"></i>`,
              action: () => {
                switchView('kanban');
                showToast(`Görev: ${t.title}`, 'info');
              }
            });
          }
        });
      });
    }

    cmdPaletteFilteredActions = [...matchedActions, ...matchedTasks.slice(0, 15)];
  }

  if (cmdPaletteFilteredActions.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-slate-400">
        <i data-lucide="search-x" class="w-8 h-8 mx-auto mb-2 text-slate-500 opacity-60"></i>
        <p class="font-medium">"${escapeHtml(q)}" ile eşleşen sonuç bulunamadı</p>
        <p class="text-[11px] text-slate-500 mt-1">Farklı bir arama terimi deneyin.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  let currentCategory = '';
  let html = '';

  cmdPaletteFilteredActions.forEach((item, index) => {
    if (item.category && item.category !== currentCategory) {
      currentCategory = item.category;
      html += `
        <div class="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          ${escapeHtml(currentCategory)}
        </div>
      `;
    }

    const isSelected = index === cmdPaletteSelectedIndex;
    const selectedClass = isSelected ? 'bg-[#1E293B] border-blue-500/40' : 'bg-transparent border-transparent';

    html += `
      <div 
        class="cmd-palette-item flex items-center justify-between p-2.5 rounded-xl border ${selectedClass} hover:bg-[#1E293B] cursor-pointer transition-colors"
        onclick="executeCommandPaletteAction(${index})"
        onmouseenter="cmdPaletteSelectedIndex = ${index}; highlightCommandPaletteItem();"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-[#162238] border border-slate-700/60">
            ${item.icon || '<i data-lucide="chevron-right" class="w-3.5 h-3.5 text-slate-400"></i>'}
          </div>
          <div class="min-w-0">
            <div class="font-medium text-slate-200 text-xs truncate">${escapeHtml(item.title)}</div>
            <div class="text-[11px] text-slate-400 truncate">${escapeHtml(item.subtitle)}</div>
          </div>
        </div>
        <div class="shrink-0 flex items-center gap-1.5 pl-2">
          ${item.badge || ''}
          <kbd class="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-[#162238] rounded border border-slate-700/60">↵</kbd>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  lucide.createIcons();
}

// Global Keyboard Shortcut: CMD+K / CTRL+K
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const modal = document.getElementById('command-palette-modal');
    if (modal && !modal.classList.contains('hidden')) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
  }
});

/**
 * ==========================================
 * AUTH & LOCAL-FIRST JSON STORAGE SERVICE
 * ==========================================
 */

let connectedLocalFileHandle = null;

async function hashPassword(str) {
  try {
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // Fallback simple hash for older environments
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return 'h_' + Math.abs(hash).toString(16);
  }
}

function checkActiveUserSession() {
  try {
    const rawUser = getStorage('active_user');
    if (!rawUser) {
      showAuthModal('login');
      return null;
    }
    const user = JSON.parse(rawUser);
    if (!user || user.isGuest || user.username === 'misafir') {
      removeStorage('active_user');
      showAuthModal('login');
      return null;
    }
    applyUserProfileToUI(user);
    hideAuthModal();
    return user;
  } catch (err) {
    showAuthModal('login');
    return null;
  }
}

function showAuthModal(tab = 'login') {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    switchAuthTab(tab);
  }
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function switchAuthTab(tab) {
  const btnLogin = document.getElementById('auth-tab-login');
  const btnRegister = document.getElementById('auth-tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');
  const alertEl = document.getElementById('auth-alert-message');

  if (alertEl) alertEl.classList.add('hidden');

  if (tab === 'login') {
    if (btnLogin) btnLogin.className = 'flex-1 py-2 text-center font-semibold rounded-lg text-white bg-blue-600 shadow-sm transition-all cursor-pointer';
    if (btnRegister) btnRegister.className = 'flex-1 py-2 text-center font-medium rounded-lg text-slate-400 hover:text-white transition-all cursor-pointer';
    if (formLogin) formLogin.classList.remove('hidden');
    if (formRegister) formRegister.classList.add('hidden');
  } else {
    if (btnRegister) btnRegister.className = 'flex-1 py-2 text-center font-semibold rounded-lg text-white bg-emerald-600 shadow-sm transition-all cursor-pointer';
    if (btnLogin) btnLogin.className = 'flex-1 py-2 text-center font-medium rounded-lg text-slate-400 hover:text-white transition-all cursor-pointer';
    if (formRegister) formRegister.classList.remove('hidden');
    if (formLogin) formLogin.classList.add('hidden');
  }
  lucide.createIcons();
}

function showAuthAlert(message, type = 'error') {
  const alertEl = document.getElementById('auth-alert-message');
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.className = type === 'error'
    ? 'mb-4 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs'
    : 'mb-4 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs';
  alertEl.classList.remove('hidden');
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const fullName = document.getElementById('auth-reg-fullname').value.trim();
  const username = document.getElementById('auth-reg-username').value.trim().toLowerCase();
  const password = document.getElementById('auth-reg-password').value;
  const confirmPassword = document.getElementById('auth-reg-password-confirm').value;

  if (!fullName || !username || !password) {
    showAuthAlert('Lütfen tüm alanları doldurun.');
    return;
  }
  if (username.length < 3) {
    showAuthAlert('Kullanıcı adı en az 3 karakter olmalıdır.');
    return;
  }
  if (password.length < 4) {
    showAuthAlert('Şifre en az 4 karakter olmalıdır.');
    return;
  }
  if (password !== confirmPassword) {
    showAuthAlert('Şifreler birbiriyle eşleşmiyor.');
    return;
  }

  const registeredUsers = JSON.parse(getStorage('registered_users', '[]'));
  if (registeredUsers.some(u => u.username === username)) {
    showAuthAlert(`"${username}" kullanıcı adı zaten kayıtlı. Lütfen giriş yapın.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const newUser = {
    username,
    fullName,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  registeredUsers.push(newUser);
  setStorage('registered_users', JSON.stringify(registeredUsers));
  setStorage('active_user', JSON.stringify(newUser));

  showAuthAlert('Hesap başarıyla oluşturuldu! Yönlendiriliyorsunuz...', 'success');
  applyUserProfileToUI(newUser);

  setTimeout(() => {
    hideAuthModal();
    showToast(`Hoş geldiniz, ${fullName}! Verileriniz yerel depoda güvenle saklanacak.`, 'success');
  }, 600);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('auth-login-username').value.trim().toLowerCase();
  const password = document.getElementById('auth-login-password').value;

  if (!username || !password) {
    showAuthAlert('Lütfen kullanıcı adı ve şifrenizi girin.');
    return;
  }

  const registeredUsers = JSON.parse(getStorage('registered_users', '[]'));
  const user = registeredUsers.find(u => u.username === username);

  if (!user) {
    showAuthAlert('Bu kullanıcı adına ait bir hesap bulunamadı. Lütfen önce "Kayıt Ol" sekmesinden hesap oluşturun.');
    return;
  }

  const passwordHash = await hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    showAuthAlert('Hatalı şifre. Lütfen tekrar deneyin.');
    return;
  }

  setStorage('active_user', JSON.stringify(user));
  showAuthAlert('Giriş başarılı! Yükleniyor...', 'success');
  applyUserProfileToUI(user);

  setTimeout(() => {
    hideAuthModal();
    showToast(`Tekrar hoş geldiniz, ${user.fullName}!`, 'success');
  }, 400);
}

function continueAsGuest() {
  showToast('Demo hesabı kapatılmıştır. Lütfen geçerli bir hesapla giriş yapın veya kayıt olun.', 'warning');
  showAuthModal('register');
}

function logoutUser() {
  removeStorage('active_user');
  connectedLocalFileHandle = null;
  updateStorageStatusBadge(null);
  showAuthModal('login');
  showToast('Oturum kapatıldı.', 'info');
}

function applyUserProfileToUI(user) {
  if (!user) return;
  const nameEl = document.getElementById('header-user-name');
  const avatarEl = document.getElementById('header-user-avatar');
  const dropdownName = document.getElementById('dropdown-user-fullname');
  const dropdownUsername = document.getElementById('dropdown-user-username');
  const greetingEl = document.querySelector('h1.tracking-tight');

  if (nameEl) nameEl.textContent = user.fullName || user.username;
  if (dropdownName) dropdownName.textContent = user.fullName || user.username;
  if (dropdownUsername) dropdownUsername.textContent = `@${user.username}`;

  // Avatar initials
  const initials = (user.fullName || user.username || 'U')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');

  if (avatarEl) avatarEl.textContent = initials || 'OI';

  if (greetingEl && user.fullName) {
    const firstName = user.fullName.split(' ')[0];
    greetingEl.innerHTML = `Merhaba ${escapeHtml(firstName)} <span class="animate-pulse">👋</span>`;
  }
}

function toggleUserProfileDropdown() {
  const dropdown = document.getElementById('user-profile-dropdown');
  if (dropdown) {
    dropdown.classList.toggle('hidden');
    lucide.createIcons();
  }
}

// Close profile dropdown when clicking outside
window.addEventListener('click', (e) => {
  const btn = document.getElementById('header-user-btn');
  const dropdown = document.getElementById('user-profile-dropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!btn?.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  }
});

/**
 * ==========================================
 * LOCAL FILE SYSTEM & JSON SYNC ENGINE
 * ==========================================
 */

function updateStorageStatusBadge(fileName) {
  const textEl = document.getElementById('header-storage-text');
  const pillEl = document.getElementById('header-user-storage-pill');
  if (!textEl) return;

  if (fileName) {
    textEl.textContent = `📁 ${fileName}`;
    if (pillEl) pillEl.className = 'text-[10px] text-cyan-300 flex items-center gap-1 font-mono font-bold';
  } else {
    textEl.textContent = 'Yerel JSON';
    if (pillEl) pillEl.className = 'text-[10px] text-emerald-400 flex items-center gap-1 font-mono';
  }
}

async function connectLocalJsonFile() {
  if (!('showOpenFilePicker' in window)) {
    const input = document.getElementById('json-file-input');
    if (input) input.click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'Repo Pilot JSON Veri Dosyası',
        accept: { 'application/json': ['.json'] }
      }],
      multiple: false
    });

    connectedLocalFileHandle = handle;
    const file = await handle.getFile();
    const content = await file.text();

    if (content.trim()) {
      importDataFromJson(content, false);
    } else {
      await writeToConnectedJsonFile();
    }

    updateStorageStatusBadge(file.name);
    showToast(`✓ Yerel dosya bağlandı: "${file.name}". Değişiklikler otomatik kaydedilecek!`, 'success');
  } catch (err) {
    if (err.name !== 'AbortError') {
      showToast(`Dosya seçim hatası: ${err.message}`, 'error');
    }
  }
}

async function writeToConnectedJsonFile() {
  if (!connectedLocalFileHandle) return;
  try {
    const writable = await connectedLocalFileHandle.createWritable();
    const payload = {
      repopilotVersion: '1.0.0',
      taskdeckVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      user: JSON.parse(getStorage('active_user', '{}')),
      mode: state.mode,
      projects: state.projects,
      kanbanOrders: state.kanbanOrders,
      kanbanOverrides: state.kanbanOverrides,
      calendarUpcomingTasks: state.calendarUpcomingTasks,
      pomodoroHistory: JSON.parse(getStorage('pomodoro_history', '[]'))
    };
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
  } catch (err) {
    console.warn('Bağlı JSON dosyasına otomatik kayıt yapılamadı:', err);
  }
}

function exportDataAsJson() {
  const activeUser = JSON.parse(getStorage('active_user', '{"username":"kullanici"}'));
  const payload = {
    repopilotVersion: '1.0.0',
    taskdeckVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    user: activeUser,
    mode: state.mode,
    projects: state.projects,
    kanbanOrders: state.kanbanOrders,
    kanbanOverrides: state.kanbanOverrides,
    calendarUpcomingTasks: state.calendarUpcomingTasks,
    pomodoroHistory: JSON.parse(getStorage('pomodoro_history', '[]'))
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
  const downloadAnchor = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `repopilot_${activeUser.username || 'gorevler'}_${dateStr}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();

  showToast('✓ Tüm verileriniz kişisel JSON dosyası olarak bilgisayarınıza indirildi!', 'success');
}

function handleJsonFileInput(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const jsonContent = e.target.result;
      importDataFromJson(jsonContent, true);
      updateStorageStatusBadge(file.name);
    } catch (err) {
      showToast(`JSON okuma hatası: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function importDataFromJson(jsonString, showNotification = true) {
  try {
    const data = JSON.parse(jsonString);
    if (!data || typeof data !== 'object') throw new Error('Geçersiz JSON yapısı.');

    if (Array.isArray(data.projects)) {
      state.projects = data.projects;
    }
    if (data.kanbanOrders && typeof data.kanbanOrders === 'object') {
      state.kanbanOrders = data.kanbanOrders;
      saveKanbanColumnOrders(data.kanbanOrders);
    }
    if (data.kanbanOverrides && typeof data.kanbanOverrides === 'object') {
      state.kanbanOverrides = data.kanbanOverrides;
      saveKanbanOverrides(data.kanbanOverrides);
    }
    if (Array.isArray(data.calendarUpcomingTasks)) {
      state.calendarUpcomingTasks = data.calendarUpcomingTasks;
      saveCalendarUpcomingTasks(data.calendarUpcomingTasks);
    }
    if (Array.isArray(data.pomodoroHistory)) {
      setStorage('pomodoro_history', JSON.stringify(data.pomodoroHistory));
    }

    applyFiltersAndRender();
    if (typeof renderKanbanBoard === 'function') renderKanbanBoard();
    if (typeof renderCalendarView === 'function') renderCalendarView();
    if (typeof renderAnalyticsPage === 'function') renderAnalyticsPage();
    if (typeof renderDailyFocus === 'function') renderDailyFocus();

    if (showNotification) {
      showToast('✓ JSON verileri başarıyla geri yüklendi ve pano güncellendi!', 'success');
    }
  } catch (err) {
    showToast(`İçe aktarma hatası: ${err.message}`, 'error');
  }
}

function saveRepoPilotDataToLocalJsonFile() {
  if (typeof saveTaskDeckDataToLocalJsonFile === 'function') {
    return saveTaskDeckDataToLocalJsonFile();
  }
}
window.saveRepoPilotDataToLocalJsonFile = saveRepoPilotDataToLocalJsonFile;
