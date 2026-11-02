/**
 * GitHub API Integration Service
 * Handles repository fetching, markdown file reading, caching, committing changes, and GitHub Issues.
 */

const parserService = require('./parserService');
const settingsService = require('./settingsService');

class GitHubService {
  constructor() {
    this.token = settingsService.get('token', process.env.GITHUB_TOKEN || '');
    this.username = settingsService.get('username', process.env.GITHUB_USERNAME || '');
    this.taskSource = settingsService.get('taskSource', 'issues'); // 'issues', 'file', 'both'
    const savedPending = settingsService.get('pendingIssues', {});
    this.pendingIssues = new Map(Object.entries(savedPending));
    this.targetFiles = ['yapilacaklar.md', 'YAPILACAKLAR.md', 'todo.md', 'TODO.md'];
    
    // In-memory cache to prevent GitHub rate limits
    this.cache = {
      repos: null,
      lastFetched: 0,
      ttl: 5 * 60 * 1000 // 5 minutes TTL
    };
  }

  savePendingIssues() {
    const serialized = {};
    for (const [k, v] of this.pendingIssues.entries()) {
      serialized[k] = { ...v, busy: false };
    }
    settingsService.save({ pendingIssues: serialized });
  }

  updateConfig(token, username, targetFiles, taskSource) {
    if (token !== undefined) this.token = token.trim();
    if (username !== undefined) this.username = username.trim();
    if (Array.isArray(targetFiles) && targetFiles.length > 0) {
      this.targetFiles = targetFiles;
    }
    if (taskSource !== undefined) {
      this.taskSource = taskSource;
    }
    this.invalidateCache();
  }

  invalidateCache() {
    this.cache.repos = null;
    this.cache.lastFetched = 0;
  }

  getHeaders() {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'RepoPilot-App'
    };
    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }
    return headers;
  }

  /**
   * Test connection to GitHub API with provided credentials
   */
  async testConnection(token, username) {
    const authHeader = token ? { 'Authorization': `token ${token}` } : {};
    const url = token ? 'https://api.github.com/user' : `https://api.github.com/users/${username}`;
    
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RepoPilot-App',
        ...authHeader
      }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API Hatası: HTTP ${res.status}`);
    }

    const userData = await res.json();
    return {
      success: true,
      user: {
        login: userData.login,
        name: userData.name || userData.login,
        avatar_url: userData.avatar_url,
        public_repos: userData.public_repos,
        total_private_repos: userData.total_private_repos || 0
      }
    };
  }

  /**
   * Parse a raw GitHub Issue into a TaskDeck task object
   */
  parseIssueToTask(issue, repoOwner, repoName) {
    let priorityRank = 3;
    let priorityCode = 'P3';
    let priorityLabel = 'P3 Düşük';

    const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));
    const labelLower = labels.map(l => l.toLowerCase());

    if (labelLower.some(l => l.includes('p1') || l.includes('critical') || l.includes('urgent') || l.includes('bug') || l.includes('blocker') || l.includes('high'))) {
      priorityRank = 1;
      priorityCode = 'P1';
      priorityLabel = 'P1 Acil';
    } else if (labelLower.some(l => l.includes('p2') || l.includes('medium') || l.includes('enhancement') || l.includes('feature'))) {
      priorityRank = 2;
      priorityCode = 'P2';
      priorityLabel = 'P2 Normal';
    }

    const tags = [];
    labels.forEach(l => tags.push(`#${l}`));
    (issue.assignees || []).forEach(a => tags.push(`@${a.login}`));

    let dueDate = null;
    let milestone = null;
    if (issue.milestone) {
      milestone = issue.milestone.title;
      if (issue.milestone.due_on) {
        dueDate = issue.milestone.due_on.split('T')[0];
      }
    }

    const dateMatch = (issue.title + ' ' + (issue.body || '')).match(/(?:📅|due:\s*|~)(\d{4}-\d{2}-\d{2})/i);
    if (dateMatch && !dueDate) {
      dueDate = dateMatch[1];
    }

    let estimate = null;
    let estimateHours = 1;
    const estMatch = (issue.title + ' ' + (issue.body || '')).match(/\(est:\s*([^)]+)\)|(?:estimate:\s*([0-9a-z]+))/i);
    if (estMatch) {
      estimate = (estMatch[1] || estMatch[2]).trim();
      const numMatch = estimate.match(/(\d+)/);
      if (numMatch) estimateHours = parseInt(numMatch[1], 10);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const isOverdue = Boolean(dueDate && dueDate < todayStr && issue.state === 'open');

    return {
      id: `issue-${issue.number}`,
      taskId: `issue-${issue.number}`,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      title: issue.title,
      description: issue.body || '',
      rawText: issue.title,
      completed: issue.state === 'closed',
      state: issue.state,
      priorityRank,
      priorityCode,
      priorityLabel,
      dueDate,
      isOverdue,
      milestone,
      milestoneNumber: issue.milestone?.number || null,
      estimate,
      estimateHours,
      tags,
      commentsCount: issue.comments || 0,
      assignees: (issue.assignees || []).map(a => ({ login: a.login, avatarUrl: a.avatar_url })),
      source: 'github-issue'
    };
  }

  async fetchRepoIssues(owner, repoName) {
    try {
      const url = `https://api.github.com/repos/${owner}/${repoName}/issues?state=all&per_page=100&sort=updated`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) return [];
      const rawIssues = await res.json();
      if (!Array.isArray(rawIssues)) return [];
      return rawIssues
        .filter(issue => !issue.pull_request)
        .map(issue => this.parseIssueToTask(issue, owner, repoName));
    } catch (e) {
      return [];
    }
  }

  mergeIssuesAndFileTasks(issues, fileTasks) {
    const issueMap = new Map();
    issues.forEach(iss => issueMap.set(iss.issueNumber, iss));

    const merged = [...issues];
    (fileTasks || []).forEach(ft => {
      if (ft.issueNumber && issueMap.has(ft.issueNumber)) {
        return;
      }
      merged.push(ft);
    });
    return merged;
  }

  /**
   * Fetch all repositories and their tasks (via GitHub Issues and/or yapilacaklar.md)
   */
  async getRepositories(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cache.repos && (now - this.cache.lastFetched < this.cache.ttl)) {
      return { fromCache: true, data: this.cache.repos };
    }

    let reposUrl = 'https://api.github.com/user/repos?per_page=100&sort=updated';
    if (!this.token && this.username) {
      reposUrl = `https://api.github.com/users/${this.username}/repos?per_page=100&sort=updated`;
    } else if (!this.token && !this.username) {
      throw new Error('GitHub Token veya Kullanıcı Adı girilmelidir.');
    }

    const rawRepos = [];
    while (reposUrl) {
      const reposRes = await fetch(reposUrl, { headers: this.getHeaders() });
      if (!reposRes.ok) {
        const err = await reposRes.json().catch(() => ({}));
        throw new Error(err.message || `Repolar çekilemedi: HTTP ${reposRes.status}`);
      }
      rawRepos.push(...await reposRes.json());
      const next = (reposRes.headers.get('link') || '').split(',').find(link => /rel="next"/.test(link));
      reposUrl = next ? next.match(/<([^>]+)>/)[1] : null;
      if (reposUrl && new URL(reposUrl).origin !== 'https://api.github.com') throw new Error('Geçersiz GitHub sayfalama adresi.');
    }
    const resultRepos = [];

    await Promise.all(
      rawRepos.map(async (repo) => {
        let repoTasks = [];
        let fileData = null;

        // Fetch tasks based on configured source: 'issues' (default), 'file', or 'both'
        if (this.taskSource === 'issues' || this.taskSource === 'both') {
          const issues = await this.fetchRepoIssues(repo.owner.login, repo.name);
          repoTasks.push(...issues);
        }

        if (this.taskSource === 'file' || this.taskSource === 'both') {
          fileData = await this.findAndFetchTargetFile(repo.owner.login, repo.name);
          if (fileData) {
            const fileTasks = parserService.parseTasks(fileData.content);
            if (this.taskSource === 'both') {
              repoTasks = this.mergeIssuesAndFileTasks(repoTasks, fileTasks);
            } else {
              repoTasks = fileTasks;
            }
          }
        }

        // Only include repositories that have active tasks or issues
        if (repoTasks.length > 0) {
          const completedCount = repoTasks.filter(t => t.completed).length;
          const totalCount = repoTasks.length;
          const pendingCount = totalCount - completedCount;
          const p1Count = repoTasks.filter(t => !t.completed && t.priorityRank === 1).length;
          const p2Count = repoTasks.filter(t => !t.completed && t.priorityRank === 2).length;
          const p3Count = repoTasks.filter(t => !t.completed && t.priorityRank === 3).length;
          const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

          // Days since last update & stale radar
          const updatedDate = new Date(repo.updated_at);
          const daysSinceUpdate = Math.max(0, Math.floor((now - updatedDate.getTime()) / (1000 * 60 * 60 * 24)));
          const isStale = daysSinceUpdate >= 14 && p1Count > 0;

          // Health Score Calculation (0 - 100)
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

          resultRepos.push({
            id: `repo-${repo.id}`,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description || 'Açıklama belirtilmemiş.',
            url: repo.html_url,
            language: repo.language || 'Diğer',
            isPrivate: repo.private,
            updatedAt: repo.updated_at,
            daysSinceUpdate,
            isStale,
            health: {
              score: healthScore,
              grade: healthGrade,
              color: healthColor
            },
            filePath: fileData ? fileData.path : 'GitHub Issues',
            fileSha: fileData ? fileData.sha : null,
            tasks: repoTasks,
            stats: {
              total: totalCount,
              completed: completedCount,
              pending: pendingCount,
              p1Count: p1Count,
              p2Count: p2Count,
              p3Count: p3Count,
              completionPercentage: completionPercentage
            }
          });
        }
      })
    );

    resultRepos.sort((a, b) => {
      if (b.stats.p1Count !== a.stats.p1Count) {
        return b.stats.p1Count - a.stats.p1Count;
      }
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    this.cache.repos = resultRepos;
    this.cache.lastFetched = now;

    return { fromCache: false, data: resultRepos };
  }

  async findAndFetchTargetFile(owner, repoName) {
    for (const fileName of this.targetFiles) {
      const fileUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${fileName}`;
      const res = await fetch(fileUrl, { headers: this.getHeaders() });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`${owner}/${repoName}/${fileName} okunamadı: HTTP ${res.status}`);
      const data = await res.json();
      if (data.type === 'file' && typeof data.content === 'string') {
        return { path: fileName, sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf-8') };
      }
      throw new Error(`${owner}/${repoName}/${fileName} geçerli bir görev dosyası değil.`);
    }
    return null;
  }

  async toggleTask({ owner, repo, filePath, taskTitle, targetState }) {
    if (!this.token) {
      throw new Error('Görev durumunu GitHub üzerinde güncellemek için Personal Access Token gereklidir.');
    }

    const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const getRes = await fetch(fileUrl, { headers: this.getHeaders() });
    if (!getRes.ok) {
      throw new Error(`Dosya okunamadı: HTTP ${getRes.status}`);
    }
    const currentData = await getRes.json();
    const currentContent = Buffer.from(currentData.content, 'base64').toString('utf-8');
    const currentSha = currentData.sha;

    const updatedContent = parserService.updateTaskInMarkdown(currentContent, taskTitle, targetState);

    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message: `docs: update task status in ${filePath} [skip ci]`,
        content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
        sha: currentSha
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub'a commit atılamadı: HTTP ${putRes.status}`);
    }

    this.invalidateCache();
    return { success: true };
  }

  async changeTaskPriority({ owner, repo, filePath, taskTitle, newPriorityCode }) {
    if (!this.token) {
      throw new Error('Öncelik değiştirmek için Personal Access Token gereklidir.');
    }

    const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const getRes = await fetch(fileUrl, { headers: this.getHeaders() });
    if (!getRes.ok) throw new Error(`Dosya okunamadı: HTTP ${getRes.status}`);

    const currentData = await getRes.json();
    const currentContent = Buffer.from(currentData.content, 'base64').toString('utf-8');
    const currentSha = currentData.sha;

    const updatedContent = parserService.changePriorityInMarkdown(currentContent, taskTitle, newPriorityCode);

    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message: `docs: update task priority to [${newPriorityCode}] in ${filePath} [skip ci]`,
        content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
        sha: currentSha
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub'a commit atılamadı: HTTP ${putRes.status}`);
    }

    this.invalidateCache();
    return { success: true };
  }

  async scheduleTask({ owner, repo, filePath, taskTitle, newDate }) {
    if (!this.token) {
      throw new Error('Görev tarihi güncellemek için Personal Access Token gereklidir.');
    }

    const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const getRes = await fetch(fileUrl, { headers: this.getHeaders() });
    if (!getRes.ok) throw new Error(`Dosya okunamadı: HTTP ${getRes.status}`);

    const currentData = await getRes.json();
    const currentContent = Buffer.from(currentData.content, 'base64').toString('utf-8');
    const currentSha = currentData.sha;

    const updatedContent = parserService.scheduleTaskInMarkdown(currentContent, taskTitle, newDate);

    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message: `docs: schedule task to ${newDate} in ${filePath} [skip ci]`,
        content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
        sha: currentSha
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `GitHub'a commit atılamadı: HTTP ${putRes.status}`);
    }

    this.invalidateCache();
    return { success: true };
  }

  async addTask({ owner, repo, filePath, title, priorityCode, dueDate, estimate, milestone }) {
    if (!this.token) {
      throw new Error('GitHub üzerinde görev eklemek için Personal Access Token gereklidir.');
    }

    const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    let currentContent = '';
    let currentSha = null;

    const getRes = await fetch(fileUrl, { headers: this.getHeaders() });
    if (getRes.ok) {
      const currentData = await getRes.json();
      currentContent = Buffer.from(currentData.content, 'base64').toString('utf-8');
      currentSha = currentData.sha;
    } else if (getRes.status !== 404) {
      throw new Error(`Dosya okunamadı: HTTP ${getRes.status}`);
    }

    const updatedContent = parserService.appendTaskToMarkdown(currentContent, title, priorityCode, dueDate, estimate, milestone);

    const bodyPayload = {
      message: `docs: add new task to ${filePath} [skip ci]`,
      content: Buffer.from(updatedContent, 'utf-8').toString('base64')
    };
    if (currentSha) {
      bodyPayload.sha = currentSha;
    }

    const putRes = await fetch(fileUrl, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(bodyPayload)
    });

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `Görev eklenemedi: HTTP ${putRes.status}`);
    }

    this.invalidateCache();
    return { success: true };
  }

  /**
   * Convert a task into an official GitHub Issue
   */
  async convertTaskToIssue({ owner, repo, filePath, taskTitle, priorityCode }) {
    if (!this.token) {
      throw new Error('GitHub Issue oluşturmak için Personal Access Token gereklidir.');
    }

    const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const initialRes = await fetch(fileUrl, { headers: this.getHeaders() });
    if (!initialRes.ok) throw new Error(`Dosya okunamadı: HTTP ${initialRes.status}`);
    const initialData = await initialRes.json();
    const task = parserService.findTask(Buffer.from(initialData.content, 'base64').toString('utf-8'), taskTitle);
    if (task.issueNumber) return { success: true, issueNumber: task.issueNumber, issueUrl: `https://github.com/${owner}/${repo}/issues/${task.issueNumber}` };
    const key = `${owner}/${repo}/${filePath}/${task.id}`;
    if (this.pendingIssues.get(key)?.busy) throw new Error('Bu görev için Issue işlemi sürüyor.');
    const remembered = this.pendingIssues.get(key);
    this.pendingIssues.set(key, { ...remembered, busy: true });
    try {
    // Retry links the existing Issue instead of creating another one.
    const issuesUrl = `https://api.github.com/repos/${owner}/${repo}/issues`;
    let issueData = remembered?.issue;
    if (!issueData) {
    const issueRes = await fetch(issuesUrl, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        title: task.title,
        body: `Bu issue **Repo Pilot** üzerinden \`${filePath}\` dosyasındaki [${priorityCode}] öncelikli görevden otomatik oluşturuldu.\n\n---\n*Öncelik: ${priorityCode}*`,
        labels: ['repopilot', priorityCode.toLowerCase()]
      })
    });

    if (!issueRes.ok) {
      const err = await issueRes.json().catch(() => ({}));
      throw new Error(err.message || `Issue oluşturulamadı: HTTP ${issueRes.status}`);
    }

    issueData = await issueRes.json();
    this.pendingIssues.set(key, { busy: true, issue: issueData });
    this.savePendingIssues();
    }
    const issueNumber = issueData.number;
    const issueUrl = issueData.html_url;

    const getRes = await fetch(fileUrl, { headers: this.getHeaders() });
    if (!getRes.ok) throw new Error(`Issue #${issueNumber} oluşturuldu, görev dosyası okunamadı: HTTP ${getRes.status}`);
    {
      const currentData = await getRes.json();
      const currentContent = Buffer.from(currentData.content, 'base64').toString('utf-8');
      const updatedContent = parserService.attachIssueToTaskInMarkdown(currentContent, taskTitle, issueNumber);

      const linkRes = await fetch(fileUrl, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({
          message: `docs: link issue #${issueNumber} to task in ${filePath} [skip ci]`,
          content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
          sha: currentData.sha
        })
      });
      if (!linkRes.ok) throw new Error(`Issue #${issueNumber} oluşturuldu, Markdown bağlantısı yazılamadı: HTTP ${linkRes.status}`);
    }

    this.pendingIssues.delete(key);
    this.savePendingIssues();
    this.invalidateCache();
    return { success: true, issueNumber, issueUrl };
    } catch (error) {
      const pending = this.pendingIssues.get(key);
      if (pending?.issue) {
        this.pendingIssues.set(key, { ...pending, busy: false });
        this.savePendingIssues();
        return { success: false, partial: true, issueNumber: pending.issue.number, issueUrl: pending.issue.html_url, error: `${error.message} Tekrar deneme mevcut Issue'yu bağlar; yeni Issue oluşturmaz.` };
      }
      this.pendingIssues.delete(key);
      this.savePendingIssues();
      throw error;
    }
  }

  /**
   * Directly toggle state of a GitHub Issue (open / closed)
   */
  async toggleIssueState({ owner, repo, issueNumber, completed }) {
    if (!this.token) throw new Error('GitHub Issue güncellemek için Personal Access Token gereklidir.');
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ state: completed ? 'closed' : 'open' })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Issue güncellenemedi: HTTP ${res.status}`);
    }
    this.invalidateCache();
    return await res.json();
  }

  /**
   * Update priority label of a GitHub Issue (P1 / P2 / P3)
   */
  async updateIssuePriority({ owner, repo, issueNumber, newPriorityCode }) {
    if (!this.token) throw new Error('GitHub Issue güncellemek için Personal Access Token gereklidir.');
    const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const issueRes = await fetch(issueUrl, { headers: this.getHeaders() });
    if (!issueRes.ok) throw new Error('Issue bilgisi alınamadı.');
    const issueData = await issueRes.json();

    const oldLabels = (issueData.labels || []).map(l => (typeof l === 'string' ? l : l.name));
    const cleanLabels = oldLabels.filter(l => !['p1', 'p2', 'p3', 'priority: high', 'priority: medium', 'priority: low'].includes(l.toLowerCase()));
    cleanLabels.push(newPriorityCode);

    const labelRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ labels: cleanLabels })
    });
    if (!labelRes.ok) throw new Error('Öncelik etiketi güncellenemedi.');
    this.invalidateCache();
    return true;
  }

  /**
   * Create a new GitHub Issue directly on repository
   */
  async createIssue({ owner, repo, title, body, priorityCode, milestoneNumber, dueDate, assignees }) {
    if (!this.token) throw new Error('GitHub Issue oluşturmak için Personal Access Token gereklidir.');
    const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
    const labels = [priorityCode || 'P2'];
    let fullBody = body || 'Repo Pilot üzerinden oluşturuldu.';
    if (dueDate && !fullBody.includes(dueDate)) {
      fullBody += `\n\n📅 ${dueDate}`;
    }

    const payload = {
      title,
      body: fullBody,
      labels
    };
    if (milestoneNumber) payload.milestone = milestoneNumber;
    if (Array.isArray(assignees) && assignees.length > 0) {
      payload.assignees = assignees;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Issue oluşturulamadı: HTTP ${res.status}`);
    }
    this.invalidateCache();
    return await res.json();
  }

  /**
   * Schedule a GitHub Issue to a date
   */
  async scheduleIssue({ owner, repo, issueNumber, targetDate }) {
    if (!this.token) throw new Error('GitHub Issue planlamak için Personal Access Token gereklidir.');
    const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    const issueRes = await fetch(issueUrl, { headers: this.getHeaders() });
    if (!issueRes.ok) throw new Error('Issue bilgisi alınamadı.');
    const issueData = await issueRes.json();

    let body = issueData.body || '';
    if (/(?:📅|due:\s*)(\d{4}-\d{2}-\d{2})/i.test(body)) {
      body = body.replace(/(?:📅|due:\s*)(\d{4}-\d{2}-\d{2})/i, `📅 ${targetDate}`);
    } else {
      body = `${body}\n\n📅 ${targetDate}`.trim();
    }

    const patchRes = await fetch(issueUrl, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ body })
    });
    if (!patchRes.ok) throw new Error('Teslim tarihi kaydedilemedi.');
    this.invalidateCache();
    return true;
  }
}

module.exports = new GitHubService();
