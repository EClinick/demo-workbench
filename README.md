# demo-workbench

A local CLI for rendering video demos, keeping numbered versions, and reviewing
outputs in a browser gallery. Each render preserves its source, media and hashes;
reviews refer to that exact output.

## Install

Requires Node.js 18+ (22 or 24 LTS recommended), npm, Git 2.28+, and FFmpeg/ffprobe
with libx264, AAC and drawtext. Install these yourself; see
[prerequisites and platform setup](docs/installation.md#prerequisites).

```sh
npm install -g @eclinick/demo-workbench@0.2.0
demo-workbench doctor
```

The published npm release is **0.2.0**. `main` includes a newer comparison-audio
fix: new comparison clips use the candidate soundtrack; the published release
produces silent comparisons. To use that fix, install from
[Git source](docs/installation.md#git-source-alternative). Both currently report
version 0.2.0, so the version string alone does not distinguish them.

In PowerShell, use `npm.cmd` and `demo-workbench.cmd`; no execution-policy change
is needed. The unscoped npm package `demo-workbench` is unrelated.

## Quick start

```sh
demo-workbench init ./my-demo --duration 2
cd my-demo
# Edit src/scene.js, then render:
npm run demo:render -- --note "First version"
npm run demo:serve
```

Open the URL printed by `serve`; `http://127.0.0.1:4173` is the default, not a
required port. Choose another available port or enable private tailnet viewing:

```sh
npm run demo:serve -- --port 4180
# Alternatively, with Tailscale installed, signed in and MagicDNS enabled:
npm run demo:serve -- --tailnet --port 4180
```

For tailnet viewing, open the printed **Tailnet gallery** URL on a connected device
permitted by your Tailscale ACLs. Keep the server running while viewing; Ctrl-C
stops it. This does not expose a public or LAN site. See
[tailnet setup and cleanup](template/README.md#private-tailnet-serving).

To start with inputs, add `--reference /path/to/reference.mp4` and
`--audio /path/to/soundtrack.mp3` to `init`. Inputs are copied, not moved.
The destination must not already exist.

Use the project's `npm run demo:*` scripts for subsequent work. Generated projects
keep a frozen runtime: updating or uninstalling the global CLI does not change
them. Rendered versions are immutable; existing projects and silent comparison
archives are not automatically upgraded.

## Documentation and safety

- [Project guide](template/README.md): rendering, comparison, reviews, archives,
  configuration and custom renderers.
- [Installation guide](docs/installation.md): Windows/WSL setup, diagnostics,
  Git-source installs, updates and uninstalling.
- [Private tailnet serving](template/README.md#private-tailnet-serving): optional
  Tailscale access and cleanup. Serving defaults to localhost; rendering uploads
  nothing. Public deployment is not supported.
- [Privacy and recovery](template/README.md#failures-preservation-and-privacy):
  only gallery outputs are served. Notes and review findings are public metadata;
  archive bundles contain private source and inputs. Run only trusted renderer
  code—it is not sandboxed.
- [NOTICE](NOTICE.md): gallery provenance and licensing limits. Public source
  availability does not grant an open-source license.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm test
```

[CI](.github/workflows/test.yml) covers Linux, macOS and native Windows on Node
22/24, plus Linux on Node 18. Browser playback and access from a second tailnet
device require manual verification.
