import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ApiClient } from '../../core/network/api.client';
import { coreSkills } from './data/core-skills';

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
  isCustom?: boolean;  // Global user-defined skill (persisted across all workspaces)
  isProject?: boolean; // Workspace-scoped project skill (persisted in .antigravity/project_skills.json)
}

export class SkillService {
  private _onDidChangeSkills = new vscode.EventEmitter<void>();
  public readonly onDidChangeSkills = this._onDidChangeSkills.event;

  private availableSkills: Skill[] = [];
  private installedSkills: Skill[] = [];
  private customCategories: string[] = [];
  private isInjecting = false;

  constructor(private context: vscode.ExtensionContext) {
    // State loading is done on activation via loadState()
  }

  public getWorkspacePathForUri(uri: vscode.Uri): string | undefined {
    const fsPath = uri.fsPath;
    const projectSkillsMap = this.getProjectSkillsMap();
    for (const workspacePath of Object.keys(projectSkillsMap)) {
      if (fsPath.startsWith(workspacePath)) {
        return workspacePath;
      }
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder?.uri.fsPath;
  }

  public getAvailableSkills(): Skill[] {
    return this.availableSkills;
  }

  public async addSkillToWorkspacePath(workspacePath: string, skillId: string): Promise<boolean> {
    const marketSkill = this.availableSkills.find(s => s.id === skillId) || this.installedSkills.find(s => s.id === skillId);
    if (!marketSkill) return false;

    const projectSkill: Skill = {
      ...marketSkill,
      id: `project-${skillId.replace(/^project-/, '')}-${Date.now()}`,
      isProject: true,
      isCustom: false,
      isActive: true
    };

    await this.addSkillToSpecificProject(workspacePath, projectSkill);
    return true;
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
    const market = this.availableSkills.filter(s => !installedIds.has(s.id));

    // Force 'human-coder' and 'arabic-localization' to be at the very top of the marketplace list
    market.sort((a, b) => {
      const priorityIds = ['human-coder', 'arabic-localization'];
      const aIdx = priorityIds.indexOf(a.id);
      const bIdx = priorityIds.indexOf(b.id);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return 0; // Maintain original order for others
    });

    return market;
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

      // If this is a project skill, persist to projectSkillsMap
      if (skill.isProject) {
        const workspaceKey = this.getCurrentWorkspaceKey();
        if (workspaceKey) {
          const projectSkillsMap = this.getProjectSkillsMap();
          const projectSkills = projectSkillsMap[workspaceKey] || [];
          const target = projectSkills.find(s => s.id === id);
          if (target) {
            target.isActive = skill.isActive;
            projectSkillsMap[workspaceKey] = projectSkills;
            this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
          }
        }
      }

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
    if (this.isInjecting) return;
    this.isInjecting = true;

    try {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return;
      }

      const currentPath = this.getCurrentWorkspaceKey();
      if (!currentPath) return;

      const projectSkillsMap = this.getProjectSkillsMap();
      const currentProjectSkills = projectSkillsMap[currentPath] || [];
      const activeSkills = currentProjectSkills.filter(s => s.isActive);

      const root = vscode.workspace.workspaceFolders[0].uri;
      const skillsFolder = vscode.Uri.joinPath(root, '.antigravity', 'skills');
      const universalFile = vscode.Uri.joinPath(root, '.antigravity', 'UNIVERSAL_AGENT_GUIDE.md');
      const anthropicFile = vscode.Uri.joinPath(root, '.antigravity', 'active_skills.xml');

      // Clear old skills folders to prevent sync issues
      try {
        await vscode.workspace.fs.delete(skillsFolder, { recursive: true, useTrash: false });
      } catch (e) { /* ignore if not exists */ }

      await vscode.workspace.fs.createDirectory(skillsFolder);

      // Write ALL project skills to the skills folder so their states are preserved
      for (const skill of currentProjectSkills) {
        const skillDir = vscode.Uri.joinPath(skillsFolder, skill.id);
        const skillMdFile = vscode.Uri.joinPath(skillDir, 'SKILL.md');
        await vscode.workspace.fs.createDirectory(skillDir);

        const fm = [
          `---`,
          `id: ${skill.id}`,
          `title: ${JSON.stringify(skill.title)}`,
          `category: ${JSON.stringify(skill.category)}`,
          `description: ${JSON.stringify(skill.description)}`,
          `active: ${skill.isActive}`,
          `---`,
          ``
        ].join('\n');

        const skillMdContent = fm + `# Skill: ${skill.title}\n\n` +
          `## Instructions\n${skill.fullInstructions}\n\n` +
          `## Triggers\n${skill.tags.map(t => `- ${t}`).join('\n')}\n`;

        await vscode.workspace.fs.writeFile(skillMdFile, Buffer.from(skillMdContent, 'utf8'));
      }

      // --- Build the persistent system instruction content from ACTIVE skills ---
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
          const skillMdFile = vscode.Uri.joinPath(skillsFolder, skill.id, 'SKILL.md');

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

      // Save workspace active skills
      await this.saveWorkspaceActiveSkills(activeSkills);

      const count = activeSkills.length;
      vscode.window.setStatusBarMessage(
        count > 0
          ? `$(zap) ${count} Expert Skill(s) synced to all AI agents`
          : `$(info) All skills deactivated — agents reset to default mode`,
        4000
      );
    } catch (err) {
      console.error('Failed to inject universal skills', err);
    } finally {
      setTimeout(() => {
        this.isInjecting = false;
      }, 500);
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

  private getCurrentWorkspaceKey(): string | undefined {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return undefined;
  }

  private saveState() {
    // Separate the three categories
    const globalMarketSkills = this.installedSkills.filter(s => !s.isCustom && !s.isProject);
    const globalCustomSkills = this.installedSkills.filter(s => s.isCustom);
    const projectSkills = this.installedSkills.filter(s => s.isProject);

    // Persist market + custom skills globally
    this.context.globalState.update('antigravity.installedSkills', [...globalMarketSkills, ...globalCustomSkills]);
    this.context.globalState.update('antigravity.customCategories', this.customCategories);

    const activeStates = this.installedSkills.reduce((acc, s) => {
      acc[s.id] = s.isActive;
      return acc;
    }, {} as Record<string, boolean>);
    this.context.globalState.update('antigravity.skillsActiveState', activeStates);

    // Persist project skills to extension globalState mapped by workspace path
    const workspaceKey = this.getCurrentWorkspaceKey();
    if (workspaceKey) {
      const projectSkillsMap = this.context.globalState.get<Record<string, Skill[]>>('antigravity.projectSkillsMap') || {};
      projectSkillsMap[workspaceKey] = projectSkills;
      this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
    }
  }

  private async loadFallbackSkills(): Promise<Skill[]> {
    try {
      const fileUri = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'skills.json');
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(raw).toString('utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 2) {
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load fallback skills from resources/skills.json', e);
    }
    return coreSkills.map(s => ({ ...s, isActive: false }));
  }

  public async loadState() {
    // 1. Load cached GitHub marketplace skills or fall back to coreSkills / local scan
    const cached = this.context.globalState.get<Skill[]>('antigravity.githubMarketplaceSkills');
    if (cached && Array.isArray(cached) && cached.length > 2) {
      this.availableSkills = cached;
    } else {
      const scanned = this.scanLocalSkills();
      if (scanned.length > 2) {
        this.availableSkills = scanned;
      } else {
        this.availableSkills = await this.loadFallbackSkills();
      }
    }

    // Silent background fetch to update the marketplace
    this.fetchMarketplaceSkillsFromGitHub().catch(() => {});

    // 2. Load globally-installed skills (market + custom) from globalState
    let savedInstalled = this.context.globalState.get<Skill[]>('antigravity.installedSkills') || [];

    this.installedSkills = savedInstalled;

    // 3. Load workspace-scoped project skills from extension globalState mapped by absolute workspace path
    const projectSkillsMap = this.getProjectSkillsMap();
    for (const workspacePath of Object.keys(projectSkillsMap)) {
      await this.syncWorkspaceFolderSkills(workspacePath);
    }

    const workspaceKey = this.getCurrentWorkspaceKey();
    if (workspaceKey) {
      // Auto-register current workspace in projectSkillsMap if not present
      const currentMap = this.getProjectSkillsMap();
      if (!currentMap[workspaceKey]) {
        currentMap[workspaceKey] = [];
        await this.context.globalState.update('antigravity.projectSkillsMap', currentMap);
      }

      await this.syncWorkspaceFolderSkills(workspaceKey);
      const loadedProjectSkills = this.getProjectSkillsMap()[workspaceKey] || [];
      loadedProjectSkills.forEach(s => {
        s.isProject = true;
        if (!this.installedSkills.some(inst => inst.id === s.id)) {
          this.installedSkills.push(s);
        }
      });
    }

    // 4. Load active status mapping (Only for global custom and marketplace skills)
    const activeStates = this.context.globalState.get<Record<string, boolean>>('antigravity.skillsActiveState') || {};
    this.installedSkills.forEach(s => {
      if (!s.isProject && activeStates[s.id] !== undefined) {
        s.isActive = activeStates[s.id];
      }
    });

    // 5. Load workspace-scoped active skills if they exist
    await this.loadWorkspaceActiveSkills();

    // 6. Load custom empty folders
    this.customCategories = this.context.globalState.get<string[]>('antigravity.customCategories') || [];

    // 7. Sync instruction files on activation with loaded state
    await this.injectSkillsToWorkspace();
  }

  // --- Global Custom Skill (cross-workspace) ---
  public addCustomSkill(skill: Skill) {
    skill.isCustom = true;
    skill.isProject = false;
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

  // --- Project Skill (workspace-scoped) ---
  public async addProjectSkill(skill: Skill) {
    skill.isProject = true;
    skill.isCustom = false;
    skill.isActive = true;

    // Persist into projectSkillsMap so the Project Skills tree shows it
    const workspaceKey = this.getCurrentWorkspaceKey();
    if (workspaceKey) {
      const projectSkillsMap = this.getProjectSkillsMap();
      const skills = projectSkillsMap[workspaceKey] || [];
      if (!skills.some(s => s.id === skill.id)) {
        skills.push(skill);
      }
      projectSkillsMap[workspaceKey] = skills;
      await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
      await this.injectSkillsToWorkspace();
    }

    this._onDidChangeSkills.fire();
  }

  public deleteProjectSkill(id: string) {
    const currentPath = this.getCurrentWorkspaceKey();
    if (currentPath) {
      this.deleteProjectSkillFromSpecificWorkspace(currentPath, id);
    }
  }

  public getCurrentWorkspacePath(): string | undefined {
    return this.getCurrentWorkspaceKey();
  }

  public getProjectSkillsMap(): Record<string, Skill[]> {
    return this.context.globalState.get<Record<string, Skill[]>>('antigravity.projectSkillsMap') || {};
  }

  public async addSkillToSpecificProject(workspacePath: string, skill: Skill): Promise<void> {
    const projectSkillsMap = this.getProjectSkillsMap();
    const skills = projectSkillsMap[workspacePath] || [];

    if (!skills.some(s => s.id === skill.id || s.title.toLowerCase() === skill.title.toLowerCase())) {
      skills.push(skill);
      projectSkillsMap[workspacePath] = skills;
      await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);

      const currentPath = this.getCurrentWorkspaceKey();
      if (currentPath === workspacePath) {
        await this.injectSkillsToWorkspace();
      } else {
        // Inject into the target project's files even though it's not currently open
        await this.injectSkillsToSpecificWorkspace(workspacePath);
      }

      this._onDidChangeSkills.fire();
    }
  }

  public async deleteProjectSkillFromSpecificWorkspace(workspacePath: string, id: string): Promise<void> {
    const projectSkillsMap = this.getProjectSkillsMap();
    const skills = projectSkillsMap[workspacePath] || [];
    const updatedSkills = skills.filter(s => s.id !== id);
    projectSkillsMap[workspacePath] = updatedSkills;
    await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);

    const currentPath = this.getCurrentWorkspaceKey();
    if (currentPath === workspacePath) {
      await this.injectSkillsToWorkspace();
    } else {
      await this.injectSkillsToSpecificWorkspace(workspacePath);
    }
    this._onDidChangeSkills.fire();
  }

  public async removeProjectWorkspacePath(workspacePath: string): Promise<void> {
    const projectSkillsMap = this.getProjectSkillsMap();
    if (projectSkillsMap[workspacePath]) {
      delete projectSkillsMap[workspacePath];
      await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
      
      const currentPath = this.getCurrentWorkspaceKey();
      if (currentPath === workspacePath) {
        this.installedSkills = this.installedSkills.filter(s => !s.isProject);
        await this.injectSkillsToWorkspace();
      } else {
        // Also clean up instruction files in the target project folder since we are deleting it
        const root = vscode.Uri.file(workspacePath);
        try {
          await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, '.antigravity'), { recursive: true, useTrash: false });
        } catch (e) {}
        try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, '.cursorrules')); } catch (e) {}
        try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, 'CLAUDE.md')); } catch (e) {}
        try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, 'GEMINI.md')); } catch (e) {}
      }
      
      this._onDidChangeSkills.fire();
      vscode.window.showInformationMessage(`Removed project workspace: ${path.basename(workspacePath)}`);
    }
  }

  public async syncWorkspaceFolderSkills(workspacePath: string): Promise<void> {
    const root = vscode.Uri.file(workspacePath);
    const skillsFolder = vscode.Uri.joinPath(root, '.antigravity', 'skills');
    
    try {
      await vscode.workspace.fs.stat(skillsFolder);
      const files = await vscode.workspace.fs.readDirectory(skillsFolder);
      const foundSkills: Skill[] = [];
      const projectSkillsMap = this.getProjectSkillsMap();
      const currentSkills = projectSkillsMap[workspacePath] || [];

      for (const [name, type] of files) {
        if (type === vscode.FileType.Directory) {
          // Ignore old or global folders that don't have project or custom prefix
          if (!name.startsWith('project-') && !name.startsWith('custom-')) {
            continue;
          }
          const folderUri = vscode.Uri.joinPath(skillsFolder, name);
          const parsedSkill = await this.parseSkillFromMd(folderUri, name);
          if (parsedSkill) {
            foundSkills.push(parsedSkill);
          }
        }
      }

      projectSkillsMap[workspacePath] = foundSkills;
      await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
      
      const currentPath = this.getCurrentWorkspaceKey();
      if (currentPath === workspacePath) {
        this.installedSkills = this.installedSkills.filter(s => !s.isProject);
        foundSkills.forEach(s => {
          s.isProject = true;
          if (!this.installedSkills.some(inst => inst.id === s.id)) {
            this.installedSkills.push(s);
          }
        });
      }
      this._onDidChangeSkills.fire();
    } catch (e) {
      // If skills folder doesn't exist but project has skills, they might have been deleted manually from folder,
      // so let's empty the projectSkillsMap for this workspace if folder is gone.
      const projectSkillsMap = this.getProjectSkillsMap();
      if (projectSkillsMap[workspacePath] && projectSkillsMap[workspacePath].length > 0) {
        projectSkillsMap[workspacePath] = [];
        await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
        
        const currentPath = this.getCurrentWorkspaceKey();
        if (currentPath === workspacePath) {
          this.installedSkills = this.installedSkills.filter(s => !s.isProject);
        }
        this._onDidChangeSkills.fire();
      }
    }
  }

  public async fetchMarketplaceSkillsFromGitHub(): Promise<void> {
    const config = vscode.workspace.getConfiguration('antigravityAccounts');
    const url = config.get<string>('skillsMarketplaceUrl') || 'https://raw.githubusercontent.com/men3emkhaled/agent-assistant-extension/main/skills.json';

    try {
      const githubSkills = await ApiClient.request<Skill[]>(url);
      if (Array.isArray(githubSkills)) {
        this.availableSkills = githubSkills.map(s => ({
          ...s,
          isActive: false
        }));

        // Preserve our hardcoded core skills in availableSkills if not present
        const hardcoded = this.scanLocalSkills().filter(s => s.id === 'arabic-localization' || s.id === 'human-coder');
        for (const h of hardcoded) {
          if (!this.availableSkills.some(s => s.id === h.id)) {
            this.availableSkills.unshift(h);
          }
        }

        await this.context.globalState.update('antigravity.githubMarketplaceSkills', this.availableSkills);
        this._onDidChangeSkills.fire();
      }
    } catch (error) {
      console.error('Failed to fetch marketplace skills from GitHub', error);
      const cached = this.context.globalState.get<Skill[]>('antigravity.githubMarketplaceSkills');
      if (cached && Array.isArray(cached) && cached.length > 2) {
        this.availableSkills = cached;
      } else {
        const scanned = this.scanLocalSkills();
        if (scanned.length > 2) {
          this.availableSkills = scanned;
        } else {
          this.availableSkills = await this.loadFallbackSkills();
        }
      }
    }
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

  private async saveWorkspaceActiveSkills(activeSkills: Skill[]) {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return;
    }
    const root = vscode.workspace.workspaceFolders[0].uri;
    const fileUri = vscode.Uri.joinPath(root, '.antigravity', 'active_skills.json');
    const data = {
      activeSkillIds: activeSkills.map(s => s.id)
    };
    try {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
    } catch (err) {
      console.error('Failed to save workspace active skills', err);
    }
  }

  private async loadWorkspaceActiveSkills() {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return;
    }
    const root = vscode.workspace.workspaceFolders[0].uri;
    const fileUri = vscode.Uri.joinPath(root, '.antigravity', 'active_skills.json');
    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(raw).toString('utf8');
      const data = JSON.parse(text);
      if (data && Array.isArray(data.activeSkillIds)) {
        const activeIds = new Set(data.activeSkillIds);
        this.installedSkills.forEach(s => {
          s.isActive = activeIds.has(s.id);
        });
      }
    } catch (e) {
      // File doesn't exist yet, we fall back to global active states (already loaded)
    }
  }

  public async scanWorkspaceForRecommendations(): Promise<Array<{ skill: Skill; matchedKeywords: string[] }>> {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return [];
    }

    const root = vscode.workspace.workspaceFolders[0].uri;
    const keywords = new Set<string>();

    // Ensure availableSkills are fetched and loaded before matching
    if (this.availableSkills.length <= 2) {
      try {
        await this.fetchMarketplaceSkillsFromGitHub();
      } catch (e) {}
    }

    // 1. Check package.json dependencies
    try {
      const packageJsonUri = vscode.Uri.joinPath(root, 'package.json');
      const raw = await vscode.workspace.fs.readFile(packageJsonUri);
      const content = Buffer.from(raw).toString('utf8');
      const pkg = JSON.parse(content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      
      for (const dep of Object.keys(deps)) {
        keywords.add(dep.toLowerCase());
        dep.toLowerCase().split(/[-/_]/).forEach(w => {
          if (w.length > 2) keywords.add(w);
        });
      }
    } catch (e) {
      // Ignore if package.json does not exist
    }

    // 2. Check for configuration files
    const configMappings: Record<string, string[]> = {
      'tsconfig.json': ['typescript', 'ts'],
      'jsconfig.json': ['javascript', 'js'],
      'tailwind.config.js': ['tailwind', 'css'],
      'tailwind.config.ts': ['tailwind', 'css'],
      'vite.config.ts': ['vite', 'frontend'],
      'vite.config.js': ['vite', 'frontend'],
      'next.config.js': ['nextjs', 'next.js', 'react'],
      'next.config.mjs': ['nextjs', 'next.js', 'react'],
      'webpack.config.js': ['webpack'],
      'Cargo.toml': ['rust'],
      'go.mod': ['go', 'golang'],
      'composer.json': ['php'],
      'pom.xml': ['java'],
      'build.gradle': ['java', 'kotlin'],
      'Dockerfile': ['docker'],
      'docker-compose.yml': ['docker'],
      'requirements.txt': ['python', 'py'],
      'pyproject.toml': ['python', 'py'],
      'Pipfile': ['python', 'py'],
      'Makefile': ['make'],
      '.github/workflows': ['github-actions', 'ci', 'cd'],
    };

    for (const [filename, keys] of Object.entries(configMappings)) {
      try {
        const fileUri = vscode.Uri.joinPath(root, filename);
        await vscode.workspace.fs.stat(fileUri);
        keys.forEach(k => keywords.add(k));
      } catch {}
    }

    // 3. Scan workspace file extensions up to depth 3
    const extensionCounts: Record<string, number> = {};
    const languageMappings: Record<string, string[]> = {
      '.ts': ['typescript', 'ts'],
      '.tsx': ['typescript', 'react', 'ts', 'tsx'],
      '.js': ['javascript', 'js'],
      '.jsx': ['javascript', 'react', 'js', 'jsx'],
      '.go': ['go', 'golang'],
      '.py': ['python', 'py'],
      '.rs': ['rust'],
      '.java': ['java'],
      '.kt': ['kotlin'],
      '.cs': ['csharp', 'dotnet'],
      '.cpp': ['cpp', 'cplusplus'],
      '.c': ['c'],
      '.swift': ['swift'],
      '.glsl': ['glsl', 'threejs', 'webgl', 'shaders'],
      '.vert': ['glsl', 'threejs', 'webgl', 'shaders'],
      '.frag': ['glsl', 'threejs', 'webgl', 'shaders'],
      '.html': ['html'],
      '.css': ['css'],
      '.md': ['markdown'],
      '.sql': ['sql', 'database'],
    };

    const maxFilesToScan = 500;
    let filesScanned = 0;

    const scanDirectory = async (dirUri: vscode.Uri, depth: number) => {
      if (depth > 3 || filesScanned > maxFilesToScan) return;
      try {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
          if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build' || name === 'out') {
            continue;
          }
          const childUri = vscode.Uri.joinPath(dirUri, name);
          if (type === vscode.FileType.Directory) {
            await scanDirectory(childUri, depth + 1);
          } else if (type === vscode.FileType.File) {
            filesScanned++;
            const ext = path.extname(name).toLowerCase();
            if (ext) {
              extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
            }
          }
        }
      } catch {}
    };

    await scanDirectory(root, 1);

    for (const [ext, count] of Object.entries(extensionCounts)) {
      if (count >= 2 && languageMappings[ext]) {
        languageMappings[ext].forEach(k => keywords.add(k));
      }
    }

    const recommendations: Array<{ skill: Skill; matchedKeywords: string[]; score: number }> = [];
    const installedIds = new Set(this.installedSkills.map(s => s.id));

    // Also exclude skills already present as project skills in the current workspace
    const currentPath = this.getCurrentWorkspaceKey();
    if (currentPath) {
      const projectSkillsMap = this.getProjectSkillsMap();
      const projectSkills = projectSkillsMap[currentPath] || [];
      projectSkills.forEach(s => {
        installedIds.add(s.id);
        // Also add the base skill ID (strip project- prefix and timestamp suffix)
        const baseId = s.id.replace(/^project-/, '').replace(/-\d+$/, '');
        installedIds.add(baseId);
      });
    }

    const activeKeywords = Array.from(keywords);

    for (const skill of this.availableSkills) {
      if (installedIds.has(skill.id)) {
        continue;
      }

      let score = 0;
      const matched: string[] = [];

      for (const kw of activeKeywords) {
        let keywordMatched = false;
        
        if (skill.tags.some(t => t.toLowerCase() === kw) || skill.category.toLowerCase() === kw) {
          score += 10;
          keywordMatched = true;
        }

        if (skill.id.toLowerCase().includes(kw)) {
          score += 8;
          keywordMatched = true;
        }

        const titleWords = skill.title.toLowerCase().split(/\s+/);
        if (titleWords.includes(kw)) {
          score += 5;
          keywordMatched = true;
        } else if (skill.title.toLowerCase().includes(kw)) {
          score += 3;
          keywordMatched = true;
        }

        if (skill.description.toLowerCase().includes(kw)) {
          score += 2;
          keywordMatched = true;
        }

        if (skill.fullInstructions.toLowerCase().includes(kw)) {
          score += 1;
          keywordMatched = true;
        }

        if (keywordMatched) {
          matched.push(kw);
        }
      }

      if (score > 0) {
        recommendations.push({
          skill,
          matchedKeywords: matched,
          score
        });
      }
    }

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(r => ({ skill: r.skill, matchedKeywords: r.matchedKeywords }));
  }

  public async detectTechStackAndRecommend() {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      return;
    }
    const root = vscode.workspace.workspaceFolders[0].uri;
    const recommendations: Array<{ skillId: string; reason: string }> = [];

    // Check for package.json (Node/JS/TS/Frontend)
    try {
      const packageJsonUri = vscode.Uri.joinPath(root, 'package.json');
      const raw = await vscode.workspace.fs.readFile(packageJsonUri);
      const content = Buffer.from(raw).toString('utf8');
      const pkg = JSON.parse(content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (deps['react'] || deps['vue'] || deps['svelte'] || deps['next']) {
        recommendations.push({
          skillId: 'creative-ui',
          reason: 'Frontend environment (React/Vue/Next/Svelte)'
        });
      }
      if (deps['typescript']) {
        recommendations.push({
          skillId: 'refactor-pro',
          reason: 'TypeScript workspace'
        });
      }
    } catch {}

    // Check for Python environment
    try {
      const pyUri1 = vscode.Uri.joinPath(root, 'requirements.txt');
      const pyUri2 = vscode.Uri.joinPath(root, 'pyproject.toml');
      let isPython = false;
      try { await vscode.workspace.fs.stat(pyUri1); isPython = true; } catch {}
      try { await vscode.workspace.fs.stat(pyUri2); isPython = true; } catch {}
      if (isPython) {
        recommendations.push({
          skillId: 'data-scientist',
          reason: 'Python environment'
        });
      }
    } catch {}

    // Check for Docker
    try {
      const dockerUri = vscode.Uri.joinPath(root, 'Dockerfile');
      await vscode.workspace.fs.stat(dockerUri);
      recommendations.push({
        skillId: 'cloud-architect',
        reason: 'Docker containerization'
      });
    } catch {}

    // Check for Prisma/Database
    try {
      const prismaUri = vscode.Uri.joinPath(root, 'prisma');
      await vscode.workspace.fs.stat(prismaUri);
      recommendations.push({
        skillId: 'sql-expert',
        reason: 'Database schema (Prisma)'
      });
    } catch {}

    // Filter recommendations that are already active
    const activeIds = new Set(this.installedSkills.filter(s => s.isActive).map(s => s.id));
    const pendingRecommendations = recommendations.filter(r => !activeIds.has(r.skillId));

    if (pendingRecommendations.length > 0) {
      const rec = pendingRecommendations[0];
      const skill = this.availableSkills.find(s => s.id === rec.skillId) || this.installedSkills.find(s => s.id === rec.skillId);
      if (skill) {
        const accept = 'Enable Skill';
        const viewAll = 'Browse Skills';
        vscode.window.showInformationMessage(
          `[Agent Assistant] Tech-Stack Detected: ${rec.reason}. We recommend enabling the '${skill.title}' skill for this workspace.`,
          accept,
          viewAll
        ).then(async selection => {
          if (selection === accept) {
            const currentPath = this.getCurrentWorkspacePath();
            if (currentPath) {
              const projectSkill: Skill = {
                ...skill,
                id: `project-${skill.id}-${Date.now()}`,
                isProject: true,
                isCustom: false,
                isActive: true
              };
              await this.addSkillToSpecificProject(currentPath, projectSkill);
            }
          } else if (selection === viewAll) {
            vscode.commands.executeCommand('agent-assistant.openMarketplace');
          }
        });
      }
    }
  }

  private async parseSkillFromMd(folderUri: vscode.Uri, skillId: string): Promise<Skill | undefined> {
    const fileUri = vscode.Uri.joinPath(folderUri, 'SKILL.md');
    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(raw).toString('utf8');

      // Match YAML-like frontmatter
      const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      let id = skillId;
      let title = skillId;
      let category = 'Premium UI & Design';
      let description = `Project skill: ${skillId}`;
      let active = true;

      if (fmMatch) {
        const fmText = fmMatch[1];
        const idMatch = fmText.match(/id:\s*(.+)/);
        if (idMatch) id = idMatch[1].trim();

        const titleMatch = fmText.match(/title:\s*(.+)/);
        if (titleMatch) {
          try {
            title = JSON.parse(titleMatch[1].trim());
          } catch {
            title = titleMatch[1].trim();
          }
        }

        const catMatch = fmText.match(/category:\s*(.+)/);
        if (catMatch) {
          try {
            category = JSON.parse(catMatch[1].trim());
          } catch {
            category = catMatch[1].trim();
          }
        }

        const descMatch = fmText.match(/description:\s*(.+)/);
        if (descMatch) {
          try {
            description = JSON.parse(descMatch[1].trim());
          } catch {
            description = descMatch[1].trim();
          }
        }

        const activeMatch = fmText.match(/active:\s*(.+)/);
        if (activeMatch) {
          active = activeMatch[1].trim() === 'true';
        }
      } else {
        const titleMatch = text.match(/# Skill:\s*(.*)/);
        if (titleMatch) title = titleMatch[1].trim();
      }

      const instructionsMatch = text.match(/## Instructions\s*([\s\S]*?)(## Triggers|$)/i);
      const fullInstructions = instructionsMatch ? instructionsMatch[1].trim() : text;

      // Extract triggers/tags
      const tags: string[] = [];
      const triggersMatch = text.match(/## Triggers\s*([\s\S]*)/i);
      if (triggersMatch) {
        const lines = triggersMatch[1].split('\n');
        for (const line of lines) {
          const match = line.match(/^-\s*(.*)/);
          if (match) {
            tags.push(match[1].trim());
          }
        }
      }

      // Find if we have a match in availableSkills to get the correct color and icon
      const matched = this.availableSkills.find(s => s.id === id);
      const color = matched ? matched.color : '#007ACC';

      return {
        id,
        title,
        category,
        description,
        tags: tags.length > 0 ? tags : [category],
        icon: matched ? matched.icon : 'layers',
        color,
        isActive: active,
        fullInstructions,
        isProject: true,
        isCustom: false
      };
    } catch (e) {
      return undefined;
    }
  }

  public async addProjectWorkspacePath(workspacePath: string): Promise<void> {
    const projectSkillsMap = this.context.globalState.get<Record<string, Skill[]>>('antigravity.projectSkillsMap') || {};
    if (!projectSkillsMap[workspacePath]) {
      projectSkillsMap[workspacePath] = [];
      const root = vscode.Uri.file(workspacePath);
      
      // Try to read existing project skills
      const projectSkillsUri = vscode.Uri.joinPath(root, '.antigravity', 'project_skills.json');
      try {
        const raw = await vscode.workspace.fs.readFile(projectSkillsUri);
        const text = Buffer.from(raw).toString('utf8');
        const parsed = JSON.parse(text) as Skill[];
        if (Array.isArray(parsed)) {
          projectSkillsMap[workspacePath] = parsed;
        }
      } catch (e) {
        const skillsFolder = vscode.Uri.joinPath(root, '.antigravity', 'skills');
        try {
          const files = await vscode.workspace.fs.readDirectory(skillsFolder);
          for (const [name, type] of files) {
            if (type === vscode.FileType.Directory) {
              const folderUri = vscode.Uri.joinPath(skillsFolder, name);
              const parsedSkill = await this.parseSkillFromMd(folderUri, name);
              if (parsedSkill) {
                projectSkillsMap[workspacePath].push(parsedSkill);
              }
            }
          }
        } catch (err) {}
      }

      await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);
      
      // Immediately write instructions for this workspace
      await this.injectSkillsToSpecificWorkspace(workspacePath);
      
      this._onDidChangeSkills.fire();
      vscode.window.showInformationMessage(`Added project workspace: ${path.basename(workspacePath)}`);
    } else {
      vscode.window.showWarningMessage(`Project workspace already added: ${path.basename(workspacePath)}`);
    }
  }

  public async toggleProjectSkillInWorkspace(id: string, workspacePath: string): Promise<boolean> {
    const projectSkillsMap = this.context.globalState.get<Record<string, Skill[]>>('antigravity.projectSkillsMap') || {};
    const skills = projectSkillsMap[workspacePath] || [];
    const skill = skills.find(s => s.id === id);
    if (skill) {
      skill.isActive = !skill.isActive;
      projectSkillsMap[workspacePath] = skills;
      await this.context.globalState.update('antigravity.projectSkillsMap', projectSkillsMap);

      const currentPath = this.getCurrentWorkspaceKey();
      if (currentPath === workspacePath) {
        const inst = this.installedSkills.find(s => s.id === id);
        if (inst) inst.isActive = skill.isActive;
        await this.injectSkillsToWorkspace();
      } else {
        await this.injectSkillsToSpecificWorkspace(workspacePath);
      }
      this._onDidChangeSkills.fire();
      return true;
    }
    return false;
  }

  public async injectSkillsToSpecificWorkspace(workspacePath: string): Promise<void> {
    if (this.isInjecting) return;
    this.isInjecting = true;

    try {
      const projectSkillsMap = this.context.globalState.get<Record<string, Skill[]>>('antigravity.projectSkillsMap') || {};
      const skills = projectSkillsMap[workspacePath] || [];
      const activeSkills = skills.filter(s => s.isActive);

      const root = vscode.Uri.file(workspacePath);
      const skillsFolder = vscode.Uri.joinPath(root, '.antigravity', 'skills');
      const universalFile = vscode.Uri.joinPath(root, '.antigravity', 'UNIVERSAL_AGENT_GUIDE.md');
      const anthropicFile = vscode.Uri.joinPath(root, '.antigravity', 'active_skills.xml');

      try {
        await vscode.workspace.fs.delete(skillsFolder, { recursive: true, useTrash: false });
      } catch (e) {}

      await vscode.workspace.fs.createDirectory(skillsFolder);

      // Write ALL project skills to the skills folder so their states are preserved
      for (const skill of skills) {
        const skillDir = vscode.Uri.joinPath(skillsFolder, skill.id);
        const skillMdFile = vscode.Uri.joinPath(skillDir, 'SKILL.md');
        await vscode.workspace.fs.createDirectory(skillDir);

        const fm = [
          `---`,
          `id: ${skill.id}`,
          `title: ${JSON.stringify(skill.title)}`,
          `category: ${JSON.stringify(skill.category)}`,
          `description: ${JSON.stringify(skill.description)}`,
          `active: ${skill.isActive}`,
          `---`,
          ``
        ].join('\n');

        const skillMdContent = fm + `# Skill: ${skill.title}\n\n` +
          `## Instructions\n${skill.fullInstructions}\n\n` +
          `## Triggers\n${skill.tags.map(t => `- ${t}`).join('\n')}\n`;

        await vscode.workspace.fs.writeFile(skillMdFile, Buffer.from(skillMdContent, 'utf8'));
      }

      if (activeSkills.length > 0) {
        const skillNames = activeSkills.map(s => s.title.toUpperCase()).join(', ');
        const persistentHeader = [
          `# AGENT ASSISTANT — ACTIVE EXPERT SKILLS`,
          ``,
          `> CRITICAL SYSTEM INSTRUCTION: You MUST follow ALL guidelines below for EVERY message in this conversation.`,
          `> Do NOT forget these instructions after the first response. They apply to the ENTIRE session.`,
          `> Active Skills: ${skillNames}`,
          ``,
        ].join('\n');

        let mdContent = persistentHeader + `## Expert Skill Guidelines\n\n`;
        let xmlContent = '<available_skills>\n';
        let compactInstructions = '';

        for (const skill of activeSkills) {
          const skillMdFile = vscode.Uri.joinPath(skillsFolder, skill.id, 'SKILL.md');

          mdContent += `### ${skill.title.toUpperCase()} (${skill.category})\n`;
          mdContent += `**Role**: ${skill.description}\n`;
          mdContent += `**Guidelines**:\n${skill.fullInstructions}\n`;
          mdContent += `---\n\n`;

          compactInstructions += `[${skill.title.toUpperCase()}]: ${skill.fullInstructions.trim()} `;

          xmlContent += '  <skill>\n';
          xmlContent += `    <name>${skill.id}</name>\n`;
          xmlContent += `    <description>${skill.description}</description>\n`;
          xmlContent += `    <location>${skillMdFile.fsPath}</location>\n`;
          xmlContent += '  </skill>\n';
        }

        xmlContent += '</available_skills>';

        await vscode.workspace.fs.writeFile(universalFile, Buffer.from(mdContent, 'utf8'));
        await vscode.workspace.fs.writeFile(anthropicFile, Buffer.from(xmlContent, 'utf8'));

        await this.updateGitignore(root);

        // Layers
        const cursorRulesFile = vscode.Uri.joinPath(root, '.cursorrules');
        await vscode.workspace.fs.writeFile(cursorRulesFile, Buffer.from(mdContent, 'utf8'));

        const claudeMdFile = vscode.Uri.joinPath(root, 'CLAUDE.md');
        await vscode.workspace.fs.writeFile(claudeMdFile, Buffer.from(mdContent, 'utf8'));

        const geminiMdFile = vscode.Uri.joinPath(root, 'GEMINI.md');
        await vscode.workspace.fs.writeFile(geminiMdFile, Buffer.from(mdContent, 'utf8'));

        const githubDir = vscode.Uri.joinPath(root, '.github');
        try { await vscode.workspace.fs.createDirectory(githubDir); } catch (e) {}
        const copilotInstructionsFile = vscode.Uri.joinPath(githubDir, 'copilot-instructions.md');
        await vscode.workspace.fs.writeFile(copilotInstructionsFile, Buffer.from(mdContent, 'utf8'));

        await this.injectChatInstructions(root, activeSkills, compactInstructions);
      } else {
        // If no active skills, delete the files or clear them
        try { await vscode.workspace.fs.delete(universalFile); } catch (e) {}
        try { await vscode.workspace.fs.delete(anthropicFile); } catch (e) {}
        try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, '.cursorrules')); } catch (e) {}
        try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, 'CLAUDE.md')); } catch (e) {}
        try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, 'GEMINI.md')); } catch (e) {}
      }
    } catch (err) {
      console.error('Failed to inject specific universal skills', err);
    } finally {
      setTimeout(() => {
        this.isInjecting = false;
      }, 500);
    }
  }
}
