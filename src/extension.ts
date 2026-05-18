/**
 * Agent Assistant — VS Code Extension Entry Point
 */

import * as vscode from 'vscode';
import { Logger } from './core/utils/logger';
import { ExtensionConfig } from './core/config/extension.config';

import { AuthService } from './infrastructure/auth/auth.service';
import { BalanceService } from './infrastructure/api/balance.service';
import { AccountRepositoryImpl } from './infrastructure/storage/account.repository.impl';
import { StateDbService } from './infrastructure/storage/state-db.service';
import { AccountService } from './features/accounts/account.service';
import { StatusBarProvider } from './presentation/providers/status-bar.provider';
import { AccountsTreeProvider } from './presentation/providers/accounts-tree.provider';
import { AccountsPanelProvider } from './presentation/providers/accounts-panel.provider';
// AccountsWebviewProvider removed — it conflicted with AccountsTreeProvider on the same view ID
import { SkillService } from './features/skills/skill.service';
import { SkillsTreeProvider } from './presentation/providers/skills-tree.provider';
import { CustomSkillsTreeProvider } from './presentation/providers/custom-skills-tree.provider';
import { SkillBuilderWebview } from './presentation/providers/skill-builder.webview';
import { SkillMarketplaceWebview } from './presentation/providers/skill-marketplace.webview';
import { PersonaDiagnosticProvider } from './presentation/providers/persona-diagnostic.provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Use console.log for absolute last resort debugging
  console.log('[Agent Assistant] Activation triggered.');
  
  try {
    // Show immediate feedback to user that extension is starting
    vscode.window.setStatusBarMessage('$(sync~spin) Agent Assistant: Booting...', 3000);

    Logger.getInstance().info('Agent Assistant is starting activation...');
    const skillService = new SkillService(context);

    // 1. Setup Logger & Config first
    const config = ExtensionConfig.getInstance();
    config.initialize(context);
    
    // 2. Initialize Core Domain Services
    const authService = new AuthService();
    const balanceService = new BalanceService();
    const accountRepo = new AccountRepositoryImpl(context);
    const stateDbService = new StateDbService(context);
    const accountService = new AccountService(authService, balanceService, accountRepo, stateDbService);

    // 3. Register UI Providers (IDs must match package.json)
    const accountsTreeProvider = new AccountsTreeProvider(accountService, accountRepo);
    context.subscriptions.push(
      vscode.window.createTreeView('agent-assistant.accountsView', {
        treeDataProvider: accountsTreeProvider,
        showCollapseAll: false
      })
    );

    const skillsTreeProvider = new SkillsTreeProvider(skillService);
    const skillsTreeView = vscode.window.createTreeView('agent-assistant.skillsView', {
      treeDataProvider: skillsTreeProvider,
      showCollapseAll: true,
      dragAndDropController: skillsTreeProvider
    });
    skillsTreeView.message = '☁️ Browse 1,440+ AI Skills in the Marketplace tab above!';
    context.subscriptions.push(skillsTreeView);

    const customSkillsTreeProvider = new CustomSkillsTreeProvider(skillService);
    vscode.window.registerTreeDataProvider('agent-assistant.customSkillsView', customSkillsTreeProvider);

    const statusBarProvider = new StatusBarProvider(accountRepo, accountService);
    context.subscriptions.push(statusBarProvider);

    const panelProvider = new AccountsPanelProvider(context.extensionUri, accountRepo, accountService, skillService);
    const personaDiagnosticProvider = new PersonaDiagnosticProvider(context, skillService);
    context.subscriptions.push(personaDiagnosticProvider);

    // 4. Register Commands (Crucial for UI to be responsive)
    const commands = registerCommands(context, skillService, accountService, accountRepo, accountsTreeProvider, skillsTreeProvider, customSkillsTreeProvider, panelProvider);
    context.subscriptions.push(...commands);

    // 5. Start Background Tasks (Non-blocking)
    accountService.startBackgroundMonitor();
    
    // 6. Initialize Skill State & Workspace Injection (May take time, so do last)
    skillService.loadState().catch((err: unknown) => {
      Logger.getInstance().error('Failed to initialize skills', err);
    });

    Logger.getInstance().info('Agent Assistant activated successfully.');
  } catch (error: unknown) {
    Logger.getInstance().error('CRITICAL: Failed to activate Agent Assistant', error);
    vscode.window.showErrorMessage(`Agent Assistant failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function deactivate(): void {
  const logger = Logger.getInstance();
  logger.info('Agent Assistant deactivated.');
}

function registerCommands(
  context: vscode.ExtensionContext,
  skillService: SkillService,
  accountService: AccountService,
  accountRepo: AccountRepositoryImpl,
  accountsTreeProvider: AccountsTreeProvider,
  skillsTreeProvider: SkillsTreeProvider,
  customSkillsTreeProvider: CustomSkillsTreeProvider,
  panelProvider: AccountsPanelProvider
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.openPanel', () => {
      panelProvider.show();
    })
  );
  
  disposables.push(
    vscode.commands.registerCommand('agent-assistant.switchAccount', async (arg?: unknown) => {
      let email = typeof arg === 'string' ? arg : (arg as { email?: string })?.email;
      
      if (!email) {
        const accounts = await accountRepo.getAccountSummaries();
        if (accounts.length === 0) {
          vscode.window.showInformationMessage('No accounts found. Add one first.');
          return;
        }
        const activeEmail = await accountService.getActiveAntigravityEmail();
        const items = accounts.map((acc: { email: string; displayName?: string }) => ({
          label: acc.email,
          description: acc.displayName || '',
          detail: acc.email === activeEmail ? '$(check) Active' : '',
          email: acc.email
        }));
        const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select account to switch to' });
        if (selected) {
          email = selected.email;
        }
      }
      
      if (email) {
        await accountService.switchAccountWorkflow(email);
        setTimeout(() => accountsTreeProvider.refresh(), 1000);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.searchAccounts', async () => {
      const query = await vscode.window.showInputBox({
        placeHolder: 'Search accounts...',
        prompt: 'Filter Agent Assistant'
      });
      if (query !== undefined) {
        accountsTreeProvider.setFilter(query);
        vscode.commands.executeCommand('setContext', 'agent-assistant.isSearching', query !== '');
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.clearSearch', () => {
      accountsTreeProvider.setFilter('');
      vscode.commands.executeCommand('setContext', 'agent-assistant.isSearching', false);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.treeDelete', async (arg: unknown) => {
      const email = typeof arg === 'string' ? arg : (arg as { email?: string })?.email;
      if (email) {
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to remove ${email}?`, 'Yes', 'No');
        if (confirm === 'Yes') {
          await accountService.removeAccountWorkflow(email);
        }
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.searchSkills', async () => {
      const query = await vscode.window.showInputBox({
        placeHolder: 'Search skills...',
        prompt: 'Filter Expert Skills'
      });
      if (query !== undefined) {
        skillsTreeProvider.setFilter(query);
        vscode.commands.executeCommand('setContext', 'agent-assistant.isSearchingSkills', query !== '');
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.clearSkillsSearch', () => {
      skillsTreeProvider.setFilter('');
      vscode.commands.executeCommand('setContext', 'agent-assistant.isSearchingSkills', false);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.toggleSkillSidebar', (id: string) => {
      skillService.toggleSkill(id);
      skillsTreeProvider.refresh();
      customSkillsTreeProvider.refresh();
      panelProvider.refresh();
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.createCustomSkill', () => {
      SkillBuilderWebview.createOrShow(context.extensionUri, skillService);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.toggleCategorySkills', (item: any) => {
      if (item && item.categoryName) {
        skillService.toggleCategory(item.categoryName);
        skillsTreeProvider.refresh();
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.openMarketplace', () => {
      SkillMarketplaceWebview.createOrShow(context.extensionUri, skillService);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.deleteSkill', async (item: any) => {
      if (item && item.skill && item.skill.id) {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to uninstall skill '${item.skill.title}'? It will be returned to the Marketplace.`,
          'Yes',
          'No'
        );
        if (confirm === 'Yes') {
          skillService.uninstallSkill(item.skill.id);
          skillsTreeProvider.refresh();
          if (SkillMarketplaceWebview.currentPanel) {
            SkillMarketplaceWebview.currentPanel.sendSkills();
          }
        }
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.moveSkillFolder', async (item: any) => {
      if (item && item.skill && item.skill.id) {
        const installed = skillService.getInstalledSkills();
        const categories = Array.from(new Set(installed.map(s => s.category).filter(Boolean)));
        
        const quickPickItems = [
          ...categories.map(cat => ({ label: cat, description: 'Existing Folder' })),
          { label: '$(add) Create New Folder...', description: 'Create a new folder for this skill' }
        ];

        const selection = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: `Move '${item.skill.title}' to folder...`
        });

        if (selection) {
          if (selection.label === '$(add) Create New Folder...') {
            const newFolder = await vscode.window.showInputBox({
              prompt: 'Enter the name of the new folder:',
              placeHolder: 'e.g. My Custom Folder'
            });
            if (newFolder && newFolder.trim()) {
              skillService.moveSkillToCategory(item.skill.id, newFolder.trim());
              skillsTreeProvider.refresh();
            }
          } else {
            skillService.moveSkillToCategory(item.skill.id, selection.label);
            skillsTreeProvider.refresh();
          }
        }
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.deleteFolder', async (item: any) => {
      if (item && item.categoryName) {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete folder '${item.categoryName}'? All skills inside it will be uninstalled and returned to the Marketplace.`,
          'Yes, Delete All',
          'Cancel'
        );
        if (confirm === 'Yes, Delete All') {
          skillService.deleteFolder(item.categoryName);
          skillsTreeProvider.refresh();
          if (SkillMarketplaceWebview.currentPanel) {
            SkillMarketplaceWebview.currentPanel.sendSkills();
          }
        }
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.renameFolder', async (item: any) => {
      if (item && item.categoryName) {
        const newName = await vscode.window.showInputBox({
          prompt: `Rename folder '${item.categoryName}'`,
          value: item.categoryName
        });
        if (newName && newName.trim() && newName.trim() !== item.categoryName) {
          skillService.renameFolder(item.categoryName, newName.trim());
          skillsTreeProvider.refresh();
        }
      }
    })
  );
  disposables.push(
    vscode.commands.registerCommand('agent-assistant.createFolder', async () => {
      const newFolder = await vscode.window.showInputBox({
        prompt: 'Enter the name of the new folder:',
        placeHolder: 'e.g. Frontend Agents'
      });
      if (newFolder && newFolder.trim()) {
        skillService.addCustomCategory(newFolder.trim());
        skillsTreeProvider.refresh();
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.refreshSkillsTree', () => {
      skillsTreeProvider.refresh();
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.toggleAllSkills', () => {
      vscode.window.showWarningMessage('Activating ALL skills can consume a massive amount of context tokens and confuse the AI. Are you sure?', 'Yes, Activate All', 'Cancel').then(selection => {
        if (selection === 'Yes, Activate All') {
          skillService.toggleAll();
          skillsTreeProvider.refresh();
        }
      });
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.deleteCustomSkill', async (item: any) => {
      if (item && item.skill && item.skill.id) {
        const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete custom skill '${item.skill.title}'?`, 'Yes', 'No');
        if (confirm === 'Yes') {
          skillService.deleteCustomSkill(item.skill.id);
          customSkillsTreeProvider.refresh();
        }
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.addAccount', async () => {
      await accountService.addAccountWorkflow();
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.refreshAccounts', async () => {
      await accountService.refreshBalancesWorkflow(true);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('agent-assistant.refreshBalances', async () => {
      await accountService.refreshBalancesWorkflow(true);
    })
  );

  return disposables;
}
