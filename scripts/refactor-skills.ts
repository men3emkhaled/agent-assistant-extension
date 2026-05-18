import * as fs from 'fs';
import * as path from 'path';

const servicePath = path.join(__dirname, '../src/features/skills/skill.service.ts');
const dataPath = path.join(__dirname, '../src/features/skills/data/built-in-skills.ts');

const content = fs.readFileSync(servicePath, 'utf-8');

// Find the start of the skills array
const arrayStartMarker = 'private skills: Skill[] = [';
const startIndex = content.indexOf(arrayStartMarker);

if (startIndex === -1) {
  console.error('Could not find the skills array start.');
  process.exit(1);
}

// Find the end of the skills array
let openBrackets = 0;
let endIndex = -1;

for (let i = startIndex + arrayStartMarker.length - 1; i < content.length; i++) {
  if (content[i] === '[') openBrackets++;
  else if (content[i] === ']') {
    openBrackets--;
    if (openBrackets === 0) {
      endIndex = i;
      break;
    }
  }
}

if (endIndex === -1) {
  console.error('Could not find the skills array end.');
  process.exit(1);
}

// Ensure it covers the semicolon
let arrayEndIndex = endIndex + 1;
if (content[arrayEndIndex] === ';') {
  arrayEndIndex++;
}

// The extracted array string
const extractedArray = content.substring(startIndex + arrayStartMarker.length - 1, endIndex + 1);

const builtInSkillsContent = `import { Skill } from '../skill.service';

export const builtInSkills: Skill[] = ${extractedArray};
`;

fs.writeFileSync(dataPath, builtInSkillsContent);
console.log('Successfully created built-in-skills.ts');

// Replace in skill.service.ts
const replacement = `private skills: Skill[] = [...builtInSkills, ...agentSkills];`;
const newServiceContent = content.substring(0, startIndex) + replacement + content.substring(arrayEndIndex);

// Add imports
const imports = `import { builtInSkills } from './data/built-in-skills';\nimport { agentSkills } from './data/agent-skills';\n`;
const importIndex = newServiceContent.indexOf('export class SkillService');
const finalServiceContent = newServiceContent.substring(0, importIndex) + imports + newServiceContent.substring(importIndex);

fs.writeFileSync(servicePath, finalServiceContent);
console.log('Successfully updated skill.service.ts');
