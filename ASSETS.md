# Third-party material and licences

Checked on 22 November 2026 from each project's own licence file or package metadata. Check again before you rely on them. This is not legal advice.

## In this repository

| What | Where | Source | Licence |
|---|---|---|---|
| SO-ARM100 robot description (`so100.urdf`) and its 13 STL meshes, unchanged | `examples/so100/` | [TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100), folder `Simulation/SO100`, commit `141aea7bcac2744d92998e30268c413202a56f96` | Apache-2.0 (the repository's `LICENSE`, copied to `examples/so100/LICENSE`) |
| Wren, the made-up example arm: URDF, poses and the script that writes its meshes | `examples/wren/` | written for this repository | MIT (this repository) |
| Everything else | | written for this repository | MIT (this repository) |

The SO-ARM100 files are redistributed as published, under the Apache License 2.0. Copyright remains with their authors (The Robot Studio and contributors). The poses file `examples/so100/poses.json` is ours.

## In the files `build` writes (`dist/`)

`robot-viewer-engine.js` bundles code from:

| Package | Version | Licence | Notice |
|---|---|---|---|
| [three](https://threejs.org) (core, GLTFLoader, OrbitControls, RoomEnvironment) | 0.187.0 | MIT | Copyright 2010-2026 three.js authors |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) reference decoder (`meshopt_decoder_reference.js`, pure JavaScript) | 1.3.0 | MIT | Copyright 2016-2026 Arseny Kapoulkine |

Both notices are in the banner at the top of the bundle. Robot models you convert keep their own licences; the GLB is a copy of them.

## Used while building (not shipped)

| Package | Version | Licence |
|---|---|---|
| @gltf-transform/core, extensions, functions | 4.5.1 | MIT |
| meshoptimizer (encoder, simplifier) | 1.3.0 | MIT |
| esbuild | 0.28.2 | MIT |
| @xmldom/xmldom | 0.9.12 | MIT |
| sharp (poster PNG and WebP) | 0.35.5 | Apache-2.0 (libvips binaries: LGPL-3.0-or-later) |
| playwright-core (optional, installed by you) | any recent | Apache-2.0 |
| ffmpeg (optional, for `record`) | any | LGPL or GPL depending on the build |
