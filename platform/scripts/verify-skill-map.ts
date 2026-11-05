/**
 * Guards the single source of truth chain:
 * plan matrix (docs/plans) ↔ FEATURES ↔ .claude/skills/<skill> ↔ orchestrator directory.
 * Run: npm run verify:skills  (exits 1 on any drift)
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { FEATURES, FEATURE_KEYS, ORCHESTRATOR_SKILL } from '../packages/permissions/src/features';

const root = join(__dirname, '..', '..');
const skillsDir = join(root, '.claude', 'skills');
const errors: string[] = [];

const dirs = readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, 'SKILL.md')));
for (const d of dirs) {
  const name = /^name:\s*(.+)$/m.exec(readFileSync(join(skillsDir, d, 'SKILL.md'), 'utf8'))?.[1].trim();
  if (name !== d) errors.push(`skill dir "${d}" has frontmatter name "${name}"`);
}

const orch = readFileSync(join(skillsDir, ORCHESTRATOR_SKILL, 'SKILL.md'), 'utf8');
const routed = new Set([...orch.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]));
const mapped = new Set(FEATURE_KEYS.map((k) => FEATURES[k].skill));

for (const k of FEATURE_KEYS) {
  const s = FEATURES[k].skill;
  if (!dirs.includes(s)) errors.push(`${k} → skill "${s}" not installed`);
  if (!routed.has(s)) errors.push(`${k} → skill "${s}" missing from orchestrator directory`);
}
for (const r of routed) if (!mapped.has(r)) errors.push(`orchestrator routes "${r}" but no FEATURE maps to it`);
for (const d of dirs) if (d !== ORCHESTRATOR_SKILL && !mapped.has(d)) errors.push(`installed skill "${d}" has no FEATURE`);

const matrix = readFileSync(join(root, 'docs', 'plans', 'SOLLUNA_Marketplace_Management_Plans.txt'), 'utf8');
for (const k of FEATURE_KEYS) if (!matrix.includes(FEATURES[k].label)) errors.push(`${k} label "${FEATURES[k].label}" not in plan matrix`);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`OK: ${FEATURE_KEYS.length} features ↔ ${dirs.length - 1} skills ↔ ${routed.size} orchestrator routes ↔ plan matrix`);
