// Minimal YAML frontmatter reader for SKILL.md and agent files.
// Supports: key: value · key: "quoted" · key: > or | (folded/literal blocks) · key: [a, b].
// Nested mappings are collected as plain text and otherwise ignored.

const KEY_LINE = /^([A-Za-z][\w-]*):\s*(.*)$/;

function unquote(value) {
  const v = value.trim();
  const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  return quoted && v.length >= 2 ? v.slice(1, -1) : v;
}

function parseInlineList(value) {
  const v = value.trim();
  if (!v.startsWith("[") || !v.endsWith("]")) return null;
  return v.slice(1, -1).split(",").map(unquote).filter(Boolean);
}

function collectBlock(lines, start) {
  const out = [];
  let i = start;
  while (i < lines.length && (lines[i].startsWith(" ") || lines[i].trim() === "")) {
    out.push(lines[i].trim());
    i += 1;
  }
  return { text: out.join(" ").replace(/\s+/g, " ").trim(), next: i };
}

function readValue(lines, index, raw) {
  if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-" || raw === "") {
    const block = collectBlock(lines, index + 1);
    return { value: block.text, next: block.next };
  }
  return { value: parseInlineList(raw) ?? unquote(raw), next: index + 1 };
}

/** Returns { data, body, bodyStartLine }, or null when the file has no frontmatter. */
export function parseFrontmatter(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return null;
  const header = lines.slice(1, end);
  const data = {};
  let i = 0;
  while (i < header.length) {
    const match = KEY_LINE.exec(header[i]);
    if (!match) {
      i += 1;
      continue;
    }
    const { value, next } = readValue(header, i, match[2].trim());
    data[match[1]] = value;
    i = next;
  }
  return { data, body: lines.slice(end + 1).join("\n"), bodyStartLine: end + 2 };
}
