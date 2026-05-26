import * as vscode from 'vscode';
import * as path from 'path';
import { SkillService, Skill } from '../../features/skills/skill.service';

export type ProjectTreeItem = ProjectFolderTreeItem | ProjectSkillTreeItem | ProjectEmptyItem;

export class ProjectSkillsTreeProvider
  implements
    vscode.TreeDataProvider<ProjectTreeItem>,
    vscode.TreeDragAndDropController<ProjectTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<ProjectTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  dragMimeTypes = ['application/vnd.code.tree.projectskills'];
  dropMimeTypes = ['application/vnd.code.tree.projectskills'];

  constructor(private skillService: SkillService) {
    skillService.onDidChangeSkills(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ProjectTreeItem): Thenable<ProjectTreeItem[]> {
    if (element instanceof ProjectFolderTreeItem) {
      const projectSkillsMap = this.skillService.getProjectSkillsMap();
      const skills = projectSkillsMap[element.workspacePath] || [];
      if (skills.length === 0) {
        return Promise.resolve([new ProjectEmptyItem(element.workspacePath)]);
      }
      return Promise.resolve(
        skills.map(skill => new ProjectSkillTreeItem(skill, element.workspacePath))
      );
    }

    if (element) return Promise.resolve([]);

    // Root level
    const projectSkillsMap = this.skillService.getProjectSkillsMap();
    const currentPath = this.skillService.getCurrentWorkspacePath();
    const folders: ProjectFolderTreeItem[] = [];

    if (currentPath) {
      const name = path.basename(currentPath);
      const skills = projectSkillsMap[currentPath] || [];
      const activeCount = skills.filter(s => s.isActive).length;
      folders.push(new ProjectFolderTreeItem(currentPath, name, true, skills.length, activeCount));
    }

    for (const workspacePath of Object.keys(projectSkillsMap)) {
      if (workspacePath === currentPath) continue;
      const name = path.basename(workspacePath);
      const skills = projectSkillsMap[workspacePath] || [];
      const activeCount = skills.filter(s => s.isActive).length;
      folders.push(new ProjectFolderTreeItem(workspacePath, name, false, skills.length, activeCount));
    }

    return Promise.resolve(folders);
  }

  // Drag & drop: copy skills between projects
  public handleDrag(
    source: readonly ProjectTreeItem[],
    dataTransfer: vscode.DataTransfer
  ): void {
    const dragItems = source.filter((i): i is ProjectSkillTreeItem => i instanceof ProjectSkillTreeItem);
    if (dragItems.length === 0) return;

    const payload = dragItems.map(i => ({ skill: i.skill, sourcePath: i.workspacePath }));
    dataTransfer.set(
      'application/vnd.code.tree.projectskills',
      new vscode.DataTransferItem(JSON.stringify(payload))
    );
  }

  public async handleDrop(
    target: ProjectTreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.projectskills');
    if (!transferItem) return;

    let payload: { skill: Skill; sourcePath: string }[];
    try {
      payload = JSON.parse(transferItem.value);
    } catch {
      return;
    }
    if (!Array.isArray(payload)) return;

    let targetPath: string | undefined;
    if (target instanceof ProjectFolderTreeItem) targetPath = target.workspacePath;
    else if (target instanceof ProjectSkillTreeItem) targetPath = target.workspacePath;
    else if (target instanceof ProjectEmptyItem) targetPath = target.workspacePath;
    
    targetPath = targetPath ?? this.skillService.getCurrentWorkspacePath();
    if (!targetPath) return;

    let count = 0;
    for (const item of payload) {
      if (item.sourcePath === targetPath) continue;
      const copiedSkill: Skill = {
        ...item.skill,
        id: `project-${item.skill.id.replace(/^project-/, '').split('-')[0]}-${Date.now()}`,
        isProject: true,
        isCustom: false,
        isActive: true,
      };
      await this.skillService.addSkillToSpecificProject(targetPath, copiedSkill);
      count++;
    }

    if (count > 0) {
      vscode.window.showInformationMessage(`Copied ${count} skill(s) to project.`);
      this.refresh();
    }
  }
}

// ─── Tree Items ─────────────────────────────────────────────────────────────

export class ProjectFolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly workspacePath: string,
    public readonly workspaceName: string,
    public readonly isCurrent: boolean,
    public readonly totalCount: number = 0,
    public readonly activeCount: number = 0
  ) {
    super(
      workspaceName,
      isCurrent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    this.description = totalCount > 0
      ? `${activeCount}/${totalCount} active`
      : 'no skills';

    this.tooltip = new vscode.MarkdownString(
      `$(folder) **${workspaceName}**\n\n` +
      `Path: \`${workspacePath}\`\n\n` +
      `Skills: **${activeCount}** active / **${totalCount}** total`
    );

    this.iconPath = new vscode.ThemeIcon(
      isCurrent ? 'folder-active' : (totalCount > 0 ? 'folder-library' : 'folder'),
      new vscode.ThemeColor(
        isCurrent
          ? 'charts.blue'
          : totalCount > 0
            ? 'charts.purple'
            : 'disabledForeground'
      )
    );

    this.contextValue = 'projectFolder';
  }
}

export class ProjectSkillTreeItem extends vscode.TreeItem {
  constructor(
    public readonly skill: Skill,
    public readonly workspacePath: string
  ) {
    super(skill.title, vscode.TreeItemCollapsibleState.None);

    this.description = skill.isActive ? '● active' : '○ inactive';

    this.tooltip = new vscode.MarkdownString(
      `**${skill.title}**\n\n` +
      `Category: ${skill.category}\n\n` +
      `${skill.description}\n\n` +
      `_Click to toggle active state_`
    );

    this.iconPath = new vscode.ThemeIcon(
      skill.isActive ? 'pass-filled' : 'circle-large-outline',
      new vscode.ThemeColor(skill.isActive ? 'charts.green' : 'disabledForeground')
    );

    this.contextValue = 'projectSkillItem';

    this.command = {
      command: 'agent-assistant.toggleProjectSkillInWorkspace',
      title: 'Toggle Skill',
      arguments: [skill.id, workspacePath],
    };
  }
}

export class ProjectEmptyItem extends vscode.TreeItem {
  constructor(public readonly workspacePath: string) {
    super('No skills added yet', vscode.TreeItemCollapsibleState.None);
    this.description = 'Use Skill Builder to add skills';
    this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('disabledForeground'));
    this.contextValue = 'projectSkillEmpty';
  }
}
