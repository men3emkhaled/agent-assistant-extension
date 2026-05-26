/**
 * Accounts Tree Provider — TreeView-based sidebar for Antigravity IDE compatibility.
 * Replaces the WebviewViewProvider to avoid service worker issues in VS Code forks.
 */

import * as vscode from 'vscode';
import { IAccountRepository } from '../../core/domain/repositories/account.repository';
import { AccountService } from '../../features/accounts/account.service';
import { Logger } from '../../core/utils/logger';

export class AccountsTreeProvider implements vscode.TreeDataProvider<AccountTreeItem> {
  private _filter: string = '';
  private _onDidChangeTreeData: vscode.EventEmitter<AccountTreeItem | undefined | void> = new vscode.EventEmitter<AccountTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<AccountTreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(
    private readonly accountService: AccountService,
    private readonly accountRepo: IAccountRepository
  ) {
    this.accountService.onAccountsChanged(() => {
      this.refresh();
    });
  }

  public setFilter(query: string) {
    this._filter = query.toLowerCase().trim();
    vscode.commands.executeCommand('setContext', 'agent-assistant.isSearching', this._filter !== '');
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AccountTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AccountTreeItem): Promise<AccountTreeItem[]> {
    if (element) {
      // Children of an account = balance details
      return element.balanceItems || [];
    }

    try {
      let accounts = await this.accountRepo.getAccountSummaries();
      const activeEmail = await this.accountService.getActiveAntigravityEmail();

      // Apply Filter
      if (this._filter) {
        accounts = accounts.filter(a => 
          a.email.toLowerCase().includes(this._filter) || 
          (a.displayName && a.displayName.toLowerCase().includes(this._filter))
        );
      }

      if (accounts.length === 0) {
        const emptyItem = new AccountTreeItem(
          'No accounts — Click + to add',
          '',
          vscode.TreeItemCollapsibleState.None
        );
        emptyItem.command = {
          command: 'agent-assistant.addAccount',
          title: 'Add Account'
        };
        emptyItem.iconPath = new vscode.ThemeIcon('add');
        return [emptyItem];
      }

      // Sort: active first, then by balance
      const sorted = [...accounts].sort((a, b) => {
        if (a.email === activeEmail) {return -1;}
        if (b.email === activeEmail) {return 1;}
        return 0;
      });

      return sorted.map(acc => {
        const isActive = acc.email === activeEmail;
        const balances = acc.balances || {};
        const balanceKeys = Object.keys(balances);

        // Filter and map only the requested models with fuzzy matching
        const findModelStat = (patterns: string[], excludePatterns: string[] = []) => {
          let minModelVal = 101;
          let foundModel = false;
          let minCreditVal = 101;
          let foundCredit = false;

          for (const key of Object.keys(balances)) {
            const lk = key.toLowerCase();
            if (!lk) {continue;}
            if (excludePatterns.length > 0 && excludePatterns.some(ep => lk.includes(ep))) {continue;}
            if (lk.startsWith('chat') || lk.startsWith('tap') || lk.startsWith('tab') || lk.startsWith('gpt')) {continue;}

            if (patterns.some(p => lk.includes(p))) {
              const val = balances[key];
              if (typeof val === 'object' && val !== null && 'value' in val) {
                const current = val.value || 0;
                if (current < minModelVal) {
                  minModelVal = current;
                  foundModel = true;
                }
              } else {
                const current = typeof val === 'number' ? val : Number(val);
                if (!isNaN(current) && current < minCreditVal) {
                  minCreditVal = current;
                  foundCredit = true;
                }
              }
            }
          }
          if (foundModel) {return minModelVal;}
          if (foundCredit) {return minCreditVal;}
          return 0;
        };

        const balanceItems: AccountTreeItem[] = [];
        const heroStats = {
          'Claude': findModelStat(['claude', 'sonnet', 'opus', 'haiku']),
          'Gemini': findModelStat(['gemini', 'flash'], ['claude'])
        };

        Object.entries(heroStats).forEach(([name, value]) => {
          const child = new AccountTreeItem(
            name,
            `${value}%`,
            vscode.TreeItemCollapsibleState.None
          );
          
          let icon = 'circle-outline';
          if (value === 0) {icon = 'error';}
          else if (value <= 20) {icon = 'warning';}
          else if (value > 50) {icon = 'circle-filled';}
          
          child.iconPath = new vscode.ThemeIcon(icon);
          balanceItems.push(child);
        });

        // Summary description
        let desc = '';
        if (balanceItems.length > 0) {
          const vals = balanceItems.map(item => parseInt(item.desc.replace('%', '')));
          const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
          desc = this.accountService.isRefreshing() ? 'Refreshing...' : `${avg}% avg`;
        } else {
          desc = 'No data';
        }

        const item = new AccountTreeItem(
          `${isActive ? '● ' : '○ '}${acc.email}`,
          desc,
          balanceKeys.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        item.balanceItems = balanceItems;
        item.email = acc.email;
        item.tooltip = `${acc.displayName || 'User'}\n${acc.email}\n${isActive ? '✓ Active Account' : 'Click to switch'}`;
        item.iconPath = new vscode.ThemeIcon(isActive ? 'account' : 'person');

        if (isActive) {
          item.contextValue = 'activeAccount';
        } else {
          item.contextValue = 'inactiveAccount';
          // Removed item.command to prevent auto-switch on click
        }

        return item;
      });
    } catch (err) {
      Logger.getInstance().error('Failed to load accounts tree', err);
      return [];
    }
  }
}

export class AccountTreeItem extends vscode.TreeItem {
  public balanceItems?: AccountTreeItem[];
  public email?: string;

  constructor(
    public readonly label: string,
    public readonly desc: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.description = desc;
  }
}
