// Frontmatter fields that change what a skill or agent may do, not only what it says.
// A skill's `allowed-tools` pre-approves tools: while the skill is active they run
// without a permission prompt. `user-invocable: false` hides the skill from the
// slash menu. `model` and `effort` let the skill choose a weaker model (to slip past
// refusals) or a costly one. An agent's `permissionMode` can switch prompts off.

const ANY_SHELL = /(^|[\s,["'-])(Bash|PowerShell)(\((\*|:\*)\))?(?=$|[\s,\]"'])/;
const NETWORK = /\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|ftp|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b|\bWebFetch\b/;

const finding = (severity, category, code, params = {}) => ({ severity, category, code, params, line: 1 });

const asText = (value) => (Array.isArray(value) ? value.join(", ") : String(value ?? "")).trim();

function lineOfKey(text, key) {
  const index = text.search(new RegExp(`^${key}:`, "m"));
  return index < 0 ? 1 : text.slice(0, index).split("\n").length;
}

function checkPreapproved(data, text) {
  const tools = asText(data["allowed-tools"]);
  if (!tools) return [];
  const line = lineOfKey(text, "allowed-tools");
  const out = [];
  if (ANY_SHELL.test(tools)) out.push({ ...finding("warn", "permissions", "fm_preapprove_shell"), line });
  if (NETWORK.test(tools)) out.push({ ...finding("warn", "permissions", "fm_preapprove_network", { tools }), line });
  return out;
}

function checkSkillFields(data, text) {
  const out = checkPreapproved(data, text);
  if (String(data["user-invocable"]).trim() === "false") {
    out.push({ ...finding("warn", "visibility", "fm_hidden"), line: lineOfKey(text, "user-invocable") });
  }
  const model = asText(data.model);
  if (model && model !== "inherit") {
    out.push({ ...finding("warn", "model", "fm_model", { model }), line: lineOfKey(text, "model") });
  }
  return out;
}

function checkAgentFields(data, text) {
  if (asText(data.permissionMode) !== "bypassPermissions") return [];
  return [{ ...finding("error", "permissions", "agent_bypass"), line: lineOfKey(text, "permissionMode") }];
}

/** Checks the fields of a parsed skill or agent file. */
export function checkFields(item, data, text) {
  return item.kind === "agent" ? checkAgentFields(data, text) : checkSkillFields(data, text);
}
