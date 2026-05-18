# Changelog

All notable changes to the Agent Assistant ecosystem are documented here. This project strictly follows [Semantic Versioning](https://semver.org/) for transparent and reliable updates.

---

## [1.0.8] - 2026-05-18
### Granular Skill Categorization
- **Refined Folders**: Re-architected the Core Skills Tree View to use highly granular and targeted categories (e.g., separating a massive 150-skill "Cloud" folder into dedicated "AWS", "Azure", and "Google Cloud" folders).
- **Improved Sidebar UX**: Categories are now strictly scoped (e.g., "React Ecosystem", "Docker & K8s", "Node.js", "CI/CD & DevOps") preventing sidebar overcrowding and making it much easier to toggle contextually relevant skill bundles.
## [1.0.7] - 2026-05-18
### Skill Marketplace & Folder Activations
- **Skill Marketplace**: Built a native Webview Marketplace allowing users to browse, search, and instantly install any of the 1,444+ agent skills from the massive Antigravity Awesome Skills repository.
- **Folder Activation**: Added a "Toggle Folder" button (`$(run-all)`) to instantly inject or remove an entire category of skills with one click.
- **Core Skills Engine**: Extracted the hardcoded skills into a dynamic 300+ core skills manifest covering Frontend, Backend, Security, DevOps, Cloud, and Architecture.
- **Mass Toggle Option**: Added a "Toggle All Skills" command (with a safety warning) for power users.
- **Workspace Protection**: Automatically generates and updates `.gitignore` to prevent the `.antigravity` environment folder and injected agent prompts from polluting the user's version control.

## [1.0.6] - 2026-05-16
### Visual Identity & Search Optimization
- **Square Logo**: Replaced the rectangular icon with a high-fidelity square logo (1:1) and transparent background for maximum visibility in search results.
- **Search Engine Optimization**: Expanded keywords to include 20+ variations of "Agent Assistant" and relevant AI models (GPT-4o, Claude 3.5, Gemini 1.5) to ensure top ranking in marketplaces.



## [1.0.5] - 2026-05-16
### Expert Skills Categorization & UI Overhaul
- **Skill Folders**: Introduced a hierarchical tree view for Expert Skills, organizing 60+ skills into 9 premium categories (e.g., Premium UI & Design, System Architecture).
- **Frontend Design Library**: Restored 10 individual high-fidelity design system skills (Apple HIG, Uber, Material 3, etc.) as standalone selectable entities within the UI folder.
- **RTL Support**: Renamed and prioritized "arabic-rtl for chat", pinning it to the absolute top of the sidebar for instant access.
- **Custom Skill Builder 2.0**: Upgraded the builder with a category selection dropdown, ensuring new skills are perfectly integrated into the folder structure.
- **Dynamic Sync**: Fixed real-time synchronization between Custom Skills management and the Expert Skills sidebar.

## [1.0.3] - 2026-05-14
### Major Skill Library Expansion
- Added 13 new skills: refactor-pro, git-expert, sql-expert, regex-master, api-tester, debug-expert, code-reviewer, prompt-engineer, css-master, animation-expert, design-system, color-theory, creative-ui.
- Upgraded all existing skills with deep, opinionated, actionable instructions replacing generic 3-4 line stubs.
- GEMINI.md injection layer: Antigravity IDE now reads skill instructions directly from workspace root.
- Updated injection pipeline to 6 layers: GEMINI.md, CLAUDE.md, .cursorrules, .github/copilot-instructions.md, .vscode/settings.json, .gemini/settings.json.
- Full README rewrite to document the 30+ skill library, injection mechanism, and updated installation instructions.
- Updated LICENSE copyright holder to men3emkhaled.

## [1.0.1] - 2026-05-13
### Human Persona Optimization
- Strengthened Human Persona: Implemented strict constraints to eliminate AI artifacts, emojis, and redundant conversational fillers.
- Metadata Cleanup: Removed emojis from README and documentation to maintain a professional, senior-developer identity.

## [1.0.0] - 2026-05-13
### Evolution into Agent Assistant
- Complete Rebranding: Transitioned from Antigravity Hub to the new Agent Assistant identity.
- Unified Sidepanel Architecture: Integrated all management features into a native VS Code sidebar for a zero-latency experience.
- Universal Skill Engine: Implemented a model-agnostic injection system compatible with GPT-4, Claude 3.5, Gemini 1.5, and Llama 3.
- Expert Instruction Sets: Injected deep technical knowledge and expert constraints directly into AI agent workspaces using the official Anthropic Skill Specification.

### New Expert Personas
- Security Shield: Enforces strict security protocols, prevents API key leakage, and audits code for vulnerabilities.
- Human Persona: Mimics professional senior developer communication, eliminating AI artifacts and redundant fillers.
- UI/UX Architect: Directs agents to build modern, accessible, and high-performance web interfaces.
- QA & Automation Lead: Expert-level testing strategies using Playwright, Jest, and Vitest.
- Performance Core: Focuses on algorithmic efficiency, memory optimization, and high-speed execution.

### Professional Quota Management
- Sync Engine v2: Enhanced multi-account synchronization with encrypted state management.
- Real-time Balance Dashboard: Glassmorphism UI providing high-visibility metrics for all major LLM providers.
- One-Click Account Swapping: Instant session injection to switch between development environments without friction.

---

## [0.1.2] - 2026-05-10
### Added
- Visual Identity: Integrated user profile pictures for active accounts.
- Performance: Optimized background sync to reduce CPU overhead during heavy polling.

## [0.1.1] - 2026-05-09
### Foundations
- Initial development of the account synchronization engine.
- Bi-lingual localization framework (Arabic/English).
- Secure credential handling using VS Code globalState.

---
*Maintained with precision by men3em*
