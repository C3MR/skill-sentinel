# False-positive benchmark

Measured on **2026-11-20** with skill-sentinel **0.1.0**, run as
`sentinel.mjs <collection> --no-lock --format json` on Node 22.
Every collection was cloned at a fixed commit and only read, never executed.

| Collection | Commit | Items | Errors (findings) | Unique errors | Warnings (findings) | Skills with errors | Time |
|---|---|---:|---:|---:|---:|---:|---:|
| [anthropics/skills](https://github.com/anthropics/skills) | `e4bb5d9` | 20 | 2 | 2 | 5 | 2 | 0.7 s |
| [obra/superpowers](https://github.com/obra/superpowers) | `22f0b46` | 15 | 0 | 0 | 3 | 0 | 0.1 s |
| [sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | `444f05e` | 9,397 | 162 | 54 | 1,562 | 21 | 29 s |

*Unique errors* collapses the same line copied into several plugin folders
(the large collection ships many skills more than once).

## What the errors were

Every one of the 54 unique errors was read by hand and sorted into three groups.

| Group | Unique errors | Meaning |
|---|---:|---|
| Security reference material | 42 | Offensive or defensive security skills that quote real attack payloads on purpose: prompt-injection catalogues and red-team eval cases, pentest playbooks, secret-detection regex tables, malware reverse-engineering notes, CI attack write-ups. The scanner is right that the text is dangerous; installing such a skill is a deliberate human decision, which is exactly what the review lock is for. |
| True findings | 7 | `git commit --no-verify` and `git push --no-verify` taught as normal workflow (git-hooks-automation); `claude --dangerously-skip-permissions` taught as a normal command, twice (claude-code-expert); XML in a description (deed-page); a name with an underscore (android_ui_verification); literal bidi control characters inside a Python script (launch-check). |
| False positives | 5 | A cautionary `rm -rf *  # if cd fails` example; two code comments that describe `--no-verify`; a sample private-key header in an Argo CD doc; an inline fake key in an rclone SFTP example. |

The two Anthropic errors are both spec issues, not false positives:
one description is 1,068 characters (limit 1,024) and one template folder name
does not match its `name:` field.

**Measured false-positive rate on errors:** 5 of 54 unique errors
(~9%), touching 4 of 9,397 skills (**~0.04%**).
For an ordinary, non-security skill collection the expected number of false
errors is close to zero.

## What changed because of this benchmark

The first run on the large collection produced 822 unique errors and 3,990
`url_http` warnings. Each false-positive source was fixed at the rule, and each
fix has a regression test:

- **Discovery** became recursive (depth 6). Before, it found only 2,944 of the 9,676 skill folders.
- **exfil** now needs a real upload flag (`-d`, `--data*`, `-F`, `-T`, `--upload-file`, `-Body`) followed by a secret.
  An `Authorization` header alone, or `-token` mistaken for `-T`, no longer counts.
- **Context:** a match inside quotes, after "tries to" or "attempts to", or after a negation is reported as a warning with a note.
  A match inside an HTML comment stays an error, because comments hide text from human readers.
- **url_http / url_ip** only fire when the URL is fetched (curl -o, wget, git clone, pip/npm/go install).
  Localhost and private ranges are excluded.
- **Placeholders** such as `sk-...`, `<your-key>` and the jwt.io sample token are ignored.
- **destructive_rm** targets only `/`, `~`, `$HOME` or a bare `*`.
- **no_verify** no longer matches `--no-verify-ssl`.
- **Fit checks** (prefix, external services) only apply to installed folders (`.claude/`, `.agents/`), not to collections.
- **JSON output** is no longer cut off at 64 KB when piped; the CLI sets `process.exitCode` instead of calling `process.exit()`.

Result: 822 → 52 unique errors before the frontmatter-field checks were added (they added 2 true errors), and 3,990 → 40 `url_http` warnings.

## Limits of this measurement

- Warnings were **not** precision-measured. They are prompts for a human to look, not verdicts.
  The biggest groups on the large collection were `credential_path` (425), `desc_short` (188), `url_http` (124), `hidden_mark` (118) and `fm_preapprove_shell` (106). These counts include every mirrored copy.
- A low false-positive rate says nothing about recall. A skill written to slip past regex rules can still pass.
  Read the skill; the scanner only tells you where to look first.
- The classification is one reviewer's judgement. The raw JSON can be reproduced with the commits above.

## Reproduce

```bash
git clone https://github.com/sickn33/antigravity-awesome-skills bench/antigravity
git -C bench/antigravity checkout 444f05e
node skills/skill-sentinel/scripts/sentinel.mjs bench/antigravity --no-lock --format json > out.json
```
