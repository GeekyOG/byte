## Two small hooks, big protection

**Before each commit** Byte checks the lines you're adding:

- A Paystack, Stripe, AWS, GitHub or OpenAI key? The commit stops before it reaches git history.
- A shortcut that breaks your design rules? You get a warning with a fix.

**After each commit** Byte gives you XP and reacts in the panel.

Hooks live in `.git/hooks` and keep anything already there. Commits stay fast (well under a second).
