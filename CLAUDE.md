# Muzzle - WebGL Jigsaw Puzzle

## Project Overview

Static zero-build-tool web app for playing jigsaw puzzles in WebGL. Special feature: puzzle source can be a looping MP4 video, making pieces appear animated. All state auto-persists to localStorage.

## File Structure

```
muzzle/
├── index.html              # Single page entry point, canvas + toolbar + dialogs
├── style.css               # UI styling (toolbar, dialogs, overlays, celebration, gamepad focus)
├── CLAUDE.md               # This file
├── package.json            # type:module, prettier config, eslint/prettier/electron devDeps
├── eslint.config.js        # ESLint flat config (recommended + no-unused-vars)
├── forge.config.js         # Electron Forge packaging config
├── js/
│   ├── main.js             # App bootstrap, render loop, module wiring
│   ├── math-utils.js       # vec2, mat3 (column-major), bezier, seeded PRNG, geometry
│   ├── puzzle.js           # Grid calc, bezier piece outlines, earcut triangulation, UV
│   ├── piece.js            # Chunk/ChunkManager classes, snap detection, merge, hit test
│   ├── renderer.js         # WebGL1 context, shaders (piece+flat), camera, draw pipeline
│   ├── input.js            # Mouse/keyboard state machine (IDLE/HOLDING/SELECTING/PANNING)
│   ├── gamepad.js          # Gamepad polling, navigation/holding/dialog modes, button mapping
│   ├── media.js            # Image/video loading, texture management, auto-detection
│   ├── state.js            # localStorage auto-save/load with 1.5s debounce
│   └── ui.js               # Toolbar, dialogs, puzzle picker, celebration, gamepad focus nav
├── electron/
│   ├── main.cjs            # Electron main process — fullscreen BrowserWindow loading prod URL
│   ├── config.json         # gitignored — { "endpoint": "https://..." }
│   └── config.json.example # Template for config.json
└── lib/
    └── earcut.js           # Vendored earcut v3.0.1 triangulation library (ESM)
```

## Mandatory Workflow

- **Always run `npx prettier --write .` and `npx eslint .` after ANY JS changes.** Fix all lint errors before considering work complete.
- Prettier config: `package.json` → printWidth:130, tabWidth:4, trailingComma:none, semi:false
- ESLint config: `eslint.config.js` → @eslint/js recommended + no-unused-vars with `^_` ignore patterns
- `package.json` has `"type": "module"` — all JS is ESM

## Architecture Details

### WebGL Rendering (renderer.js)

- WebGL1 with two shader programs: **piece shader** (textured, with alpha) and **flat shader** (solid color for selection rect)
- Camera system: `{ x, y, zoom }` — pan offset in world coords, zoom scalar
- Camera matrix: column-major mat3 — translate(-cam) _ scale(zoom) _ scale(2/w, -2/h)
- `screenToWorld()` / `worldToScreen()` for coordinate conversion
- `zoomAtScreen()` — zoom centered on cursor position
- Textures: `createTexture(source)`, `updateTexture(tex, source)` for video frames

### Puzzle Generation (puzzle.js)

- `calculateGrid(pieceCount, aspectRatio)` → { cols, rows }
- Seeded PRNG (mulberry32) ensures deterministic shapes from seed
- Edge types: EDGE_NONE (border), EDGE_POS (tab), EDGE_NEG (blank)
- Bezier tab shapes with random perturbations (width, height, asymmetry, neck)
- `generatePieceOutline()` → closed polygon per piece
- `triangulatePiece()` via earcut → triangle indices
- `buildPieceMesh()` → interleaved Float32Array [x, y, u, v] + Uint16Array indices
- `WORLD_PIECE_SIZE = 100` — base piece size in world pixels

### Piece/Chunk System (piece.js)

- **Chunk class**: id, pieces Set, x/y position, rotation (0/90/180/270), cached worldMatrix
- **ChunkManager**: manages all chunks, handles snap detection, merging, hit testing
- Initially every piece is its own chunk
- `trySnap(chunkId)` — after drop, checks border pieces for neighbors within threshold (30% of piece size), requires matching rotation, recursive for cascading snaps
- `_mergeChunks()` — aligns positions, re-parents pieces, removes merged chunk
- `isComplete()` — single chunk with all pieces (any rotation)
- `hitTest(worldX, worldY)` — inverse transform → AABB check → pointInPolygon
- `cleanup()` — reorganize all chunks into a grid layout
- `serialize()` / `restoreChunks()` for save/load

### Input System (input.js)

- State machine: IDLE → PENDING_PICK → HOLDING_CLICK or HOLDING_DRAG
- IDLE → SELECTING (left drag on background)
- IDLE → PANNING (right drag on background)
- Right-click while holding rotates 90° CW
- Selection rectangle gathers pieces, creates multi-selection
- Keyboard: R=rotate, O/S=solution, M=mute, F=fullscreen, H/?=help, Esc=cancel/quit
- Scroll wheel: zoom at cursor
- Escape in IDLE with no dialog: calls `window.close()` (no-op in browser, quits Electron)

### Gamepad System (gamepad.js)

- Polls `navigator.getGamepads()` every frame via render loop
- Button edge detection (justPressed vs isPressed) for clean single-fire events
- Dead zone (0.2) on analog sticks
- **Three modes**: Navigation (no piece held), Holding (piece held), Dialog (UI open)
- **Navigation mode**: D-pad/left stick highlights nearest chunk in direction (cone-based search)
    - A picks up highlighted chunk, B quits, X rotates in place, Y toggles solution
    - Start opens puzzle select, Select toggles help
- **Holding mode**: D-pad accelerates (800 u/s², max 1200 u/s), analog stick proportional (1400 u/s max)
    - Camera auto-follows held piece with smooth lerp
    - A places piece (triggers snap), B cancels (returns to pre-pickup position), X rotates
    - Instant stop on d-pad release for precision
- **Dialog mode**: D-pad/left stick navigates focusable elements, A activates, B cancels
    - 2D grid navigation for preset thumbnails, linear navigation for other elements
    - LB/RB quick-navigate through preset list
- Quit combo: Hold Start+Select for 500ms → `window.close()`
- Right stick always pans camera, LB/RB zoom (when not in dialog)
- Clears highlight when mouse/touch input is detected

### Media (media.js)

- Auto-detects image vs video from URL extension
- Video: `<video>` element, loop, playsinline, muted initially for autoplay
- Video texture updated per-frame via `texImage2D` in render loop
- Autoplay fallback: shows "Click to Start Video" overlay

### State (state.js)

- localStorage key: `muzzle_puzzle_state`
- Debounced save (1.5s) + immediate save on beforeunload
- Save format version 1: puzzle config (url, seed, cols, rows) + chunk positions + camera + completion
- Key insight: piece geometry NOT saved — regenerated deterministically from seed

### UI (ui.js)

- 5 preset puzzles from Wikimedia Commons (all images currently)
- Puzzle selection dialog: presets + custom URL, piece count dropdown, rotation checkbox
- Confirmation dialog for cleanup
- Help dialog with keybind reference
- Celebration: CSS confetti particles, auto-dismiss after 6s, "Complete!" badge

## Known Issues / TODO

- Solution overlay doesn't account for tab overhang beyond piece bounds
- No spatial indexing for hit testing (may slow down beyond ~400 pieces)
- Preset puzzle URLs are all images; no video presets yet

## Testing

```bash
python3 -m http.server 8000   # serve from project root
# Open http://localhost:8000 in browser
```

## Key Bug Fixes Applied

1. Chunk merge used dx/2 instead of full dx — caused compounding misalignment (FIXED)
2. isComplete() required rotation===0 — prevented win when rotation enabled (FIXED: any rotation)
3. Right-click rotation unreachable in HOLDING_CLICK state (FIXED: check before early return)
4. Selection rectangle didn't trigger re-render during drag (FIXED: set \_needsRender)
