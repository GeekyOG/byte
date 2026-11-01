## Byte learns your rules for you

Nobody has to write a config file. Byte reads your code and finds patterns it already follows, like:

- *Controllers never import repositories directly; they go through services*
- *Every class in `gateways/` implements `PaymentGateway`*
- *Two HTTP libraries in use; which one should new code use?*

You keep or skip each one in the terminal. Existing issues go into a **baseline**, so only new code gets warnings.

Commit `byte.patterns.yml` and `.byte/baseline.json` so your team shares the rules.
