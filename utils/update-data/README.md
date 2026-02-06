# update-data

Fetches external data needed by the actions at build time:

- **Compiler tags** — GCC, Clang, and CMake version tags from remote git repos
- **Ubuntu versions** — version-to-codename mapping from Ubuntu changelogs
- **Boost deps** — dependency graph for Boost libraries

## Usage

```bash
npm run update-data
```

This is also included in `npm run validate` for the full pre-commit check.
