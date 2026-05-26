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
    const customSkills = this.skillService.getInstalledSkills().filter(skill => skill.isCustom && !skill.isProject);
    
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
    this.description = skill.isActive ? 'ACTIVE' : '';
    
    this.iconPath = new vscode.ThemeIcon(
      skill.isActive ? 'pass-filled' : 'person',
      new vscode.ThemeColor(skill.isActive ? 'charts.green' : 'disabledForeground')
    );

    this.contextValue = 'customSkillItem';
    
    this.command = {
      command: 'agent-assistant.toggleSkillSidebar',
      title: 'Toggle Skill',
      arguments: [skill.id]
    };
  }
}
