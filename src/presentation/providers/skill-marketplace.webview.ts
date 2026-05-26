import * as vscode from 'vscode';
import { SkillService, Skill } from '../../features/skills/skill.service';

export class SkillMarketplaceWebview {
  public static currentPanel: SkillMarketplaceWebview | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _skillService: SkillService;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, skillService: SkillService) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SkillMarketplaceWebview.currentPanel) {
      SkillMarketplaceWebview.currentPanel._panel.reveal(column);
      SkillMarketplaceWebview.currentPanel.sendSkills();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'skillMarketplace',
      'Antigravity Skill Marketplace',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
      }
    );

    SkillMarketplaceWebview.currentPanel = new SkillMarketplaceWebview(panel, extensionUri, skillService);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, skillService: SkillService) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._skillService = skillService;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'installSkill':
            const success = this._skillService.installSkill(message.id);
            if (success) {
              vscode.window.showInformationMessage(`Skill installed successfully!`);
              // Refresh Sidebar Tree Provider
              vscode.commands.executeCommand('agent-assistant.refreshSkillsTree');
              this.sendSkills();
            }
            break;
          case 'installSkillsBatch':
            let installedCount = 0;
            for (const id of message.ids) {
              if (this._skillService.installSkill(id)) {
                installedCount++;
              }
            }
            if (installedCount > 0) {
              vscode.window.showInformationMessage(`Successfully installed ${installedCount} skills!`);
              vscode.commands.executeCommand('agent-assistant.refreshSkillsTree');
              this.sendSkills();
            }
            break;
          case 'openSkillFile':
            const skillPath = vscode.Uri.joinPath(this._extensionUri, 'skill', message.id, 'SKILL.md');
            vscode.window.showTextDocument(skillPath).then(undefined, (err) => {
              vscode.window.showErrorMessage(`Failed to open skill file: ${err.message}`);
            });
            break;
          case 'refresh':
            await vscode.window.withProgress({
              location: vscode.ProgressLocation.Notification,
              title: "Refreshing marketplace from GitHub...",
              cancellable: false
            }, async () => {
              await this._skillService.fetchMarketplaceSkillsFromGitHub();
            });
            this.sendSkills();
            break;
        }
      },
      null,
      this._disposables
    );

    // Watch for internal changes to trigger live marketplace sync
    this._skillService.onDidChangeSkills(() => {
      this.sendSkills();
    }, null, this._disposables);

    // Send skills immediately after open
    setTimeout(() => this.sendSkills(), 500);
  }

  public sendSkills() {
    if (!this._panel) return;
    const skills = this._skillService.getMarketplaceSkills();
    this._panel.webview.postMessage({ command: 'setSkills', skills });
  }

  public dispose() {
    SkillMarketplaceWebview.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antigravity Skill Marketplace</title>
  <style>
    :root {
      --background: var(--vscode-editor-background, #1e1e1e);
      --foreground: var(--vscode-editor-foreground, #cccccc);
      --card-bg: var(--vscode-editor-inactiveSelectionBackground, #2d2d2d);
      --card-border: var(--vscode-widget-border, #3c3c3c);
      --input-bg: var(--vscode-input-background, #252526);
      --input-border: var(--vscode-input-border, #3c3c3c);
      --button-bg: var(--vscode-button-background, #0e639c);
      --button-hover: var(--vscode-button-hoverBackground, #1177bb);
      --button-fg: var(--vscode-button-foreground, #ffffff);
      --accent: #5e81ac;
      --success: #a3be8c;
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    }

    body {
      background-color: var(--background);
      color: var(--foreground);
      font-family: var(--font-family);
      margin: 0;
      padding: 24px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }

    header {
      margin-bottom: 24px;
    }

    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.5px;
      background: linear-gradient(120deg, #81a1c1, #b48ead);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      color: var(--vscode-descriptionForeground, #888888);
      font-size: 14px;
      margin-top: 4px;
    }

    .controls {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .search-wrapper {
      position: relative;
      flex: 1;
    }

    .search-input {
      width: 100%;
      background-color: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--foreground);
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .filter-select {
      background-color: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--foreground);
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      min-width: 160px;
      cursor: pointer;
    }

    .skills-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      overflow-y: auto;
      flex: 1;
      padding-bottom: 20px;
    }

    .skill-card {
      background-color: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
      position: relative;
      overflow: hidden;
      min-height: 220px;
    }

    .skill-card:hover {
      transform: translateY(-2px);
      border-color: var(--accent);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .skill-card.active {
      border-color: var(--success);
    }

    .skill-card.active::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background-color: var(--success);
    }

    .skill-header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .skill-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
      color: var(--vscode-editor-foreground, #ffffff);
    }

    .skill-category {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      background-color: rgba(255,255,255,0.08);
      color: var(--vscode-descriptionForeground, #aaaaaa);
      margin-left: 8px;
      white-space: nowrap;
    }

    .skill-description {
      font-size: 13px;
      line-height: 1.4;
      color: var(--vscode-descriptionForeground, #aaaaaa);
      margin: 0 0 16px 0;
      flex: 1;
    }

    .skill-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
    }

    .tag {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      background-color: rgba(255,255,255,0.04);
      color: var(--vscode-descriptionForeground, #888888);
    }

    .skill-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .status-badge {
      font-size: 11px;
      font-weight: 500;
    }

    .status-badge.active {
      color: var(--success);
    }

    .status-badge.inactive {
      color: var(--vscode-descriptionForeground, #888888);
    }

    .toggle-btn {
      background-color: var(--button-bg);
      color: var(--button-fg);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .toggle-btn.view-btn {
      background-color: transparent;
      border: 1px solid var(--card-border);
      color: var(--foreground);
    }

    .toggle-btn.view-btn:hover {
      border-color: var(--accent);
      background-color: rgba(255,255,255,0.05);
    }

    .toggle-btn:hover {
      background-color: var(--button-hover);
    }

    .toggle-btn.active-btn {
      background-color: transparent;
      border: 1px solid var(--vscode-button-border, #3c3c3c);
      color: var(--foreground);
    }

    .toggle-btn.active-btn:hover {
      background-color: rgba(255,255,255,0.05);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--vscode-descriptionForeground, #888888);
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background, rgba(255, 255, 255, 0.1));
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground, rgba(255, 255, 255, 0.2));
    }
  </style>
</head>
<body>

  <header>
    <div class="title-row">
      <div>
        <h1>Antigravity Skill Marketplace</h1>
        <div class="subtitle">Search, discover, and toggle standard agent skills for deep context injection.</div>
      </div>
      <button class="toggle-btn" onclick="triggerSync()" style="height: 38px; display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
        <svg style="width:16px; height:16px;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3 3m0 0l3-3m-3 3V3"/>
        </svg>
        Sync GitHub Skills
      </button>
    </div>

    <div class="controls">
      <div class="search-wrapper">
        <input type="text" id="searchInput" class="search-input" placeholder="Search skills by name, description, tags...">
      </div>
      <select id="categoryFilter" class="filter-select">
        <option value="all">All Categories</option>
      </select>
      <button id="installCategoryBtn" class="toggle-btn" style="height: 38px; margin-left: 12px; display: none;" onclick="installCurrentCategory()">Install Category</button>
    </div>
    <div style="color: #f87171; font-size: 11px; font-weight: 600; margin-bottom: 20px; margin-top: -12px; letter-spacing: 0.3px;">
      * NOTE: Do not rely solely on categories right now. Use the search bar above for more comprehensive results.
    </div>
  </header>

  <div id="skillsGrid" class="skills-grid">
    <!-- Dynamic Content -->
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let allSkills = [];
    let categories = new Set();

    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const skillsGrid = document.getElementById('skillsGrid');

    // Listen for messages from VS Code
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.command) {
        case 'setSkills':
          allSkills = message.skills;
          updateCategories();
          renderSkills();
          break;
      }
    });

    function updateCategories() {
      categories.clear();
      allSkills.forEach(s => {
        if (s.category) categories.add(s.category);
      });

      // Keep selected value
      const currentSelected = categoryFilter.value;
      
      // Reset options
      categoryFilter.innerHTML = '<option value="all">All Categories (' + allSkills.length + ')</option>';
      Array.from(categories).sort().forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        const count = allSkills.filter(s => s.category === cat).length;
        option.textContent = cat + ' (' + count + ')';
        categoryFilter.appendChild(option);
      });

      if (Array.from(categories).includes(currentSelected)) {
        categoryFilter.value = currentSelected;
      }
    }

    function renderSkills() {
      const query = searchInput.value.toLowerCase();
      const category = categoryFilter.value;

      const filtered = allSkills.filter(s => {
        const matchesQuery = s.title.toLowerCase().includes(query) || 
                             s.description.toLowerCase().includes(query) ||
                             s.category.toLowerCase().includes(query) ||
                             (s.tags && s.tags.some(t => t.toLowerCase().includes(query)));
        const matchesCategory = category === 'all' || s.category === category;
        return matchesQuery && matchesCategory;
      });

      if (filtered.length === 0) {
        skillsGrid.innerHTML = \`
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <p style="margin-top: 12px; font-size: 15px;">No matching skills found.</p>
          </div>
        \`;
        return;
      }

      skillsGrid.innerHTML = '';
      filtered.forEach(s => {
        const card = document.createElement('div');
        card.className = 'skill-card';
        
        const tagsHtml = (s.tags || []).map(t => '<span class="tag">' + t + '</span>').join('');
        
        card.innerHTML = \`
          <div>
            <div class="skill-header">
              <h3 class="skill-title">\${s.title}</h3>
              <span class="skill-category">\${s.category}</span>
            </div>
            <p class="skill-description">\${s.description}</p>
            <div class="skill-tags">
              \${tagsHtml}
            </div>
          </div>
          <div class="skill-footer">
            <span class="status-badge inactive">
              AVAILABLE
            </span>
            <div style="display: flex; gap: 8px;">
              <button class="toggle-btn view-btn" onclick="openSkillFile('\${s.id}')">View</button>
              <button class="toggle-btn" onclick="installSkill('\${s.id}')">Install</button>
            </div>
          </div>
        \`;
        skillsGrid.appendChild(card);
      });
    }

    function installSkill(id) {
      vscode.postMessage({ command: 'installSkill', id });
    }

    function triggerSync() {
      vscode.postMessage({ command: 'refresh' });
    }

    function openSkillFile(id) {
      vscode.postMessage({ command: 'openSkillFile', id });
    }

    function installCurrentCategory() {
      const category = categoryFilter.value;
      if (category === 'all') return;
      const skillsToInstall = allSkills.filter(s => s.category === category).map(s => s.id);
      if (skillsToInstall.length > 0) {
        vscode.postMessage({ command: 'installSkillsBatch', ids: skillsToInstall });
      }
    }

    searchInput.addEventListener('input', renderSkills);
    categoryFilter.addEventListener('change', () => {
      const btn = document.getElementById('installCategoryBtn');
      if (categoryFilter.value === 'all') {
        btn.style.display = 'none';
      } else {
        btn.style.display = 'block';
      }
      renderSkills();
    });

    // Initial Request for Skills
    vscode.postMessage({ command: 'refresh' });
  </script>
</body>
</html>`;
  }
}