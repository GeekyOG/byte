# Byte

A robot pet for VS Code and the terminal that grows with your coding habits. Phases 1 to 3 of the build guide: the pet with its XP engine and signal collectors, the design guard, and the health check.

## Quick start

```bash
npx byte-pet setup        # once published to npm
```

From this repo: `npm install && npm run build && cd apps/cli && npm link`, then `byte setup` inside any project. `byte doctor` shows what's set up. In VS Code, the extension opens a **Get started with Byte** guide the first time.

Publishing steps are in [PUBLISHING.md](PUBLISHING.md).

## Layout

```
packages/pet       XP, health, moods, stages, state file (pure TypeScript, fully tested)
packages/signals   git helpers, hook installer, Jest/Vitest report parser
plugins/design-guard  rule discovery, import and class analysis, baseline, commit reports
plugins/audit      health check: secrets, packages, risky code, code health, live site
apps/cli           the `byte` command (also run by the git hook)
apps/vscode        the extension: sidebar pet, status bar, watchers
```

## Commands

```bash
npm install
npm test            # engine and parser tests
npm run typecheck
npm run build       # builds the packages, CLI and extension
```

## Try it

**In VS Code:** open `apps/vscode` in VS Code and press F5. A new window opens with Byte in the activity bar.

**Package the extension:** `cd apps/vscode && npm run package`, then install the `.vsix` with *Extensions: Install from VSIX*.

**In the terminal:**

```bash
node apps/vscode/dist/byte.js init      # inside any git repo
git commit -m "something"               # Byte reacts
node apps/vscode/dist/byte.js status   # animated pixel Byte
node apps/vscode/dist/byte.js pet      # Byte lives in your terminal: p pet, f feed, j jump, d dance, click to pet or move, q quit
```

State lives in `~/.byte/state.json` (set `BYTE_HOME` to change it). The CLI and the extension share it.

## How XP works

| Event | Effect |
| --- | --- |
| Commit (3+ lines changed) | +5 XP, +2 health, daily cap 30 XP |
| Tiny commit | +1 XP |
| Green test run | +1 XP per test (cap 25/day), +5 health, each run counted once |
| Failing tests | −2 health per failure (max −10), mood: concerned |
| Skipped tests | −1 health each (max −5) |
| Lint errors fixed | +2 XP each (cap 20/day) |
| New lint errors | −1 health each (max −5) |
| Idle weekday | −4 health, capped at −20 per break, never below 10 |

Stages: Boot (0), Mini-bot (50), Bot (200), Senior Dev (500).

## Design guard (phase 2)

```bash
byte init              # installs the post-commit and pre-commit hooks
byte guard init        # studies the codebase and asks which rules to keep
git commit             # the pre-commit hook prints the report
byte guard check       # check staged changes any time (--json for tools)
byte guard baseline --prune   # drop old issues that have been fixed
```

**How rules are found.** `byte guard init` parses every code file with the TypeScript compiler API and looks for patterns the code already follows:

- *Layers*: folders like `src/controllers` with 3 or more files.
- *"A reaches B only through C"*: if controllers import services and services import repositories, but no controller imports repositories, that's a rule. If a few files already break it, Byte marks it **mixed** and asks.
- *Shared interfaces*: a folder where every class implements the same interface.
- *Competing libraries*: axios and got both in use, moment and dayjs, and so on. Always asked, never assumed.

Run with `--yes` to keep the sure rules and skip the open questions (also the default when there's no terminal).

**The baseline.** Existing violations go into `.byte/baseline.json` so only new code gets warnings. Fingerprints use the rule, file and import or class name, not the line number, so moving code around doesn't create false warnings. When someone fixes an old issue, the report says so and Byte gives XP.

**Rule types** in `byte.patterns.yml`:

```yaml
layers:
  controllers: src/controllers/**
  repositories: src/repositories/**
rules:
  - id: no-controllers-to-repositories
    type: forbid-import
    from: controllers
    to: repositories
    message: Controllers should reach repositories through services
  - id: gateways-implement-paymentgateway
    type: must-implement
    files: src/gateways/**
    interface: PaymentGateway
  - id: use-got
    type: forbid-package
    packages: [axios]
    message: Use got for HTTP requests
block: false   # true = stop commits that add new warnings (skip once with --no-verify)
```

Commit `byte.patterns.yml` and `.byte/baseline.json`. `.byte/last-report.json` is personal and gets added to `.gitignore`.

**Limits for now.** TypeScript and JavaScript only. Path aliases `@/` and `~/` map to `src/`; other tsconfig paths aren't read yet. No AI review yet (that needs the server, phase 5), so fixes are rule-based suggestions.

## Health check (phase 3)

```bash
byte audit                     # secrets, packages, risky code, code health
byte audit --history           # also scan the last 300 commits for secrets
byte audit --url https://site  # also check a live site: HTTPS, headers, speed, certificate
byte audit --all               # list everything, not just the top 5 per section
byte audit --json              # for tools (the VS Code panel uses this)
byte audit --strict            # exit 1 if anything critical, for CI
byte audit accept <id> "why"   # keep a risk on purpose; also: accepted, unaccept <id>
```

| Check | How | Examples |
| --- | --- | --- |
| Secrets | Byte's own rules (no gitleaks needed), values always masked | Paystack/Stripe and Flutterwave keys, AWS, GitHub, Anthropic, OpenAI, Slack, Google keys, private keys, database URLs with passwords, tracked `.env` files |
| Packages | `npm audit` on `package-lock.json` | Known vulnerabilities, with the version to update to |
| Risky code | Byte's own rules on the TypeScript syntax tree | SQL built with `${}`, shell commands from strings, `eval`, `innerHTML` from data, open CORS with credentials, `jwt.decode`, JWT `none`, TLS checks off, MD5/SHA1 on passwords, `Math.random()` for tokens, secrets in logs |
| Code health | Import graph from the design guard | Files over 500 lines, files nothing imports, no tests, TODO count, test ratio |
| Live site (opt-in) | One request plus a TLS check | Plain HTTP, missing security headers, X-Powered-By, slow responses, certificate expiry |

**Score:** starts at 100; critical −25, high −10, moderate −3, low −1 (all low findings together cost at most 10). It shows as the light in the middle of Byte's chest: green 80+, amber 50 to 79, red below 50. Improving the score earns XP; critical findings make Byte concerned.

**Secrets in the pre-commit hook.** Every commit's *added lines* are checked. A new secret stops the commit (old secrets in a file you touch don't). False alarm? Add `// byte-ignore-secret` to the line, or `git commit --no-verify`. Set `secrets: warn` in `byte.patterns.yml` to only warn.

**Files:** commit `.byte/audit-accepted.json` (accepted risks with reasons). `.byte/audit.json` is personal and goes in `.gitignore`.

**Team Semgrep rules (optional).** Put your own rules in `.byte/semgrep/` and install Semgrep; Byte runs them too. Byte itself ships no Semgrep registry rules, so there are no license questions.

**Limits for now:** packages need `package-lock.json` (pnpm and yarn are next) and network access to npm. Risky-code rules cover JavaScript and TypeScript.

## Next (phase 4)

The WhatsApp plugin: webhook scaffold, flow simulator, template checker, live watch.
