# Installation, diagnostics and updates

The CLI uses npm's ordinary `bin` mechanism. There is no bootstrap service,
postinstall hook, OS installer, registry package, or automatic authentication.
The current package version is **0.2.0**; `demo-workbench --version` reports what
is actually installed. This repository is currently private. Future public
access will use the same Git installation mechanism without the private-access
prerequisite; npm publication and redistribution rights are separate work.

## Prerequisites

- **Node >=18 and npm**; use a supported Node LTS (22/24 recommended). Node 18
  compatibility is tested, not a recommendation to install an end-of-life Node.
- **Git** with `git init -b` support (2.28+), and existing Git access to this
  repository for Git-source installation. Your Git credentials/SSH configuration
  must already work; a browser or agent's GitHub login is not necessarily Git
  authentication. No credentials belong in the URL or a saved command.
- **FFmpeg and ffprobe** on PATH, including **libx264, AAC and drawtext**. The
  comparison labels use an existing system font (Arial on Windows/macOS,
  DejaVu Sans on common Linux systems), falling back to FFmpeg font lookup.
  Current Homebrew's minimal `ffmpeg` formula omits drawtext: use a build with
  that capability, such as `ffmpeg-full`, and put its `bin` directory on your PATH
  (`brew --prefix ffmpeg-full` locates it). CI selects that keg explicitly rather
  than silently using the minimal build. On Windows the tested Chocolatey
  `ffmpeg`/Gyan essentials build includes the required capabilities.
  No fonts or external tools are bundled/downloaded. Install prerequisites
  yourself through sources you trust; the workbench does not run sudo or an OS
  package manager. FFmpeg is needed for init/render, not the npm installation.
- A writable npm global prefix with its executable directory on PATH. This is
  the current Node installation's prefix, not necessarily the system prefix.
- **Optional:** an installed, connected Tailscale client with self MagicDNS for
  explicit `--tailnet` use. Local rendering/serving never requires Tailscale.

## Install once

One command, from any directory; no persistent source checkout is needed.
The `main` branch below is moving source, **not** a published release/tag.
For a reproducible or reviewed installation, replace `#main` with the approved
full commit SHA. Do not assume a `v0.2.0` Git tag or npm package exists.

**macOS, Linux and WSL (sh/bash/zsh):**

```sh
npm install --global --ignore-scripts --omit=dev --no-audit --no-fund 'git+https://github.com/EClinick/demo-workbench.git#main'
demo-workbench --version
demo-workbench doctor
```

**Native Windows PowerShell:**

```powershell
npm.cmd install --global --ignore-scripts --omit=dev --no-audit --no-fund 'git+https://github.com/EClinick/demo-workbench.git#main'
demo-workbench.cmd --version
demo-workbench.cmd doctor
```

The `.cmd` spelling avoids PowerShell blocking npm's `.ps1` shim. Do not change
execution policy to use this tool. **Native cmd.exe:** use the same commands
with double quotes instead of single quotes around the Git URL; `npm` and
`demo-workbench` resolve their `.cmd` shims automatically.

If your existing Git authentication is SSH, substitute
`git+ssh://git@github.com/EClinick/demo-workbench.git#main` (or a pinned SHA).
An authentication error is not an invitation for the tool to log you in or
modify Git configuration. No `npx demo-workbench` shortcut is advertised:
there is no registry package whose ownership this project can assume.

### If the command is not found or the prefix is unwritable

Run `npm prefix -g` (`npm.cmd prefix -g` in PowerShell). Executables are in
`<prefix>/bin` on macOS/Linux/WSL and directly in `<prefix>` on Windows. Inspect
`command -v demo-workbench` on POSIX, `Get-Command demo-workbench.cmd` in
PowerShell, or `where demo-workbench` in cmd.exe. Ensure your user-managed Node/npm
installation supplies a writable prefix and that executable directory on PATH.
Do not run the installation with sudo or change global configuration blindly.
The workbench never edits shell startup files, PATH, npm settings, or accounts.
Switching Node installations/version-manager versions can select another prefix;
reinstall under the intended Node installation rather than keeping a worktree link.

## Daily use

Run from an existing parent directory; choose a **new** destination each time:

```sh
demo-workbench init ./my-demo --duration 2
cd my-demo
npm run demo:render -- --note "Initial study"
npm run demo:serve
```

In PowerShell use `demo-workbench.cmd` and `npm.cmd` in these examples. The same
project commands work in cmd.exe. Quote paths containing spaces/Unicode. For
example, `demo-workbench.cmd init ".\demo study" --reference "C:\Videos\ref.mp4"`.
On macOS/Linux/WSL use the shell's own filesystem paths. Use WSL's Linux Node/npm,
Git and FFmpeg for WSL projects; do not mix a Windows npm installation into a
Linux PATH. Native Windows is a separate environment, not a WSL synonym.

Init checks all required tools before staging, copies inputs, validates its
zero-runtime-dependency lockfile offline, smoke-renders one frame, and creates a
new local Git repository with no commit or remote. An effective caller identity
is copied only into that project's local Git config; missing identity is a
warning. A failed init retains diagnostics and never deletes an existing target.

Use **project-local `npm run demo:*` scripts** for recurring render, comparison,
review, archive and serving. They invoke the project's frozen `.workbench`
runtime. New projects also support:

```sh
node .workbench/bin/cli.js --version
node .workbench/bin/cli.js doctor --json
```

The globally installed CLI can operate on projects, but doing so selects the
global runtime, not the frozen one. Do not substitute it for the local scripts
when updating the initializer or reproducing older evidence. Generated runtime
commands intentionally do not include `init`.

## Doctor is read-only

`demo-workbench doctor` aggregates Node/npm/Git/FFmpeg/ffprobe versions and paths,
FFmpeg capability listings and Git identity availability. It reports all checks,
not just the first failure. `--json` returns the same machine-readable report.
Exit **0** means required checks passed (warnings may remain); **1** means a
required check or argument failed. Missing Git identity and an unknown default
font are warnings. Each external probe has a five-second timeout and bounded
output. npm on Windows is run via its standard `npm-cli.js` beside `npm.cmd`,
without shell interpolation. Nonstandard npm batch-only wrappers are diagnosed;
use a standard Node/npm installation. Custom batch renderers should instead use
an executable, or `node` with a script argument; arbitrary shell text is not run.

Only explicit `doctor --tailnet` requires Tailscale. It reads version, status,
self identity/MagicDNS and Serve help; it never logs in, starts a listener,
creates a route or changes network settings. `--tailscale PATH` selects an
already installed client and requires `--tailnet`. Discovery uses PATH first,
then standard Windows/macOS application locations; WSL can discover Windows
`C:\Program Files\Tailscale\tailscale.exe` through its usual mount.

A successful doctor is **not** a render, font, route, ACL or second-device test.
Init supplies the one-frame renderer test; a reference render also exercises
comparison labels. Explicit serving supplies its own route probe:

```sh
npm run demo:serve -- --tailnet
# Ctrl-C stops listeners and cleans up only the owned mapping.
# After a crash, from the SAME generated project:
npm run demo:serve -- --stop-tailnet
```

On WSL, working Windows localhost forwarding and `curl.exe` are also needed for
the Serve bridge. No WSL/netsh/firewall repairs are automatic. Never use Funnel
or `tailscale serve reset` as installation/recovery advice. Second-device tailnet
access depends on your existing ACLs/client connectivity and needs its own test.

## Update and uninstall

To update, repeat the **same install command** with `#main` or a newly reviewed
commit SHA, then check `--version` and `doctor`. To pin/roll back, specify the
older reviewed SHA explicitly. Do not rely on `npm update -g demo-workbench` to
track Git releases as if this were a registry channel.

Uninstall with `npm uninstall --global demo-workbench` (`npm.cmd` in PowerShell),
using the original npm prefix. Stop any serving process/owned route first.
Uninstall removes the package/bin, **not** demos, media, Git repositories or
Tailscale routes. Updating/removing the initializer never rewrites existing
projects. Each generated project records its generator version in `demo.json`
and frozen runtime metadata in `.workbench/package.json`. Old projects stay on
their original runtime; no silent migration or automatic runtime updater exists.

## Offline/local artifact alternative

From a trusted source checkout, `npm pack --ignore-scripts` produces
`demo-workbench-0.2.0.tgz`. Install that artifact with:

```sh
npm install --global --offline --ignore-scripts --omit=dev --no-audit --no-fund ./demo-workbench-0.2.0.tgz
```

Use `npm.cmd` in PowerShell. Package version changes change the filename. This
is a real packaged copy, not `npm link` or a global directory dependency that
can break when a disposable checkout is removed. Keep NOTICE with the artifact;
private local installation is not permission to redistribute it publicly.

## Platform verification

The hosted workflow runs **real macOS, Linux and native Windows** installations
on Node 22/24, plus Linux Node 18 compatibility. It provisions runner-only
FFmpeg, installs tarballs and pinned Git sources into isolated prefixes/caches,
invokes the real npm command shim (PowerShell and cmd.exe on Windows), checks
version/doctor, initializes space/Unicode paths, renders/serves synthetic media,
and exercises updates/uninstall without changing generated runtime/evidence.
All existing runtime, privacy and tailnet ownership regressions run there too.

WSL is checked separately on a WSL host: the Windows `curl.exe` loopback bridge
test is skipped on non-WSL runners, not counted as a native Windows substitute.
Tailscale mutation tests use local client fixtures, never the runner's/shared
network configuration. Hosted green checks are not browser-playback or live
second-device tailnet verification. Consult the actual commit's CI results,
not this workflow description, for observed pass/fail status.
