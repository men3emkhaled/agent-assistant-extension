import * as fs from 'fs';
import * as path from 'path';

const hardcodedSkills = [
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

const categoryColors: Record<string, string> = {
  'frontend': '#3b82f6',
  'backend': '#10b981',
  'security': '#ef4444',
  'devops': '#f97316',
  'cloud': '#06b6d4',
  'architecture': '#8b5cf6',
  'design': '#ec4899',
  'development': '#6366f1',
  'data': '#14b8a6',
  'data-ai': '#7c3aed',
  'testing': '#eab308',
  'productivity': '#22c55e',
  'content': '#f59e0b',
  'marketing': '#d946ef',
  'workflow-bundle': '#0ea5e9',
  'granular-workflow-bundle': '#0284c7',
  'meta': '#64748b',
  'framework': '#a855f7',
  'growth': '#16a34a',
  'ai-agents': '#7c3aed',
  'mcp': '#0891b2',
  'automation': '#f97316',
  'business': '#059669',
  'coding': '#6366f1',
  'education': '#8b5cf6',
  'research': '#0ea5e9',
};

const skillsDir = path.join(__dirname, '../skill');
const dirs = fs.readdirSync(skillsDir).filter(d => {
  const fullPath = path.join(skillsDir, d);
  return fs.statSync(fullPath).isDirectory() && !d.startsWith('.');
});

const hardcodedIds = new Set(hardcodedSkills.map(s => s.id));
const fullGeneratedSkills: any[] = [];
const metaGeneratedSkills: any[] = [];
let skipped = 0;

for (const dir of dirs) {
  if (hardcodedIds.has(dir)) continue;

  const mdPath = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) {
    skipped++;
    continue;
  }

  try {
    const content = fs.readFileSync(mdPath, 'utf-8');

    // Parse frontmatter
    let name = dir;
    let description = '';
    let category = 'Uncategorized';

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const nameMatch = fm.match(/name:\s*(.+)/);
      if (nameMatch) name = nameMatch[1].trim();

      const descMatch = fm.match(/description:\s*["']?([\s\S]*?)["']?\n(?:\w+:|$)/);
      if (descMatch) description = descMatch[1].trim();

      const catMatch = fm.match(/category:\s*(.+)/);
      if (catMatch) category = catMatch[1].trim().replace(/^["']|["']$/g, '');
    }

    // Extract body after frontmatter
    const lines = content.split('\n');
    let inBody = false;
    const bodyContent: string[] = [];
    let dashesCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        dashesCount++;
        if (dashesCount === 2) {
          inBody = true;
          continue;
        }
      }
      if (inBody || !content.startsWith('---')) {
        bodyContent.push(lines[i]);
      }
    }

    const fullInstructions = bodyContent.join('\n').trim();
    if (!fullInstructions) {
      skipped++;
      continue;
    }

    const formattedCategory = category.charAt(0).toUpperCase() + category.slice(1);
    const color = categoryColors[category.toLowerCase()] || '#6366f1';

    // Full version with instructions for resources/skills.json
    fullGeneratedSkills.push({
      id: dir,
      title: name.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
      category: formattedCategory,
      description: description || `Expert skill for ${name}`,
      tags: [formattedCategory, 'Awesome-Skill'],
      icon: 'zap',
      isActive: false,
      color,
      fullInstructions
    });

    // Metadata-only version for src/features/skills/data/core-skills.ts to keep bundle small
    metaGeneratedSkills.push({
      id: dir,
      title: name.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
      category: formattedCategory,
      description: description || `Expert skill for ${name}`,
      tags: [formattedCategory, 'Awesome-Skill'],
      icon: 'zap',
      isActive: false,
      color,
      fullInstructions: ''
    });
  } catch (e) {
    skipped++;
  }
}

// 1. Write the full catalog to resources/skills.json
const resourcesDir = path.join(__dirname, '../resources');
if (!fs.existsSync(resourcesDir)) {
  fs.mkdirSync(resourcesDir, { recursive: true });
}
const fullSkillsList = [...hardcodedSkills, ...fullGeneratedSkills];
const jsonOutPath = path.join(resourcesDir, 'skills.json');
fs.writeFileSync(jsonOutPath, JSON.stringify(fullSkillsList, null, 2), 'utf-8');
console.log(`Generated ${jsonOutPath} with ${fullSkillsList.length} skills (full instructions).`);

// 2. Write the metadata catalog to src/features/skills/data/core-skills.ts
const metaSkillsList = [...hardcodedSkills, ...metaGeneratedSkills];
const outputTs = "import { Skill } from '../skill.service';\n\nexport const coreSkills: Skill[] = " + JSON.stringify(metaSkillsList, null, 2) + ";\n";
const outPath = path.join(__dirname, '../src/features/skills/data/core-skills.ts');
fs.writeFileSync(outPath, outputTs);
console.log(`Generated ${outPath} with ${metaSkillsList.length} skills (metadata-only).`);
console.log(`Skipped: ${skipped} (no SKILL.md or empty)`);
