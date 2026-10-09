# demo-workbench · local-first

Create a demo folder and local Git repo once; let agents work on scenes instead of
rebuilding the review website. A small Node CLI renders MP4s, preserves numbered
versions and exact-output reviews, and updates the **same extracted Love gallery**.
Local-first, with explicit private tailnet sharing: no registry publication,
remote creation, agent service or public deployment.

## Quick start

With **Node >=18, npm, Git, FFmpeg and ffprobe** already installed, install once
from any directory (the repository currently requires existing Git access):

```sh
npm install --global --ignore-scripts --omit=dev --no-audit --no-fund 'git+https://github.com/EClinick/demo-workbench.git#main'
demo-workbench --version
demo-workbench doctor
demo-workbench init ./my-first-demo --duration 2
cd my-first-demo
# Optional: start your ordinary Claude session yourself, then edit src/scene.js.
npm run demo:render -- --note "First study"
npm run demo:serve
# Open http://127.0.0.1:4173. Ctrl-C stops the server.
```

**Native Windows:** in PowerShell use `npm.cmd` and `demo-workbench.cmd` for
the commands above (no execution-policy change). In cmd.exe use double quotes
around the Git URL. macOS/Linux/WSL use the shell example as written. `main` is
a moving branch; replace it with a reviewed full commit SHA to pin the install.
No registry package or release tag is assumed. See [installation](docs/installation.md)
for prerequisites, PATH/auth diagnostics, Windows examples, update/uninstall and
offline artifacts. Nothing installs OS tools or logs in for you.

With inputs (copies, never moves):

```sh
demo-workbench init ./reference-demo \
  --reference /path/to/reference.mp4 --audio /path/to/soundtrack.mp3 \
  --title "My demo"
```

Reference dimensions, rational FPS and duration are probed automatically. Optional
`--width`, `--height`, `--fps`, `--duration` override render settings. Preserve the
reference aspect by changing width and height together. Without inputs, the neutral
RGB JavaScript scene works immediately, is silent, and explicitly has no reference.
No Canvas/browser/native npm library is required for the starter. A simple custom
renderer-to-H.264-MP4 contract allows richer frameworks later without gallery edits.

### Independent generated projects

The generated project vendors the runtime CLI/gallery and has a locked,
zero-runtime-dependency package; deleting or updating the initializer installation
does not change existing demos or break rendering. Prefer its `npm run demo:*`
scripts for recurring work, not a newer global runtime. New generated CLIs also
support `--version` and read-only `doctor [--json] [--tailnet]`, but never `init`;
use the standalone installed CLI to initialize another project.
Project init checks prerequisites, runs offline `npm ci` and a one-frame renderer
smoke test, and initializes Git `main` with **no commit and no remote**. It never
changes global Git identity or Claude settings. When the caller has an effective
Git name/email (including repo-local config), init copies it into the new repo's
local config. Otherwise it warns and leaves identity unset rather than inventing
one. Its `CLAUDE.md` is task-local only.

## Workflow and commands

Inside the generated project:

```sh
npm run demo:render -- --note "What changed"     # next immutable v001, v002, …
npm run demo:compare -- v001                    # verify/locate archived packet
npm run demo:review -- v001 --file review.json  # explicit one-time review import
npm run demo:serve -- --port 4173               # loopback, public output only
npm run demo:serve -- --tailnet --port 4173     # explicit private MagicDNS URL
npm run demo:archive -- v001 /tmp/v001-bundle    # NEW private evidence bundle
```

Render builds the comparison automatically when a reference exists. Full-quality
artifacts are separate from smaller web media. Evidence records common-timeline
frame indices/timestamps, reference/candidate SHA-256s, source snapshots, Git state,
settings and tool versions. A failed renderer cannot reuse old media; per-run scratch
is retained with diagnostics and the public manifest is left unchanged. Changing
reference, offsets, FPS or source requires a **new** version, never regrading an old
video under new evidence. Old media is never overwritten. Missing reviews remain
**not judged yet**, and scores/findings are imported only for matching artifact hashes.

Run chosen critics in the ordinary Claude session, with a stated budget. There is
no critic API, scheduler, automatic quality guarantee or automatic agent launch.
The generated [README](template/README.md) documents configuration, renderer contract,
review JSON schema, alignment semantics, failure recovery and privacy in detail.

## Private tailnet access

Every generated project inherits `npm run demo:serve -- --tailnet`. Localhost
remains available and remains the default without that flag. Authenticate/connect
Tailscale yourself first; the workbench never installs it or logs in for you.

- **Native Tailscale interface:** auto mode binds additional listeners to the exact
  verified self Tailscale IPs, never `0.0.0.0`/`::` or a LAN interface.
- **WSL + Windows Tailscale:** auto mode discovers the standard Windows
  `tailscale.exe` when the Linux CLI is absent and creates one explicit private
  HTTP Serve mapping to the loopback backend. Windows `curl.exe` first verifies
  localhost forwarding reaches this exact demo. No netsh, firewall or WSL changes.
- `--tailnet-mode direct|serve` selects a mode explicitly; `--tailnet-port 19417`
  optionally differs from the local `--port`. `--tailscale PATH` selects an already
  installed CLI, including a Windows executable whose path contains spaces.

The command prints `http://<verified-self-MagicDNS-name>:<port>/` **only after a
same-machine route probe succeeds**. HTTP runs over the encrypted tailnet, not
public Funnel. Access also depends on your tailnet ACLs and client connectivity;
a same-machine check is not proof from a second device.

Occupied mappings/backend ports are refused, not replaced. Ctrl-C/SIGTERM closes
listeners and attempts cleanup of its own mapping. After a crash or refused
cleanup, run:

```sh
npm run demo:serve -- --stop-tailnet
```

See the generated [README](template/README.md#private-tailnet-serving) for the
mapping ownership, locking, external-administrator constraints and recovery rules.

## Reused gallery, not a new design

`template/site/` is extracted/generalized from approved Love source commit
`f4b701baa1030b08c677f4e6294ff8ecf777e985`, using read-only `git show`. It retains the
cool paper `#EEEEEB`, ink `#151413`, red focus/cursor system, responsive showcase,
player tabs, expandable history, synchronized two-version comparison/scrubbing,
lightbox, score display and dark-mode toggle. Titles, inputs, aspect ratios, media
paths and scores now come from one atomic manifest. The page refreshes when data
changes while idle; during playback/open reviews it offers a refresh button.

No historical scores, Love media, conversation/replay/making-of pages or font files
are shipped. No external font/network requests. System sans/mono fallbacks replace
font services. The original has no root license file; this is authorized **local
reuse**, not an open-source redistribution grant. See [NOTICE.md](NOTICE.md).

## Safety boundaries

- Refuses every existing init target, including empty directories and dangling
  symlinks. Preconditions are checked before staging. A partial failure retains
  staging/diagnostics and any partial target; there is no destructive resume mode.
- One conservative render at a time per project; no queues or parallel frame swarm.
  Rendering does not expose a server or upload anything.
- Server defaults to `127.0.0.1`; explicit tailnet access uses verified self
  addresses or a private Serve mapping. Only concrete Host/Origin authorities
  for those endpoints are accepted; forwarded hosts are never trusted. Generated
  routes retain Range/HEAD/MIME, traversal and symlink protections. Source, .git,
  raw reference inputs and private runs are never served.
- Public metadata includes render notes and imported findings. Keep secrets out of
  these fields. Archive bundles include private source/inputs: do not publish them.
- No OS installs, Wi-Fi changes, public bind/Funnel, account integrations or global
  configuration. The explicit tailnet option changes only its owned Serve mapping
  when that mode is needed. Public deployment remains out of scope.
- Use trusted local scene/renderer code; a renderer is arbitrary code you run, not
  a sandbox. Do not allow untrusted writers into a project while serving/rendering.

## Verification

```sh
npm ci --ignore-scripts
npm run check
npm test
```

The [hosted matrix](.github/workflows/test.yml) runs on real macOS/Linux/native
Windows with Node 22/24, plus Linux Node 18. It also installs the exact Git source
commit using the runner's existing short-lived read-only credential, never a
credential in a URL. WSL and its Windows localhost bridge have a separate test;
non-WSL runners explicitly skip that bridge test. No hosted check claims live
second-device access. See actual CI results for observed platform outcomes.

Tests create synthetic fixtures in isolated temporary directories and exercise:
actual isolated-prefix tarball and Git installation, native command shims,
version/aggregate read-only doctor, spaces/Unicode, upgrade/uninstall independence; source-path independence; two reference aspect/FPS
classes (4:3 at 24000/1001 and 16:9 at 60); different source/output FPS; audio mux;
new/pending/imported review states; two versions with stable old media and review
hashes; failed/non-producing render isolation; archive/export; missing dependencies
and inputs; existing/symlink-target refusal; byte-range seeking, MIME, HEAD,
loopback binding and privacy. Tailnet tests cover verified identity, direct-address
selection, generated CLI inheritance, missing/offline tools, mapping/port conflicts,
exact cleanup, overlapping lifecycle operations and Host/Origin/Range/privacy
behavior through a proxy prefix. Regression checks also cover fresh-checkout
bootstrap, runtime-only command dispatch and rejection of non-MP4 containers.
DOM-based gallery checks exercise pending scores, media selection and local-only
links/resources; they do not decode or play media.
`DEMO_KEEP_TEST_OUTPUT=1 npm test` retains the end-to-end fixture directory and
prints its path for manual inspection.

**Visual layout, interactive playback, dark mode, and real browser seeking remain
unverified** by these automated checks. DOM, HTTP, media-probe and script-syntax
checks are not substitutes for verification in a real browser.
A generated project was tested through the actual Windows Tailscale Serve route
from WSL using MagicDNS: local/tailnet HTTP 200, MP4 Range 206, private paths 404,
untrusted Host/Origin 403, and exact restoration of existing Serve configuration
on shutdown. **No second-device confirmation** was performed; tailnet client ACLs,
DNS and connectivity still need checking from the intended device.

Limits: single local process, no crash-resume automation, one review import per
version, silent comparison clips, manual temporal offsets (not optical alignment),
and a simple CPU starter rather than a high-performance 4K animation framework.
No source project or private reference files are needed at runtime or in tests.
