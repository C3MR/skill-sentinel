// Output formats: human text, JSON for tools, and GitHub Actions annotations.
import { join, relative, sep } from "node:path";
import { message } from "./messages.mjs";

const ORDER = { error: 0, warn: 1 };

const sorted = (findings) =>
  [...findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);

export function summarize(findings) {
  const errors = findings.filter((f) => f.severity === "error").length;
  return { errors, warnings: findings.length - errors };
}

function formatText(result, lang) {
  const lines = sorted(result.findings).map((f) => {
    const mark = f.severity === "error" ? "✗" : "!";
    return `  ${mark} ${f.path}:${f.line} [${f.code}]\n      ${message(f.code, f.params, lang)}`;
  });
  const { errors, warnings } = summarize(result.findings);
  const head = lang === "ar" ? "العناصر المفحوصة" : "Items scanned";
  const tail = lang === "ar" ? `أخطاء: ${errors} · تنبيهات: ${warnings}` : `errors: ${errors} · warnings: ${warnings}`;
  return [...lines, `${head}: ${result.items.length} · ${tail}`].join("\n");
}

function formatJson(result, lang) {
  const findings = sorted(result.findings).map(({ params, ...f }) => ({ ...f, message: message(f.code, params, lang) }));
  return JSON.stringify({ items: result.items.length, ...summarize(result.findings), locked: result.locked, findings }, null, 2);
}

const escapeData = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

function formatGithub(result, lang, root) {
  return sorted(result.findings)
    .map((f) => {
      const level = f.severity === "error" ? "error" : "warning";
      const file = relative(process.cwd(), join(root, f.path)).split(sep).join("/");
      const props = `file=${escapeProp(file)},line=${f.line},title=${escapeProp(`skill-sentinel/${f.code}`)}`;
      return `::${level} ${props}::${escapeData(message(f.code, f.params, lang))}`;
    })
    .join("\n");
}

export function render(result, { format = "text", lang = "en", root = "." } = {}) {
  if (format === "json") return formatJson(result, lang);
  if (format === "github") return formatGithub(result, lang, root);
  return formatText(result, lang);
}
