import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node18", sourcemap: true };

// The extension itself
await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"], format: "cjs" });

// The CLI, shipped inside the extension so the git hook works without a global install
await build({ ...common, sourcemap: false, minify: true, entryPoints: ["../cli/src/index.ts"], outfile: "dist/byte.js", banner: { js: "#!/usr/bin/env node" } });

console.log("Built dist/extension.js and dist/byte.js");
