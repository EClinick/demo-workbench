# demo-workbench · local-first

Set up a demo folder and a local Git repo once, then let agents iterate on scenes
instead of rebuilding the review site every time. A small Node CLI renders MP4s,
keeps every version numbered, ties each review to the exact output it judged, and
updates the **same gallery extracted from Love**.

Everything runs on your machine. You can share it privately over your tailnet if
you ask for that. Your demos are never published to a registry, deployed publicly,
or handed to a hosted agent service by the workbench.

## Quick start

Install the [prerequisites](docs/installation.md#prerequisites) first. Then
install once from any directory.

**Upcoming npm release:** the scoped package below is prepared for publication,
not yet published. Until it is available, use the
[public Git-source alternative](docs/installation.md#git-source-alternative).

```sh
npm install -g @eclinick/demo-workbench
demo-workbench --version
demo-workbench doctor
demo-workbench init ./my-first-demo --duration 2
cd my-first-demo
# Optional: start your usual Claude session yourself, then edit src/scene.js.
npm run demo:render -- --note "First study"
npm run demo:serve
# Open http://127.0.0.1:4173. Ctrl-C stops the server.
```

**Windows:** in PowerShell, use `npm.cmd` and `demo-workbench.cmd` (no
execution-policy change needed). cmd.exe, macOS, Linux, and WSL can run the
commands as written.

The npm package is **`@eclinick/demo-workbench`**; the executable stays
**`demo-workbench`**. The unscoped npm name belongs to an unrelated project.
[Installation](docs/installation.md) covers version pinning, prerequisites, PATH
problems, Windows examples, updating, uninstalling, Git-source and offline
alternatives. The installer never installs OS tools or logs you in to anything.

To start from a reference video and soundtrack (they're copied, not moved):

```sh
demo-workbench init ./reference-demo \
  --reference /path/to/reference.mp4 --audio /path/to/soundtrack.mp3 \
  --title "My demo"
```

Init reads the reference's dimensions, FPS (as a fraction), and duration. Override
them with `--width`, `--height`, `--fps`, and `--duration`. Change width and height
together to keep the reference's aspect ratio.

Without inputs, you get a silent starter scene in plain JavaScript that renders
right away. It doesn't need Canvas, a browser, or any native npm library. When you
want a richer framework, any renderer that outputs H.264 MP4 plugs in without
touching the gallery.

### Each project stands on its own

A generated project carries its own copy of the CLI and gallery, with a locked
package and no runtime dependencies. Updating or deleting the global install
won't change or break existing demos. For day-to-day work, use the project's
`npm run demo:*` scripts rather than a newer global CLI. The project's CLI also
supports `--version` and read-only `doctor [--json] [--tailnet]`, but not `init`.
Use the global CLI to create new projects.

When you run init, it:

- checks prerequisites
- runs an offline `npm ci` and renders one test frame
- creates a Git repo on `main` with **no commits and no remote**
- copies your Git name and email into the repo's local config if you have them set
  (including repo-local config). If you don't, it warns and leaves them unset
  rather than making something up.

It never touches your global Git identity or Claude settings. The project's
`CLAUDE.md` only covers that project.

## Workflow and commands

Inside a generated project:

```sh
npm run demo:render -- --note "What changed"     # next immutable v001, v002, …
npm run demo:compare -- v001                    # verify/locate archived packet
npm run demo:review -- v001 --file review.json  # one-time review import
npm run demo:serve -- --port 4173               # localhost, public output only
npm run demo:serve -- --tailnet --port 4173     # private MagicDNS URL
npm run demo:archive -- v001 ../v001-bundle     # new private evidence bundle
```

If there's a reference, render builds the side-by-side comparison automatically.
Full-quality files are kept separate from the smaller web copies.

Each version records its evidence: frame indices and timestamps on a shared
timeline, SHA-256 hashes of the reference and the render, a snapshot of the
source, Git state, settings, and tool versions.

Versions are immutable:

- A failed render can't reuse old media. Its scratch folder is kept with
  diagnostics, and the public manifest stays as it was.
- Changing the reference, offsets, FPS, or source means a **new** version. An old
  video is never re-graded against new evidence, and old media is never overwritten.
- A version with no review shows as **not judged yet**. Scores and findings only
  import if they match the artifact's hashes.

Critics run in your normal Claude session, on a budget you set. There's no critic
API, scheduler, auto-launched agent, or quality guarantee. The generated
[README](template/README.md) goes deep on configuration, the renderer contract, the
review JSON schema, alignment, failure recovery, and privacy.

## Private tailnet access

Every generated project gets `npm run demo:serve -- --tailnet`. Without the flag,
it serves on localhost only, and localhost stays available with it. Set up and
log in to Tailscale yourself first. The workbench never installs it or signs you in.

- **Native Tailscale:** auto mode adds listeners on your machine's verified
  Tailscale IPs only, never `0.0.0.0`, `::`, or a LAN interface.
- **WSL with Tailscale on Windows:** if the Linux CLI is missing, auto mode finds
  the standard Windows `tailscale.exe` and creates one private HTTP Serve mapping
  to the localhost backend. It uses Windows `curl.exe` to confirm localhost
  forwarding reaches this demo first. It doesn't change netsh, the firewall, or WSL.
- `--tailnet-mode direct|serve` picks the mode. `--tailnet-port 19417` uses a
  different port from `--port`. `--tailscale PATH` points at a CLI you already
  have, including a Windows path with spaces.

The tailnet URL (`http://<your-MagicDNS-name>:<port>/`) only prints **after a
probe from the same machine succeeds**. Traffic is HTTP inside the encrypted
tailnet, not public Funnel. Whether another device can reach it still depends on
your ACLs and that device's connection; a check from the same machine doesn't
prove it.

If a mapping or backend port is already taken, the command refuses instead of
replacing it. Ctrl-C or SIGTERM closes the listeners and tries to remove the
mapping it created. If it crashed or couldn't clean up, run:

```sh
npm run demo:serve -- --stop-tailnet
```

The generated [README](template/README.md#private-tailnet-serving) covers mapping
ownership, locking, admin-managed setups, and recovery.

## The gallery is reused from Love

`template/site/` is pulled from approved Love commit
`f4b701baa1030b08c677f4e6294ff8ecf777e985` (read-only `git show`) and generalized.
It keeps the paper `#EEEEEB` and ink `#151413` colors, the red focus and cursor,
the responsive showcase, player tabs, expandable history, synced side-by-side
comparison and scrubbing, lightbox, scores, and dark mode. Titles, inputs, aspect
ratios, media paths, and scores now all come from one manifest that's written
atomically. The page refreshes itself when data changes while idle. If something's
playing or a review is open, it shows a refresh button instead.

It ships without Love's old scores, media, conversation, replay, or making-of
pages, and without font files. It makes no external font or network requests and
falls back to system sans and mono fonts. Love has no license file, so this is
authorized **local reuse**, not an open-source license. See [NOTICE.md](NOTICE.md).

## Safety boundaries

- Init refuses any target that already exists, including empty directories and
  broken symlinks. It checks preconditions before staging. If it fails partway,
  it keeps the staging folder, diagnostics, and whatever it created. There's no
  resume mode that could delete things.
- One render at a time per project. No queues, no parallel frame workers.
  Rendering never starts a server or uploads anything.
- The server binds to `127.0.0.1` by default. With `--tailnet`, it only uses your
  verified Tailscale addresses or a private Serve mapping. It only accepts Host
  and Origin values for those exact endpoints and never trusts forwarded hosts.
  Routes keep Range, HEAD, MIME, path traversal, and symlink protections. Source,
  `.git`, raw reference inputs, and private runs are never served.
- Render notes and imported findings are public metadata, so keep secrets out of
  them. Archive bundles include your private source and inputs. Don't publish them.
- No OS installs, Wi-Fi changes, public binding or Funnel, account integrations,
  or global config changes. With `--tailnet`, the only thing it changes is its own
  Serve mapping, and only in serve mode. Public deployment is out of scope.
- A renderer is arbitrary code that you run, not a sandbox. Only use scene and
  renderer code you trust, and don't let untrusted people write to a project
  while it's serving or rendering.

## Verification

```sh
npm ci --ignore-scripts
npm run check
npm test
```

The [CI matrix](.github/workflows/test.yml) runs on real macOS, Linux, and native
Windows with Node 22 and 24, plus Linux on Node 18. It also installs from the exact
Git commit using the runner's short-lived read-only credential, never a credential
in a URL. WSL's Windows localhost bridge has its own test, which other runners skip.
No CI check covers access from a second device. Check the actual CI runs for
per-platform results.

Tests build synthetic fixtures in isolated temp directories and cover:

- installing from a tarball and from Git into an isolated prefix, native command
  shims, `--version` and read-only `doctor`, paths with spaces and Unicode, and
  upgrading or uninstalling without breaking existing projects
- two reference shapes (4:3 at 24000/1001 FPS and 16:9 at 60), different source
  and output FPS, and audio muxing
- new, pending, and imported review states; two versions with stable old media
  and review hashes; failed renders that produce nothing
- archive and export, missing dependencies and inputs, refusing existing or
  symlinked targets
- byte-range seeking, MIME, HEAD, localhost binding, and privacy
- tailnet: verified identity, picking direct addresses, the generated CLI
  inheriting the flag, missing or offline tools, mapping and port conflicts, exact
  cleanup, overlapping start and stop, and Host/Origin/Range/privacy behind a
  proxy prefix
- fresh-checkout bootstrap, runtime-only command dispatch, and rejecting non-MP4
  containers
- DOM checks on the gallery for pending scores, media selection, and local-only
  links (they don't decode or play media)

`DEMO_KEEP_TEST_OUTPUT=1 npm test` keeps the end-to-end fixture folder and prints
its path so you can poke at it.

**Not verified by the automated tests:** visual layout, playback, dark mode, and
seeking in a real browser. DOM, HTTP, media-probe, and syntax checks don't replace
trying it in a browser.

One generated project was tested by hand through the real Windows Tailscale Serve
route from WSL over MagicDNS. Local and tailnet requests returned 200, MP4 range
requests 206, private paths 404, and untrusted Host/Origin 403, and the existing
Serve config was restored exactly on shutdown. It was **not tested from a second
device**, so check ACLs, DNS, and connectivity from the device you plan to use.

**Limits:** one local process, no automatic crash recovery, one review import per
version, silent comparison clips, manual time offsets (no optical alignment), and a
simple CPU starter scene rather than a fast 4K animation framework. Nothing from a
source project or private reference files is needed at runtime or in tests.
