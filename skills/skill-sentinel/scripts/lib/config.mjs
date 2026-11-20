// Hooks, permissions and MCP servers. Hooks run commands automatically on agent
// events, with nobody asking for them, and MCP servers are code fetched and run
// by the agent: both deserve the same scrutiny as skills, and a place in the lock.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { relPath } from "./discover.mjs";
import { checkLine } from "./rules.mjs";

const SETTINGS_FILES = [".claude/settings.json", ".claude/settings.local.json"];
const MCP_FILES = [".mcp.json"];
const SECURITY_KEYS = ["hooks", "permissions", "enableAllProjectMcpServers", "enabledMcpjsonServers", "mcpServers"];
const NETWORK_TOOL = /\b(curl|wget|nc|ncat|netcat|scp|rsync|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const LOCAL_SCRIPT = /(?:^|\s|["'])((?:\.{1,2}\/|\.claude\/)[\w./-]+\.(?:sh|bash|py|js|mjs|cjs|ts|ps1))/g;
// "$CLAUDE_PROJECT_DIR"/x, ${CLAUDE_PROJECT_DIR}/x and $CLAUDE_PROJECT_DIR/x all point inside the project.
const PROJECT_DIR = /["']?\$\{?CLAUDE_PROJECT_DIR\}?["']?\//g;
const RUNNERS = new Set(["npx", "bunx", "pnpx", "uvx", "pipx"]);
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;
const SAFE_VALUE = /^(\$\{?[A-Za-z_][\w]*\}?|<[^>]*>|your[-_].*|changeme|xxx+|\*+|)$/i;

const finding = (severity, code, path, line, params = {}) => ({ severity, category: "config", code, params, path, line });

const pick = (obj) => JSON.stringify(Object.fromEntries(SECURITY_KEYS.filter((k) => k in obj).map((k) => [k, obj[k]])));

const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

function configItem(root, file, kind) {
  const extract = kind === "settings" ? (text) => pick(safeParse(text) ?? {}) : (text) => text;
  return { kind: "config", configKind: kind, folder: file, dir: null, file: join(root, file), rel: relPath(root, join(root, file)), extract };
}

export function discoverConfigs(root) {
  const settings = SETTINGS_FILES.filter((f) => existsSync(join(root, f))).map((f) => configItem(root, f, "settings"));
  const mcp = MCP_FILES.filter((f) => existsSync(join(root, f))).map((f) => configItem(root, f, "mcp"));
  return [...settings, ...mcp];
}

function lineOf(text, needle) {
  const index = typeof needle === "string" && needle ? text.indexOf(needle) : -1;
  return index < 0 ? 1 : text.slice(0, index).split("\n").length;
}

function scanScript(ctx, script) {
  const { root } = ctx;
  const path = resolve(root, script);
  const inside = path.startsWith(resolve(root) + sep);
  if (!inside || !existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line, i) => checkLine(line, ctx.allow).map((r) => ({ severity: r.severity, category: r.category, code: r.code, params: r.context ? { context: r.context } : {}, path: relPath(root, path), line: i + 1 })));
}

function checkCommand(ctx, command, event) {
  const line = lineOf(ctx.text, command);
  const out = checkLine(command, ctx.allow).map((r) => ({ severity: r.severity, category: r.category, code: r.code, params: r.context ? { context: r.context } : {}, path: ctx.rel, line }));
  if (NETWORK_TOOL.test(command)) out.push(finding("warn", "hook_network", ctx.rel, line, { event }));
  for (const match of command.replace(PROJECT_DIR, "./").matchAll(LOCAL_SCRIPT)) out.push(...scanScript(ctx, match[1]));
  return out;
}

function hookCommands(hooks) {
  const commands = [];
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (typeof hook?.command === "string") commands.push({ event, command: hook.command });
      }
    }
  }
  return commands;
}

function checkPermissions(ctx, settings) {
  const out = [];
  const perms = settings.permissions ?? {};
  if (perms.defaultMode === "bypassPermissions") out.push(finding("error", "perm_bypass", ctx.rel, lineOf(ctx.text, "bypassPermissions")));
  for (const rule of Array.isArray(perms.allow) ? perms.allow : []) {
    if (/^Bash(\((\*|:\*)?\))?$/.test(String(rule).trim())) out.push(finding("warn", "perm_broad_bash", ctx.rel, lineOf(ctx.text, rule)));
  }
  if (settings.enableAllProjectMcpServers === true) {
    out.push(finding("warn", "mcp_auto_enable", ctx.rel, lineOf(ctx.text, "enableAllProjectMcpServers")));
  }
  return out;
}

function isPinned(runner, pkg) {
  if (runner === "uvx" || runner === "pipx") return /==|@/.test(pkg);
  return pkg.lastIndexOf("@") > 0;
}

function checkServer(ctx, name, server) {
  const out = [];
  const args = Array.isArray(server?.args) ? server.args.map(String) : [];
  const command = String(server?.command ?? "");
  const runner = command.split(/[\\/]/).pop();
  const pkg = args.find((a) => !a.startsWith("-"));
  if (RUNNERS.has(runner) && pkg && !isPinned(runner, pkg)) out.push(finding("warn", "mcp_unpinned", ctx.rel, lineOf(ctx.text, pkg), { name, pkg }));
  const url = String(server?.url ?? "");
  if (/^http:\/\/(?!localhost|127\.|\[::1\])/i.test(url)) out.push(finding("warn", "mcp_http", ctx.rel, lineOf(ctx.text, url), { name }));
  const joined = [command, ...args, url].join(" ");
  out.push(...checkLine(joined, ctx.allow).map((r) => ({ severity: r.severity, category: r.category, code: r.code, params: r.context ? { context: r.context } : {}, path: ctx.rel, line: lineOf(ctx.text, name) })));
  for (const [key, value] of Object.entries(server?.env ?? {})) {
    const literal = typeof value === "string" && !SAFE_VALUE.test(value.trim());
    if (literal && SECRET_NAME.test(key)) out.push(finding("error", "mcp_secret", ctx.rel, lineOf(ctx.text, key), { name, key }));
  }
  return out;
}

function checkServers(ctx, servers) {
  return Object.entries(servers ?? {}).flatMap(([name, server]) => checkServer(ctx, name, server));
}

/** Checks one settings or MCP file. */
export function checkConfig(root, item, policy = {}) {
  const text = readFileSync(item.file, "utf8");
  const json = safeParse(text);
  if (!json) return [finding("error", "config_invalid", item.rel, 1)];
  const ctx = { root, text, rel: item.rel, allow: policy.allowRules ?? [] };
  if (item.configKind === "mcp") return checkServers(ctx, json.mcpServers);
  const hooks = hookCommands(json.hooks).flatMap(({ event, command }) => checkCommand(ctx, command, event));
  return [...hooks, ...checkPermissions(ctx, json), ...checkServers(ctx, json.mcpServers)];
}
