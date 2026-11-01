## Byte loves green tests

Byte reads Jest and Vitest results to give XP for passing tests and to worry when they fail.

It adds a few flags to your `test` script so the runner also saves a JSON report. Your normal output stays the same. Byte shows you the exact change first.

If your test script is custom (several commands chained together), Byte won't edit it and shows you the flags to add instead.
