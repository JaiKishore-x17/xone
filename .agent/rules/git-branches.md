## Git Branch Workflow (`main` vs `exp/xone-dash`)
This repository is split into two active branches maintained separately:
1. **`main` (Production):** Clean, stable signed release build (`v1.2.1+`). Must NEVER contain Xone Dash game code, `SettingsPage.tsx` game toggles, or experimental game dependencies.
2. **`exp/xone-dash` (Experimental):** Contains the Xone Dash beat-synced canvas game, Easy/Raw difficulty settings, and experimental features published as GitHub Pre-releases.


### Rules for Every Task:
- Always check `git branch --show-current` before modifying files or suggesting git commands.
- When working on `main`, keep all changes strictly scoped to the core music player and never introduce Xone Dash references.
- When working on `exp/xone-dash`, keep experimental game features isolated here; if I fix a core music player bug on `main` that `exp/xone-dash` also needs, cherry-pick or merge `main` into `exp/xone-dash` — NEVER merge `exp/xone-dash` into `main`.