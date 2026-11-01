# byte-pet

A little robot that lives in your terminal and grows with your coding habits. It also stops leaked API keys before they reach git, keeps your codebase's design consistent, and runs a security health check.

```bash
npm install -g byte-pet
cd your-project
byte setup
```

Or without installing: `npx byte-pet setup`

## What Byte does

- **Blocks secrets on commit.** Paystack, Stripe, Flutterwave, AWS, GitHub, OpenAI and Anthropic keys, private keys, database passwords and `.env` files never make it into git history.
- **Design guard.** Learns the rules your code already follows (like "controllers never call the database directly") and warns when a commit breaks them, with a suggested fix. Old code goes into a baseline, so only new work is judged.
- **Health check** (`byte audit`). Secrets, vulnerable packages, SQL and command injection, unsafe HTML, open CORS, JWT mistakes, weak hashing, huge or unused files. Scored out of 100.
- **A pet that cares.** XP for commits, green tests and fixing old issues. Moods, stages, and an interactive robot in your terminal (`byte pet`).

## Commands

| Command | What it does |
| --- | --- |
| `byte setup` | Set everything up in one go |
| `byte doctor` | Check what's set up |
| `byte pet` | Play with Byte in your terminal |
| `byte status` | Health, XP and recent activity |
| `byte audit` | Health check (`--history`, `--url <site>`, `--strict` for CI) |
| `byte guard init` | Learn your design rules |
| `byte tests setup` | Let Byte read Jest or Vitest results |
| `byte vacation on/off` | Pause health loss |

Also available as a VS Code extension with an animated Byte that walks, giggles and reacts to your work.

Everything runs on your machine. Nothing is sent anywhere, except `npm audit` asking the npm registry about your packages.

MIT licensed.
