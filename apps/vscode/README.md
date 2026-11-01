# Byte

A small robot that lives in your VS Code sidebar and grows with your coding habits.

- **Byte is alive**: it wanders around the panel, its eyes follow your mouse, click to pet it, double-click to make it jump, click anywhere to send it there. It jumps when you earn XP and shakes when something breaks.
- Commits give XP (tiny ones count less, with a daily cap)
- Green test runs give XP and health; failing tests make Byte concerned
- Fixing errors in the Problems panel gives XP
- Health drops slowly on idle weekdays, never on weekends or in vacation mode
- **Sounds**: Byte giggles when you pet it, beeps when it walks, chimes when you earn XP, boings when it jumps and boops sadly when something breaks. Use the speaker button in the panel, or the `byte.sound` and `byte.soundVolume` settings.
- **Health check**: leaked keys, vulnerable packages, risky code and messy spots, scored out of 100 and shown as the light on Byte's chest. Runs weekly on its own, or click **Run health check**.
- **Design guard**: Byte learns the design rules your code already follows and warns when a commit breaks them, showing what changed, what was introduced, and a suggested fix

## Getting started

1. Open a git repository and run **Byte: Install git hooks** (or click the button in the Byte panel).
2. Click **Learn design rules** in the panel. Byte studies the code and asks which patterns to keep.
3. Have your test runner write a JSON report Byte can see:
   - Vitest: `vitest run --reporter=json --outputFile=vitest-report.json`
   - Jest: `jest --json --outputFile=jest-results.json`
4. Code as usual and watch Byte react.
