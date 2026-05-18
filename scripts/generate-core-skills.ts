import * as fs from 'fs';
import * as path from 'path';

interface AwesomeSkill {
  id: string;
  path: string;
  category: string;
  name: string;
  description: string;
}

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

// Read skills_index.json
const indexPath = path.join(__dirname, '../skill/skills_index.json');
const indexData: AwesomeSkill[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

// Filter top categories for Core Skills
const topCategories = ['frontend', 'backend', 'security', 'devops', 'cloud', 'architecture'];
const coreAwesomeSkills = indexData.filter(s => topCategories.includes(s.category));

// Read fullInstructions from SKILL.md for each awesome skill
const generatedSkills = coreAwesomeSkills.map(s => {
  const skillMdPath = path.join(__dirname, '../skill', s.path, 'SKILL.md');
  let fullInstructions = '';
  try {
    const mdContent = fs.readFileSync(skillMdPath, 'utf-8');
    // Extract instructions part from markdown (skipping frontmatter)
    const lines = mdContent.split('\n');
    let inBody = false;
    let bodyContent = [];
    let dashesCount = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            dashesCount++;
            if (dashesCount === 2) {
                inBody = true;
                continue;
            }
        }
        if (inBody || !mdContent.startsWith('---')) {
            bodyContent.push(lines[i]);
        }
    }
    const text = bodyContent.join('\n');
    fullInstructions = text.trim();
  } catch (e) {
    console.error(`Failed to read ${skillMdPath}`);
  }

  const formattedCategory = s.category.charAt(0).toUpperCase() + s.category.slice(1);

  return {
    id: s.id,
    title: s.name,
    category: formattedCategory,
    description: s.description,
    tags: [formattedCategory, 'Awesome-Skill'],
    icon: 'zap',
    isActive: false,
    color: '#6366f1',
    fullInstructions: fullInstructions
  };
});

const allCoreSkills = [...hardcodedSkills, ...generatedSkills];

const outputTs = "import { Skill } from '../skill.service';\n\nexport const coreSkills: Skill[] = " + JSON.stringify(allCoreSkills, null, 2) + ";\n";

const outPath = path.join(__dirname, '../src/features/skills/data/core-skills.ts');
fs.writeFileSync(outPath, outputTs);
console.log("Generated " + outPath + " with " + allCoreSkills.length + " skills.");
