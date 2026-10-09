# Your demo workbench

A self-contained local project: edit a scene, render it, compare/review the exact
output, inspect the same reusable gallery. No dependency on the initializer's
installation path and no npm runtime dependencies. Requires Node >=18, npm, Git,
FFmpeg/ffprobe with libx264, AAC and drawtext. Nothing installs OS packages.
`npm ci --offline --ignore-scripts` validates the supplied zero-dependency lockfile.

## Everyday commands

```sh
# Edit src/scene.js and demo.json first (the neutral starter already works).
npm run demo:render -- --note "First motion study"
npm run demo:compare -- v001
npm run demo:serve                      # http://127.0.0.1:4173
npm run demo:serve -- --port 4180        # optional loopback port
npm run demo:serve -- --tailnet          # explicit private MagicDNS access
# After preparing a review, as described below:
npm run demo:review -- v001 --file review.json
npm run demo:render -- --note "Revise the transition"  # v002; v001 unchanged
npm run demo:archive -- v001 /tmp/my-demo-v001-bundle # NEW external folder
```

`render` assigns the next number; optional `--version v001` asserts that number,
not an overwrite permission. With a reference, comparison MP4 + aligned PNG pairs
are built as part of the successful render. `compare` verifies and returns that
immutable packet, and refreshes the gallery; it never re-aligns an old version
against a changed reference/config. Without a reference, it reports its absence.
`archive` copies the complete private run bundle (source, inputs, full quality,
web preview, packet, manifest and imported review) to a new directory.

No automatic commits, remote repositories, agents, browser, or servers are started
by init/render. Git starts on `main`, without an initial commit. Use your normal
Git identity/workflow when ready. Init copies a configured caller name/email into
this repo's local config, never global settings. If no caller identity existed,
init reported that it remains unset; configure a local identity before committing.
Media and scratch are ignored, not disposable.

## Files and configuration

- `demo.json`: title/description, input paths, dimensions, rational FPS, duration,
  renderer command, comparison offsets/sample count and review target/budget.
- `src/`, `assets/`: editable creative source, copied and hashed per run.
- `reference/`: copied originals (never moved). `inputs.*.facts/sha256` record intake;
  the run re-probes/re-hashes the actual input, so later edits cannot masquerade as
  the original. To add inputs, set `inputs.reference: {"path":"reference/ref.mp4"}`
  and/or `inputs.audio: {"path":"reference/music.wav"}`. Paths stay project-relative.
- `runs/v001/`: immutable media, source/input snapshots, manifest, and optional
  one-time `review.json`. New iterations always get a new directory.
- `site/`: approved extracted gallery/theme. Agents do not rebuild it per scene.
- `public/`: only gallery, manifest and explicitly selected media. It contains
  render notes and imported review findings, but not raw source or transcripts.
- `.workbench/`: vendored CLI, per-run scratch, an exclusive render lock, and an
  ignored `tailnet.json` ownership record while a private Serve mapping exists.

FPS accepts a rational such as `24000/1001` or `60`; dimensions must be even.
Reference-driven init uses actual reference dimensions/FPS/duration by default.
For faster creative iteration, lower both dimensions proportionally in demo.json.
The gallery needs no edits for 4:3, 16:9, portrait, or FPS changes. The RGB starter
is deliberately simple, single-threaded and not optimized for long 4K renders.
Web previews cap width at 960; full-quality render downloads remain available.
Comparisons default to 480 pixels per panel, preserve proportions with padding,
and are silent, explicitly labelled Reference/Candidate. Only candidate render
playback uses the supplied audio (reference audio is not implicitly adopted).
Audio is padded/trimmed to the configured duration. Without --audio, renders are silent.

### Renderer-to-MP4 contract

Default: `node src/render.js OUTPUT.mp4 CONFIG.json`. Configure `renderer.command`
and `renderer.args` (an argv array, no shell) with standalone `{output}` and
`{config}` placeholders. It runs from the project root with
`DEMO_RENDER_WORKERS=1`. Agents may use another installed/local renderer; list and
lock its own dependencies in package.json if needed. The workbench never installs
new renderer dependencies silently.

Write a fresh **silent H.264/yuv420p MP4** at the supplied absolute output path;
exit nonzero on failure. Use demo.json's `video.width`, `height`, `fps`, `duration`.
Never reuse a shared output or run directory. The workbench validates dimensions,
codec, FPS, duration and absent audio, then muxes the configured soundtrack itself,
probes again, makes a small web encode and snapshots provenance. Source must stay
unchanged during the run. Custom code/dependencies outside src/assets should be
moved into those trees for snapshotting; tool dependencies are not bundled in runs.

### Alignment and judging

`comparison.referenceStart` and `candidateStart` are nonnegative seconds (default
0). Original timestamps are reset, decoded frames are trimmed, the requested
offset is subtracted, and both streams are resampled onto the configured **same
zero-based rational FPS grid** before identical frame indices are sampled. The
shorter remaining timeline sets comparison duration. The packet records offsets,
normalized indices, nominal source sample times, input/output and comparison hashes.
Nominal requests are quantized to decoded source frames (up to one source-frame
interval); they are not a claim that an input contains a frame at every requested
time. This is deterministic temporal alignment, not optical/content matching.
Nonzero offsets and variable-rate sources still need human verification.
Changing offsets requires a new render/version. No stale frame-number pairing.

Run your chosen critics in the ordinary Claude session against the archived full
render/comparison/PNG pairs. Use demo.json's target, rubric and round budget as
instructions, not a promise or automatic stopping/agent service. There is no critic
API integration. Scores are subjective and may not be comparable across rubrics.
Copy `outputSha256` and `packetSha256` from `runs/v001/manifest.json`:

```json
{
  "version": "v001",
  "outputSha256": "<exact outputSha256 from manifest>",
  "packetSha256": "<exact packetSha256, or JSON null without a reference>",
  "rubric": "Timing, motion and visual fidelity",
  "critics": [
    { "name": "Motion", "model": "your chosen model", "score": 7.5,
      "findings": "The second transition starts too late." }
  ]
}
```

Scores must be finite numbers 0–10. The mean is computed, not trusted from input.
Missing reviews show **not judged yet**. Wrong-version/hash imports fail. One
review per version is accepted; it cannot be overwritten by rerunning import.
New outputs never inherit old grades. Only import findings suitable for the gallery.

## Private tailnet serving

Localhost is the default. To deliberately share the same output-only gallery with
connected tailnet devices:

```sh
npm run demo:serve -- --tailnet --port 4173
# Optional different tailnet port, avoiding another service's existing mapping:
npm run demo:serve -- --tailnet --port 4173 --tailnet-port 19417
# Choose native private Serve explicitly, or require direct interface binding:
npm run demo:serve -- --tailnet --tailnet-mode serve
npm run demo:serve -- --tailnet --tailnet-mode direct
# Nonstandard installation / explicit Windows Tailscale from WSL:
npm run demo:serve -- --tailnet --tailscale '/mnt/c/Program Files/Tailscale/tailscale.exe'
```

Install and authenticate Tailscale yourself; its backend must be running, its self
node online, and MagicDNS enabled. No login/OS installation happens automatically.
Auto mode binds exact Tailscale self IPs when they are assigned to this OS, otherwise
uses supported `tailscale serve --bg --http=PORT TARGET` to forward privately to the
loopback server. It never invokes Funnel, resets Serve, binds all interfaces or
opens your LAN/firewall. `--tailnet-mode direct` refuses when no verified local
Tailscale address exists. Direct mode creates no persistent Tailscale mapping.

On WSL without native Tailscale, the standard Windows Tailscale executable is
found automatically. This mode needs Windows `curl.exe` at its standard path and
working WSL localhost forwarding. The tool verifies Windows can reach this exact
WSL server before creating the mapping. If forwarding is unavailable or a Windows
service owns that loopback port, it fails without trying to fix networking. No
Linux Tailscale install or hardcoded WSL IP is required.

A successful start prints a usable `http://<self-name>.<tailnet>.ts.net:PORT/` URL
and keeps `http://127.0.0.1:LOCAL_PORT/` working. HTTP is protected in transit by
Tailscale's encrypted network, not browser HTTPS. Only exact verified self DNS/IP
Host authorities (with their actual ports) and matching Origin values are allowed;
`X-Forwarded-Host` cannot grant access. Tailnet membership/ACL policy remains your
Tailscale configuration. The startup probe runs on this machine; test the link,
seeking and audio on the intended second device before claiming delivery there.

**Ownership and stopping.** Existing mappings (including foreground/service or
Funnel entries) and occupied ports are refused, never taken over. Serve mappings
use a unique backend URL prefix and persist exact node/port/target ownership in
`.workbench/tailnet.json`. Cooperating workbench projects also hold an exclusive
per-node/port lease file under the OS temporary directory. This is not a daemon.
Do not delete these records or reuse ports while a mapping is live.

Ctrl-C/SIGTERM removes only the exact owned Serve mapping and closes all listeners.
After a crash or forced termination, use:

```sh
npm run demo:serve -- --stop-tailnet
# Add --tailscale PATH when necessary to select the original client/node.
```

This removes the mapping, ownership record and matching lease, not other services.
It does not kill another process; a still-running local server stops with its own
Ctrl-C. Direct bindings disappear when their process stops, with no mapping to
clean. Cleanup refuses if the node, target, handlers or Funnel state no longer
match the record; inspect the diagnostic and existing Tailscale status rather
than resetting shared configuration. Missing/offline tools leave ownership data
for a later safe cleanup. A stale route cannot reach a different workbench process
because each proxy target includes its own instance prefix.

The native Tailscale CLI has no cross-administrator atomic reservation interface.
The workbench's lease prevents its own cooperating projects racing, but external
administrators must not change Serve mappings during startup/cleanup. No other
services' settings are restored from a snapshot or overwritten. Public deployment
is not supported by these options.

### Failures, preservation and privacy

Every render uses fresh scratch and one project-wide lock. Nothing updates the
public manifest until all new artifacts validate. On failure inspect the printed
scratch path/ERROR.txt; fix source and retry. Scratch is deliberately retained.
If a run was archived before a publication failure, its number remains reserved;
`compare VERSION` verifies it and retries publication. No partial success is
reported as a complete render. If a process is killed, inspect for running work
before manually removing `.workbench/operation.lock`; there is no resume daemon.
Do not edit run/public files to get around integrity failures.

Serving defaults to **127.0.0.1**, with deliberate private tailnet access as described
above. Both modes support GET/HEAD and single byte ranges, and only allow generated
gallery/media routes. No directory listing, source, .git, reference originals, raw
packets, archives, symlinks or traversal. Do not expose the unauthenticated backend
publicly. Wi-Fi/public deployment and unrelated network changes are not included.
See NOTICE.md for extraction provenance and local-use licensing limits.
