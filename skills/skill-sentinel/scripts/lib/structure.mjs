// Does the skill have a valid shape, sit in the right place, and still match the project?
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFields } from "./fields.mjs";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED = /anthropic|claude/;
const XML_TAG = /<\/?[a-z][\w-]*(\s[^>]*)?>/i;
const MAX_BODY_LINES = 500;
const READ_ONLY_CLAIM = /read[-\s]only|قراءة\s+فقط|لا\s+يعدّ?ل\s+ملفات/i;
const WRITE_TOOLS = /\b(Write|Edit|MultiEdit|NotebookEdit)\b/;
const BACKTICK_PATH = /`([\w.@[\]()-]+\/[\w.@[\]()/-]*)`/g;
const NPM_RUN = /\bnpm\s+run\s+(?:-{1,2}[\w-]+\s+)*([\w:.][\w:.-]*)/g;
const MODULE_EXT = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", "/index.ts", "/index.tsx", "/index.js"];
const PLACEHOLDER_START = new Set(["<", "{", "["]);

const finding = (severity, category, code, params = {}, line = 1) => ({ severity, category, code, params, line });

function checkName(item, data, policy) {
  const name = typeof data.name === "string" ? data.name : "";
  if (!name) return [finding("error", "frontmatter", "name_missing")];
  const out = [];
  if (!NAME.test(name) || name.length > 64) out.push(finding("error", "name", "name_format", { name }));
  if (RESERVED.test(name)) out.push(finding("warn", "name", "name_reserved"));
  if (name !== item.folder) out.push(finding("error", "placement", "name_mismatch", { name, folder: item.folder }));
  const approved = !policy.prefix || name.startsWith(policy.prefix) || policy.external.includes(name);
  if (!approved) out.push(finding("warn", "placement", "prefix", { prefix: policy.prefix }));
  return out;
}

function checkDescription(data) {
  const d = typeof data.description === "string" ? data.description : "";
  if (!d) return [finding("error", "frontmatter", "desc_missing")];
  const out = [];
  if (d.length > 1024) out.push(finding("error", "frontmatter", "desc_long", { length: d.length }));
  if (XML_TAG.test(d)) out.push(finding("error", "frontmatter", "desc_xml"));
  if (d.length < 40) out.push(finding("warn", "frontmatter", "desc_short"));
  return out;
}

function checkAgentTools(data, text) {
  if (!READ_ONLY_CLAIM.test(text)) return [];
  const tools = Array.isArray(data.tools) ? data.tools.join(",") : String(data.tools ?? "");
  if (WRITE_TOOLS.test(tools)) return [finding("error", "contradiction", "agent_write_tools")];
  if (/\bBash\b/.test(tools)) return [finding("warn", "contradiction", "agent_bash")];
  return [];
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function checkReferences(root, skillDir, text) {
  const out = [];
  for (const match of text.matchAll(BACKTICK_PATH)) {
    const path = match[1].replace(/:\d+$/, "");
    const first = path.split("/")[0];
    const local = first && !first.startsWith("@") && first !== "node_modules" && existsSync(join(root, first));
    const bases = skillDir ? [root, skillDir] : [root];
    const exists = bases.some((base) => MODULE_EXT.some((ext) => existsSync(join(base, path + ext))));
    if (local && !/[*<{]|\.\.\./.test(path) && !exists) {
      out.push(finding("warn", "stale", "stale_reference", { path }, lineOf(text, match.index)));
    }
  }
  return out;
}

function readScripts(root) {
  const file = join(root, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")).scripts ?? {};
  } catch {
    return null;
  }
}

function checkScripts(root, text) {
  const scripts = readScripts(root);
  if (!scripts) return [];
  const out = [];
  for (const match of text.matchAll(NPM_RUN)) {
    const script = match[1].replace(/[.:]+$/, "");
    const placeholder = PLACEHOLDER_START.has(text[match.index + match[0].length] ?? "");
    if (!placeholder && !(script in scripts)) {
      out.push(finding("error", "stale", "stale_script", { script }, lineOf(text, match.index)));
    }
  }
  return out;
}

function checkForbidden(text, policy) {
  return policy.forbiddenTerms
    .filter((term) => text.includes(term))
    .map((term) => finding("error", "placement", "forbidden_term", { term }));
}

// Project-fit checks only make sense for skills installed in the project they serve:
// a skill in a collection or a plugin cannot know your scripts and paths.
const INSTALLED = /^\.(claude|agents)\//;

/** Checks the main skill or agent file. `parsed` comes from parseFrontmatter. */
export function checkStructure(root, item, parsed, policy) {
  if (!parsed) return [finding("error", "frontmatter", "frontmatter_missing")];
  const text = readFileSync(item.file, "utf8");
  const bodyLines = parsed.body.split("\n").length;
  return [
    ...checkName(item, parsed.data, policy),
    ...checkDescription(parsed.data),
    ...(item.kind === "agent" ? checkAgentTools(parsed.data, text) : []),
    ...checkFields(item, parsed.data, text),
    ...(bodyLines > MAX_BODY_LINES ? [finding("warn", "size", "size", { lines: bodyLines })] : []),
    ...(INSTALLED.test(item.rel) ? checkReferences(root, item.dir, text) : []),
    ...(INSTALLED.test(item.rel) ? checkScripts(root, text) : []),
    ...checkForbidden(text, policy),
  ];
}
