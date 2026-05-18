import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Skill {
  id: string;
  title: string;
  category: string;
  description: string;
  tags: string[];
  icon: string;
  isActive: boolean;
  color: string;
  fullInstructions: string;
  isCustom?: boolean;
}

export class SkillService {
  private _onDidChangeSkills = new vscode.EventEmitter<void>();
  public readonly onDidChangeSkills = this._onDidChangeSkills.event;

  private availableSkills: Skill[] = [];
  private installedSkills: Skill[] = [];
  private customCategories: string[] = [];

  constructor(private context: vscode.ExtensionContext) {
    // State loading is done on activation via loadState()
  }

  public getInstalledSkills(): Skill[] {
    return this.installedSkills;
  }

  public getCustomCategories(): string[] {
    return this.customCategories;
  }

  public addCustomCategory(name: string): boolean {
    if (!this.customCategories.includes(name)) {
      this.customCategories.push(name);
      this.saveState();
      this._onDidChangeSkills.fire();
      return true;
    }
    return false;
  }

  public renameFolder(oldName: string, newName: string): boolean {
    if (oldName === newName || !newName.trim()) return false;
    let changed = false;

    // 1. Rename custom category
    const idx = this.customCategories.indexOf(oldName);
    if (idx !== -1) {
      this.customCategories[idx] = newName.trim();
      changed = true;
    } else if (this.customCategories.includes(newName.trim())) {
      // Trying to rename to something that already exists as a custom category
    } else {
      // Add as custom category if it wasn't one
      this.customCategories.push(newName.trim());
      changed = true;
    }

    // 2. Rename inside installed skills
    this.installedSkills.forEach(skill => {
      if (skill.category === oldName) {
        skill.category = newName.trim();
        changed = true;
      }
    });

    if (changed) {
      this.saveState();
      this.injectSkillsToWorkspace();
      this._onDidChangeSkills.fire();
    }
    return changed;
  }

  public deleteFolder(categoryName: string): boolean {
    let changed = false;
    // 1. Remove skills in this category
    const skillsToDelete = this.installedSkills.filter(s => s.category === categoryName);
    if (skillsToDelete.length > 0) {
      this.installedSkills = this.installedSkills.filter(s => s.category !== categoryName);
      changed = true;
    }
    
    // 2. Remove from custom categories if present
    const idx = this.customCategories.indexOf(categoryName);
    if (idx !== -1) {
      this.customCategories.splice(idx, 1);
      changed = true;
    }

    if (changed) {
      this.saveState();
      this.injectSkillsToWorkspace();
      this._onDidChangeSkills.fire();
    }
    return changed;
  }

  public getSkills(): Skill[] {
    return this.getInstalledSkills();
  }

  public getMarketplaceSkills(): Skill[] {
    const installedIds = new Set(this.installedSkills.map(s => s.id));
    return this.availableSkills.filter(s => !installedIds.has(s.id));
  }

  public installSkill(id: string, categoryName?: string): boolean {
    const installedIds = new Set(this.installedSkills.map(s => s.id));
    if (installedIds.has(id)) return false;

    const skill = this.availableSkills.find(s => s.id === id);
    if (skill) {
      const newSkill = { ...skill, isActive: false };
      if (categoryName) {
        newSkill.category = categoryName;
      }
      this.installedSkills.push(newSkill);
      this.saveState();
      this.injectSkillsToWorkspace();
      this._onDidChangeSkills.fire();
      return true;
    }
    return false;
  }

  public uninstallSkill(id: string): boolean {
    const initialLength = this.installedSkills.length;
    this.installedSkills = this.installedSkills.filter(s => s.id !== id);
    if (this.installedSkills.length !== initialLength) {
      this.saveState();
      this.injectSkillsToWorkspace();
      this._onDidChangeSkills.fire();
      return true;
    }
    return false;
  }

  public moveSkillToCategory(id: string, newCategory: string): boolean {
    const skill = this.installedSkills.find(s => s.id === id);
    if (skill) {
      skill.category = newCategory;
      this.saveState();
      this.injectSkillsToWorkspace();
      this._onDidChangeSkills.fire();
      return true;
    }
    return false;
  }

  public toggleSkill(id: string): boolean {
    const skill = this.installedSkills.find(s => s.id === id);
    if (skill) {
      skill.isActive = !skill.isActive;
      this.saveState();
      this.injectSkillsToWorkspace(); // Sync with Agent context
      this._onDidChangeSkills.fire();
      return true;
    }
    return false;
  }

  public toggleCategory(categoryName: string): boolean {
    const categorySkills = this.installedSkills.filter(s => s.category === categoryName);
    if (categorySkills.length === 0) return false;

    // Determine target state: if all are active, deactivate them. Otherwise, activate all.
    const allActive = categorySkills.every(s => s.isActive);
    categorySkills.forEach(s => s.isActive = !allActive);

    this.saveState();
    this.injectSkillsToWorkspace();
    this._onDidChangeSkills.fire();
    return true;
  }

  public toggleAll(): void {
    // Determine target state: if any skill is inactive, activate all. If all are active, deactivate all.
    const anyInactive = this.installedSkills.some(s => !s.isActive);
    this.installedSkills.forEach(s => s.isActive = anyInactive);

    this.saveState();
    this.injectSkillsToWorkspace();
    this._onDidChangeSkills.fire();
  }

  private async injectSkillsToWorkspace() {
    const activeSkills = this.installedSkills.filter(s => s.isActive);
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return;
    }

    const root = vscode.workspace.workspaceFolders[0].uri;
    const skillsFolder = vscode.Uri.joinPath(root, '.antigravity', 'skills');
    const universalFile = vscode.Uri.joinPath(root, '.antigravity', 'UNIVERSAL_AGENT_GUIDE.md');
    const anthropicFile = vscode.Uri.joinPath(root, '.antigravity', 'active_skills.xml');

    try {
      // Clear old skills folders to prevent sync issues
      try {
        await vscode.workspace.fs.delete(skillsFolder, { recursive: true, useTrash: false });
      } catch (e) { /* ignore if not exists */ }

      await vscode.workspace.fs.createDirectory(skillsFolder);

      // --- Build the persistent system instruction content ---
      const skillNames = activeSkills.map(s => s.title.toUpperCase()).join(', ');
      const persistentHeader = activeSkills.length > 0
        ? [
            `# AGENT ASSISTANT — ACTIVE EXPERT SKILLS`,
            ``,
            `> CRITICAL SYSTEM INSTRUCTION: You MUST follow ALL guidelines below for EVERY message in this conversation.`,
            `> Do NOT forget these instructions after the first response. They apply to the ENTIRE session.`,
            `> Active Skills: ${skillNames}`,
            ``,
          ].join('\n')
        : '';

      let mdContent = persistentHeader;
      let xmlContent = '<available_skills>\n';
      let compactInstructions = ''; // For injection into settings/chat instructions

      if (activeSkills.length > 0) {
        mdContent += `## Expert Skill Guidelines\n\n`;

        for (const skill of activeSkills) {
          const skillDir = vscode.Uri.joinPath(skillsFolder, skill.id);
          const skillMdFile = vscode.Uri.joinPath(skillDir, 'SKILL.md');
          await vscode.workspace.fs.createDirectory(skillDir);

          const skillMdContent = `# Skill: ${skill.title}\n\n` +
            `## Instructions\n${skill.fullInstructions}\n\n` +
            `## Triggers\n${skill.tags.map(t => `- ${t}`).join('\n')}\n`;

          await vscode.workspace.fs.writeFile(skillMdFile, Buffer.from(skillMdContent, 'utf8'));

          // Build Universal Markdown
          mdContent += `### ${skill.title.toUpperCase()} (${skill.category})\n`;
          mdContent += `**Role**: ${skill.description}\n`;
          mdContent += `**Guidelines**:\n${skill.fullInstructions}\n`;
          mdContent += `---\n\n`;

          // Compact version for settings injection
          compactInstructions += `[${skill.title.toUpperCase()}]: ${skill.fullInstructions.trim()} `;

          // Keep Anthropic XML for backward compatibility
          xmlContent += '  <skill>\n';
          xmlContent += `    <name>${skill.id}</name>\n`;
          xmlContent += `    <description>${skill.description}</description>\n`;
          xmlContent += `    <location>${skillMdFile.fsPath}</location>\n`;
          xmlContent += '  </skill>\n';
        }
      } else {
        mdContent += `No specialized skills currently active. Operating in standard assistant mode.\n`;
      }

      xmlContent += '</available_skills>';

      // --- Write .antigravity internal files ---
      await vscode.workspace.fs.writeFile(universalFile, Buffer.from(mdContent, 'utf8'));
      await vscode.workspace.fs.writeFile(anthropicFile, Buffer.from(xmlContent, 'utf8'));

      // --- Update .gitignore ---
      await this.updateGitignore(root);

      // ============================================================
      // LAYER 1: .github/copilot-instructions.md (Gemini / Copilot)
      // ============================================================
      const githubDir = vscode.Uri.joinPath(root, '.github');
      try { await vscode.workspace.fs.createDirectory(githubDir); } catch (e) { /* exists */ }
      const copilotInstructionsFile = vscode.Uri.joinPath(githubDir, 'copilot-instructions.md');
      await vscode.workspace.fs.writeFile(copilotInstructionsFile, Buffer.from(mdContent, 'utf8'));

      // ============================================================
      // LAYER 2: .vscode/settings.json — chat.instructions
      // ============================================================
      await this.injectChatInstructions(root, activeSkills, compactInstructions);

      // ============================================================
      // LAYER 3: Cursor (.cursorrules)
      // ============================================================
      const cursorRulesFile = vscode.Uri.joinPath(root, '.cursorrules');
      await vscode.workspace.fs.writeFile(cursorRulesFile, Buffer.from(mdContent, 'utf8'));

      // ============================================================
      // LAYER 4: Claude Code + Antigravity (CLAUDE.md)
      // ============================================================
      const claudeMdFile = vscode.Uri.joinPath(root, 'CLAUDE.md');
      await vscode.workspace.fs.writeFile(claudeMdFile, Buffer.from(mdContent, 'utf8'));

      // ============================================================
      // LAYER 5: Antigravity IDE / Gemini (GEMINI.md)
      // ============================================================
      const geminiMdFile = vscode.Uri.joinPath(root, 'GEMINI.md');
      await vscode.workspace.fs.writeFile(geminiMdFile, Buffer.from(mdContent, 'utf8'));

      // ============================================================
      // LAYER 6: Gemini Code Assist (.gemini/settings.json)
      // ============================================================
      const geminiDir = vscode.Uri.joinPath(root, '.gemini');
      try { await vscode.workspace.fs.createDirectory(geminiDir); } catch (e) { /* exists */ }
      const geminiStyleFile = vscode.Uri.joinPath(geminiDir, 'settings.json');
      const geminiSettings = JSON.stringify({
        codeAssist: {
          systemInstruction: activeSkills.length > 0
            ? `You have the following expert personas active. Follow their guidelines for EVERY response: ${compactInstructions.trim()}`
            : ''
        }
      }, null, 2);
      await vscode.workspace.fs.writeFile(geminiStyleFile, Buffer.from(geminiSettings, 'utf8'));

      const count = activeSkills.length;
      vscode.window.setStatusBarMessage(
        count > 0
          ? `$(zap) ${count} Expert Skill(s) synced to all AI agents`
          : `$(info) All skills deactivated — agents reset to default mode`,
        4000
      );
    } catch (err) {
      console.error('Failed to inject universal skills', err);
    }
  }

  private async updateGitignore(root: vscode.Uri) {
    const gitignoreFile = vscode.Uri.joinPath(root, '.gitignore');
    const ignoreEntries = [
      '',
      '# Agent Assistant Skills & Context',
      '.antigravity/',
      '.gemini/',
      'CLAUDE.md',
      'GEMINI.md',
      '.github/copilot-instructions.md'
    ];
    
    let content = '';
    try {
      const raw = await vscode.workspace.fs.readFile(gitignoreFile);
      content = Buffer.from(raw).toString('utf8');
    } catch (e) {
      // File doesn't exist, we will create it
    }

    let changed = false;
    for (const entry of ignoreEntries) {
      if (entry && !content.includes(entry)) {
        if (!changed && content && !content.endsWith('\n')) {
          content += '\n';
        }
        content += entry + '\n';
        changed = true;
      }
    }

    if (changed) {
      try {
        await vscode.workspace.fs.writeFile(gitignoreFile, Buffer.from(content, 'utf8'));
      } catch (err) {
        console.error('Failed to update .gitignore', err);
      }
    }
  }

  private async injectChatInstructions(
    root: vscode.Uri,
    activeSkills: Skill[],
    compactInstructions: string
  ) {
    const vscodeDir = vscode.Uri.joinPath(root, '.vscode');
    const settingsFile = vscode.Uri.joinPath(vscodeDir, 'settings.json');

    try {
      try { await vscode.workspace.fs.createDirectory(vscodeDir); } catch (e) { /* exists */ }

      let existingSettings: Record<string, any> = {};
      try {
        const raw = await vscode.workspace.fs.readFile(settingsFile);
        const text = Buffer.from(raw).toString('utf8');
        const stripped = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        existingSettings = JSON.parse(stripped);
      } catch (e) { /* file doesn't exist or parse error */ }

      const agentAssistantMarker = '[Agent Assistant]';
      const existingInstructions: any[] = existingSettings['github.copilot.chat.codeGeneration.instructions'] || [];
      const cleaned = existingInstructions.filter(
        (entry: any) => typeof entry === 'string'
          ? !entry.includes(agentAssistantMarker)
          : !(entry.text && entry.text.includes(agentAssistantMarker))
      );

      if (activeSkills.length > 0) {
        cleaned.push({
          text: `${agentAssistantMarker} PERSISTENT EXPERT INSTRUCTIONS — Apply these to EVERY response in this session: ${compactInstructions.trim()}`
        });
      }

      existingSettings['github.copilot.chat.codeGeneration.instructions'] = cleaned;

      const content = JSON.stringify(existingSettings, null, 2);
      await vscode.workspace.fs.writeFile(settingsFile, Buffer.from(content, 'utf8'));
    } catch (err) {
      console.error('Failed to inject chat instructions into .vscode/settings.json', err);
    }
  }

  private saveState() {
    this.context.globalState.update('antigravity.installedSkills', this.installedSkills);
    this.context.globalState.update('antigravity.customCategories', this.customCategories);

    const activeStates = this.installedSkills.reduce((acc, s) => {
      acc[s.id] = s.isActive;
      return acc;
    }, {} as Record<string, boolean>);
    this.context.globalState.update('antigravity.skillsActiveState', activeStates);
  }

  public async loadState() {
    // 1. Scan and parse local 1,440+ skills dynamically
    this.availableSkills = this.scanLocalSkills();

    // 2. Load installed skills list from globalState
    let savedInstalled = this.context.globalState.get<Skill[]>('antigravity.installedSkills') || [];

    // Fallback: if empty, pre-install the 2 core skills and active them
    if (savedInstalled.length === 0) {
      const coreIds = ['arabic-localization', 'human-coder'];
      savedInstalled = this.availableSkills.filter(s => coreIds.includes(s.id));
      savedInstalled.forEach(s => s.isActive = true);
    }

    this.installedSkills = savedInstalled;

    // Load active status mapping
    const activeStates = this.context.globalState.get<Record<string, boolean>>('antigravity.skillsActiveState') || {};
    this.installedSkills.forEach(s => {
      if (activeStates[s.id] !== undefined) {
        s.isActive = activeStates[s.id];
      }
    });

    // Load custom empty folders
    this.customCategories = this.context.globalState.get<string[]>('antigravity.customCategories') || [];

    // 3. Sync instruction files on activation with loaded state
    await this.injectSkillsToWorkspace();
  }

  public addCustomSkill(skill: Skill) {
    skill.isCustom = true;
    skill.isActive = true;
    this.installedSkills.push(skill);
    this.saveState();
    this.injectSkillsToWorkspace();
    this._onDidChangeSkills.fire();
  }

  public deleteCustomSkill(id: string) {
    this.installedSkills = this.installedSkills.filter(s => s.id !== id);
    this.saveState();
    this.injectSkillsToWorkspace();
    this._onDidChangeSkills.fire();
  }

  private scanLocalSkills(): Skill[] {
    const parsed: Skill[] = [];
    const skillsDir = path.join(this.context.extensionPath, 'skill');

    // Always include the two hardcoded core skills
    const hardcodedSkills: Skill[] = [
      {
        id: 'arabic-localization',
        title: 'arabic-rtl for chat',
        category: 'Standalone',
        description: 'Ensure proper Right-to-Left text alignment for Arabic communication.',
        tags: ['RTL', 'Arabic', 'Localization'],
        icon: 'symbol-string',
        isActive: false,
        color: '#0ea5e9',
        fullInstructions: `- RTL ARABIC SUPPORT: If the user communicates in Arabic, you MUST wrap your entire response in \`<div dir="rtl">\` and \`</div>\` to ensure proper Right-to-Left text alignment in the chat interface.\n- CONSISTENCY: Always ensure that the \`div\` tags correctly wrap the entire response when speaking in Arabic.`
      },
      {
        id: 'human-coder',
        title: 'human-persona',
        category: 'Persona & Tone',
        description: 'Professional human-like communication. Eliminates AI markers and excessive emojis.',
        tags: ['Human Style', 'No Emojis', 'Clean Tone'],
        icon: 'person',
        isActive: false,
        color: '#334155',
        fullInstructions: `- ZERO TOLERANCE FOR EMOJIS: Never use icons or any other symbols.\n- ELIMINATE CONVERSATIONAL FILLER: Do not use generic AI greetings or filler phrases in any language. Start directly with the technical content.\n- MULTILINGUAL PROFESSIONALISM: Maintain a professional, senior-level technical tone in the user's preferred language (e.g., Arabic or English).\n- ADOPT SENIOR PRAGMATISM: Write code and comments as a focused human senior developer would. Use concise, technical language.\n- NO AI MARKERS: Do not explain obvious logic or use repetitive AI-style bullet points.\n- PURE TECHNICAL DELIVERY: Provide only the code and essential technical notes in a professional, dry tone.`
      }
    ];

    parsed.push(...hardcodedSkills);

    if (!fs.existsSync(skillsDir)) {
      return parsed;
    }

    try {
      const dirs = fs.readdirSync(skillsDir);
      for (const dir of dirs) {
        if (dir.startsWith('.')) continue;

        const dirPath = path.join(skillsDir, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          const mdPath = path.join(dirPath, 'SKILL.md');
          if (fs.existsSync(mdPath)) {
            try {
              const content = fs.readFileSync(mdPath, 'utf8');
              const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
              
              let name = dir;
              let description = '';
              let category = 'Uncategorized';
              
              if (frontmatterMatch) {
                const fm = frontmatterMatch[1];
                const nameMatch = fm.match(/name:\s*(.+)/);
                if (nameMatch) name = nameMatch[1].trim();
                
                const descMatch = fm.match(/description:\s*["']?([\s\S]*?)["']?\n(?:\w+:|$)/);
                if (descMatch) description = descMatch[1].trim();
                
                const catMatch = fm.match(/category:\s*(.+)/);
                if (catMatch) category = catMatch[1].trim();
              }

              // Skip duplicate if it matches hardcoded IDs
              if (parsed.some(s => s.id === dir)) continue;

              parsed.push({
                id: dir,
                title: name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                category: category.charAt(0).toUpperCase() + category.slice(1),
                description: description || 'No description available.',
                tags: [category, 'Awesome-Skill'],
                icon: 'zap',
                isActive: false,
                color: '#6366f1',
                fullInstructions: content.replace(/^---\n([\s\S]*?)\n---/, '').trim()
              });
            } catch (e) {
              // Ignore individual parsing failures silently to keep extension robust
            }
          }
        }
      }
    } catch (err) {
      console.error('Error scanning local skills folder:', err);
    }

    return parsed;
  }
}
