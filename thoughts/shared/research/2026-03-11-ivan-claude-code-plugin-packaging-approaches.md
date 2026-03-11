---
date: 2026-03-11T00:00:00Z
type: external-research
topic: "Ivan Claude Code plugin packaging approaches"
focus: general
sources:
  - https://code.claude.com/docs/en/plugins
  - https://code.claude.com/docs/en/plugins-reference
  - https://code.claude.com/docs/en/hooks
  - https://code.claude.com/docs/en/settings
  - https://code.claude.com/docs/en/discover-plugins
  - https://code.claude.com/docs/en/plugin-marketplaces
status: complete
---

# Research: Ivan Claude Code Plugin Packaging Approaches

## Summary

Claude Code now has a first-class plugin system, and it is capable of bundling hooks, skills, agents, MCP servers, and default agent selection. That means Ivan can be packaged as a Claude Code plugin, but the official docs also explicitly recommend starting with standalone `.claude/` configuration for project-specific workflows and only converting to plugins when the goal is sharing, versioning, or marketplace distribution.

The practical recommendation is: do not replace Ivan's repo-local hook installer with a plugin as the primary integration path yet. Keep the repo-local `.claude/settings.json` approach as the default for fast iteration and per-repo control, and treat a Claude Code plugin as a secondary packaging/distribution layer for shared hook logic, reusable skills, and optional MCP-backed Ivan capabilities.

## Key Findings

### Official plugin system exists and is broad enough

Anthropic's plugin docs say plugins can extend Claude Code with:

- skills
- agents
- hooks
- MCP servers
- LSP servers

Official plugin structure supports:

- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `skills/`
- `agents/`
- `.mcp.json`
- `settings.json`

Source:

- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugins-reference

### Anthropic explicitly recommends standalone first for project-specific iteration

The plugin guide draws a sharp line:

- standalone `.claude/` is best for personal workflows, project-specific customizations, and quick experiments
- plugins are best for team sharing, reusable cross-project capabilities, versioned releases, and marketplace distribution

It also says: start with standalone configuration in `.claude/` for quick iteration, then convert to a plugin when ready to share.

Source:

- https://code.claude.com/docs/en/plugins

### Hooks fit both approaches, but live in different places

For standalone/project configuration:

- hooks live in `.claude/settings.json`

For plugins:

- hooks live in `hooks/hooks.json`
- the format is effectively the same hook configuration object migrated out of settings

The plugin migration guide explicitly describes moving existing `.claude/settings.json` hook config into `hooks/hooks.json`.

Source:

- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/plugins

### Project scope is a strong fit for Ivan's current model

Claude Code settings docs say project scope is best for:

- team-shared settings
- hooks
- MCP servers
- plugins the whole team should have

That matches Ivan's current architecture better than a user-global install, because learnings are repo-local and the selected hook set is intentionally tied to the repository's `.claude/settings.json`.

Source:

- https://code.claude.com/docs/en/settings

### Plugin settings are not a full replacement for hook config

Plugin root `settings.json` currently supports only the `agent` key. Unknown keys are ignored.

That means a plugin cannot simply ship a generic root `settings.json` that directly replaces Ivan's current `.claude/settings.json` hook wiring approach. Hook behavior still needs to live in `hooks/hooks.json` inside the plugin.

Source:

- https://code.claude.com/docs/en/plugins

### Plugins are installable at user, project, or local scope

Claude Code supports plugin installation scopes:

- user
- project
- local
- managed

Project-scoped plugin installs write into `.claude/settings.json`, which means plugins can still align with repo-shared workflows if desired.

Source:

- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/discover-plugins

### Distribution options are flexible

Anthropic documents plugin marketplace distribution via:

- GitHub
- generic git repositories
- URL-based marketplaces
- npm packages
- local files/directories

For npm-based plugin sources, marketplace entries can point at scoped packages and optionally pin versions or custom registries.

Source:

- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/plugin-marketplaces

## Implications For Ivan

### What a plugin would be good for

A plugin is a good fit if Ivan wants to distribute Claude-side behavior that is:

- reused across many repositories
- versioned independently from any one repo
- installable by teams from a marketplace
- more than hooks alone, such as skills plus hooks plus MCP servers

Concrete plugin candidates:

- reusable learnings-recall hooks
- an Ivan skill namespace for setup, rebuild, and inspect flows
- an MCP bridge that exposes Ivan query/build capabilities as Claude tools
- a standardized reviewer or implementation agent for Ivan-aware repos

### What a plugin is not good for

A plugin is a weaker fit if the main goal is:

- fast per-repo experimentation
- shipping repo-specific hook commands that depend on that repo's local `learnings.db`
- keeping repo configuration transparent and editable in source control
- minimizing Claude-side packaging overhead while the feature is still changing quickly

That describes Ivan's current learnings integration fairly closely.

## Approaches

## Approach 1: Stay standalone only

Shape:

- keep `ivan learnings install-hooks --repo ...`
- write repo-local `.claude/settings.json`
- write repo-local hook scripts under `.claude/hooks/`

Pros:

- matches Anthropic's recommended starting path
- easiest to debug
- no plugin marketplace or plugin namespacing overhead
- strongest fit for repo-local `learnings.db`
- fully visible in the target repo

Cons:

- harder to share updates across many repos
- no centralized plugin versioning
- each repo carries its own hook copies

Best when:

- the feature is still evolving
- most value comes from repo-local behavior
- the team is still learning Claude hook semantics

## Approach 2: Hybrid, repo-local by default plus optional plugin packaging

Shape:

- keep `ivan learnings install-hooks --repo ...` as the default path
- also create an Ivan Claude plugin for shared skills/hooks/MCP later
- use the plugin for reusable behavior, while repo-local settings remain the fast path

Pros:

- lowest migration risk
- preserves current working model
- creates a path to team-wide reuse and marketplace distribution
- lets plugin adoption happen after the hook/query contract stabilizes

Cons:

- two packaging surfaces to maintain
- risk of drift if standalone and plugin variants are not generated from the same source templates

Best when:

- Ivan needs to move fast now but may later serve many repositories or teams

## Approach 3: Plugin-first distribution

Shape:

- move hook config into `hooks/hooks.json`
- distribute via project-scoped plugin install
- possibly add plugin skills and optional MCP capabilities

Pros:

- clean Claude-native distribution story
- versioned and updatable
- easier team rollout once stable
- compatible with marketplace-based installation

Cons:

- more moving parts immediately
- plugin namespacing and marketplace concerns arrive early
- less transparent than directly editing `.claude/settings.json`
- likely premature before the learnings hook surface is stable

Best when:

- Ivan is already a shared platform product, not just a repo feature
- multiple teams need the same Claude extension bundle now

## Recommendation

Recommendation: choose Approach 2.

Interpretation:

- Keep `ivan learnings install-hooks --repo ...` as the canonical near-term integration path.
- Do not package Ivan as a Claude Code plugin as the primary delivery vehicle yet.
- Start a plugin only when one of these becomes true:
  - the hook contract is stable across repositories
  - there is clear demand for multi-repo/team reuse
  - Ivan needs bundled skills/agents/MCP beyond simple repo-local hook scripts

This is the best fit with Anthropic's own guidance:

- standalone first for project-specific experimentation
- plugins once sharing and distribution matter

## Suggested Plugin Shape If We Do It

If Ivan does become a plugin, the most coherent first version is not "Ivan CLI inside a plugin" as a monolith. It is a narrow Claude-side integration package:

- plugin name: `ivan-learnings`
- `hooks/hooks.json`:
  - `UserPromptSubmit`
  - `PostToolUse` matcher `Edit|Write|MultiEdit`
  - `Stop`
- `skills/`:
  - setup/diagnostics skills
  - inspect current repo learnings skill
- optional `.mcp.json` later:
  - expose `query`, `rebuild`, or diagnostics as tools if that proves useful

Avoid in the first plugin version:

- trying to move all of Ivan's orchestration product into the plugin
- relying on plugin root `settings.json` for hook behavior
- forcing user-scope installation for something that is inherently repo-bound

## Decision Heuristics

Package Ivan as a plugin if:

- the same Claude augmentation needs to be reused across many repos
- you want marketplace installation or update flows
- you want to bundle hooks plus skills plus MCP together as one Claude extension

Do not package Ivan as the primary path yet if:

- the integration still depends on repo-local learnings state
- the hook contract is still being validated experimentally
- the simplest and most transparent behavior is still a checked-in `.claude/settings.json`

## Sources

- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
- Claude Code settings: https://code.claude.com/docs/en/settings
- Discover and install plugins: https://code.claude.com/docs/en/discover-plugins
- Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
