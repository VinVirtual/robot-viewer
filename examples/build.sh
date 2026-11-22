#!/usr/bin/env bash
# Rebuilds the example: both robots into examples/dist, then the video and stills in examples/media.
# Needs Chrome with WebGL (posters, verify, record) and ffmpeg (record). Takes a few minutes on a CPU.
set -euo pipefail
E="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RV="$E/../robot-viewer"
rm -rf "$E/dist"
node "$E/wren/make-meshes.mjs"
"$RV" build "$E/wren/wren.urdf" --out "$E/dist" --poses "$E/wren/poses.json" \
  --title "Wren" --alt "Wren, a small made-up desk arm with a two-finger gripper" \
  --license MIT --source "robot-viewer example (made up)"
"$RV" build "$E/so100/so100.urdf" --out "$E/dist" --name so100 --poses "$E/so100/poses.json" --orbit "-60 18" \
  --title "SO-ARM100" --alt "SO-ARM100, an open-source 3D-printed robot arm designed by The Robot Studio" \
  --license Apache-2.0 --source "github.com/TheRobotStudio/SO-ARM100 at 141aea7, Simulation/SO100 (converted)"
"$RV" verify "$E/dist"
mkdir -p "$E/media"
"$RV" record "$E/dist" wren --out "$E/media/wren-demo.mp4"
"$RV" record "$E/dist" so100 --out "$E/media/so100-demo.mp4" --theme dark
cp "$E/dist/wren.poster.png" "$E/media/wren-poster.png"
cp "$E/dist/so100.poster.png" "$E/media/so100-poster.png"
FF="$(node --input-type=module -e "const { findFF } = await import('$E/../engine/lib/env.js'); console.log(findFF())")"
"$FF" -loglevel error -y -ss 0.8 -t 6.5 -i "$E/media/wren-demo.mp4" -vf "fps=12,scale=640:-1:flags=lanczos" \
  -c:v libwebp -lossless 0 -q:v 45 -compression_level 6 -loop 0 -an "$E/media/wren-preview.webp"
echo "example rebuilt: $E/dist and $E/media"
