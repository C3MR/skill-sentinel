# Changelog

## 0.1.0 — 2026-11-20

First public version.

### Review lock
- `skills.lock.json` stores a SHA-256 for every file of every reviewed skill, agent and security setting.
- A failure names the exact file that was added, changed or removed, and the skill it belongs to.
- `--write-lock` is refused while any error remains.
- An unreadable lock fails instead of being trusted.

### What it checks
- **Shape and placement:** frontmatter, name format and folder match, reserved words, description length and XML, project prefix, forbidden terms.
- **Project fit:** missing `npm run` scripts, deleted paths, and read-only agents that carry write tools or Bash. These run only on installed folders (`.claude/`, `.agents/`).
- **Frontmatter fields that grant power:**
  - `allowed-tools` pre-approving any shell or network tool
  - `user-invocable: false`
  - a skill-chosen `model`
  - an agent's `permissionMode: bypassPermissions`
- **Hooks, permissions and MCP servers** in `.claude/settings.json`, `.claude/settings.local.json` and `.mcp.json`. Hook commands and local hook scripts go through every content rule.
- **25 harmful-content rules,** including Arabic instruction-override and concealment patterns.
  - A match that is quoted, described or negated is reported as a warning with a note.
  - A match inside an HTML comment stays an error.

### Measured
- False-positive benchmark on 9,432 public skills ([docs/benchmark.md](docs/benchmark.md)): false errors touched 4 skills (~0.04%).

### Use
- Scans a project, a collection (recursively) or a single downloaded skill.
- Text, JSON or GitHub-annotation output; messages in English or Arabic.
- Composite GitHub Action and a Claude skill wrapper.
- 85 tests on `node:test`, zero dependencies.
