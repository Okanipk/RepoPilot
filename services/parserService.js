/**
 * Parser Service for `yapilacaklar.md` (and TODO.md) files.
 * Extracts tasks, priorities, deadlines, time estimates, milestones, and tags.
 */

const crypto = require('crypto');
const { today, validDate } = require('./dateService');
const PRIORITY_REGEX = /(?:\[(?<bracket>P[1-4]|acil|urgent|critical|y[uü]ksek|high|orta|medium|normal|d[uü][sş][uü]k|low|fikir|idea)\]|\((?<paren>P[1-4]|acil|urgent|critical|y[uü]ksek|high|orta|medium|normal|d[uü][sş][uü]k|low|fikir|idea)\)|^(?<bare>P[1-4])(?=\s|:|$):?)/i;

const PRIORITY_MAP = {
  // P1 - Critical / Urgent / High
  'p1': { rank: 1, label: 'P1 - Acil', color: 'red' },
  'acil': { rank: 1, label: 'P1 - Acil', color: 'red' },
  'urgent': { rank: 1, label: 'P1 - Acil', color: 'red' },
  'critical': { rank: 1, label: 'P1 - Acil', color: 'red' },
  'yuksek': { rank: 1, label: 'P1 - Yüksek', color: 'red' },
  'yüksek': { rank: 1, label: 'P1 - Yüksek', color: 'red' },
  'high': { rank: 1, label: 'P1 - Yüksek', color: 'red' },

  // P2 - Medium / Normal
  'p2': { rank: 2, label: 'P2 - Orta', color: 'orange' },
  'orta': { rank: 2, label: 'P2 - Orta', color: 'orange' },
  'medium': { rank: 2, label: 'P2 - Orta', color: 'orange' },
  'normal': { rank: 2, label: 'P2 - Normal', color: 'orange' },

  // P3 - Low
  'p3': { rank: 3, label: 'P3 - Düşük', color: 'blue' },
  'dusuk': { rank: 3, label: 'P3 - Düşük', color: 'blue' },
  'düşük': { rank: 3, label: 'P3 - Düşük', color: 'blue' },
  'low': { rank: 3, label: 'P3 - Düşük', color: 'blue' },

  // P4 - Minor / Idea / Backlog
  'p4': { rank: 4, label: 'P4 - Fikir', color: 'gray' },
  'fikir': { rank: 4, label: 'P4 - Fikir', color: 'gray' },
  'idea': { rank: 4, label: 'P4 - Fikir', color: 'gray' }
};

/**
 * Parses raw markdown content into structured task objects with scheduling metadata.
 * @param {string} markdown - The markdown content of yapilacaklar.md
 * @returns {Array} Array of parsed tasks
 */
function parseTasks(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return [];
  }

  const lines = markdown.split('\n');
  const tasks = [];

  const taskRegex = /^\s*(?:[-*+]|\d+\.)\s+\[(?<status>[\sxX])\]\s*(?<content>.+)$/;
  const priorityRegex = PRIORITY_REGEX;
  const tagRegex = /(?:^|\s)(#[a-zA-Z0-9_-]+|@[a-zA-Z0-9_-]+)/g;
  const issueLinkRegex = /#(\d+)/;
  // Date patterns: ~2026-10-30 or [deadline: 2026-10-30] or (tarih: 2026-10-30) or @date:2026-10-30
  const dateRegex = /(?:~|@date:|\[(?:deadline|tarih):\s*|\((?:deadline|tarih):\s*)(?<isoDate>\d{4}-\d{2}-\d{2})(?:\]|\))?/i;
  // Estimate patterns: (est: 2h), [est: 4h], ~3h, (2h), (45m), (1d)
  const estimateRegex = /(?:~|\((?:est:\s*)?|\[(?:est:\s*)?)(?<val>\d+(?:\.\d+)?)\s*(?<unit>h|hour|saat|m|min|dakika|d|gun|gün)(?:\)|\])?/i;
  // Milestone / Sprint patterns: %v1.2, [milestone: v1.0], [sprint: 3], [v2.0]
  const milestoneRegex = /(?:%|\[milestone:\s*|\[sprint:\s*)(?<msName>[a-zA-Z0-9_.\-]+)\]?/i;

  const todayStr = today();
  const todayTimestamp = new Date(todayStr).getTime();

  lines.forEach((line, index) => {
    const match = line.match(taskRegex);
    if (!match) return;

    const isCompleted = match.groups.status.trim().toLowerCase() === 'x';
    const persistedId = match.groups.content.match(/<!--\s*(?:repopilot|taskdeck):([a-f0-9-]+)\s*-->/i);
    let rawContent = match.groups.content.replace(/<!--\s*(?:repopilot|taskdeck):[a-f0-9-]+\s*-->/ig, '').trim();

    // 1. Priority
    let priority = { rank: 3, label: 'P3 - Düşük', color: 'blue' };
    const priorityMatch = rawContent.match(priorityRegex);
    if (priorityMatch) {
      const key = (priorityMatch.groups.bracket || priorityMatch.groups.paren || priorityMatch.groups.bare).toLowerCase()
        .replace('ı', 'i')
        .replace('ü', 'u')
        .replace('ş', 's');
      if (PRIORITY_MAP[key]) {
        priority = PRIORITY_MAP[key];
      }
      rawContent = rawContent.replace(priorityMatch[0], '').trim();
    }

    // 2. Deadline / Due Date
    let dueDate = null;
    let isOverdue = false;
    let daysRemaining = null;
    const dateMatch = rawContent.match(dateRegex);
    if (dateMatch && dateMatch.groups && dateMatch.groups.isoDate) {
      dueDate = dateMatch.groups.isoDate;
      rawContent = rawContent.replace(dateMatch[0], '').trim();

      const dueTimestamp = new Date(dueDate).getTime();
      const diffMs = dueTimestamp - todayTimestamp;
      daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (!isCompleted && daysRemaining < 0) {
        isOverdue = true;
      }
    }

    // 3. Time Estimate
    let estimate = null;
    let estimateHours = 0;
    const estMatch = rawContent.match(estimateRegex);
    if (estMatch && estMatch.groups) {
      const val = parseFloat(estMatch.groups.val);
      const unit = estMatch.groups.unit.toLowerCase();
      estimate = `${val}${unit.charAt(0)}`;
      rawContent = rawContent.replace(estMatch[0], '').trim();

      if (unit.startsWith('h') || unit.startsWith('s')) {
        estimateHours = val;
      } else if (unit.startsWith('m') || unit.startsWith('d') && unit !== 'd') {
        estimateHours = Math.round((val / 60) * 10) / 10;
      } else if (unit === 'd' || unit.startsWith('g')) {
        estimateHours = val * 8; // 1 day = 8 work hours
      }
    }

    // 4. Milestone / Sprint
    let milestone = null;
    const msMatch = rawContent.match(milestoneRegex);
    if (msMatch && msMatch.groups && msMatch.groups.msName) {
      milestone = msMatch.groups.msName;
      rawContent = rawContent.replace(msMatch[0], '').trim();
    }

    // 5. Tags & Issue Link
    const tags = [];
    const foundTags = rawContent.match(tagRegex);
    if (foundTags) {
      foundTags.forEach(t => tags.push(t.trim()));
    }

    let issueNumber = null;
    const issueMatch = rawContent.match(issueLinkRegex);
    if (issueMatch) {
      issueNumber = issueMatch[1];
    }

    const cleanTitle = rawContent.replace(/^[:\-\s]+/, '').trim();

    tasks.push({
      id: persistedId ? (persistedId[1].length === 24 ? `legacy-${persistedId[1]}` : persistedId[1]) : `legacy-${crypto.createHash('sha256').update(cleanTitle || match.groups.content.trim()).digest('hex').slice(0, 24)}`,
      persistentId: persistedId ? persistedId[1] : null,
      lineNumber: index + 1,
      rawLine: line,
      title: cleanTitle || match.groups.content.trim(),
      completed: isCompleted,
      priorityRank: priority.rank,
      priorityCode: `P${priority.rank}`,
      priorityLabel: priority.label,
      priorityColor: priority.color,
      dueDate,
      isOverdue,
      daysRemaining,
      estimate,
      estimateHours,
      milestone,
      issueNumber,
      tags
    });
  });

  return tasks.sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    // Sort tasks with overdue deadlines first
    if (a.isOverdue !== b.isOverdue) {
      return a.isOverdue ? -1 : 1;
    }
    // Then sort by priority
    if (a.priorityRank !== b.priorityRank) {
      return a.priorityRank - b.priorityRank;
    }
    // Then by due date if available
    if (a.dueDate && b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    return 0;
  });
}

function findTask(markdown, target) {
  const title = typeof target === 'string' ? target.trim() : target && target.title;
  const id = target && typeof target === 'object' ? target.id : null;
  if (!id && !title) throw new Error('Görev kimliği veya tam başlığı gerekli.');
  const tasks = parseTasks(markdown);
  const matches = tasks.filter(task => id ? task.id === id : task.title === title);
  if (matches.length !== 1) throw new Error(matches.length ? 'Görev hedefi belirsiz; listeyi yenileyin.' : 'Görev bulunamadı; listeyi yenileyin.');
  return matches[0];
}

function rewriteTask(markdown, target, transform) {
  const task = findTask(markdown, target);
  const lines = markdown.split('\n');
  let line = transform(lines[task.lineNumber - 1], task);
  if (!task.persistentId) line = `${line.trimEnd()} <!-- repopilot:${task.id.replace('legacy-', '')} -->`;
  lines[task.lineNumber - 1] = line;
  return lines.join('\n');
}

/**
 * Updates a task completion state in markdown text.
 */
function updateTaskInMarkdown(markdown, taskTitle, targetCompletedState) {
  if (typeof targetCompletedState !== 'boolean') throw new Error('Geçersiz tamamlanma durumu.');
  return rewriteTask(markdown, taskTitle, line => line.replace(/\[[\sxX]\]/, targetCompletedState ? '[x]' : '[ ]'));
}

/**
 * Schedules or changes the date of a task in markdown text.
 */
function scheduleTaskInMarkdown(markdown, taskTitle, newIsoDate) {
  if (!validDate(newIsoDate)) throw new Error('Geçerli bir YYYY-MM-DD tarihi gerekli.');
  const dateRegex = /(?:~|@date:|\[(?:deadline|tarih):\s*|\((?:deadline|tarih):\s*)\d{4}-\d{2}-\d{2}(?:\]|\))?/i;
  return rewriteTask(markdown, taskTitle, line => dateRegex.test(line)
    ? line.replace(dateRegex, `~${newIsoDate}`) : `${line.trimEnd()} ~${newIsoDate}`);
}

/**
 * Changes a task priority in markdown text.
 */
function changePriorityInMarkdown(markdown, taskTitle, newPriorityCode) {
  if (!/^P[1-4]$/i.test(newPriorityCode)) throw new Error('Geçersiz öncelik.');
  return rewriteTask(markdown, taskTitle, line => line.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[[\sxX]\]\s*)(.*)$/, (all, prefix, content) => {
    const marker = `[${newPriorityCode.toUpperCase()}]`;
    return prefix + (PRIORITY_REGEX.test(content) ? content.replace(PRIORITY_REGEX, marker) : `${marker} ${content}`);
  }));
}

/**
 * Appends a GitHub Issue link to a task in markdown.
 */
function attachIssueToTaskInMarkdown(markdown, taskTitle, issueNumber) {
  if (!/^\d+$/.test(String(issueNumber))) throw new Error('Geçersiz Issue numarası.');
  return rewriteTask(markdown, taskTitle, (line, task) => task.issueNumber === String(issueNumber)
    ? line : `${line.trimEnd()} (#${issueNumber})`);
}

/**
 * Appends a new task to the markdown content with optional deadline and estimate.
 */
function appendTaskToMarkdown(markdown, title, priorityCode = 'P2', dueDate = null, estimate = null, milestone = null) {
  if (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title)) throw new Error('Tek satırlık görev başlığı gerekli.');
  if (!/^P[1-4]$/i.test(priorityCode)) throw new Error('Geçersiz öncelik.');
  if (dueDate && !validDate(dueDate)) throw new Error('Geçersiz tarih.');
  if ((estimate && /[\r\n]/.test(estimate)) || (milestone && /[\r\n]/.test(milestone))) throw new Error('Geçersiz görev metadatası.');
  let taskSuffix = '';
  if (dueDate) taskSuffix += ` ~${dueDate}`;
  if (estimate) taskSuffix += ` (${estimate})`;
  if (milestone) taskSuffix += ` %${milestone}`;

  const formattedTask = `- [ ] [${priorityCode.toUpperCase()}] ${title.trim()}${taskSuffix} <!-- repopilot:${crypto.randomUUID()} -->`;
  if (!markdown || markdown.trim() === '') {
    return `# Yapılacaklar Listesi\n\n${formattedTask}\n`;
  }
  return `${markdown.trimEnd()}\n${formattedTask}\n`;
}

module.exports = {
  parseTasks,
  findTask,
  updateTaskInMarkdown,
  scheduleTaskInMarkdown,
  changePriorityInMarkdown,
  attachIssueToTaskInMarkdown,
  appendTaskToMarkdown,
  PRIORITY_MAP
};
