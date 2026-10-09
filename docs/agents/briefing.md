# Briefing rules for agents

Work on Voidbinder is split into Jira tickets and handed to subagents. Every subagent brief must be
self-contained, because the worker sees nothing else. A brief names:

- the ticket key and the goal in one or two sentences;
- the acceptance criteria;
- the relevant files, packages and interfaces;
- the constraints (fixed architecture in [ADR 0001](../adr/0001-stack.md), versions, what not to
  touch);
- how to verify the work (commands, expected results);
- what to report back.

Frontend briefs also name the concrete design patterns to avoid (for example generic hero
gradients, card grids with icon-title-text, placeholder stock imagery, inline `style=""`
attributes that break the CSP), not just "make it look good".

## Rules for every Voidbinder ticket

- Keep working until everything the ticket asks for is done, and only stop to ask when you can't go on without the user or before a risky step. When the work is done and checked, stop and report. Don't add features, tests, files, docs or refactors that weren't asked for. If you think one would help, mention it at the end instead of doing it.
- If you find a pre-existing bug or behavior the ticket doesn't mention, don't fix it in this change unless the ticket can't work without it; report it as a follow-up.
- When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done: the project's tests, type-checker, or build, or the changed command itself. A syntax-only check, or a check command that failed to start, does not count; if all that is missing is the project's declared dependencies, install them with its own package manager and lockfile, never via sudo or the system package manager. Only if no real check can run here, say which one you did not run and why instead of reporting the change as done.
- Do not end your turn with a summary that announces the next step, an offer to continue, a list of decisions that don't block the work, or a report because a milestone is done. Put status notes in the same message as your next tool call and carry on with whatever doesn't depend on the user's answer. Stop only when the ticket is done or nothing can move without the user. This does not override the need for confirmation on risky or destructive actions.
- When a step depends on a library, SDK or service from a fast-moving area (Astro, Cloudflare products, Expo, Turborepo, pnpm), check its current state in the official documentation (WebFetch / cloudflare docs MCP) before you use it. Familiarity is not a reason to skip the check.
- The repository github.com/derFrisson/Voidbinder is PUBLIC and AGPL-3.0. Never commit secrets, tokens, `.dev.vars`, `.env` files or personal data. Code, comments, commit messages, docs and PRs are in English.
- Git: work on your own branch, commit in small conventional commits (`feat(site): ...`, `chore(ci): ...`) that mention the ticket key, end every commit message with `Co-Authored-By: Claude <noreply@anthropic.com>`. Push the branch and open a PR with `gh pr create` whose title starts with the ticket key and whose body lists what was done and how it was verified. Never push to `main` directly, never merge your own PR, never force-push.
- Tooling and dependencies: always the latest stable release (check `npm view <pkg> version` and the official changelog), never an older major because it feels familiar. The only acceptable reason to stay behind is a hard incompatibility with another dependency, or pnpm's release-age policy below; name it in the report. Version numbers in a brief are context, not a ceiling.
- pnpm 12 enforces `minimumReleaseAge` (default 24 h): a version published less than a day ago is not resolved. Keep the policy (it is supply-chain protection for a public repo); when the newest release is younger than a day, give the range a floor that admits the previous release and let the lockfile pin it. Never set `minimumReleaseAge: 0` or exclude packages to get around it.
- Do not touch Jira yourself; the orchestrator updates the ticket from your report.
- Voidbinder is a separate product from Voidcom. Do not copy Voidcom's architecture (Flutter, Rust, gRPC). Other repositories in the maintainer's workspace are reference only; do not modify them.
