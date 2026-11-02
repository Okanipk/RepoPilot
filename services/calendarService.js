/**
 * Calendar & Scheduling Service
 * Manages calendar events, milestone roadmaps, workload estimation, and iCal (.ics) exports.
 */

const crypto = require('crypto');
const { today, validDate, TIME_ZONE } = require('./dateService');

function escapeText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function foldLine(line) {
  let result = '';
  let bytes = 0;
  for (const character of line) {
    const length = Buffer.byteLength(character, 'utf8');
    if (bytes + length > 75) { result += '\r\n '; bytes = 1; }
    result += character;
    bytes += length;
  }
  return result;
}

class CalendarService {
  /**
   * Generates RFC 5545 iCalendar (.ics) format string
   */
  generateIcs(projects) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RepoPilot//Developer Command Center//TR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Repo Pilot Proje Görevleri',
      `X-WR-TIMEZONE:${TIME_ZONE}`
    ];

    const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    projects.forEach(repo => {
      (repo.tasks || []).forEach(task => {
        if (!validDate(task.dueDate)) return;

        const dateClean = task.dueDate.replace(/-/g, '');
        const end = new Date(task.dueDate);
        end.setUTCDate(end.getUTCDate() + 1);
        const endDate = end.toISOString().slice(0, 10).replace(/-/g, '');
        const key = `${repo.fullName}/${repo.filePath || 'yapilacaklar.md'}/${task.id}`;
        const uid = `repopilot-${crypto.createHash('sha256').update(key).digest('hex')}@repopilot.local`;
        const summary = `[${task.priorityCode}] [${repo.name}] ${task.title}`;
        const description = `Proje: ${repo.fullName}\\nÖncelik: ${task.priorityLabel}\\nTahmini Süre: ${task.estimate || 'Belirtilmedi'}\\nSürüm/Milestone: ${task.milestone || '-'}\\nRepo URL: ${repo.url}`;
        const priorityNum = task.priorityRank === 1 ? '1' : task.priorityRank === 2 ? '5' : '9';
        const status = task.completed ? 'CANCELLED' : 'CONFIRMED';

        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}`);
        lines.push(`DTSTAMP:${nowStr}`);
        lines.push(`DTSTART;VALUE=DATE:${dateClean}`);
        lines.push(`DTEND;VALUE=DATE:${endDate}`);
        lines.push(`SUMMARY:${escapeText(summary)}`);
        lines.push(`DESCRIPTION:${escapeText(description.replace(/\\n/g, '\n'))}`);
        lines.push(`STATUS:${status}`);
        lines.push(`PRIORITY:${priorityNum}`);
        lines.push(`CATEGORIES:${escapeText(repo.name)},${escapeText(task.priorityCode)}`);
        lines.push('END:VEVENT');
      });
    });

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  /**
   * Aggregates tasks for calendar views, timelines, and milestones
   */
  getScheduleSummary(projects) {
    const todayStr = today();
    const todayTimestamp = new Date(todayStr).getTime();

    const scheduledTasks = [];
    const unscheduledTasks = [];
    const overdueTasks = [];
    const todayTasks = [];
    const next7DaysTasks = [];
    const milestonesMap = new Map();
    const dateWorkloadMap = new Map(); // date -> { count, hours }

    projects.forEach(repo => {
      (repo.tasks || []).forEach(task => {
        const item = {
          ...task,
          repoId: repo.id,
          repoName: repo.name,
          repoFullName: repo.fullName,
          language: repo.language,
          filePath: repo.filePath
        };

        // Milestone aggregation
        if (task.milestone) {
          const msKey = `${repo.name}#${task.milestone}`;
          if (!milestonesMap.has(msKey)) {
            milestonesMap.set(msKey, {
              key: msKey,
              repoName: repo.name,
              repoId: repo.id,
              milestone: task.milestone,
              total: 0,
              completed: 0,
              totalHours: 0,
              tasks: []
            });
          }
          const ms = milestonesMap.get(msKey);
          ms.total++;
          if (task.completed) ms.completed++;
          ms.totalHours += task.estimateHours || 0;
          ms.tasks.push(item);
        }

        if (task.dueDate) {
          scheduledTasks.push(item);

          // Workload per date
          if (!dateWorkloadMap.has(task.dueDate)) {
            dateWorkloadMap.set(task.dueDate, {
              date: task.dueDate,
              totalCount: 0,
              totalHours: 0,
              pendingCount: 0,
              pendingHours: 0,
              completedCount: 0,
              tasks: []
            });
          }
          const wl = dateWorkloadMap.get(task.dueDate);
          wl.totalCount++;
          wl.totalHours += task.estimateHours || 0;
          if (!task.completed) {
            wl.pendingCount++;
            wl.pendingHours += task.estimateHours || 0;
            wl.tasks.push(item);
          } else {
            wl.completedCount++;
          }

          const taskTimestamp = new Date(task.dueDate).getTime();
          const diffDays = Math.round((taskTimestamp - todayTimestamp) / (1000 * 60 * 60 * 24));

          if (!task.completed && diffDays < 0) {
            overdueTasks.push(item);
          } else if (!task.completed && diffDays === 0) {
            todayTasks.push(item);
          } else if (!task.completed && diffDays > 0 && diffDays <= 7) {
            next7DaysTasks.push(item);
          }
        } else {
          if (!task.completed) {
            unscheduledTasks.push(item);
          }
        }
      });
    });

    // Calculate milestone progress percentages
    const milestones = Array.from(milestonesMap.values()).map(ms => ({
      ...ms,
      percentage: ms.total > 0 ? Math.round((ms.completed / ms.total) * 100) : 0
    }));

    return {
      todayStr,
      scheduledCount: scheduledTasks.length,
      unscheduledCount: unscheduledTasks.length,
      overdueCount: overdueTasks.length,
      todayCount: todayTasks.length,
      next7DaysCount: next7DaysTasks.length,
      overdueTasks,
      todayTasks,
      next7DaysTasks,
      unscheduledTasks,
      milestones,
      workloads: Array.from(dateWorkloadMap.values())
    };
  }
}

module.exports = new CalendarService();
