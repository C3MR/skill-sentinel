#!/usr/bin/env node
// skill-sentinel — integrity guard for agent skills.
// Usage: sentinel [path] [--write-lock] [--strict] [--no-lock] [--lang en|ar] [--format text|json|github]
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runSentinel } from "./lib/index.mjs";
import { LANGUAGES } from "./lib/messages.mjs";
import { render, summarize } from "./lib/report.mjs";

const VERSION = "0.1.0";
const FORMATS = ["text", "json", "github"];
const HELP = `skill-sentinel ${VERSION}

Usage: sentinel [path] [options]

  path               Project root, a skills collection, or one skill folder (default: .)
  --write-lock       After review: record a fingerprint of every skill (refused if any error)
  --no-lock          Skip the review-lock check (e.g. vetting a skill before install)
  --strict           Warnings also fail
  --lang en|ar       Message language (default: en)
  --format FORMAT    text | json | github (default: text)
  --help, --version

Exit codes: 0 clean · 1 findings that fail · 2 usage error`;

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function parse(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const valued = new Set(["--lang", "--format"]);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));
  return {
    root: resolve(positional[0] ?? "."),
    writeLock: flags.has("--write-lock"),
    noLock: flags.has("--no-lock"),
    strict: flags.has("--strict"),
    lang: option(argv, "--lang", "en"),
    format: option(argv, "--format", "text"),
    help: flags.has("--help"),
    version: flags.has("--version"),
  };
}

function usageError(text) {
  console.error(`${text}\n\n${HELP}`);
  return 2;
}

function main(argv) {
  const opts = parse(argv);
  if (opts.help) return console.log(HELP), 0;
  if (opts.version) return console.log(VERSION), 0;
  if (!LANGUAGES.includes(opts.lang)) return usageError(`Unknown language: ${opts.lang}`);
  if (!FORMATS.includes(opts.format)) return usageError(`Unknown format: ${opts.format}`);
  if (!existsSync(opts.root)) return usageError(`Path not found: ${opts.root}`);
  const result = runSentinel(opts.root, { writeLock: opts.writeLock, noLock: opts.noLock });
  const output = render(result, { format: opts.format, lang: opts.lang, root: opts.root });
  if (output) console.log(output);
  if (opts.writeLock && opts.format === "text") {
    const ar = opts.lang === "ar";
    console.log(result.locked ? (ar ? "قُفلت المراجعة." : "Review locked.") : ar ? "لم يُكتب القفل: أصلح الأخطاء أولاً." : "Lock not written: fix the errors first.");
  }
  const { errors, warnings } = summarize(result.findings);
  return errors > 0 || (opts.strict && warnings > 0) ? 1 : 0;
}

// exitCode, not process.exit(): exiting early truncates large output written to a pipe.
process.exitCode = main(process.argv.slice(2));
