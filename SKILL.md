---
name: robot-viewer
description: Turn any URDF robot (links, joints, STL/OBJ/COLLADA meshes) into one embeddable, self-hosted web component. Converts the robot to a single meshopt-compressed GLB that keeps the link and joint tree plus a joints JSON, and generates a robot-viewer element (three.js bundled locally, no CDN, works under Content-Security-Policy default-src 'self') with orbit, joint sliders with real limits, named poses with smooth moves, drag-a-part inverse kinematics, a poster rendered in headless Chrome for no-WebGL and reduced motion, keyboard-accessible sliders, light and dark themes, lazy loading and an optional AR button. Outputs a dist/ folder, a snippet and a size report. Use whenever the user wants a robot, robot arm or URDF model on a website, portfolio or docs page, an interactive 3D robot viewer, joint sliders in the browser, "embed my URDF", "URDF to GLB", a robot web component, a viewer that passes a strict CSP, or a poster or short video of a robot in a viewer.
---

# robot-viewer

Pipeline: **URDF + meshes** → one **GLB** (gltf-transform, meshopt compression, link/joint node tree, joints JSON inside and beside it) → **`<robot-viewer>`** bundle (three.js + a pure-JavaScript meshopt decoder, no WebAssembly, no workers, no inline code) → **poster** drawn by the real component in headless Chrome → **demo page, snippet, size report**.

Skill folder (written `$V` below): this folder. Every command is `$V/robot-viewer <command>`; `$V/robot-viewer help` lists them all.

## Workflow

1. `$V/robot-viewer check`. `npm ci` in `$V` if packages are missing. Chrome with WebGL is needed only for posters, `verify` and `record`; ffmpeg only for `record`.
2. **Rights.** Ask where the robot model came from unless it is clearly the user's own. The GLB, poster and any video are modified copies (derivative works) of the meshes that every visitor downloads, so the user needs the right to redistribute and modify them. Many public robot descriptions do not allow it. Pass `--license` and `--source` to the build: they are written into the GLB (`asset.copyright`) and shown on the demo page. Keep the upstream licence (and NOTICE file, if there is one) with the published files.
3. `$V/robot-viewer inspect <robot.urdf>`: joint names, types, limits in degrees or metres, meshes found or refused. Xacro must be expanded first (`xacro x.urdf.xacro > x.urdf`). Pass `--package <package folder>` (the folder holding both `urdf/` and `meshes/`) when meshes are written as `package://name/...` and that folder is not called `name`, or as `../meshes/...`.
4. Write a **poses file** with the user, using only joint names from `inspect`:
   ```json
   { "units": "deg", "default": "home", "poses": { "home": { "shoulder": -12, "elbow": 118 }, "reach": { ... } } }
   ```
   - 2 to 5 poses that show what the robot is for. Names are button labels: short words.
   - `default` is how the robot first appears and where the floor goes (the lowest point in that pose). Pick a pose in which it stands on its base.
   - Sliding joints are metres whatever `units` says. Mimic and fixed joints cannot be posed.
   - Values outside the limits stop the build. `--clamp` pulls them in with a warning; prefer fixing the value.
5. **Build**:
   ```
   $V/robot-viewer build <robot.urdf> --out <site's static folder>/robots --poses poses.json --title "Name" --alt "what it is" --base /robots/
   ```
   It prints every warning, the size report and the snippet. `--orbit "az el"` sets the starting view (degrees; 0 is the robot's +X side). Run it once per robot into the same `--out`; the demo page lists them all.
6. **Look at it.** Read the poster PNG (`<out>/<name>.poster.png`). Check the robot is upright, whole, in the default pose and not tiny. If the view is edge-on, rebuild with another `--orbit`; if a pose looks wrong, fix the poses file. For more angles: `$V/robot-viewer poster <out> <name> --pose reach --orbit "120 20"`. Do not say it looks right without having viewed it.
7. `$V/robot-viewer verify <out>`: static CSP check of every page and script, then the demo page in Chrome under the header `Content-Security-Policy: default-src 'self'`. It must end with "no violations or errors".
8. Hand over: the snippet, the size report, the poster path, and the rules below. Optional: `$V/robot-viewer record <out> <name> --out demo.mp4` for a short video of poses, a slider and a drag (`--theme dark` for a dark one). Read a few frames from it before sending it on.

## Putting it on a site

- Copy the whole `dist/` folder into the site's static files. At the least keep `robot-viewer.js`, `robot-viewer-engine.js`, `robot-viewer.css`, `robot-viewer-licenses.txt` (the MIT texts of three.js and meshoptimizer, which their licences require you to ship) and each robot's `.glb` and `.poster.*`. The JS files must stay side by side.
- Paste the snippet. The `<script type="module">` goes in once per page, however many robots it shows.
- Size: the element fills its width; height comes from `--rv-aspect` (default `4 / 3`) or a CSS height. When it is 760 px or wider the control panel moves to the side (`--rv-aspect-wide`, default `16 / 9`).
- Restyle with CSS variables on the element: `--rv-accent`, `--rv-surface`, `--rv-ink`, `--rv-line`, `--rv-stage`, `--rv-grid`, `--rv-shadow`, `--rv-radius-frame`, `--rv-panel-width`, `--rv-font`, `--rv-mono`. `theme="dark"` or `theme="light"` forces a theme; otherwise it follows the visitor's setting.
- Attributes: `src`, `poster`, `alt`, `pose`, `orbit`, `controls` (`full`, `poses`, `none`), `ik`, `grid="off"`, `loading="eager"`, `theme`, `ar-glb`, `ar-usdz`. Changing `src`, `controls` or `ik` after loading rebuilds the 3D view; `pose`, `theme`, `grid`, `poster`, `alt` and the AR attributes apply in place; `orbit` and `loading` are read when the view is built. Removing the element frees its WebGL context.
- React, Vue, Svelte: load the script once on the client and render `<robot-viewer ...>` as a normal element. Do not render it on the server with properties; attributes are enough.
- Serve `.glb` as `model/gltf-binary` (most hosts already do). Turn on gzip or brotli for `.js`.

## AR button

The viewer shows "View in your room" only when it is given AR files and the visitor's phone can open them. Make the files with the **ar-models** skill (`~/.claude/skills/ar-models`): `ar convert robot.urdf --height <real height in metres> --pose "..." --out ar/`, then pass them to the build: `--ar-glb ar/robot.glb --ar-usdz ar/robot.usdz`. Its README covers real-world size, the MIME types and testing on phones. Do not copy its code here; it is a separate tool. AR was not tested on phones by this skill.

## Rules

- Say what the viewer is: an interactive model. Nothing checks collisions, balance, torque or speed. Joint limits from the URDF are the only rule enforced. The demo page says so; keep that line or an equivalent where the user publishes it.
- Never invent specifications in titles, alt text or pages. Numbers shown (joints, links, triangles, file size) come from the build.
- Textures are not carried into the GLB (colours are). This keeps the viewer free of `blob:` URLs, which a strict policy blocks. If the user's robot relies on image textures, say so.
- Keep the GLB under about 4 MB. If it is larger: `--simplify 0.5` (keeps about half the vertices where the shape allows) and look at the poster again.

## Troubleshooting

- **"not found" for meshes**: `inspect` shows where it looked. Use `--package <folder>` for `package://name/...` paths, or fix the path in the URDF.
- **"leads outside the URDF folder"**: the usual ROS layout (`urdf/robot.urdf` with `../meshes/...` or `package://name/meshes/...`) needs `--package <folder that holds urdf/ and meshes/>`. Anything outside that folder is refused on purpose.
- **"absolute path"**: refused on purpose. Copy the meshes into the package folder and use relative paths.
- **Robot lying on its side**: the URDF is not Z-up, or a COLLADA file declares the wrong up axis. Check `<up_axis>` in the `.dae`.
- **Robot floating or under the floor**: the floor sits under the default pose. Choose a default pose that rests on the base.
- **Blank grey box in the page**: open the browser console. A 404 means the `.glb` path in `src` is wrong (it is relative to the page, or use `--base`). A policy error means the site's own CSP is stricter than `default-src 'self'` (for example `connect-src 'none'`).
- **No poster**: Chrome with WebGL was not found. The build still works; run `poster` later on a machine that has it.
- **`record` cannot find ffmpeg**: install it, or set `FF=/path/to/ffmpeg`, or `ROBOT_VIEWER_PYTHON` to a Python that has `imageio-ffmpeg`.
- **`record` is slow**: rendering is in software (SwiftShader) without a GPU, roughly 5 to 6 frames a second at 1280x720.
