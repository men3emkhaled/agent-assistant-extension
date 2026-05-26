import * as vscode from 'vscode';
import { SkillService, Skill } from '../../features/skills/skill.service';

export class CustomSkillsTreeProvider
  implements
    vscode.TreeDataProvider<CustomSkillTreeItem>,
    vscode.TreeDragAndDropController<CustomSkillTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<CustomSkillTreeItem | undefined | void> = new vscode.EventEmitter<CustomSkillTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<CustomSkillTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  dragMimeTypes = ['application/vnd.code.tree.projectskills'];
  dropMimeTypes = [];

  constructor(private skillService: SkillService) {
    skillService.onDidChangeSkills(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CustomSkillTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CustomSkillTreeItem): Thenable<CustomSkillTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    // Global custom skills only (isCustom: true, not project-scoped)
    let customSkills = this.skillService.getInstalledSkills().filter(skill => skill.isCustom && !skill.isProject && !skill.id.startsWith('project-'));
    
    // STRICT FILTER: Exclude skills already added to the current workspace project
    const currentPath = this.skillService.getCurrentWorkspacePath();
    if (currentPath) {
      const projectSkillsMap = this.skillService.getProjectSkillsMap();
      const projectSkills = projectSkillsMap[currentPath] || [];
      const projectBaseIds = new Set(projectSkills.map(s => {
        let base = s.id.replace(/^project-/, '');
        const parts = base.split('-');
        if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
          parts.pop();
        }
        return parts.join('-');
      }));
      customSkills = customSkills.filter(skill => !projectBaseIds.has(skill.id));
    }
    
    return Promise.resolve(customSkills.map(skill => new CustomSkillTreeItem(skill)));
  }

  public handleDrag(
    source: readonly CustomSkillTreeItem[],
    dataTransfer: vscode.DataTransfer
  ): void {
    const payload = source.map(item => ({
      skill: item.skill,
      sourcePath: ''
    }));
    dataTransfer.set('application/vnd.code.tree.projectskills', new vscode.DataTransferItem(JSON.stringify(payload)));
  }
}

export class CustomSkillTreeItem extends vscode.TreeItem {
  constructor(public readonly skill: Skill) {
    super(skill.title, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${skill.category}: ${skill.description}`;
    this.description = '';
    
    this.iconPath = new vscode.ThemeIcon(
      'person',
      new vscode.ThemeColor('charts.blue')
    );

    this.contextValue = 'customSkillItem';
    
    this.command = {
      command: 'agent-assistant.toggleSkillSidebar',
      title: 'Add Skill to Project',
      arguments: [skill.id]
    };
  }
}
