/**
 * Codebase Scanner Service
 * Scans code files for // TODO: and // FIXME: comments and allows 1-click addition to yapilacaklar.md.
 */

const fs = require('fs');
const path = require('path');

// Mock discovered code todos for demo repositories
const MOCK_CODE_TODOS = [
  {
    id: 'code-todo-1',
    repoId: 'demo-repo-1',
    repoName: 'TenderAgent',
    file: 'src/middlewares/auth.middleware.ts',
    line: 42,
    type: 'FIXME',
    content: 'Expired JWT token yakalandığında 401 yerine bazen 500 dönüyor, interceptor ekle',
    priority: 'P1'
  },
  {
    id: 'code-todo-2',
    repoId: 'demo-repo-1',
    repoName: 'TenderAgent',
    file: 'src/services/payment.service.ts',
    line: 118,
    type: 'TODO',
    content: 'Webhook cevabında HMAC SHA256 imza doğrulamasını zorunlu kıl',
    priority: 'P2'
  },
  {
    id: 'code-todo-3',
    repoId: 'demo-repo-2',
    repoName: 'FamApp',
    file: 'lib/screens/chat_view.dart',
    line: 205,
    type: 'TODO',
    content: 'Klavye açıldığında ListView otomatik en alta scroll yapmıyor',
    priority: 'P2'
  },
  {
    id: 'code-todo-4',
    repoId: 'demo-repo-4',
    repoName: 'Sector 9',
    file: 'pkg/mqtt/client.go',
    line: 87,
    type: 'FIXME',
    content: 'Broker bağlantısı koptuğunda reconnect backoff süresi logaritmik artmıyor',
    priority: 'P1'
  },
  {
    id: 'code-todo-5',
    repoId: 'demo-repo-3',
    repoName: 'CRM Dashboard',
    file: 'app/api/customers/route.ts',
    line: 63,
    type: 'TODO',
    content: 'Müşteri listesi sorgusuna cursor-based pagination ekle',
    priority: 'P3'
  }
];

class ScannerService {
  constructor() {
    this.customTodos = [...MOCK_CODE_TODOS];
  }

  /**
   * Get all detected code TODOs
   */
  async getCodeTodos(mode = 'demo', scanRoot = '', knownProjects = []) {
    // If a scan directory is configured, scan it directly
    if (scanRoot && fs.existsSync(scanRoot)) {
      return await this.scanLocalDirectory(scanRoot, knownProjects);
    }

    // In live mode without a configured scan directory, return empty (no mock data)
    if (mode === 'live') {
      return [];
    }

    // In demo mode without custom scanRoot, return demo mock todos
    return this.customTodos;
  }

  /**
   * Remove a code todo once it has been transferred to yapilacaklar.md
   */
  dismissCodeTodo(id) {
    this.customTodos = this.customTodos.filter(t => t.id !== id);
    return true;
  }

  /**
   * Scan a local folder directory for TODOs
   */
  async scanLocalDirectory(dirPath, knownProjects = []) {
    const results = [];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.repopilot', '.taskdeck'];
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.dart', '.rs', '.java', '.php', '.c', '.cpp', '.cs'];

    const defaultRepoName = path.basename(dirPath) || 'local-project';
    const defaultRepo = knownProjects.find(p => p.name === defaultRepoName) || knownProjects[0] || { id: 'local-dir', name: defaultRepoName };

    function walk(dir) {
      if (!fs.existsSync(dir)) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                const todoMatch = line.match(/(?:\/\/|#|\/\*)\s*(TODO|FIXME|BUG|HACK):\s*(.+?)(?:\*\/|$)/i);
                if (todoMatch) {
                  const relPath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
                  const firstFolder = relPath.split('/')[0];
                  const matchedRepo = knownProjects.find(p => p.name === firstFolder) || defaultRepo;
                  const itemType = todoMatch[1].toUpperCase();

                  results.push({
                    id: `scan-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`,
                    repoId: matchedRepo.id || 'local-dir',
                    repoName: matchedRepo.name || defaultRepoName,
                    file: relPath,
                    line: idx + 1,
                    type: (itemType === 'FIXME' || itemType === 'BUG') ? 'FIXME' : 'TODO',
                    content: todoMatch[2].trim(),
                    priority: (itemType === 'FIXME' || itemType === 'BUG') ? 'P1' : 'P2'
                  });
                }
              });
            } catch (err) {
              // ignore read errors
            }
          }
        }
      }
    }

    walk(dirPath);
    return results;
  }
}

module.exports = new ScannerService();
