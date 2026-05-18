import * as fs from 'fs';
import * as path from 'path';

interface Skill {
  id: string;
  title: string;
  category: string;
  description: string;
  tags: string[];
  icon: string;
  isActive: boolean;
  color: string;
  fullInstructions: string;
}

const skillsDir = path.join(__dirname, '../agent-skills/skills');
const outputFile = path.join(__dirname, '../src/features/skills/data/agent-skills.ts');

function parseMarkdown(filePath: string): Skill | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Parse frontmatter
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);
  
  if (!match) return null;
  
  const frontmatter = match[1];
  let name = '';
  let description = '';
  
  const nameMatch = frontmatter.match(/name:\s*(.+)/);
  if (nameMatch) name = nameMatch[1].trim();
  
  const descMatch = frontmatter.match(/description:\s*(.+)/);
  if (descMatch) description = descMatch[1].trim();
  
  // Strip frontmatter from content for fullInstructions
  let fullInstructions = content.replace(frontmatterRegex, '').trim();
  
  return {
    id: name,
    title: name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    category: 'Agent Skills',
    description: description,
    tags: ['Agent', 'AI', name],
    icon: 'robot', // Default icon
    isActive: false,
    color: '#10b981', // Default color (emerald green)
    fullInstructions: fullInstructions
  };
}

function generateAgentSkills() {
  if (!fs.existsSync(skillsDir)) {
    console.error(`Directory not found: ${skillsDir}`);
    return;
  }
  
  const parsedSkills: Skill[] = [];
  const dirs = fs.readdirSync(skillsDir);
  
  for (const dir of dirs) {
    const dirPath = path.join(skillsDir, dir);
    if (fs.statSync(dirPath).isDirectory()) {
      const skillPath = path.join(dirPath, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const skill = parseMarkdown(skillPath);
        if (skill) {
          parsedSkills.push(skill);
        }
      }
    }
  }
  
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const tsContent = `// Automatically generated from agent-skills repository
import { Skill } from '../skill.service';

export const agentSkills: Skill[] = ${JSON.stringify(parsedSkills, null, 2)};
`;

  fs.writeFileSync(outputFile, tsContent);
  console.log(`Successfully generated ${parsedSkills.length} agent skills to ${outputFile}`);
}

generateAgentSkills();
