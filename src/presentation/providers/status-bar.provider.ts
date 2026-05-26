/**
 * Status Bar Provider
 * 
 * Manages the VS Code status bar item for the extension.
 * Displays the currently active account and its credit balance.
 * Provides a quick click action to switch accounts.
 */

import * as vscode from 'vscode';
import { IAccountRepository } from '../../core/domain/repositories/account.repository';
import { I18nService } from '../../i18n/i18n.service';
import { AccountStatus } from '../../core/domain/models/account.model';
import { AccountService } from '../../features/accounts/account.service';

export class StatusBarProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private accountRepo: IAccountRepository,
    private accountService: AccountService
  ) {
    // Create item aligned to the right, priority 100 (pushes it to the far right)
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'agent-assistant.switchAccount';
    
    // Update on account changes
    this.disposables.push(
      this.accountService.onAccountsChanged(() => {
        this.update();
      })
    );
    
    // Perform initial render
    this.update();
  }

  /**
   * Refreshes the status bar display based on the current active account.
   */
  async update(): Promise<void> {
    const activeEmail = await this.accountService.getActiveAntigravityEmail();
    const i18n = I18nService.getInstance();

    if (!activeEmail) {
      this.statusBarItem.text = `$(account) ${i18n.t('statusBar.noAccount')}`;
      this.statusBarItem.tooltip = i18n.t('statusBar.tooltip');
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
      return;
    }

    const activeAccount = await this.accountRepo.getAccount(activeEmail);
    if (!activeAccount) {
      this.statusBarItem.hide();
      return;
    }

    // Build the display text
    const displayName = activeAccount.alias || activeAccount.email.split('@')[0];
    
    // Find the minimum quota percentage for a model family.
    // Only considers model-quota objects (with 'value' property from fetchAvailableModels).
    // Falls back to credit numbers only if no model objects matched.
    const findModelStat = (patterns: string[], excludePatterns: string[] = []) => {
      const balances = activeAccount.balances || {};
      let minModelVal = 101;
      let foundModel = false;
      let minCreditVal = 101;
      let foundCredit = false;

      for (const key of Object.keys(balances)) {
        const lk = key.toLowerCase();
        if (!lk) {continue;}
        // Skip if matches any exclude pattern
        if (excludePatterns.length > 0 && excludePatterns.some(ep => lk.includes(ep))) {continue;}
        // Skip common non-model prefixes
        if (lk.startsWith('chat') || lk.startsWith('tap') || lk.startsWith('tab') || lk.startsWith('gpt')) {continue;}

        if (patterns.some(p => lk.includes(p))) {
          const val = balances[key];
          if (typeof val === 'object' && val !== null && 'value' in val) {
            // Model quota object (percentage 0-100)
            const current = val.value || 0;
            if (current < minModelVal) {
              minModelVal = current;
              foundModel = true;
            }
          } else {
            // Credit number — only use as fallback
            const current = typeof val === 'number' ? val : Number(val);
            if (!isNaN(current) && current < minCreditVal) {
              minCreditVal = current;
              foundCredit = true;
            }
          }
        }
      }
      // Prefer model percentage over raw credit numbers
      if (foundModel) {return minModelVal;}
      if (foundCredit) {return minCreditVal;}
      return 0;
    };

    const claudeVal = findModelStat(['claude', 'sonnet', 'opus', 'haiku']);
    const geminiVal = findModelStat(['gemini', 'flash'], ['claude']);
    
    // Layout: Gemini/Claude with NO money icon
    this.statusBarItem.text = `$(hubot) ${displayName} | ${geminiVal}/${claudeVal}`;
    
    // Build detailed tooltip
    const balancesTooltip = `Gemini: ${geminiVal}%\nClaude: ${claudeVal}%`;
      
    this.statusBarItem.tooltip = `${activeAccount.email}\n${balancesTooltip}\n\n${i18n.t('statusBar.tooltip')}`;

    // Apply color coding based on health status
    if (activeAccount.status === AccountStatus.DEPLETED || activeAccount.status === AccountStatus.ERROR || activeAccount.status === AccountStatus.TOKEN_EXPIRED) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (activeAccount.status === AccountStatus.LOW_BALANCE) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.backgroundColor = undefined; // Use default VS Code theme color
    }

    this.statusBarItem.show();
  }

  /**
   * Applies the same filtering/merging pipeline used in the main webview UI.
   * This ensures the status bar tooltip shows only the same models visible in the extension panel.
   * 
   * Pipeline phases:
   *   1. Separate credits (plain numbers) from models (objects with 'value')
   *   2. Exclude by prefix: chat*, tap*, tab*, gpt*
   *   3. Exclude gemini-2.5
   *   4. Strip -low/-high suffixes and deduplicate
   *   5. Unconditional exclusion of "lite" models
   *   6. Claude version merging (same balance → "claude-{version}-All")
   */
  private filterBalances(balances: Record<string, any> | undefined): {
    models: Array<{ key: string; value: number; resetTime?: string }>;
    credits: Array<{ key: string; value: number }>;
  } {
    if (!balances || Object.keys(balances).length === 0) {
      return { models: [], credits: [] };
    }

    const credits: Array<{ key: string; value: number }> = [];
    const allModelEntries: Array<{ key: string; lowerKey: string; value: number; resetTime?: string }> = [];

    // ── Phase 0: Collect and categorize ──
    for (const [k, rawV] of Object.entries(balances)) {
      if (!k) {continue;}
      const lowerKey = k.toLowerCase();

      if (typeof rawV === 'object' && rawV !== null && 'value' in rawV) {
        // Model entry (from fetchAvailableModels)
        allModelEntries.push({ key: k, lowerKey, value: rawV.value, resetTime: rawV.resetTime });
      } else {
        // Credit entry (plain number)
        const value = typeof rawV === 'number' ? rawV : Number(rawV);
        credits.push({ key: k, value });
      }
    }

    // ── Phase 1: Exclude by prefix (chat*, tap*, tab*, gpt*) ──
    const afterPrefixFilter = allModelEntries.filter(m =>
      !m.lowerKey.startsWith('chat')
      && !m.lowerKey.startsWith('tap')
      && !m.lowerKey.startsWith('tab')
      && !m.lowerKey.startsWith('gpt')
    );

    // ── Phase 2: Exclude gemini-2.5 ──
    const afterGeminiFilter = afterPrefixFilter.filter(m => !m.lowerKey.includes('gemini-2.5'));

    // ── Phase 3: Strip -low/-high suffixes and deduplicate ──
    const baseKeyMap = new Map<string, { key: string; value: number; resetTime?: string }>();
    for (const m of afterGeminiFilter) {
      const baseKey = m.lowerKey.replace(/-(?:low|high)$/, '');
      if (!baseKeyMap.has(baseKey)) {
        baseKeyMap.set(baseKey, { key: baseKey, value: m.value, resetTime: m.resetTime });
      }
    }

    // ── Phase 4: Unconditional exclusion of "lite" models ──
    const afterLiteFilter = new Map<string, { key: string; value: number; resetTime?: string }>();
    for (const [baseKey, model] of baseKeyMap) {
      if (baseKey.match(/[-_\s]?lite$/i)) {continue;}
      afterLiteFilter.set(baseKey, model);
    }

    // ── Phase 5: Claude version merging ──
    const claudeModels: Array<{ baseKey: string; model: { key: string; value: number; resetTime?: string } }> = [];
    const nonClaudeModels: Array<{ key: string; value: number; resetTime?: string }> = [];

    for (const [baseKey, model] of afterLiteFilter) {
      if (baseKey.includes('claude')) {
        claudeModels.push({ baseKey, model });
      } else {
        nonClaudeModels.push(model);
      }
    }

    const extractClaudeVersion = (name: string): string => {
      const match = name.match(/claude-[a-z]+-(d+(?:-\d+)*)/i);
      return match ? match[1] : 'unknown';
    };

    const balanceFingerprint = (m: { value: number; resetTime?: string }) =>
      `${m.value}|${m.resetTime || ''}`;

    const claudeByBalance = new Map<string, typeof claudeModels>();
    for (const cm of claudeModels) {
      const fp = balanceFingerprint(cm.model);
      if (!claudeByBalance.has(fp)) {claudeByBalance.set(fp, []);}
      claudeByBalance.get(fp)!.push(cm);
    }

    const mergedClaudeModels: Array<{ key: string; value: number; resetTime?: string }> = [];
    for (const [, group] of claudeByBalance) {
      if (group.length <= 1) {
        mergedClaudeModels.push(group[0].model);
        continue;
      }

      const byVersion = new Map<string, typeof group>();
      for (const cm of group) {
        const version = extractClaudeVersion(cm.baseKey);
        if (!byVersion.has(version)) {byVersion.set(version, []);}
        byVersion.get(version)!.push(cm);
      }

      for (const [version, versionGroup] of byVersion) {
        if (versionGroup.length > 1) {
          const representative = versionGroup[0].model;
          mergedClaudeModels.push({
            key: `claude-${version}-All`,
            value: representative.value,
            resetTime: representative.resetTime,
          });
        } else {
          mergedClaudeModels.push(versionGroup[0].model);
        }
      }
    }

    // ── Phase 6: Build final list and sort ──
    const models = [...nonClaudeModels, ...mergedClaudeModels];
    models.sort((a, b) => {
      const aCritical = a.value < 20;
      const bCritical = b.value < 20;
      if (aCritical && !bCritical) {return 1;}
      if (!aCritical && bCritical) {return -1;}
      if (a.value !== b.value) {return b.value - a.value;}
      return 0;
    });

    return { models, credits };
  }

  /**
   * Cleans up the UI element when the extension is deactivated.
   */
  dispose() {
    this.statusBarItem.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}

