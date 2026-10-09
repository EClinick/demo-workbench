# demo-workbench · local v1

Create a demo folder and local Git repo once; let agents work on scenes instead of
rebuilding the review website. A small Node CLI renders MP4s, preserves numbered
versions and exact-output reviews, and updates the **same extracted Love gallery**.
Local only: no registry publication, remote creation, agent service or deployment.

## Quick start

From this repository, with **Node >=18, npm, Git, FFmpeg and ffprobe** installed:

```sh
node bin/cli.js init /tmp/my-first-demo --duration 2
cd /tmp/my-first-demo
# Optional: start your ordinary Claude session yourself, then edit src/scene.js.
npm run demo:render -- --note "First study"
npm run demo:serve
# Open http://127.0.0.1:4173. Ctrl-C stops the server.
```

With inputs (copies, never moves):

```sh
node bin/cli.js init /tmp/reference-demo \
  --reference /path/to/reference.mp4 --audio /path/to/soundtrack.mp3 \
  --title "My demo"
```

Reference dimensions, rational FPS and duration are probed automatically. Optional
`--width`, `--height`, `--fps`, `--duration` override render settings. Preserve the
reference aspect by changing width and height together. Without inputs, the neutral
RGB JavaScript scene works immediately, is silent, and explicitly has no reference.
No Canvas/browser/native npm library is required for the starter. A simple custom
renderer-to-H.264-MP4 contract allows richer frameworks later without gallery edits.

### Optional local installation (no global settings or registry)

From this repository:

```sh
install_dir=$(mktemp -d)
npm pack --pack-destination "$install_dir"
npm install --prefix "$install_dir" --offline --ignore-scripts --no-audit --no-fund \
  "$install_dir/demo-workbench-0.1.0.tgz"
"$install_dir/node_modules/.bin/demo-workbench" init /tmp/installed-demo
```

The command is locally installed at that exact path; this does **not** add it to
PATH, publish to npm, use npx, or make a global installation. No registry package
is advertised. Both direct and tarball invocation are exercised by `npm test`.
The generated project vendors the small CLI/gallery and has a locked, zero-runtime-
dependency package; deleting the initializer installation does not break rendering.
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
- Server binds `127.0.0.1`, permits only generated public routes, supports single
  byte ranges/HEAD/media types, and rejects traversal, symlink escapes and nonlocal
  Host headers. It does not serve source, .git, raw reference inputs or private runs.
- Public metadata includes render notes and imported findings. Keep secrets out of
  these fields. Archive bundles include private source/inputs: do not publish them.
- No OS installs, Tailscale/Wi-Fi changes, public bind, account integrations or global
  configuration. Off-device access/deployment is a separately authorized task.
- Use trusted local scene/renderer code; a renderer is arbitrary code you run, not
  a sandbox. Do not allow untrusted writers into a project while serving/rendering.

## Verification

```sh
npm ci --offline --ignore-scripts
npm run check
npm test
```

Tests create only synthetic fixtures in a clean temp directory and exercise:
actual tarball installation; source-path independence; two reference aspect/FPS
classes (4:3 at 24000/1001 and 16:9 at 60); different source/output FPS; audio mux;
new/pending/imported review states; two versions with stable old media and review
hashes; failed/non-producing render isolation; archive/export; missing dependencies
and inputs; existing/symlink-target refusal; byte-range seeking, MIME, HEAD,
loopback binding and privacy. `DEMO_KEEP_TEST_OUTPUT=1 npm test` retains the temp
fixture directory and prints its path for manual inspection.

Browser verification was attempted using `chrome-devtools-axi` but returned
`BRIDGE_NOT_READY` (attached CDP target gone). **Visual layout, interactive playback,
dark mode, and real browser seeking remain unverified**, despite passing HTTP,
media-probe and script-syntax checks. No browser/shared-service repair was attempted.
No second-device access was tested or promised; v1 is deliberately loopback-only.

Limits: single local process, no crash-resume automation, one review import per
version, silent comparison clips, manual temporal offsets (not optical alignment),
and a simple CPU starter rather than a high-performance 4K animation framework.
No source project or private reference files are needed at runtime or in tests.
