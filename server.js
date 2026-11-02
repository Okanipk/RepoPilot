require('dotenv').config();
const fs = require('fs');
const express = require('express');
const settingsService = require('./services/settingsService');
const securityService = require('./services/securityService');
const path = require('path');
const cron = require('node-cron');
const githubService = require('./services/githubService');
const parserService = require('./services/parserService');
const telegramService = require('./services/telegramService');
const scannerService = require('./services/scannerService');
const calendarService = require('./services/calendarService');
const { DEMO_REPOSITORIES } = require('./services/demoData');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb', verify: (req, res, buffer) => { req.rawBody = buffer; } }));
app.post('/api/session', securityService.session);
app.use('/api', securityService.protect);
app.use(express.static(path.join(__dirname, 'public')));

const repopilotDemoFile = path.join(__dirname, '.repopilot', 'demo-state.json');
const taskdeckDemoFile = path.join(__dirname, '.taskdeck', 'demo-state.json');
const DEMO_STATE_FILE = fs.existsSync(repopilotDemoFile)
  ? repopilotDemoFile
  : (fs.existsSync(taskdeckDemoFile) ? taskdeckDemoFile : repopilotDemoFile);

function loadDemoReposState() {
  try {
    if (fs.existsSync(DEMO_STATE_FILE)) {
      const content = fs.readFileSync(DEMO_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error('Demo durumu dosyadan okunamadı:', err.message);
  }
  return JSON.parse(JSON.stringify(DEMO_REPOSITORIES));
}

function saveDemoReposState() {
  try {
    const dir = path.dirname(DEMO_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEMO_STATE_FILE, JSON.stringify(demoReposState, null, 2), 'utf-8');
  } catch (err) {
    console.error('Demo durumu kaydedilemedi:', err.message);
  }
}

let demoReposState = loadDemoReposState();
let currentMode = settingsService.get('mode', githubService.token ? 'live' : 'demo');
let targetFileName = settingsService.get('targetFile', 'yapilacaklar.md');
if (settingsService.get('targetFile')) githubService.targetFiles = [targetFileName, 'TODO.md'];

/**
 * Computes health score and stats for a repo
 */
function enrichRepoWithParsedTasks(repo) {
  let tasks = [];
  const source = settingsService.get('taskSource', 'issues');
  
  if (source === 'issues') {
    if (Array.isArray(repo.issues)) {
      tasks = [...repo.issues];
    } else if (repo.markdownContent) {
      tasks = parserService.parseTasks(repo.markdownContent);
    }
  } else if (source === 'both') {
    const fileTasks = repo.markdownContent ? parserService.parseTasks(repo.markdownContent) : [];
    tasks = Array.isArray(repo.issues) ? [...repo.issues] : [];
    fileTasks.forEach(ft => {
      if (!tasks.some(it => it.issueNumber && it.issueNumber === ft.issueNumber)) {
        tasks.push(ft);
      }
    });
  } else if (source === 'file') {
    if (repo.markdownContent) {
      tasks = parserService.parseTasks(repo.markdownContent);
    } else if (Array.isArray(repo.issues)) {
      tasks = [...repo.issues];
    }
  } else if (Array.isArray(repo.issues)) {
    tasks = [...repo.issues];
  } else if (repo.markdownContent) {
    tasks = parserService.parseTasks(repo.markdownContent);
  }

  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pending = total - completed;
  const p1Count = tasks.filter(t => !t.completed && t.priorityRank === 1).length;
  const p2Count = tasks.filter(t => !t.completed && t.priorityRank === 2).length;
  const p3Count = tasks.filter(t => !t.completed && t.priorityRank === 3).length;
  const completionPercentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Stale detection
  const now = Date.now();
  const updatedDate = new Date(repo.updatedAt);
  const daysSinceUpdate = Math.max(0, Math.floor((now - updatedDate.getTime()) / (1000 * 60 * 60 * 24)));
  const isStale = daysSinceUpdate >= 14 && p1Count > 0;

  // Health Score (0 - 100)
  let healthScore = 100;
  healthScore -= (p1Count * 15);
  healthScore -= (p2Count * 5);
  healthScore -= (p3Count * 2);
  if (isStale) healthScore -= 10;
  healthScore += Math.round(completionPercentage * 0.15);
  healthScore = Math.max(10, Math.min(100, healthScore));

  let healthGrade = 'A+';
  let healthColor = 'emerald';
  if (healthScore < 50) {
    healthGrade = 'F';
    healthColor = 'red';
  } else if (healthScore < 70) {
    healthGrade = 'C';
    healthColor = 'amber';
  } else if (healthScore < 85) {
    healthGrade = 'B';
    healthColor = 'blue';
  }

  return {
    ...repo,
    daysSinceUpdate,
    isStale,
    health: {
      score: healthScore,
      grade: healthGrade,
      color: healthColor
    },
    tasks,
    stats: {
      total,
      completed,
      pending,
      p1Count,
      p2Count,
      p3Count,
      completionPercentage
    }
  };
}

/**
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
  const calendarBase = settingsService.get('calendarBaseUrl', process.env.REPOPILOT_PUBLIC_URL || process.env.TASKDECK_PUBLIC_URL || '').replace(/\/+$/, '');
  const calendarSubscriptionUrl = calendarBase
    ? `${calendarBase}/api/calendar.ics?token=${securityService.calendarToken}`
    : `/api/calendar.ics?token=${securityService.calendarToken}`;

  res.json({
    mode: currentMode,
    hasToken: Boolean(githubService.token),
    username: githubService.username || '',
    taskSource: githubService.taskSource || settingsService.get('taskSource', 'issues'),
    targetFileName: targetFileName,
    telegramConfigured: telegramService.isConfigured(),
    telegramChatId: telegramService.chatId || '',
    telegramHasToken: Boolean(telegramService.botToken),
    timeZone: require('./services/dateService').TIME_ZONE,
    localScanRoot: settingsService.get('localScanRoot', process.env.REPOPILOT_SCAN_ROOT || process.env.TASKDECK_SCAN_ROOT || ''),
    calendarBaseUrl: settingsService.get('calendarBaseUrl', process.env.REPOPILOT_PUBLIC_URL || process.env.TASKDECK_PUBLIC_URL || ''),
    calendarToken: securityService.calendarToken,
    calendarSubscriptionUrl
  });
});

/**
 * POST /api/mode
 */
app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'demo' || mode === 'live') {
    settingsService.save({ mode });
    currentMode = mode;
    return res.json({ success: true, mode: currentMode });
  }
  res.status(400).json({ error: 'Geçersiz mod.' });
});

/**
 * POST /api/settings
 */
app.post('/api/settings', (req, res) => {
  try {
    const { token, username, targetFile, telegramToken, telegramChatId, localScanRoot, calendarBaseUrl, taskSource } = req.body;
    const values = {};
    for (const [key, value] of Object.entries({ username, targetFile, localScanRoot, calendarBaseUrl, taskSource })) {
      if (value !== undefined) {
        if (typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('Geçersiz ayar değeri.');
        values[key] = value.trim();
      }
    }
    if (values.targetFile && (values.targetFile.includes('..') || values.targetFile.startsWith('/') || values.targetFile.includes('\\'))) throw new Error('Geçersiz görev dosyası yolu.');
    if (values.calendarBaseUrl) {
      const url = new URL(values.calendarBaseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Takvim için sorgusuz bir HTTPS temel adresi gerekli.');
    }
    for (const [key, value] of Object.entries({ token, telegramToken, telegramChatId })) {
      if (value !== undefined && typeof value !== 'string') throw new Error('Geçersiz kimlik bilgisi.');
      if (value?.trim()) values[key] = value.trim();
    }
    if (req.body.clearGitHubToken === true) values.token = '';
    if (req.body.clearTelegram === true) { values.telegramToken = ''; values.telegramChatId = ''; }
    if (values.token) values.mode = 'live';
    settingsService.save(values);
    targetFileName = settingsService.get('targetFile', targetFileName) || 'yapilacaklar.md';
    githubService.updateConfig(values.token, values.username, [targetFileName, 'TODO.md'], values.taskSource);
    telegramService.updateConfig(values.telegramToken, values.telegramChatId);
    if (values.mode) currentMode = values.mode;
    res.json({ success: true, mode: currentMode, hasToken: Boolean(githubService.token), username: githubService.username, taskSource: githubService.taskSource, telegramConfigured: telegramService.isConfigured() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/test-connection
 */
app.post('/api/test-connection', async (req, res) => {
  try {
    const { token, username } = req.body;
    const testResult = await githubService.testConnection(
      token || githubService.token,
      username || githubService.username
    );
    res.json(testResult);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/projects
 */
app.get('/api/projects', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';

    if (currentMode === 'demo') {
      const enrichedDemo = demoReposState.map(enrichRepoWithParsedTasks);
      
      enrichedDemo.sort((a, b) => {
        if (b.stats.p1Count !== a.stats.p1Count) {
          return b.stats.p1Count - a.stats.p1Count;
        }
        return a.name.localeCompare(b.name);
      });

      const totalProjects = enrichedDemo.length;
      const totalTasks = enrichedDemo.reduce((acc, r) => acc + r.stats.total, 0);
      const totalCompleted = enrichedDemo.reduce((acc, r) => acc + r.stats.completed, 0);
      const totalP1 = enrichedDemo.reduce((acc, r) => acc + r.stats.p1Count, 0);
      const staleCount = enrichedDemo.filter(r => r.isStale).length;
      const overdueCount = enrichedDemo.reduce((acc, r) => acc + (r.tasks || []).filter(t => t.isOverdue).length, 0);
      const overallPercentage = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

      return res.json({
        mode: 'demo',
        fromCache: false,
        summary: {
          totalProjects,
          totalTasks,
          totalCompleted,
          totalPending: totalTasks - totalCompleted,
          totalP1,
          staleCount,
          overdueCount,
          overallPercentage
        },
        projects: enrichedDemo
      });
    }

    const githubResult = await githubService.getRepositories(forceRefresh);
    const enrichedLive = githubResult.data;

    const totalProjects = enrichedLive.length;
    const totalTasks = enrichedLive.reduce((acc, r) => acc + r.stats.total, 0);
    const totalCompleted = enrichedLive.reduce((acc, r) => acc + r.stats.completed, 0);
    const totalP1 = enrichedLive.reduce((acc, r) => acc + r.stats.p1Count, 0);
    const staleCount = enrichedLive.filter(r => r.isStale).length;
    const overdueCount = enrichedLive.reduce((acc, r) => acc + (r.tasks || []).filter(t => t.isOverdue).length, 0);
    const overallPercentage = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

    res.json({
      mode: 'live',
      fromCache: githubResult.fromCache,
      summary: {
        totalProjects,
        totalTasks,
        totalCompleted,
        totalPending: totalTasks - totalCompleted,
        totalP1,
        staleCount,
        overdueCount,
        overallPercentage
      },
      projects: enrichedLive
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/analytics - Dynamic analytics metrics and project distributions
 */
app.get('/api/analytics', async (req, res) => {
  try {
    let projects = [];
    if (currentMode === 'demo') {
      projects = demoReposState.map(enrichRepoWithParsedTasks);
    } else {
      const ghRes = await githubService.getRepositories(false).catch(() => ({ data: [] }));
      projects = ghRes.data || [];
    }

    let totalTasks = 0;
    let completedTasks = 0;
    let overdueTasks = 0;
    let criticalTasks = 0;

    const projectBreakdown = projects.map(p => {
      const tasks = p.tasks || [];
      const pTotal = tasks.length;
      const pCompleted = tasks.filter(t => t.completed).length;
      const pPending = pTotal - pCompleted;
      const pCritical = tasks.filter(t => !t.completed && (t.priorityRank === 1 || t.priorityCode === 'P1')).length;
      const pOverdue = tasks.filter(t => !t.completed && (t.isOverdue || (t.dueDate && new Date(t.dueDate) < new Date()))).length;

      totalTasks += pTotal;
      completedTasks += pCompleted;
      overdueTasks += pOverdue;
      criticalTasks += pCritical;

      return {
        id: p.id,
        name: p.name,
        fullName: p.fullName || p.name,
        language: p.language || '',
        totalTasks: pTotal,
        completedTasks: pCompleted,
        pendingTasks: pPending,
        criticalTasks: pCritical,
        overdueTasks: pOverdue
      };
    });

    const projectShares = projectBreakdown.map(p => ({
      ...p,
      percentage: totalTasks > 0 ? Math.round((p.totalTasks / totalTasks) * 100) : 0
    }));

    res.json({
      success: true,
      mode: currentMode,
      metrics: {
        totalTasks,
        completedTasks,
        pendingTasks: totalTasks - completedTasks,
        overdueTasks,
        criticalTasks,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
      },
      projectShares,
      projectsCount: projects.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/toggle
 */
function taskTarget(body) {
  return { id: body.taskId, title: body.taskTitle };
}

function findDemoRepo(query) {
  const { repoId, repoFullName, repoName } = query;
  return demoReposState.find(r => 
    (repoId && (r.id === repoId || String(r.id) === String(repoId) || r.id === `demo-repo-${repoId}`)) ||
    (repoFullName && r.fullName === repoFullName) ||
    (repoName && (r.name === repoName || r.fullName === repoName))
  );
}

async function resolveRepoFullName(body) {
  if (body.repoFullName && body.repoFullName.includes('/')) return body.repoFullName;
  if (body.repoId && String(body.repoId).includes('/')) return String(body.repoId);
  try {
    const ghRes = await githubService.getRepositories(false);
    const found = (ghRes.data || []).find(r => r.id === body.repoId || r.name === body.repoName || r.fullName === body.repoName);
    if (found && found.fullName && found.fullName.includes('/')) return found.fullName;
  } catch (_) {}
  return null;
}

app.post('/api/tasks/toggle', async (req, res) => {
  try {
    const { repoId, repoFullName, filePath, taskId, issueNumber, taskTitle, completed } = req.body;
    const isIssue = (taskId && String(taskId).startsWith('issue-')) || issueNumber || req.body.source === 'github-issue';

    if (currentMode === 'demo') {
      const repo = findDemoRepo(req.body);
      if (!repo) return res.status(404).json({ error: 'Demo repo bulunamadı.' });

      if (Array.isArray(repo.issues)) {
        const num = issueNumber || (taskId ? parseInt(String(taskId).replace('issue-', ''), 10) : null);
        const iss = repo.issues.find(i => (num && i.issueNumber === num) || i.title === taskTitle || i.id === taskId);
        if (iss) {
          iss.completed = Boolean(completed);
          iss.state = completed ? 'closed' : 'open';
          saveDemoReposState();
          return res.json({ success: true, mode: 'demo', issue: iss });
        }
      }

      if (repo.markdownContent) {
        repo.markdownContent = parserService.updateTaskInMarkdown(repo.markdownContent, taskTarget(req.body), completed);
        saveDemoReposState();
      }
      return res.json({ success: true, mode: 'demo' });
    }

    const resolvedFullName = await resolveRepoFullName(req.body);
    if (!resolvedFullName) {
      return res.status(400).json({ error: 'Geçersiz repo bilgisi. Tam repo adı (owner/repo) gereklidir.' });
    }
    const [owner, repoName] = resolvedFullName.split('/');

    if (isIssue) {
      const num = issueNumber || (taskId ? parseInt(String(taskId).replace('issue-', ''), 10) : null);
      if (num) {
        const result = await githubService.toggleIssueState({
          owner,
          repo: repoName,
          issueNumber: num,
          completed: Boolean(completed)
        });
        return res.json({ success: true, mode: 'live', ...result });
      }
    }

    await githubService.toggleTask({
      owner,
      repo: repoName,
      filePath: filePath || targetFileName,
      taskTitle: taskTarget(req.body),
      targetState: completed
    });

    res.json({ success: true, mode: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/priority - Move priority in Kanban or Card
 */
app.post('/api/tasks/priority', async (req, res) => {
  try {
    const { repoId, repoFullName, filePath, taskId, issueNumber, taskTitle, newPriorityCode } = req.body;
    const isIssue = (taskId && String(taskId).startsWith('issue-')) || issueNumber || req.body.source === 'github-issue';

    if (currentMode === 'demo') {
      const repo = findDemoRepo(req.body);
      if (!repo) return res.status(404).json({ error: 'Demo repo bulunamadı.' });

      if (Array.isArray(repo.issues)) {
        const num = issueNumber || (taskId ? parseInt(String(taskId).replace('issue-', ''), 10) : null);
        const iss = repo.issues.find(i => (num && i.issueNumber === num) || i.title === taskTitle || i.id === taskId);
        if (iss) {
          iss.priorityCode = newPriorityCode;
          iss.priorityRank = newPriorityCode === 'P1' ? 1 : newPriorityCode === 'P2' ? 2 : 3;
          iss.priorityLabel = `${newPriorityCode} ${newPriorityCode === 'P1' ? 'Acil' : newPriorityCode === 'P2' ? 'Normal' : 'Düşük'}`;
          saveDemoReposState();

          if (newPriorityCode === 'P1') {
            telegramService.sendInstantP1Alert({
              repoName: repo.name,
              title: iss.title,
              issueNumber: iss.issueNumber,
              dueDate: iss.dueDate,
              assignees: iss.assignees,
              description: iss.description,
              action: 'escalated'
            }).catch(() => {});
          }

          return res.json({ success: true, mode: 'demo', issue: iss });
        }
      }

      if (repo.markdownContent) {
        repo.markdownContent = parserService.changePriorityInMarkdown(repo.markdownContent, taskTarget(req.body), newPriorityCode);
        saveDemoReposState();
      }

      if (newPriorityCode === 'P1') {
        telegramService.sendInstantP1Alert({
          repoName: repo.name,
          title: taskTitle,
          action: 'escalated'
        }).catch(() => {});
      }

      return res.json({ success: true, mode: 'demo' });
    }

    const resolvedFullName = await resolveRepoFullName(req.body);
    if (!resolvedFullName) {
      return res.status(400).json({ error: 'Geçersiz repo bilgisi. Tam repo adı (owner/repo) gereklidir.' });
    }
    const [owner, repoName] = resolvedFullName.split('/');

    if (isIssue) {
      const num = issueNumber || (taskId ? parseInt(String(taskId).replace('issue-', ''), 10) : null);
      if (num) {
        const result = await githubService.updateIssuePriority({
          owner,
          repo: repoName,
          issueNumber: num,
          newPriorityCode
        });

        if (newPriorityCode === 'P1') {
          telegramService.sendInstantP1Alert({
            repoName,
            title: taskTitle,
            issueNumber: num,
            action: 'escalated'
          }).catch(() => {});
        }

        return res.json({ success: true, mode: 'live', ...result });
      }
    }

    await githubService.changeTaskPriority({
      owner,
      repo: repoName,
      filePath: filePath || targetFileName,
      taskTitle: taskTarget(req.body),
      newPriorityCode
    });

    if (newPriorityCode === 'P1') {
      telegramService.sendInstantP1Alert({
        repoName,
        title: taskTitle,
        action: 'escalated'
      }).catch(() => {});
    }

    res.json({ success: true, mode: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/add
 */
app.post('/api/tasks/add', async (req, res) => {
  try {
    const { repoId, repoFullName, filePath, title, description, priorityCode, dueDate, estimate, milestone, assignees } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Görev açıklaması boş olamaz.' });
    }

    const source = githubService.taskSource || settingsService.get('taskSource', 'issues');
    const isAddingIssue = source === 'issues' || (!filePath || filePath === 'GitHub Issues');

    if (currentMode === 'demo') {
      const repo = findDemoRepo(req.body);
      if (!repo) return res.status(404).json({ error: 'Demo repo bulunamadı.' });

      if (isAddingIssue) {
        if (!Array.isArray(repo.issues)) repo.issues = [];
        const nextNumber = repo.issues.length > 0 ? Math.max(...repo.issues.map(i => i.issueNumber || 0)) + 1 : 101;
        const pCode = priorityCode || 'P2';
        const pRank = pCode === 'P1' ? 1 : pCode === 'P2' ? 2 : 3;
        const assigneeList = assignees
          ? (Array.isArray(assignees)
              ? assignees.map(a => typeof a === 'string' ? { login: a.replace(/^@/, '') } : a)
              : [{ login: String(assignees).replace(/^@/, '') }])
          : [];

        const newIssue = {
          id: `issue-${nextNumber}`,
          taskId: `issue-${nextNumber}`,
          issueNumber: nextNumber,
          issueUrl: `https://github.com/${repo.fullName}/issues/${nextNumber}`,
          title: title.trim(),
          description: description || '',
          completed: false,
          state: 'open',
          priorityRank: pRank,
          priorityCode: pCode,
          priorityLabel: `${pCode} ${pCode === 'P1' ? 'Acil' : pCode === 'P2' ? 'Normal' : 'Düşük'}`,
          dueDate: dueDate || null,
          isOverdue: dueDate ? (new Date(dueDate) < new Date()) : false,
          milestone: milestone || null,
          estimate: estimate || null,
          estimateHours: estimate ? (parseInt(estimate, 10) || null) : null,
          tags: [`#${pCode.toLowerCase()}`],
          commentsCount: 0,
          assignees: assigneeList,
          source: 'github-issue'
        };
        repo.issues.unshift(newIssue);
        saveDemoReposState();

        if (pCode === 'P1') {
          telegramService.sendInstantP1Alert({
            repoName: repo.name || repo.fullName,
            title: title.trim(),
            issueNumber: nextNumber,
            issueUrl: newIssue.issueUrl,
            dueDate,
            assignees: assigneeList,
            description,
            action: 'created'
          }).catch(() => {});
        }

        return res.json({ success: true, mode: 'demo', issue: newIssue });
      }

      repo.markdownContent = parserService.appendTaskToMarkdown(
        repo.markdownContent || '',
        title.trim(),
        priorityCode || 'P2',
        dueDate,
        estimate,
        milestone
      );
      saveDemoReposState();

      if ((priorityCode || 'P2') === 'P1') {
        telegramService.sendInstantP1Alert({
          repoName: repo.name || repo.fullName,
          title: title.trim(),
          dueDate,
          description,
          action: 'created'
        }).catch(() => {});
      }

      return res.json({ success: true, mode: 'demo' });
    }

    const resolvedFullName = await resolveRepoFullName(req.body);
    if (!resolvedFullName) {
      return res.status(400).json({ error: 'Geçersiz repo bilgisi. Tam repo adı (owner/repo) gereklidir.' });
    }
    const [owner, repoName] = resolvedFullName.split('/');

    if (isAddingIssue) {
      const assigneeArr = assignees
        ? (Array.isArray(assignees)
            ? assignees.map(a => typeof a === 'string' ? a.replace(/^@/, '').trim() : a.login)
            : [String(assignees).replace(/^@/, '').trim()]).filter(Boolean)
        : undefined;

      const created = await githubService.createIssue({
        owner,
        repo: repoName,
        title: title.trim(),
        body: description || '',
        priorityCode: priorityCode || 'P2',
        dueDate,
        assignees: assigneeArr && assigneeArr.length > 0 ? assigneeArr : undefined
      });

      if ((priorityCode || 'P2') === 'P1') {
        telegramService.sendInstantP1Alert({
          repoName,
          title: title.trim(),
          issueNumber: created?.issueNumber,
          issueUrl: created?.html_url || created?.issueUrl,
          dueDate,
          assignees: assigneeArr,
          description,
          action: 'created'
        }).catch(() => {});
      }

      return res.json({ success: true, mode: 'live', issue: created });
    }

    await githubService.addTask({
      owner,
      repo: repoName,
      filePath: filePath || targetFileName,
      title: title.trim(),
      priorityCode: priorityCode || 'P2',
      dueDate,
      estimate,
      milestone
    });

    if ((priorityCode || 'P2') === 'P1') {
      telegramService.sendInstantP1Alert({
        repoName,
        title: title.trim(),
        dueDate,
        description,
        action: 'created'
      }).catch(() => {});
    }

    res.json({ success: true, mode: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tasks/convert-to-issue - Convert task to GitHub Issue
 */
app.post('/api/tasks/convert-to-issue', async (req, res) => {
  try {
    const { repoId, repoFullName, filePath, taskTitle, priorityCode } = req.body;

    if (currentMode === 'demo') {
      const repo = findDemoRepo(req.body);
      if (!repo) return res.status(404).json({ error: 'Demo repo bulunamadı.' });
      
      const mockIssueNumber = Math.floor(Math.random() * 80 + 12);
      repo.markdownContent = parserService.attachIssueToTaskInMarkdown(repo.markdownContent, taskTarget(req.body), mockIssueNumber);
      
      if ((priorityCode || 'P2') === 'P1') {
        telegramService.sendInstantP1Alert({
          repoName: repo.name || repo.fullName,
          title: taskTarget(req.body),
          issueNumber: mockIssueNumber,
          issueUrl: `https://github.com/${repo.fullName}/issues/${mockIssueNumber}`,
          action: 'created'
        }).catch(() => {});
      }

      return res.json({
        success: true,
        mode: 'demo',
        issueNumber: mockIssueNumber,
        issueUrl: `https://github.com/${repo.fullName}/issues/${mockIssueNumber}`
      });
    }

    const resolvedFullName = await resolveRepoFullName(req.body);
    if (!resolvedFullName) {
      return res.status(400).json({ error: 'Geçersiz repo bilgisi. Tam repo adı (owner/repo) gereklidir.' });
    }
    const [owner, repoName] = resolvedFullName.split('/');
    const result = await githubService.convertTaskToIssue({
      owner,
      repo: repoName,
      filePath: filePath || targetFileName,
      taskTitle: taskTarget(req.body),
      priorityCode: priorityCode || 'P2'
    });

    if ((priorityCode || 'P2') === 'P1') {
      telegramService.sendInstantP1Alert({
        repoName,
        title: taskTarget(req.body),
        issueNumber: result?.issueNumber,
        issueUrl: result?.issueUrl,
        action: 'created'
      }).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/code-todos - Get scanned codebase TODOs
 */
app.get('/api/code-todos', async (req, res) => {
  const scanRoot = settingsService.get('localScanRoot', process.env.REPOPILOT_SCAN_ROOT || process.env.TASKDECK_SCAN_ROOT || '');
  let knownProjects = [];
  if (currentMode === 'live') {
    const ghRes = await githubService.getRepositories(false).catch(() => ({ data: [] }));
    knownProjects = ghRes.data || [];
  } else {
    knownProjects = demoReposState;
  }
  const todos = await scannerService.getCodeTodos(currentMode, scanRoot, knownProjects);
  res.json({ todos, scanRoot, mode: currentMode });
});

/**
 * POST /api/code-todos/transfer - Transfer a code todo to yapilacaklar.md
 */
app.post('/api/code-todos/transfer', async (req, res) => {
  try {
    const { todoId, repoId, repoName, content, priority, file, line } = req.body;
    if (!content) return res.status(400).json({ error: 'Görev içeriği belirtilmedi.' });
    const taskTitle = `${content} [${file || 'src'}:${line || 1}]`;

    if (currentMode === 'demo') {
      let repo = demoReposState.find(r => (repoId && r.id === repoId) || r.name === repoName || (r.fullName && r.fullName === repoName));
      if (!repo && demoReposState.length > 0) {
        repo = demoReposState[0];
      }
      if (repo) {
        if (Array.isArray(repo.issues)) {
          const nextNum = repo.issues.length > 0 ? Math.max(...repo.issues.map(i => i.issueNumber || 0)) + 1 : 120;
          repo.issues.push({
            id: `issue-${nextNum}`,
            issueNumber: nextNum,
            title: taskTitle,
            state: 'open',
            completed: false,
            priorityCode: priority || 'P2',
            priorityRank: priority === 'P1' ? 1 : priority === 'P2' ? 2 : 3,
            createdAt: new Date().toISOString()
          });
        }
        if (repo.markdownContent) {
          repo.markdownContent = parserService.appendTaskToMarkdown(repo.markdownContent, taskTitle, priority || 'P2');
        }
        saveDemoReposState();
      }
    } else {
      const ghRes = await githubService.getRepositories(false);
      const repo = (ghRes.data || []).find(r => (repoId && r.id === repoId) || r.name === repoName || r.fullName === repoName);
      if (!repo) {
        return res.status(404).json({ error: `"${repoName || repoId}" projesi GitHub üzerinde bulunamadı.` });
      }
      const [owner, rName] = repo.fullName.split('/');
      await githubService.addTask({
        owner,
        repo: rName,
        filePath: repo.filePath || targetFileName,
        title: taskTitle,
        priorityCode: priority || 'P2'
      });
    }

    scannerService.dismissCodeTodo(todoId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/telegram/send-digest - Send or test Telegram notifications
 * Supports scenario: 'morning' | 'p1' | 'deadline' | 'evening'
 */
app.post('/api/telegram/send-digest', async (req, res) => {
  try {
    const scenario = req.body?.scenario || 'morning';
    let projects = [];
    if (currentMode === 'demo') {
      projects = demoReposState.map(enrichRepoWithParsedTasks);
    } else {
      const result = await githubService.getRepositories(false);
      projects = result.data;
    }

    let result;
    if (scenario === 'p1') {
      result = await telegramService.sendInstantP1Alert({
        repoName: projects[0]?.name || 'Repo Pilot',
        title: req.body?.title || 'Örnek Kritik Görev (Test Alarmı)',
        issueNumber: 101,
        dueDate: new Date().toISOString().split('T')[0],
        assignees: ['@developer'],
        description: 'Bu bir anlık P1 kritik görev test bildirimidir. Sistemde acil bir görev açıldığında veya önceliği P1 yapıldığında otomatik iletilir.',
        action: 'created'
      });
    } else if (scenario === 'deadline') {
      result = await telegramService.sendDeadlineReminder(projects, true);
    } else if (scenario === 'evening') {
      result = await telegramService.sendEveningDigest(projects, true);
    } else {
      result = await telegramService.sendDailyDigest(projects);
    }

    res.json({ success: true, scenario, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/telegram/test-connection - Test Bot token, auto-detect chat ID and send confirmation
 */
app.post('/api/telegram/test-connection', async (req, res) => {
  try {
    const { token, chatId } = req.body;
    const botToken = (token || telegramService.botToken || '').trim();
    const resolvedChatId = (chatId || telegramService.chatId || '').trim();

    if (!botToken) {
      return res.status(400).json({ error: 'Telegram Bot Token girilmedi. Lütfen @BotFather tarafından verilen tokenı girin.' });
    }

    const result = await telegramService.testConnection(botToken, resolvedChatId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/webhook - GitHub Webhook Endpoint
 */
app.post('/api/webhook', securityService.webhook, async (req, res) => {
  if (currentMode !== 'live') return res.json({ received: true, skipped: 'demo' });
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'push' && payload && payload.repository) {
    const repoFullName = payload.repository.full_name;
    const commits = payload.commits || [];

    // Check for commit messages with (done: ...) or (fixes: ...)
    for (const commit of commits) {
      const msg = commit.message || '';
      const doneMatch = msg.match(/(?:done|fixes|resolves):\s*([a-zA-Z0-9_\-\s]+)/i);
      if (doneMatch) {
        const taskKeyword = doneMatch[1].trim();
        const resolvedFullName = await resolveRepoFullName(req.body);
    if (!resolvedFullName) {
      return res.status(400).json({ error: 'Geçersiz repo bilgisi. Tam repo adı (owner/repo) gereklidir.' });
    }
    const [owner, repoName] = resolvedFullName.split('/');
        try {
          await githubService.toggleTask({
            owner,
            repo: repoName,
            filePath: targetFileName,
            taskTitle: taskKeyword,
            targetState: true
          });
        } catch (e) {
          console.error('Webhook görev tamamlama hatası:', e.message);
        }
      }
    }

    githubService.invalidateCache();
    return res.json({ success: true, message: 'Webhook işlendi ve önbellek sıfırlandı.' });
  }

  res.json({ received: true });
});

/**
 * GET /api/schedule - Aggregated calendar, milestones, and workloads
 */
app.get('/api/schedule', async (req, res) => {
  try {
    let projects = [];
    if (currentMode === 'demo') {
      projects = demoReposState.map(enrichRepoWithParsedTasks);
    } else {
      const result = await githubService.getRepositories(false);
      projects = result.data;
    }

    const summary = calendarService.getScheduleSummary(projects);
    res.json({ success: true, mode: currentMode, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/calendar.ics - Standard iCalendar feed for Google Calendar / Apple Calendar
 */
app.get('/api/calendar.ics', async (req, res) => {
  try {
    let projects = [];
    if (currentMode === 'demo') {
      projects = demoReposState.map(enrichRepoWithParsedTasks);
    } else {
      const result = await githubService.getRepositories(false);
      projects = result.data;
    }

    const icsContent = calendarService.generateIcs(projects);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="repopilot.ics"');
    res.send(icsContent);
  } catch (err) {
    res.status(500).send('iCal feed oluşturulamadı.');
  }
});

/**
 * POST /api/tasks/schedule - Assign or change deadline date of a task
 */
app.post('/api/tasks/schedule', async (req, res) => {
  try {
    const { repoId, repoFullName, filePath, taskId, issueNumber, taskTitle, date, timeSlot, estimate } = req.body;
    if (!taskTitle || !date) {
      return res.status(400).json({ error: 'Görev adı ve tarih zorunludur.' });
    }

    const isIssue = (taskId && String(taskId).startsWith('issue-')) || issueNumber || req.body.source === 'github-issue';

    if (currentMode === 'demo') {
      let repo = findDemoRepo(req.body);
      if (!repo && demoReposState.length > 0) {
        repo = demoReposState[0];
      }
      if (!repo) return res.status(404).json({ error: 'Demo repo bulunamadı.' });

      if (Array.isArray(repo.issues)) {
        const num = issueNumber || (taskId ? parseInt(String(taskId).replace('issue-', ''), 10) : null);
        let iss = repo.issues.find(i => (num && i.issueNumber === num) || i.title === taskTitle || i.id === taskId);
        if (iss) {
          iss.dueDate = date;
          if (timeSlot) iss.timeSlot = timeSlot;
          if (estimate) iss.estimate = estimate;
          iss.isOverdue = new Date(date) < new Date() && !iss.completed;
          saveDemoReposState();
          return res.json({ success: true, mode: 'demo', issue: iss });
        } else {
          const nextNum = repo.issues.length > 0 ? Math.max(...repo.issues.map(i => i.issueNumber || 0)) + 1 : 110;
          const newIssue = {
            id: `issue-${nextNum}`,
            issueNumber: nextNum,
            title: taskTitle,
            state: 'open',
            completed: false,
            priorityCode: req.body.priority || 'P2',
            priorityRank: req.body.priority === 'P1' ? 1 : req.body.priority === 'P2' ? 2 : 3,
            dueDate: date,
            timeSlot: timeSlot || null,
            estimate: estimate || null,
            isOverdue: new Date(date) < new Date(),
            createdAt: new Date().toISOString()
          };
          repo.issues.push(newIssue);
          saveDemoReposState();
          return res.json({ success: true, mode: 'demo', issue: newIssue });
        }
      }

      if (repo.markdownContent) {
        try {
          repo.markdownContent = parserService.scheduleTaskInMarkdown(repo.markdownContent, taskTarget(req.body), date);
        } catch (e) {
          repo.markdownContent = parserService.appendTaskToMarkdown(repo.markdownContent, taskTitle, req.body.priority || 'P2', date);
        }
        saveDemoReposState();
      }
      return res.json({ success: true, mode: 'demo' });
    }

    const resolvedFullName = await resolveRepoFullName(req.body);
    if (!resolvedFullName) {
      return res.status(400).json({ error: 'Geçersiz repo bilgisi. Tam repo adı (owner/repo) gereklidir.' });
    }
    const [owner, repoName] = resolvedFullName.split('/');

    if (isIssue) {
      const num = issueNumber || (taskId ? parseInt(String(taskId).replace('issue-', ''), 10) : null);
      if (num) {
        const result = await githubService.scheduleIssue({
          owner,
          repo: repoName,
          issueNumber: num,
          targetDate: date
        });
        return res.json({ success: true, mode: 'live', ...result });
      }
    }

    await githubService.scheduleTask({
      owner,
      repo: repoName,
      filePath: filePath || targetFileName,
      taskTitle: taskTarget(req.body),
      newDate: date
    });

    res.json({ success: true, mode: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/demo/reset
 */
app.post('/api/demo/reset', (req, res) => {
  demoReposState = JSON.parse(JSON.stringify(DEMO_REPOSITORIES));
  saveDemoReposState();
  res.json({ success: true, message: 'Demo verileri sıfırlandı.' });
});

/**
 * Helper: Fetch current projects for Telegram digests
 */
async function getProjectsForTelegram() {
  if (currentMode === 'demo') {
    return demoReposState.map(enrichRepoWithParsedTasks);
  }
  const resData = await githubService.getRepositories(true);
  return resData.data;
}

// 1. Sabah Özeti: Her sabah saat 09:00'da
cron.schedule('0 9 * * *', async () => {
  if (telegramService.isConfigured()) {
    try {
      const projects = await getProjectsForTelegram();
      await telegramService.sendDailyDigest(projects);
      console.log('⏰ [Telegram] 09:00 Sabah Özeti başarıyla iletildi.');
    } catch (e) {
      console.error('Zamanlanmış Telegram 09:00 Sabah Özeti hatası:', e.message);
    }
  }
});

// 2. Teslim Tarihi & Gecikme Hatırlatması: Hafta içi her gün 16:00'da
cron.schedule('0 16 * * 1-5', async () => {
  if (telegramService.isConfigured()) {
    try {
      const projects = await getProjectsForTelegram();
      const res = await telegramService.sendDeadlineReminder(projects);
      if (res && res.skipped) {
        console.log('⏰ [Telegram] 16:00 Teslimat hatırlatması atlandı (Yarına teslim veya geciken iş yok).');
      } else {
        console.log('⏰ [Telegram] 16:00 Teslim Tarihi Hatırlatıcısı başarıyla iletildi.');
      }
    } catch (e) {
      console.error('Zamanlanmış Telegram 16:00 Hatırlatıcı hatası:', e.message);
    }
  }
});

// 3. Gün Sonu Kapanış Raporu: Hafta içi her gün 18:00'de
cron.schedule('0 18 * * 1-5', async () => {
  if (telegramService.isConfigured()) {
    try {
      const projects = await getProjectsForTelegram();
      await telegramService.sendEveningDigest(projects);
      console.log('⏰ [Telegram] 18:00 Gün Sonu Kapanış Raporu başarıyla iletildi.');
    } catch (e) {
      console.error('Zamanlanmış Telegram 18:00 Gün Sonu Raporu hatası:', e.message);
    }
  }
});

const HOST = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(HOST) && !(process.env.REPOPILOT_API_TOKEN || process.env.TASKDECK_API_TOKEN)) {
  throw new Error('Ağ erişimi için REPOPILOT_API_TOKEN yapılandırılmalıdır.');
}
app.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Repo Pilot Geliştirici Komuta Merkezi: http://localhost:${PORT}`);
  console.log(`Mod: [${currentMode.toUpperCase()}]`);
  console.log(`======================================================\n`);
});
