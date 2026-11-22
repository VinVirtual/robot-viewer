#!/usr/bin/env bash
# Checks what robot-viewer needs and prints how to fix anything missing. Tested on Linux only.
#   Required for `build`: Node.js 20+, and the npm packages in package.json (npm ci).
#   Optional: Playwright + Chrome/Chromium with WebGL (posters, `verify`, `record`), ffmpeg (`record`).
# Overrides: PLAYWRIGHT_CORE (folder of playwright-core), ROBOT_VIEWER_CHROME (browser binary), FF (ffmpeg binary).
R="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ok=1
good() { echo "ok   $1"; }
miss() { ok=0; echo "MISS $1"; shift; for line in "$@"; do echo "       $line"; done; }
opt() { echo "opt  $1"; shift; for line in "$@"; do echo "       $line"; done; }

if ! command -v node >/dev/null 2>&1; then
  miss "node (version 20 or newer)" "install Node.js from https://nodejs.org, or with nvm or brew"
  echo "something is missing: fix the MISS lines above and run this again"; exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -ge 20 ] 2>/dev/null; then good "node $(node -v)"; else miss "node 20 or newer (found $(node -v))" "update Node.js"; fi

tmp="$(mktemp)"
if (cd "$R" && node -e "
  const need = ['three','@gltf-transform/core','@gltf-transform/functions','@gltf-transform/extensions','meshoptimizer','esbuild','@xmldom/xmldom','sharp'];
  Promise.all(need.map((n) => import(n).then(() => null, (e) => n + ': ' + String(e.message).split('\n')[0]))).then((r) => { r = r.filter(Boolean); if (r.length) { console.error(r.join('\n')); process.exit(1) } })
" 2>"$tmp"); then good "npm packages (three, gltf-transform, meshoptimizer, esbuild, xmldom, sharp)"
else miss "npm packages" "cd \"$R\" && npm ci" "$(head -3 "$tmp")"; fi
rm -f "$tmp"

if out="$(cd "$R" && node --input-type=module -e "
  const { launchBrowser } = await import('./engine/lib/env.js');
  const b = await launchBrowser(); const p = await b.newPage();
  const gl = await p.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) });
  console.log(b.version() + (gl ? ' with WebGL' : ' WITHOUT WebGL')); await b.close(); if (!gl) process.exit(2)
" 2>&1)"; then good "browser: $out (posters, verify, record)"
else opt "no browser with WebGL: posters, \`verify\` and \`record\` are skipped (the build still works)" \
  "npm i -g playwright-core   (then, if no Chrome is installed: npx playwright-core install chromium)" \
  "$(echo "$out" | head -2)"; fi

if out="$(cd "$R" && node --input-type=module -e "const { findFF } = await import('./engine/lib/env.js'); console.log(findFF())" 2>&1)"; then good "ffmpeg ($out) (record)"
else opt "no ffmpeg: \`record\` is unavailable" "install ffmpeg (apt install ffmpeg / brew install ffmpeg), or pip install imageio-ffmpeg, or set FF=/path/to/ffmpeg"; fi

if [ $ok = 1 ]; then echo "all good"; else echo "something is missing: fix the MISS lines above and run this again"; exit 1; fi
