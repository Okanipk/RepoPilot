/**
 * Telegram Notification Service
 * Sends morning briefings, calendar deadlines, and urgent task alerts to Telegram.
 */

const settingsService = require('./settingsService');

function escapeTg(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class TelegramService {
  constructor() {
    this.botToken = settingsService.get('telegramToken', process.env.TELEGRAM_BOT_TOKEN || '');
    this.chatId = settingsService.get('telegramChatId', process.env.TELEGRAM_CHAT_ID || '');
  }

  updateConfig(botToken, chatId) {
    if (botToken !== undefined) this.botToken = botToken.trim();
    if (chatId !== undefined) this.chatId = chatId.trim();
  }

  isConfigured() {
    return Boolean(this.botToken && this.chatId);
  }

  /**
   * Get bot information from Telegram API
   */
  async getMe(token = this.botToken) {
    if (!token) throw new Error('Telegram Bot Token girilmedi.');
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (!data.ok) {
      if (data.description === 'Unauthorized' || res.status === 401 || res.status === 404) {
        throw new Error('Geçersiz Telegram Bot Token. @BotFather tarafından verilen tokenı eksiksiz kopyaladığınızdan emin olun.');
      }
      throw new Error(data.description || 'Geçersiz Bot Token.');
    }
    return data.result;
  }

  /**
   * Auto-detect Chat ID from recent messages sent to the bot
   */
  async detectChatId(token = this.botToken) {
    if (!token) throw new Error('Telegram Bot Token girilmedi.');
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-10&limit=10`);
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.description || 'Telegram güncellemeleri alınamadı.');
    }
    const updates = data.result || [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const chat = u.message?.chat || u.edited_message?.chat || u.channel_post?.chat || u.callback_query?.message?.chat;
      if (chat && chat.id) {
        return {
          chatId: String(chat.id),
          username: chat.username || '',
          firstName: chat.first_name || chat.title || ''
        };
      }
    }
    return null;
  }

  /**
   * Verify token, detect or validate chat ID, and deliver a confirmation message
   */
  async testConnection(token, chatId) {
    const activeToken = token || this.botToken;
    if (!activeToken) throw new Error('Telegram Bot Token belirtilmedi.');

    const bot = await this.getMe(activeToken);
    let resolvedChatId = (chatId || this.chatId || '').trim();

    // If chat ID is not provided or invalid, attempt auto-detect via getUpdates
    if (!resolvedChatId) {
      const detected = await this.detectChatId(activeToken);
      if (detected) {
        resolvedChatId = detected.chatId;
      }
    }

    if (!resolvedChatId) {
      return {
        success: false,
        needsStart: true,
        bot: { username: bot.username, firstName: bot.first_name },
        message: `Bot doğrulandı (@${bot.username}) ancak henüz size ait bir mesaj bulunamadı. Telegram kuralları gereği botlar kullanıcıya ilk mesajı atamaz. Lütfen aşağıdaki butona tıklayarak bota "BAŞLAT" (/start) deyin, ardından tekrar test edin.`
      };
    }

    // Attempt to send a test confirmation message
    const sendUrl = `https://api.telegram.org/bot${activeToken}/sendMessage`;
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: resolvedChatId,
        text: `🚀 <b>Repo Pilot · Telegram Bildirimi Aktif!</b>\n\n🎉 Tebrikler! Repo Pilot ile Telegram botunuz başarıyla senkronize edildi.\nHer sabah saat 09:00'da günlük proje ve teslim tarihi özetiniz bu sohbete iletilecektir.`,
        parse_mode: 'HTML'
      })
    });

    const sendData = await sendRes.json();
    if (!sendData.ok) {
      const desc = sendData.description || '';
      if (desc.includes("bot can't initiate conversation") || desc.includes("chat not found")) {
        return {
          success: false,
          needsStart: true,
          chatId: resolvedChatId,
          bot: { username: bot.username, firstName: bot.first_name },
          message: `Bot size mesaj gönderemedi çünkü henüz bota mesaj atmadınız. Lütfen Telegram'da @${bot.username} botuna gidip "BAŞLAT" (/start) butonuna tıklayın.`
        };
      }
      throw new Error(desc || 'Telegram test mesajı gönderilemedi.');
    }

    // Update runtime config and persist chat ID
    this.botToken = activeToken;
    this.chatId = resolvedChatId;
    settingsService.save({ telegramToken: activeToken, telegramChatId: resolvedChatId });

    return {
      success: true,
      chatId: resolvedChatId,
      bot: { username: bot.username, firstName: bot.first_name },
      message: `✓ Başarılı! @${bot.username} botu bağlandı ve Chat ID (${resolvedChatId}) otomatik tespit edilerek onay mesajı gönderildi!`
    };
  }

  /**
   * Send a Telegram message via Bot API
   */
  async sendMessage(text, parseMode = 'HTML') {
    if (!this.isConfigured()) {
      throw new Error('Telegram Bot Token veya Chat ID tanımlanmamış.');
    }

    // Enforce Telegram message length limit (4096 max, capped at 4000)
    let payloadText = text;
    if (payloadText.length > 4000) {
      payloadText = payloadText.slice(0, 3950) + '\n\n<i>...içerik uzunluk sınırı nedeniyle kısaltıldı.</i>';
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: payloadText,
        parse_mode: parseMode,
        disable_web_page_preview: true
      })
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || 'Telegram mesajı gönderilemedi.');
    }

    return { success: true, result: data.result };
  }

  /**
   * Format and send daily morning digest with deadlines & urgent tasks
   */
  async sendDailyDigest(projects) {
    const calendarService = require('./calendarService');
    const schedule = calendarService.getScheduleSummary(projects);
    const p1Tasks = [];
    let totalPending = 0;

    projects.forEach(repo => {
      totalPending += (repo.stats && repo.stats.pending) || 0;
      (repo.tasks || []).forEach(t => {
        if (!t.completed && t.priorityRank === 1) {
          p1Tasks.push({ repo: repo.name, task: t.title, dueDate: t.dueDate });
        }
      });
    });

    const dateStr = new Date().toLocaleDateString('tr-TR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let message = `🌅 <b>Repo Pilot · Günlük Geliştirici Özeti</b>\n`;
    message += `📅 <i>${escapeTg(dateStr)}</i>\n\n`;
    message += `📊 <b>Genel Durum:</b>\n`;
    message += `• Takip Edilen Proje: <b>${projects.length}</b>\n`;
    message += `• Bekleyen Toplam Görev: <b>${totalPending}</b>\n`;
    message += `• 🚨 <b>Kritik (P1) Görev: ${p1Tasks.length}</b>\n`;
    if (schedule.overdueCount > 0) {
      message += `• ⚠️ <b>Gecikmiş Görev: ${schedule.overdueCount}</b>\n`;
    }
    if (schedule.todayCount > 0) {
      message += `• 📌 <b>Bugün Teslim: ${schedule.todayCount}</b>\n`;
    }
    message += `\n`;

    // Overdue tasks
    if (schedule.overdueTasks.length > 0) {
      message += `⚠️ <b>Gecikmiş Görevler (${schedule.overdueTasks.length}):</b>\n`;
      schedule.overdueTasks.slice(0, 5).forEach((item, idx) => {
        message += `${idx + 1}. [${escapeTg(item.dueDate)}] <b>[${escapeTg(item.repoName)}]</b> ${escapeTg(item.title)}\n`;
      });
      if (schedule.overdueTasks.length > 5) {
        message += `<i>...ve ${schedule.overdueTasks.length - 5} gecikmiş görev daha.</i>\n`;
      }
      message += `\n`;
    }

    // Today's tasks
    if (schedule.todayTasks.length > 0) {
      message += `📌 <b>Bugün Teslim Edilecekler (${schedule.todayTasks.length}):</b>\n`;
      schedule.todayTasks.slice(0, 5).forEach((item, idx) => {
        message += `${idx + 1}. [${escapeTg(item.priorityCode)}] <b>[${escapeTg(item.repoName)}]</b> ${escapeTg(item.title)}\n`;
      });
      if (schedule.todayTasks.length > 5) {
        message += `<i>...ve ${schedule.todayTasks.length - 5} görev daha.</i>\n`;
      }
      message += `\n`;
    }

    // P1 Urgent tasks
    if (p1Tasks.length > 0) {
      message += `🚨 <b>Bugün Odaklanılacak Acil (P1) Görevler:</b>\n`;
      p1Tasks.slice(0, 5).forEach((item, idx) => {
        message += `${idx + 1}. <b>[${escapeTg(item.repo)}]</b> ${escapeTg(item.task)}\n`;
      });
      if (p1Tasks.length > 5) {
        message += `<i>...ve ${p1Tasks.length - 5} acil görev daha.</i>\n`;
      }
      message += `\n`;
    } else if (schedule.overdueTasks.length === 0 && schedule.todayTasks.length === 0) {
      message += `🎉 <i>Tebrikler! Bekleyen P1 acil veya gecikmiş görev bulunmuyor.</i>\n\n`;
    }

    // Next 7 days workload
    if (schedule.next7DaysTasks.length > 0) {
      message += `⏳ <b>Önümüzdeki 7 Gün İçinde:</b> <b>${schedule.next7DaysTasks.length}</b> görev teslim edilecek.\n\n`;
    }

    const publicUrl = settingsService.get('calendarBaseUrl', process.env.REPOPILOT_PUBLIC_URL || process.env.TASKDECK_PUBLIC_URL || 'http://localhost:3000');
    message += `🔗 <a href="${escapeTg(publicUrl)}">Repo Pilot Paneline Git</a>`;

    return await this.sendMessage(message);
  }

  /**
   * 2. Send instant high-priority alert when a P1 / Critical task is created or escalated
   */
  async sendInstantP1Alert(data) {
    if (!this.isConfigured()) return { skipped: true };
    const { repoName, title, issueNumber, issueUrl, dueDate, assignees, description, action = 'created' } = data;

    const actionText = action === 'escalated' ? '🔴 <b>ÖNCELİK P1 ACİL SEVİYESİNE YÜKSELTİLDİ!</b>' : '🚨 <b>YENİ KRİTİK (P1) GÖREV OLUŞTURULDU!</b>';

    let message = `${actionText}\n\n`;
    message += `📁 <b>Proje:</b> <code>${escapeTg(repoName)}</code>\n`;
    message += `📌 <b>Görev:</b> <b>${escapeTg(title)}</b>`;
    if (issueNumber) message += ` (<b>#${issueNumber}</b>)`;
    message += `\n`;

    if (dueDate) {
      message += `📅 <b>Teslim Tarihi:</b> <code>${escapeTg(dueDate)}</code>\n`;
    }

    if (Array.isArray(assignees) && assignees.length > 0) {
      const names = assignees.map(a => typeof a === 'string' ? a.replace(/^@/, '') : a.login).filter(Boolean);
      if (names.length > 0) {
        message += `👤 <b>Atanan:</b> @${names.map(escapeTg).join(', @')}\n`;
      }
    }

    if (description && description.trim()) {
      const cleanDesc = description.trim().slice(0, 200);
      message += `📝 <b>Açıklama:</b> <i>${escapeTg(cleanDesc)}${description.length > 200 ? '...' : ''}</i>\n`;
    }

    if (issueUrl) {
      message += `\n🔗 <a href="${escapeTg(issueUrl)}">GitHub Issue'yu Aç</a>`;
    } else {
      const publicUrl = settingsService.get('calendarBaseUrl', process.env.REPOPILOT_PUBLIC_URL || process.env.TASKDECK_PUBLIC_URL || 'http://localhost:3000');
      message += `\n🔗 <a href="${escapeTg(publicUrl)}">Repo Pilot Paneline Git</a>`;
    }

    try {
      return await this.sendMessage(message);
    } catch (err) {
      console.error('Instant P1 Alert Hatası:', err.message);
      return { error: err.message };
    }
  }

  /**
   * 3. Send 16:00 afternoon deadline reminder for tasks due tomorrow or currently overdue
   */
  async sendDeadlineReminder(projects, forceTest = false) {
    if (!this.isConfigured()) return { skipped: true };
    const calendarService = require('./calendarService');
    const schedule = calendarService.getScheduleSummary(projects);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const tomorrowTasks = [];
    projects.forEach(repo => {
      (repo.tasks || []).forEach(t => {
        if (!t.completed && t.dueDate === tomorrowStr) {
          tomorrowTasks.push({ repo: repo.name, task: t.title, priorityCode: t.priorityCode });
        }
      });
    });

    if (!forceTest && tomorrowTasks.length === 0 && schedule.overdueTasks.length === 0) {
      return { skipped: 'no_upcoming_deadlines' };
    }

    if (tomorrowTasks.length === 0 && schedule.overdueTasks.length === 0) {
      tomorrowTasks.push({ repo: 'Repo Pilot', task: 'Örnek Proje Teslimatı (Yarın için test görevi)', priorityCode: 'P1' });
    }

    let message = `⏰ <b>Repo Pilot · Teslim Tarihi Hatırlatıcısı</b>\n`;
    message += `<i>Günü tamamlamadan önce yarının teslimatlarını ve gecikenleri kontrol edin:</i>\n\n`;

    if (tomorrowTasks.length > 0) {
      message += `📌 <b>Yarın Teslim Edilecek Görevler (${tomorrowTasks.length}):</b>\n`;
      tomorrowTasks.slice(0, 6).forEach((t, i) => {
        message += `${i + 1}. [${escapeTg(t.priorityCode)}] <b>[${escapeTg(t.repo)}]</b> ${escapeTg(t.task)}\n`;
      });
      if (tomorrowTasks.length > 6) {
        message += `<i>...ve ${tomorrowTasks.length - 6} görev daha.</i>\n`;
      }
      message += `\n`;
    }

    if (schedule.overdueTasks.length > 0) {
      message += `⚠️ <b>Hâlâ Bekleyen Gecikmiş Görevler (${schedule.overdueTasks.length}):</b>\n`;
      schedule.overdueTasks.slice(0, 4).forEach((t, i) => {
        message += `${i + 1}. [${escapeTg(t.dueDate)}] <b>[${escapeTg(t.repoName)}]</b> ${escapeTg(t.title)}\n`;
      });
      message += `\n`;
    }

    const publicUrl = settingsService.get('calendarBaseUrl', process.env.REPOPILOT_PUBLIC_URL || process.env.TASKDECK_PUBLIC_URL || 'http://localhost:3000');
    message += `🔗 <a href="${escapeTg(publicUrl)}">Takvim & Ajandayı Aç</a>`;

    try {
      return await this.sendMessage(message);
    } catch (err) {
      console.error('Deadline Reminder Hatası:', err.message);
      return { error: err.message };
    }
  }

  /**
   * 4. Send 18:00 evening recap of completed tasks today and progress
   */
  async sendEveningDigest(projects, forceTest = false) {
    if (!this.isConfigured()) return { skipped: true };
    const dateStr = new Date().toLocaleDateString('tr-TR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let totalCompleted = 0;
    let totalPending = 0;
    const completedTasks = [];

    projects.forEach(repo => {
      totalCompleted += (repo.stats && repo.stats.completed) || 0;
      totalPending += (repo.stats && repo.stats.pending) || 0;
      (repo.tasks || []).forEach(t => {
        if (t.completed) {
          completedTasks.push({ repo: repo.name, task: t.title, issueNumber: t.issueNumber });
        }
      });
    });

    if (completedTasks.length === 0 && forceTest) {
      completedTasks.push({ repo: 'Repo Pilot', task: 'Telegram bildirim entegrasyonu tamamlandı', issueNumber: 42 });
      totalCompleted = 1;
    }

    let message = `🌆 <b>Repo Pilot · Gün Sonu Kapanış Raporu</b>\n`;
    message += `📅 <i>${escapeTg(dateStr)}</i>\n\n`;

    message += `📊 <b>Günün İlerleme Durumu:</b>\n`;
    message += `• Toplam Tamamlanan Görev: <b>${totalCompleted}</b> ✅\n`;
    message += `• Kalan Bekleyen Görev: <b>${totalPending}</b> ⏳\n\n`;

    if (completedTasks.length > 0) {
      message += `🎉 <b>Bugün Çözülen & Kapatılan İşler:</b>\n`;
      completedTasks.slice(0, 6).forEach((item, idx) => {
        message += `✓ <b>[${escapeTg(item.repo)}]</b> ${escapeTg(item.task)}`;
        if (item.issueNumber) message += ` (#${item.issueNumber})`;
        message += `\n`;
      });
      if (completedTasks.length > 6) {
        message += `<i>...ve ${completedTasks.length - 6} tamamlanmış iş daha.</i>\n`;
      }
      message += `\n`;
    } else {
      message += `☕ <i>Bugün tamamlanan iş kaydedilmedi. Yarın için başarılar dileriz!</i>\n\n`;
    }

    const publicUrl = settingsService.get('calendarBaseUrl', process.env.REPOPILOT_PUBLIC_URL || process.env.TASKDECK_PUBLIC_URL || 'http://localhost:3000');
    message += `İyi akşamlar dileriz! 🌙\n`;
    message += `🔗 <a href="${escapeTg(publicUrl)}">Repo Pilot Paneline Git</a>`;

    try {
      return await this.sendMessage(message);
    } catch (err) {
      console.error('Evening Digest Hatası:', err.message);
      return { error: err.message };
    }
  }
}

module.exports = new TelegramService();
