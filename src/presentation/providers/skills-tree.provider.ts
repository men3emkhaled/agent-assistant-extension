import * as vscode from 'vscode';
import { SkillService, Skill } from '../../features/skills/skill.service';

export class SkillsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.TreeDragAndDropController<vscode.TreeItem> {
  private filterQuery: string = '';
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

  dropMimeTypes = ['application/vnd.code.tree.agent-assistant.skills'];
  dragMimeTypes = ['application/vnd.code.tree.agent-assistant.skills', 'application/vnd.code.tree.projectskills'];

  constructor(private skillService: SkillService) {
    skillService.onDidChangeSkills(() => this.refresh());
  }

  public async handleDrag(source: readonly vscode.TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    dataTransfer.set('application/vnd.code.tree.agent-assistant.skills', new vscode.DataTransferItem(source));

    const dragItems = source.filter((item): item is SkillTreeItem => item instanceof SkillTreeItem);
    if (dragItems.length > 0) {
      const payload = dragItems.map(item => ({
        skill: item.skill,
        sourcePath: ''
      }));
      dataTransfer.set('application/vnd.code.tree.projectskills', new vscode.DataTransferItem(JSON.stringify(payload)));
    }
  }

  public async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.agent-assistant.skills');
    if (!transferItem) {
      return;
    }

    const draggedItems = transferItem.value as vscode.TreeItem[];
    if (draggedItems.length === 0) return;

    let targetCategory = 'Standalone';
    if (target instanceof CategoryTreeItem) {
      targetCategory = target.categoryName;
    } else if (target instanceof SkillTreeItem) {
      targetCategory = target.skill.category;
    }

    for (const item of draggedItems) {
      if (item instanceof SkillTreeItem) {
        this.skillService.moveSkillToCategory(item.skill.id, targetCategory);
      }
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setFilter(query: string): void {
    this.filterQuery = query.toLowerCase();
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    let skills = this.skillService.getInstalledSkills();
    
    // Ensure we only show actual global expert skills
    skills = skills.filter(s => !s.isProject && !s.id.startsWith('project-'));

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
      skills = skills.filter(skill => !projectBaseIds.has(skill.id));
    }
    
    if (this.filterQuery) {
      skills = skills.filter(skill => 
        skill.title.toLowerCase().includes(this.filterQuery) || 
        skill.category.toLowerCase().includes(this.filterQuery) ||
        skill.description.toLowerCase().includes(this.filterQuery) ||
        skill.tags.some(tag => tag.toLowerCase().includes(this.filterQuery))
      );
      return Promise.resolve(skills.map(skill => new SkillTreeItem(skill)));
    }

    if (element) {
      if (element instanceof CategoryTreeItem) {
        const categorySkills = skills.filter(s => s.category === element.categoryName);
        return Promise.resolve(categorySkills.map(skill => new SkillTreeItem(skill)));
      }
      return Promise.resolve([]);
    }

    // Root level
    const groups = new Map<string, Skill[]>();
    const standalone: Skill[] = [];

    skills.forEach(skill => {
      if (!skill.category || skill.category.toLowerCase() === 'standalone') {
        standalone.push(skill);
      } else {
        if (!groups.has(skill.category)) {
          groups.set(skill.category, []);
        }
        groups.get(skill.category)!.push(skill);
      }
    });

    const items: vscode.TreeItem[] = [];
    
    // Add custom empty categories
    const customCats = this.skillService.getCustomCategories();
    customCats.forEach(cat => {
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
    });

    for (const [category, groupSkills] of groups.entries()) {
      items.push(new CategoryTreeItem(category, groupSkills.length));
    }

    standalone.forEach(skill => {
      items.push(new SkillTreeItem(skill));
    });

    items.sort((a, b) => {
      // arabic-localization always at the very top
      if (a instanceof SkillTreeItem && a.skill.id === 'arabic-localization') return -1;
      if (b instanceof SkillTreeItem && b.skill.id === 'arabic-localization') return 1;
      
      if (a instanceof CategoryTreeItem && b instanceof SkillTreeItem) return -1;
      if (a instanceof SkillTreeItem && b instanceof CategoryTreeItem) return 1;
      return a.label!.toString().localeCompare(b.label!.toString());
    });

    return Promise.resolve(items);
  }
}

class SkillTreeItem extends vscode.TreeItem {
  constructor(public readonly skill: Skill) {
    super(skill.title, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${skill.category}: ${skill.description}`;
    this.description = '';
    
    this.iconPath = new vscode.ThemeIcon(
      'zap',
      new vscode.ThemeColor('charts.blue')
    );

    this.contextValue = 'skillItem';
    
    this.command = {
      command: 'agent-assistant.toggleSkillSidebar',
      title: 'Add Skill to Project',
      arguments: [skill.id]
    };
  }
}

export class CategoryTreeItem extends vscode.TreeItem {
  constructor(public readonly categoryName: string, count: number) {
    super(categoryName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'categoryItem';
    this.description = `${count} skills`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}
