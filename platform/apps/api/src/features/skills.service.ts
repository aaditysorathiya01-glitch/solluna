import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { FEATURES, FEATURE_KEYS, ORCHESTRATOR_SKILL } from '../../../../packages/permissions/src/features';
import { config } from '../common/config';

export interface Skill { name: string; description: string; instructions: string }

function findSkillsDir(): string {
  if (config.skillsDir) return resolve(config.skillsDir);
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, '.claude', 'skills');
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) throw new Error('Could not locate .claude/skills — set SKILLS_DIR');
    dir = up;
  }
}

/**
 * Loads the installed SOLLUNA skills (.claude/skills/<name>/SKILL.md) — the single definition of how
 * each service is delivered. Boot fails if any feature's skill is missing, so the platform can never
 * route work to a skill that does not exist.
 */
@Injectable()
export class SkillsService implements OnModuleInit {
  private skills = new Map<string, Skill>();
  readonly dir = findSkillsDir();

  onModuleInit() {
    const wanted = new Set([ORCHESTRATOR_SKILL, ...FEATURE_KEYS.map((k) => FEATURES[k].skill)]);
    const missing: string[] = [];
    for (const name of wanted) {
      const file = join(this.dir, name, 'SKILL.md');
      if (!existsSync(file)) { missing.push(name); continue; }
      const raw = readFileSync(file, 'utf8');
      const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
      const fmName = fm && /^name:\s*(.+)$/m.exec(fm[1])?.[1].trim();
      if (fmName !== name) { missing.push(`${name} (frontmatter name "${fmName}")`); continue; }
      const description = (fm && /^description:\s*(.+)$/m.exec(fm[1])?.[1].trim()) ?? '';
      this.skills.set(name, { name, description, instructions: fm ? raw.slice(fm[0].length) : raw });
    }
    if (missing.length) throw new Error(`Skills missing or misnamed in ${this.dir}: ${missing.join(', ')}`);
  }

  get(name: string): Skill {
    const s = this.skills.get(name);
    if (!s) throw new NotFoundException(`Skill ${name} not installed`);
    return s;
  }

  list() { return [...this.skills.values()].map(({ name, description }) => ({ name, description })); }
}
