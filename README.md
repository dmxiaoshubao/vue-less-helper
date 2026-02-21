# vue-less-helper

VS Code extension for Less symbol enhancement in Vue and `.less` files.

## Current Capabilities (v0.1.1)

- Completion for Less variables and mixins in:
  - `.less` files
  - Vue SFC `<style lang="less">` blocks only
- Hover and definition for variables/mixins.
- Auto import on completion (`@import (reference) '...'`):
  - skips self import
  - prevents unsafe circular import by default
  - prefers the symbol source file over entry files when possible
- Recursive index from configured entry Less files and their imports.
- Consistent preview between completion and hover.
- Mixin preview body is truncated to at most 5 lines, then `...`.
- Multi-root workspace support:
  - each workspace folder indexes independently
  - completion/hover/definition/auto-import resolve by current file's workspace root

## Screenshots

Hover tooltip:

![Hover Tooltip](docs/images/hover-tooltip.png)

Go to definition:

![Go to Definition](docs/images/go-to-definition.gif)

Completion suggestions:

![Completion Suggestions](docs/images/completion-suggestions.gif)

## Core Feature Support Matrix

| Feature | Supported | Notes |
| --- | --- | --- |
| Variable/mixin completion in `.less` files | Yes | Triggered by `@` (variables) and `.` (mixins). |
| Completion in Vue `<style lang="less">` | Yes | Works only inside less style blocks. |
| Completion in Vue non-less style blocks | No | Explicitly out of scope. |
| Variable/mixin hover | Yes | Uses the same preview format as completion. |
| Variable/mixin definition | Yes | Jumps to symbol definition location. |
| Auto import on completion | Yes | Inserts `@import (reference) '...';`. |
| Auto import self-import guard | Yes | Skips when target is current file. |
| Auto import circular dependency guard (default) | Yes | Unsafe circular imports are blocked by default. |
| Prefer symbol source file over entry file | Yes | Uses symbol definition source when available. |
| Mixin preview body max 5 lines | Yes | Over-limit lines become `...`. |
| Multi-root workspace isolation | Yes | Uses current file workspace root for symbol lookup and import resolution. |
| Relative path resolution | Yes | Supported for config/import resolution. |
| Absolute path resolution | Yes | Supported for config/import resolution. |
| Alias resolution from `tsconfig/jsconfig` | Yes | Uses `baseUrl + paths`. |

## Configuration

Set workspace settings in `.vscode/settings.json`:

```json
{
  "vueLessHelper.lessFiles": [
    "@/styles/variables.less",
    "@/styles/mixins.less"
  ],
  "vueLessHelper.notice": true
}
```

### Config keys

- `vueLessHelper.lessFiles`: entry Less files used to build symbol index.
- `vueLessHelper.notice`: whether to show onboarding notice when `lessFiles` is empty.

## Path Resolution Rules

- Supports:
  - relative paths
  - absolute paths
  - aliases from `tsconfig.json` / `jsconfig.json` (`compilerOptions.baseUrl + paths`)

## Multi-root Usage

- This extension supports multi-root workspaces, including:
  - monorepo
  - multiple independent projects opened together in one VS Code window
- Configure `vueLessHelper.lessFiles` per workspace folder.
- Symbol index and provider behavior are isolated by the active document's workspace folder.

## Local Development

```bash
npm install
npm run compile
npm run test:unit
npm run test:host
npm run test:host:demos
```

Demo workspaces used by host matrix tests:

- `demo/basic`
- `demo/tsconfig-alias`
- `demo/jsconfig-alias`
- `demo/demo-multi-root.code-workspace`


## Notes

- Parsing is regex-based and focused on common Less variable/mixin patterns.
- If you need exact behavior in your project, configure `vueLessHelper.lessFiles` explicitly.

## License

MIT
