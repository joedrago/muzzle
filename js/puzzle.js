import { vec2, flattenCubicBezier, mulberry32 } from "./math-utils.js"
import earcut from "../lib/earcut.js"

// Edge types
export const EDGE_NONE = 0 // border - straight
export const EDGE_POS = 1 // tab (outward bump)
export const EDGE_NEG = -1 // blank (inward notch)

export const WORLD_PIECE_SIZE = 100 // base piece size in world pixels

// ── Grid calculation ──────────────────────────────────

export function calculateGrid(pieceCount, aspectRatio) {
    let cols = Math.round(Math.sqrt(pieceCount * aspectRatio))
    let rows = Math.round(cols / aspectRatio)

    // Adjust to get close to desired count
    if (cols < 1) cols = 1
    if (rows < 1) rows = 1

    // Fine-tune: try nearby values
    let best = cols * rows
    let bestCols = cols,
        bestRows = rows
    for (let c = cols - 1; c <= cols + 1; c++) {
        for (let r = rows - 1; r <= rows + 1; r++) {
            if (c < 1 || r < 1) continue
            const count = c * r
            if (Math.abs(count - pieceCount) < Math.abs(best - pieceCount)) {
                best = count
                bestCols = c
                bestRows = r
            }
        }
    }

    return { cols: bestCols, rows: bestRows }
}

// ── Edge assignment ───────────────────────────────────

export function generateEdges(cols, rows, rng) {
    // hEdges[row][col] = edge type for the horizontal edge below piece (row, col)
    // There are (rows-1) rows of horizontal edges, each with cols entries
    const hEdges = []
    for (let r = 0; r < rows - 1; r++) {
        hEdges[r] = []
        for (let c = 0; c < cols; c++) {
            hEdges[r][c] = rng() > 0.5 ? EDGE_POS : EDGE_NEG
        }
    }

    // vEdges[row][col] = edge type for the vertical edge to the right of piece (row, col)
    // There are rows rows of vertical edges, each with (cols-1) entries
    const vEdges = []
    for (let r = 0; r < rows; r++) {
        vEdges[r] = []
        for (let c = 0; c < cols - 1; c++) {
            vEdges[r][c] = rng() > 0.5 ? EDGE_POS : EDGE_NEG
        }
    }

    return { hEdges, vEdges }
}

// ── Edge random parameters ────────────────────────────
// Draradech-style: t controls tab size, a-e are per-edge jitter

function randomEdgeParams(rng) {
    return {
        t: 0.07 + rng() * 0.04, // 0.07–0.11 tab size factor (controls all proportions)
        a: (rng() - 0.5) * 0.04, // left shoulder jitter
        b: (rng() - 0.5) * 0.04, // horizontal shift of tab center
        c: (rng() - 0.5) * 0.02, // vertical shift of tab center
        d: (rng() - 0.5) * 0.02, // indent variation at neck
        e: (rng() - 0.5) * 0.04 // right shoulder jitter
    }
}

// For edges with reversed transforms (bottom, left), mirror the params
function reverseParams(p) {
    return { t: p.t, a: p.e, b: -p.b, c: p.c, d: -p.d, e: p.a }
}

export function generateEdgeParams(cols, rows, rng) {
    // Random params per edge for unique tab shapes
    const hParams = []
    for (let r = 0; r < rows - 1; r++) {
        hParams[r] = []
        for (let c = 0; c < cols; c++) {
            hParams[r][c] = randomEdgeParams(rng)
        }
    }

    const vParams = []
    for (let r = 0; r < rows; r++) {
        vParams[r] = []
        for (let c = 0; c < cols - 1; c++) {
            vParams[r][c] = randomEdgeParams(rng)
        }
    }

    return { hParams, vParams }
}

// ── Bezier tab outline (Draradech-style) ─────────────

// Generate points along an edge from (0,0) to (edgeLen, 0)
// direction: 1 for POS (tab goes in +Y), -1 for NEG (blank goes in -Y)
// Uses 10 control points forming 3 cubic bezier segments
function generateEdgePoints(edgeLen, direction, params) {
    const { t, a, b, c, d, e } = params
    const f = direction

    // Scale jitter params to edge length
    const ts = t * edgeLen
    const as = a * edgeLen
    const bs = b * edgeLen
    const cs = c * edgeLen
    const ds = d * edgeLen
    const es = e * edgeLen
    const half = edgeLen / 2

    // 10 control points: p0-p9
    const p0 = [0, 0]
    const p1 = [half * 0.4, f * as]
    const p2 = [half + bs + ds, f * (-ts + cs)]
    const p3 = [half - ts + bs, f * (ts + cs)]
    const p4 = [half - 2 * ts + bs - ds, f * (3 * ts + cs)]
    const p5 = [half + 2 * ts + bs - ds, f * (3 * ts + cs)]
    const p6 = [half + ts + bs, f * (ts + cs)]
    const p7 = [half + bs + ds, f * (-ts + cs)]
    const p8 = [edgeLen - half * 0.4, f * es]
    const p9 = [edgeLen, 0]

    // 3 cubic bezier segments, skip duplicate junction points
    const seg1 = flattenCubicBezier(p0, p1, p2, p3, 0.15)
    const seg2 = flattenCubicBezier(p3, p4, p5, p6, 0.15)
    const seg3 = flattenCubicBezier(p6, p7, p8, p9, 0.15)

    return [...seg1, ...seg2.slice(1), ...seg3.slice(1)]
}

// ── Piece outline generation ──────────────────────────

export function generatePieceOutline(col, row, cols, rows, edges, edgeParams, pieceW, pieceH) {
    const { hEdges, vEdges } = edges
    const { hParams, vParams } = edgeParams

    const outline = []

    // Top edge: from left to right at y=0
    {
        const edgeType = row > 0 ? hEdges[row - 1][col] : EDGE_NONE
        if (edgeType === EDGE_NONE) {
            outline.push([0, 0])
            outline.push([pieceW, 0])
        } else {
            // Top edge has no transform, so +Y goes INTO the piece (blank).
            // If stored edge is POS (bottom piece has tab going out), we need
            // direction=+1 here to make the blank go into our piece body.
            // reverseParams mirrors X to match the bottom edge's X-reversal.
            const pts = generateEdgePoints(pieceW, edgeType, reverseParams(hParams[row - 1][col]))
            outline.push(...pts)
        }
    }

    // Right edge: from top to bottom at x=pieceW
    {
        const edgeType = col < cols - 1 ? vEdges[row][col] : EDGE_NONE
        if (edgeType === EDGE_NONE) {
            outline.push([pieceW, 0])
            outline.push([pieceW, pieceH])
        } else {
            const pts = generateEdgePoints(pieceH, edgeType, vParams[row][col])
            // Rotate 90°: points along right edge going down
            // Edge goes from (pieceW, 0) to (pieceW, pieceH)
            // Transform: (x, y) in edge space → (pieceW + y, x) in piece space
            for (const p of pts) {
                outline.push([pieceW + p[1], p[0]])
            }
        }
    }

    // Bottom edge: from right to left at y=pieceH
    {
        const edgeType = row < rows - 1 ? hEdges[row][col] : EDGE_NONE
        if (edgeType === EDGE_NONE) {
            outline.push([pieceW, pieceH])
            outline.push([0, pieceH])
        } else {
            const pts = generateEdgePoints(pieceW, edgeType, hParams[row][col])
            // Reverse direction and flip: points go right→left along bottom
            // Edge goes from (pieceW, pieceH) to (0, pieceH)
            // Transform: (x, y) in edge space → (pieceW - x, pieceH + y) in piece space
            for (const p of pts) {
                outline.push([pieceW - p[0], pieceH + p[1]])
            }
        }
    }

    // Left edge: from bottom to top at x=0
    {
        const edgeType = col > 0 ? vEdges[row][col - 1] : EDGE_NONE
        if (edgeType === EDGE_NONE) {
            outline.push([0, pieceH])
            outline.push([0, 0])
        } else {
            // This edge was defined from the left neighbor's right perspective.
            // The left transform reverses X, so we need reverseParams to match.
            const dir = -edgeType
            const pts = generateEdgePoints(pieceH, dir, reverseParams(vParams[row][col - 1]))
            for (const p of pts) {
                outline.push([-p[1], pieceH - p[0]])
            }
        }
    }

    // Remove duplicate consecutive points
    const cleaned = [outline[0]]
    for (let i = 1; i < outline.length; i++) {
        const prev = cleaned[cleaned.length - 1]
        if (vec2.distanceSq(outline[i], prev) > 0.01) {
            cleaned.push(outline[i])
        }
    }
    // Remove last if same as first
    if (cleaned.length > 1 && vec2.distanceSq(cleaned[0], cleaned[cleaned.length - 1]) < 0.01) {
        cleaned.pop()
    }

    return cleaned
}

// ── Triangulation + mesh creation ─────────────────────

export function triangulatePiece(outline) {
    // Flatten to earcut format
    const flat = []
    for (const p of outline) {
        flat.push(p[0], p[1])
    }

    const indices = earcut(flat)
    return indices
}

export function buildPieceMesh(outline, indices, col, row, cols, rows, pieceW, pieceH) {
    // Build interleaved vertex data: [x, y, u, v]
    const vertData = new Float32Array(outline.length * 4)

    for (let i = 0; i < outline.length; i++) {
        const lx = outline[i][0]
        const ly = outline[i][1]
        vertData[i * 4 + 0] = lx
        vertData[i * 4 + 1] = ly
        // UV: map piece-local coords to texture UV
        vertData[i * 4 + 2] = (col + lx / pieceW) / cols
        vertData[i * 4 + 3] = (row + ly / pieceH) / rows
    }

    const indexData = new Uint16Array(indices)

    return { vertData, indexData, triCount: indices.length / 3 }
}

// ── Outline strip generation (triangle strip for thick borders) ──

const OUTLINE_WIDTH = 1.2 // world units (piece size = 100)

function buildOutlineStrip(outline) {
    const n = outline.length
    const halfW = OUTLINE_WIDTH / 2
    const verts = []

    for (let i = 0; i < n; i++) {
        const prev = outline[(i - 1 + n) % n]
        const curr = outline[i]
        const next = outline[(i + 1) % n]

        // Edge directions
        const dx1 = curr[0] - prev[0],
            dy1 = curr[1] - prev[1]
        const dx2 = next[0] - curr[0],
            dy2 = next[1] - curr[1]

        // Normals (perpendicular)
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1
        const nx1 = -dy1 / len1,
            ny1 = dx1 / len1
        const nx2 = -dy2 / len2,
            ny2 = dx2 / len2

        // Average normal (miter join)
        let nx = (nx1 + nx2) / 2
        let ny = (ny1 + ny2) / 2
        const nlen = Math.sqrt(nx * nx + ny * ny) || 1
        nx /= nlen
        ny /= nlen

        // Miter scale to maintain consistent width at corners
        const dot = nx * nx1 + ny * ny1
        const miterScale = dot > 0.15 ? 1 / dot : 1 / 0.15
        const offset = halfW * Math.min(miterScale, 3)

        // Inner and outer vertices for the strip
        verts.push(curr[0] - nx * offset, curr[1] - ny * offset)
        verts.push(curr[0] + nx * offset, curr[1] + ny * offset)
    }

    // Close the strip by repeating first two vertices
    verts.push(verts[0], verts[1])
    verts.push(verts[2], verts[3])

    return new Float32Array(verts)
}

// ── Full puzzle generation ────────────────────────────

export function generatePuzzle(cols, rows, seed, renderer) {
    const rng = mulberry32(seed)
    const edges = generateEdges(cols, rows, rng)
    const edgeParams = generateEdgeParams(cols, rows, rng)

    const pieceW = WORLD_PIECE_SIZE
    const pieceH = WORLD_PIECE_SIZE

    const pieces = []

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const id = r * cols + c
            const outline = generatePieceOutline(c, r, cols, rows, edges, edgeParams, pieceW, pieceH)
            const indices = triangulatePiece(outline)
            const { vertData, indexData, triCount } = buildPieceMesh(outline, indices, c, r, cols, rows, pieceW, pieceH)

            const vbo = renderer.createVBO(vertData)
            const ibo = renderer.createIBO(indexData)

            // Outline triangle strip for thick border rendering
            const outlineStrip = buildOutlineStrip(outline)
            const outlineVBO = renderer.createVBO(outlineStrip)
            const outlineVertCount = outlineStrip.length / 2

            pieces.push({
                id,
                col: c,
                row: r,
                outline,
                vbo,
                ibo,
                triCount,
                outlineVBO,
                outlineVertCount,
                chunkId: id // initially each piece is its own chunk
            })
        }
    }

    return {
        pieces,
        edges,
        edgeParams,
        pieceW,
        pieceH,
        cols,
        rows,
        seed,
        // Puzzle world dimensions
        puzzleWidth: cols * pieceW,
        puzzleHeight: rows * pieceH
    }
}
