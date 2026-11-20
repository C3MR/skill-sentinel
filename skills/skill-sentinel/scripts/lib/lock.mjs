// Review lock: a fingerprint of every file in every reviewed skill, agent and
// security-relevant config. A new or changed file fails the check until a human
// reviews it and refreshes the lock, so a change shows up in review instead of
// slipping in after trust was granted ("rug pull").
//
// The lock stores one hash per file, so a failure names the exact file that changed.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listTextFiles, relPath } from "./discover.mjs";

export const LOCK_FILE = "skills.lock.json";
const VERSION = 1;

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Files that make up an item. Config items hash only their security-relevant part. */
function fileHashes(root, item) {
  if (item.extract) {
    const content = item.extract(readFileSync(item.file, "utf8"));
    return { [item.rel]: sha256(content) };
  }
  const files = item.dir ? listTextFiles(item.dir) : [item.file];
  return Object.fromEntries(files.map((file) => [relPath(root, file), sha256(readFileSync(file))]));
}

export function writeLock(root, items) {
  const entries = items.map((item) => [item.rel, { kind: item.kind, files: fileHashes(root, item) }]);
  const lock = { version: VERSION, items: Object.fromEntries(entries) };
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
}

const lockFinding = (severity, path, code, params = {}) => ({
  severity,
  category: "review-lock",
  code,
  params,
  path,
  line: 1,
});

function compareFiles(root, item, locked) {
  const current = fileHashes(root, item);
  const label = { item: item.dir ? relPath(root, item.dir) : item.rel };
  const out = [];
  for (const [path, hash] of Object.entries(current)) {
    if (locked[path] === undefined) out.push(lockFinding("error", path, "lock_file_added", label));
    else if (locked[path] !== hash) out.push(lockFinding("error", path, "lock_file_changed", label));
  }
  for (const path of Object.keys(locked).filter((p) => current[p] === undefined)) {
    out.push(lockFinding("error", path, "lock_file_removed", label));
  }
  return out;
}

function compareItems(root, items, lockedItems) {
  const out = [];
  for (const item of items) {
    const entry = lockedItems[item.rel];
    if (entry === undefined) out.push(lockFinding("error", item.rel, "lock_new"));
    else out.push(...compareFiles(root, item, entry.files ?? {}));
  }
  return out;
}

function readLock(file) {
  try {
    const lock = JSON.parse(readFileSync(file, "utf8"));
    return lock.version === VERSION && lock.items && typeof lock.items === "object" ? lock.items : null;
  } catch {
    return null;
  }
}

/** Compares the project with the lock. No lock yet = one warning, not an error per item. */
export function checkLock(root, items) {
  const file = join(root, LOCK_FILE);
  if (!existsSync(file)) return [lockFinding("warn", LOCK_FILE, "lock_missing")];
  const lockedItems = readLock(file);
  if (!lockedItems) return [lockFinding("error", LOCK_FILE, "lock_invalid")];
  const out = compareItems(root, items, lockedItems);
  const present = new Set(items.map((item) => item.rel));
  for (const path of Object.keys(lockedItems).filter((p) => !present.has(p))) {
    out.push(lockFinding("warn", path, "lock_removed"));
  }
  return out;
}
