// skill-sentinel: shape and placement, harmful content, hooks and MCP config, and the review lock.
import { readFileSync } from "node:fs";
import { checkConfig, discoverConfigs } from "./config.mjs";
import { discover, listTextFiles, loadPolicy, relPath } from "./discover.mjs";
import { parseFrontmatter } from "./frontmatter.mjs";
import { checkLock, writeLock } from "./lock.mjs";
import { checkLine } from "./rules.mjs";
import { checkStructure } from "./structure.mjs";

export const contextParams = (r) => (r.context ? { context: r.context } : {});

function scanContent(root, item, policy) {
  const files = item.dir ? listTextFiles(item.dir) : [item.file];
  const findings = [];
  for (const file of files) {
    const path = relPath(root, file);
    readFileSync(file, "utf8")
      .replace(/^\uFEFF/, "")
      .split("\n")
      .forEach((line, index) => {
        for (const r of checkLine(line, policy.allowRules)) {
          findings.push({ severity: r.severity, category: r.category, code: r.code, params: contextParams(r), path, line: index + 1 });
        }
      });
  }
  return findings;
}

function checkItem(root, item, policy) {
  if (item.kind === "config") return checkConfig(root, item, policy);
  const parsed = parseFrontmatter(readFileSync(item.file, "utf8"));
  const structure = checkStructure(root, item, parsed, policy).map((f) => ({ ...f, path: item.rel }));
  return [...structure, ...scanContent(root, item, policy)];
}

/**
 * Runs every check. Returns { items, findings, locked }.
 * With writeLock, the lock is written only when no finding is an error:
 * the lock certifies a review, it is not a stamp on anything.
 */
export function runSentinel(root, options = {}) {
  const policy = loadPolicy(root);
  const items = [...discover(root), ...discoverConfigs(root)];
  const content = items.flatMap((item) => checkItem(root, item, policy));
  if (options.writeLock) {
    const blocked = content.some((f) => f.severity === "error");
    if (!blocked) writeLock(root, items);
    return { items, findings: content, locked: !blocked };
  }
  const lock = options.noLock ? [] : checkLock(root, items);
  return { items, findings: [...content, ...lock], locked: false };
}
