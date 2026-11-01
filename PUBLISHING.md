# Publishing Byte

## npm (the `byte-pet` command)

The name `byte-pet` was free on npm when this was written. Check again before publishing: `npm view byte-pet` should say "not found".

1. Create an account at npmjs.com and turn on two-factor authentication.
2. Log in from the terminal:
   ```bash
   npm login
   ```
3. Build and check what will be published:
   ```bash
   npm install
   npm run build
   cd apps/cli
   npm pack --dry-run      # should list only dist/byte.js, README.md, LICENSE, package.json
   ```
4. Publish:
   ```bash
   npm publish
   ```
5. Try it like a stranger would, in a fresh folder:
   ```bash
   npx byte-pet setup
   ```

For each new release, bump `version` in `apps/cli/package.json`, then repeat steps 3 and 4.

## VS Code Marketplace

1. Create a publisher at https://marketplace.visualstudio.com/manage (sign in with a Microsoft account). Use the ID `acedigitalhub`, or change `publisher` in `apps/vscode/package.json` to match yours.
2. Create a Personal Access Token in Azure DevOps (https://dev.azure.com) with the **Marketplace: Manage** scope.
3. Log in and publish:
   ```bash
   cd apps/vscode
   npx @vscode/vsce login acedigitalhub
   npx @vscode/vsce publish
   ```

## Open VSX (Cursor, Windsurf, VSCodium)

1. Sign in at https://open-vsx.org with GitHub and create an access token.
2. Publish the same file:
   ```bash
   npx ovsx publish byte-vscode-<version>.vsix -p <token>
   ```

## Before the first public release

- Put the code on GitHub and add `"repository"` to both `apps/cli/package.json` and `apps/vscode/package.json`.
- Add the demo GIF to the top of both READMEs.
- Add a 128x128 PNG `icon` to `apps/vscode/package.json`; the Marketplace shows it everywhere.
