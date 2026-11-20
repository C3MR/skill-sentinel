// Finds skills and agents. Works on a project, a plugin, a skills collection at
// any depth, or one downloaded skill.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

const AGENT_ROOTS = [".claude/agents", ".agents/agents"];
const TEXT_FILE = /\.(md|txt|sh|bash|zsh|ps1|py|js|mjs|cjs|ts|json|ya?ml|toml)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "vendor", ".venv", "__pycache__"]);
const VISIBLE_DOT_DIRS = new Set([".claude", ".agents"]);
const MAX_DEPTH = 6;
const MAX_BYTES = 512 * 1024;

const toPosix = (p) => p.split(sep).join("/");

export function relPath(root, file) {
  return toPosix(relative(root, file)) || basename(file);
}

export function loadPolicy(root) {
  const file = join(root, ".skills-policy.json");
  const defaults = { prefix: null, external: [], forbiddenTerms: [], allowRules: [] };
  return existsSync(file) ? { ...defaults, ...JSON.parse(readFileSync(file, "utf8")) } : defaults;
}

export function listTextFiles(dir) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) visit(full);
      else if (entry.isFile() && TEXT_FILE.test(entry.name) && statSync(full).size <= MAX_BYTES) files.push(full);
    }
  };
  visit(dir);
  return files.sort();
}

const skillItem = (dir) => ({ kind: "skill", folder: basename(dir), dir, file: join(dir, "SKILL.md") });

const descend = (name) => !SKIP_DIRS.has(name) && (!name.startsWith(".") || VISIBLE_DOT_DIRS.has(name));

/**
 * Walks the tree (bounded depth) and stops at the first folder holding a SKILL.md:
 * a skill's own sub-folders are scanned as part of that skill, not as new skills.
 * This covers .claude/skills, plugins/<name>/skills, category folders and collections.
 */
function findSkills(root) {
  if (existsSync(join(root, "SKILL.md"))) return [skillItem(root)];
  const skills = [];
  const visit = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !descend(entry.name)) continue;
      const full = join(dir, entry.name);
      if (existsSync(join(full, "SKILL.md"))) skills.push(skillItem(full));
      else visit(full, depth + 1);
    }
  };
  visit(root, 1);
  return skills.sort((a, b) => a.dir.localeCompare(b.dir));
}

function findAgents(root) {
  const agents = [];
  for (const base of AGENT_ROOTS) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      agents.push({ kind: "agent", folder: name.replace(/\.md$/, ""), dir: null, file: join(dir, name) });
    }
  }
  return agents;
}

/** Each item: { kind, folder, dir, file, rel } with rel relative to root. */
export function discover(root) {
  return [...findSkills(root), ...findAgents(root)].map((item) => ({ ...item, rel: relPath(root, item.file) }));
}
