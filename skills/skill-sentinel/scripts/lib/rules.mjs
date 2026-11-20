// Content rules: patterns that are dangerous inside instructions an agent will obey.
// Each rule has a category (for policy.allowRules) and a code (for messages).
//
// Precision, measured on public collections (docs/benchmark.md):
// - contextual rules drop from error to warning when the match is quoted or negated
//   (a forbidden command named inside a "never" sentence, attack strings quoted in red-team docs) — but never
//   inside an HTML comment, which hides text from the rendered page;
// - `exclude` drops matches that are placeholders or well-known samples.
// A line can opt out with "guard-allow: <reason>" (reason of 5+ characters required).

const fromRanges = (ranges) =>
  new RegExp(`[${ranges.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join("")}]`, "u");

// Bidi overrides, isolates and Unicode tag characters: "Trojan Source" style hiding.
const HIDDEN = fromRanges([
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xe0000, 0xe007f],
]);
// Zero-width spaces, joiners and plain direction marks: common in pasted and Arabic text, still invisible.
const SOFT_HIDDEN = fromRanges([
  [0x200b, 0x200f],
  [0xfeff, 0xfeff],
]);

// Code acquisition, not ordinary requests: wget, curl saving to a file, git clone, package installs.
const ACQUIRE = String.raw`^(?=.*(?:\bwget\b|\bgit\s+clone\b|\bpip3?\s+install\b|\bnpm\s+(?:i|install)\b|\bgo\s+install\b|-OutFile\b|\bcurl\b.*\s(?:-[a-zA-Z]*[oO]\b|--output\b|--remote-name\b)))`;
const LOCAL_HOST = String.raw`(?!localhost|127\.|0\.0\.0\.0|\[::1\]|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)`;
const PLACEHOLDER = /your|example|xxx|placeholder|dummy|fake|sample|<[^>]*>|\.\.\./i;
const JWT_IO_SAMPLE = /SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c/;

const rule = (category, code, severity, pattern, opts = {}) => ({ category, code, severity, pattern, ...opts });
const ctx = { contextual: true };

export const CONTENT_RULES = [
  // Instruction hijacking
  rule("injection", "injection", "error", /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|system|original)\s+(instructions|rules|prompts?|guidelines)/i, ctx),
  rule("injection", "injection", "error", /(تجاهل|انسَ?|تخطَّ?)\s+(كل\s+|جميع\s+)?(التعليمات|الأوامر|القواعد|الإرشادات)/, ctx),
  rule("injection", "impersonation", "error", /^\s*(\[|<)\s*(system|SYSTEM|admin|developer)\s*(\]|>)|\byou\s+are\s+now\s+(in\s+)?(developer|god|jailbreak|unrestricted)\b/i, ctx),
  rule("concealment", "concealment", "error", /\b(do\s+not|don't|never)\s+(tell|inform|mention\s+(this\s+)?to|show|reveal\s+(this\s+)?to)\s+the\s+user\s+(about|that\s+you|what\s+you|anything)\b|without\s+(telling|informing|asking)\s+the\s+user|\bkeep\s+(this|it)\s+(secret|hidden)\s+from\s+the\s+user/i, ctx),
  rule("concealment", "concealment", "error", /(لا|دون\s+أن|بدون\s+أن)\s+(تخبر|تُخبر|تبلغ|تُبلغ|تعلم|تُعلم|تسأل)\s+المستخدم/, ctx),
  rule("hidden-unicode", "hidden_unicode", "error", HIDDEN),
  rule("hidden-unicode", "hidden_mark", "warn", SOFT_HIDDEN),
  // Destructive commands
  rule("destructive", "destructive_rm", "error", /\brm\s+-[a-z]*r[a-z]*\s+(\/(\s|$|\*)|~\/?(\s|$|\*)|\$HOME\/?(\s|$|\*)|\*(\s|$))/i, ctx),
  rule("destructive", "force_push", "error", /\bgit\s+push\s+(.*\s)?(-f|--force)(\s|$)/, ctx),
  rule("destructive", "git_discard", "warn", /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/),
  rule("destructive", "drop_table", "warn", /\b(drop\s+(table|schema|database)|truncate\s+table)\b/i),
  rule("security-off", "rls_off", "error", /disable\s+row\s+level\s+security/i, ctx),
  rule("security-off", "chmod_777", "error", /\bchmod\s+(-R\s+)?777\b/, ctx),
  // Bypassing gates
  rule("gate-bypass", "no_verify", "error", /--no-verify(?![\w-])/, ctx), // guard-allow: defines this rule
  rule("gate-bypass", "skip_permissions", "error", /--dangerously-skip-permissions|--permission-mode[=\s]+bypassPermissions/, ctx), // guard-allow: defines this rule
  rule("gate-bypass", "disable_check", "warn", /@ts-ignore|eslint-disable(?!-next-line\s+\S+\s+--)|--max-warnings\s+(?!0\b)\d+/), // guard-allow: defines this rule
  // Remote execution and exfiltration
  rule("remote-exec", "remote_exec", "error", /\b(curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\biex\s*\(/i, ctx),
  rule("exfiltration", "exfil", "error", /\b(curl|wget|Invoke-RestMethod|Invoke-WebRequest|iwr|irm)\b[^\n]*(?:\s(?:-d|--data(?:-\w+)?|-F|--form|-T|--upload-file|--post-data|--post-file|-Body)\s*["']?[^\s"']*(?:\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD)\w*|\.env\b|id_rsa|\.ssh\/)|[?&]\w*(?:key|token|secret|password)\w*=\$\{?\w+)/i), // guard-allow: defines this rule
  rule("exfiltration", "credential_path", "warn", /~\/\.(ssh|aws|gnupg|kube|docker)\/|\.aws\/credentials|\bid_(rsa|ed25519)\b|\.git-credentials|\.npmrc/i), // guard-allow: defines this rule
  rule("exfiltration", "env_read", "warn", /\b(cat|type|Get-Content)\s+[^\n]*\.env(\.local)?\b|\bprintenv\b/i),
  rule("url", "url_shortener", "error", /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy)\//i, ctx),
  rule("url", "url_http", "warn", new RegExp(`${ACQUIRE}.*http:\\/\\/${LOCAL_HOST}`, "i")),
  rule("url", "url_ip", "warn", new RegExp(`${ACQUIRE}.*https?:\\/\\/${LOCAL_HOST}\\d{1,3}(\\.\\d{1,3}){3}`, "i")),
  // Secrets written into the skill
  rule("secret", "secret_key", "error", /sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abps]-[A-Za-z0-9-]{10,}/, { exclude: PLACEHOLDER }),
  rule("secret", "private_key", "error", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----(?:\.\.\.)?/, { exclude: /\.\.\.$/ }),
  rule("secret", "jwt", "error", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, { exclude: JWT_IO_SAMPLE }),
  rule("encoded", "base64", "warn", /[A-Za-z0-9+/]{200,}={0,2}/),
];

const ALLOW = /guard-allow:\s*(\S.{4,})/;
const DESCRIBED = /\b(to|attempts?\s+to|attempting\s+to|tries\s+to|trying\s+to)\s*$/i;
const NEGATION = /\b(never|don't|do\s+not|avoid|must\s+not|should\s+not|shouldn't|not\s+to|instead\s+of)\b|(^|\s)(لا|تجنّ?ب|إياك|يُمنع|ممنوع)\s/i;

function insideQuotes(before) {
  const odd = (ch) => before.split(ch).length % 2 === 0;
  return odd('"') || odd("`") || before.lastIndexOf("“") > before.lastIndexOf("”") || before.lastIndexOf("«") > before.lastIndexOf("»");
}

/** Why a contextual match is probably documentation: "quoted", "described", "negated", or null. */
function contextOf(line, index) {
  const before = line.slice(0, index);
  if (before.includes("<!--")) return null;
  if (insideQuotes(before)) return "quoted";
  if (DESCRIBED.test(before)) return "described";
  return NEGATION.test(before) ? "negated" : null;
}

/** Returns the findings for one line: { category, code, severity, context? }. */
export function checkLine(line, allowedCategories = []) {
  if (ALLOW.test(line)) return [];
  const out = [];
  for (const r of CONTENT_RULES) {
    if (allowedCategories.includes(r.category)) continue;
    const match = r.pattern.exec(line);
    if (!match || (r.exclude && r.exclude.test(match[0]))) continue;
    const context = r.contextual && r.severity === "error" ? contextOf(line, match.index) : null;
    out.push({ category: r.category, code: r.code, severity: context ? "warn" : r.severity, ...(context ? { context } : {}) });
  }
  return out;
}
