# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project and runtime

TaskDeck Pro (now Repo Pilot) aggregates Markdown task lists from GitHub repositories into a Turkish-language developer dashboard: project health, cross-repository Kanban, calendar/milestones, daily focus/Pomodoro, and code TODOs. It also exposes a CLI, an authenticated iCalendar feed, and Telegram morning briefings.

This directory (`C:\Users\BISPC7\Desktop\Asist`) is the application root and contains `package.json`; it is not currently a Git repository.

The app uses CommonJS JavaScript, Express 4, and Node's global `fetch`. Use a modern Node.js runtime supporting `fetch` and `node --watch`; no Node version is pinned. There is no frontend build step, database, TypeScript setup, or bundler.

## Commands

Run from the application root:

```sh
npm ci                    # Install dependencies from package-lock.json
npm start                 # Run server.js; default http://localhost:3000
npm run dev               # Run server.js with Node watch mode
npm run cli -- help       # CLI usage; no running server needed
npm run cli -- list       # Project health and task counts
npm run cli -- p1         # Pending urgent tasks across projects
npm run cli -- cal        # Deadlines, milestones, and authenticated iCal feed URL
npm run cli -- add e-ticaret P1 "Task description"
npm run cli -- digest     # Sends Telegram daily digest
```

The CLI is an authenticated HTTP client: all commands except help connect to the server via `apiFetch`, which automatically handles session cookie acquisition and authorization headers (`TASKDECK_API_TOKEN`). It defaults to `http://localhost:3000`; set `TASKDECK_URL` to target another URL. CLI failures return exit code 1; ambiguous repository names are rejected with list of candidates.

Syntax-only checks can be run per file:

```sh
node --check server.js
node --check bin/taskdeck.js
node --check public/app.js
node --check services/parserService.js
node --check services/calendarService.js
node --check services/telegramService.js
node --check services/scannerService.js
```

## Configuration and state

- **Settings Persistence:** Configuration values (`mode`, `token`, `username`, `targetFile`, `telegramToken`, `telegramChatId`, `localScanRoot`, `calendarBaseUrl`, `pendingIssues`, `sessionSecret`) are persisted to `.taskdeck/settings.json` with restricted file permissions (`0600`).
- **Security & Session:** `services/securityService.js` provides session authentication (`POST /api/session`), CSRF same-origin enforcement, HMAC-signed session cookies, and tokenized access to `/api/calendar.ics?token=...`. Remote connections require `TASKDECK_API_TOKEN`.
- **Mode Switching:** Startup selects the saved mode from `settingsService` (defaulting to live if token exists, otherwise demo). `POST /api/mode` switches between `demo` and `live`.
- **Demo State:** Demo repositories are cloned from `services/demoData.js` and mutated in memory. `POST /api/demo/reset` resets demo data.
- **Daily Focus:** Selections are stored in `localStorage` under `taskdeck_focus_tasks`. Tasks from other modes or missing repositories are visually badged with disabled checkboxes. Completions are persisted to `localStorage` only after server API calls succeed.
- **Pending Issues:** Issues created on GitHub whose markdown link writes encounter errors are persisted in `.taskdeck/settings.json` to prevent duplicate Issue creation upon retry.

## Architecture and data flow

### HTTP orchestration and integrations

`server.js` owns Express setup, static serving of `public/`, all `/api/*` routes, process-wide mode/settings, demo state, and the daily Telegram cron job.

- **GitHub Service (`services/githubService.js`):** Singleton wrapping GitHub REST calls using native `fetch`. Caches repository lists for 5 minutes (bypass with `?refresh=true`). Task mutations (`toggleTask`, `changeTaskPriority`, `scheduleTask`, `convertTaskToIssue`, `addTask`) accept `{ id, title }` target objects and create commits on GitHub.
- **Calendar & Timeline (`services/calendarService.js`):** Computes monthly schedules, milestone progress, and date workloads (`totalHours`, `pendingHours`, `pendingCount`, `completedCount`). Generates RFC 5545 iCalendar feed (`/api/calendar.ics`) with deterministic UIDs and timezone metadata.
- **Telegram Service (`services/telegramService.js`):** Sends daily digests with HTML entity escaping and a 4000-character safety ceiling. Digests include Overdue, Today, This Week, and P1 tasks with links to the public Repo Pilot panel. The daily `0 9 * * *` cron job obeys the active mode (`demo` vs `live`).
- **Scanner Service (`services/scannerService.js`):** Scans the configured `localScanRoot` folder for `// TODO:` and `// FIXME:` comments across code files. In live mode without a configured path, returns an empty list with configuration guidance instead of mock demo data. TODO transfers resolve actual repository owners, names, and target filenames.
- **Webhook (`POST /api/webhook`):** Verifies HMAC-SHA256 signatures with `GITHUB_WEBHOOK_SECRET` and auto-completes tasks matching commit message keywords (`done:`, `fixes:`, `resolves:`).

### Markdown contract

`services/parserService.js` is the single source of truth for parsing and rewriting task files (`yapilacaklar.md`). Task items support priorities `P1`–`P4`, `#tags`, `@mentions`, issue numbers (`#12`), ISO deadlines (`~YYYY-MM-DD`), estimates (`est: 2h`), and milestones (`%v1.0`). Tasks maintain persistent or derived IDs matching `{ id, title }`.

### Browser UI

- `public/index.html` provides the 5 view containers, modals, and Tailwind/Lucide icon markup.
- `public/app.js` is a zero-build client handling state management, drag-and-drop calendar task rescheduling, modal interactions, and API communication.
- `public/style.css` provides custom dark-theme styling, status badges, and drag-and-drop animations.
