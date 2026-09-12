# Local Stream Browser

mi serve una semplice app che mi permette di connettermi ad una macchina via indirizzo IP fisso della rete a 192.168.1.69 e mi mostri il contenuto come un classico browser ma senza avere tutte le caratteristiche e limitazione dei browser per i blocchi firewall o altro.  se non hai capito fammi qualche domanda e ti rispondo

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4fa59025-3582-4942-96f9-46233e941997).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Desktop app (Electron)

The web app needs a running Node/Nitro server (it proxies HTTP requests to the
LAN machine and rewrites the returned HTML to strip frame-busting/CSP), so the
desktop build wraps that server in an Electron shell instead of shipping a
static site.

```sh
# macOS build (dmg + zip, arm64 + x64) — run on a Mac
npm run dist:mac

# Windows build (nsis installer + portable exe) — run on Windows
npm run dist:win
```

Artifacts land in `release/`. `npm run electron:dev` builds once and launches
the app locally without packaging, for quick testing.

Pushes to `main` (and manual runs) also trigger
[`.github/workflows/build-desktop.yml`](.github/workflows/build-desktop.yml),
which builds both platforms natively on GitHub-hosted macOS and Windows
runners (no Wine/cross-compilation) and uploads the installers as workflow
artifacts. Pushing a tag like `v1.0.0` additionally publishes them to a draft
GitHub Release.

Note: the macOS build is signed with whatever identity is available locally
(ad-hoc if none) and is **not notarized**, so Gatekeeper will warn on first
launch on another Mac (right-click → Open bypasses it). The Windows build is
unsigned, so SmartScreen may warn similarly. Add a Developer ID / code-signing
certificate later if you want to remove those warnings for other users.
