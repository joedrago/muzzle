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

export function generateEdgeParams(cols, rows, rng) {
    // Random params per edge for unique tab shapes
    const hParams = []
    for (let r = 0; r < rows - 1; r++) {
        hParams[r] = []
        for (let c = 0; c < cols; c++) {
            hParams[r][c] = {
                tabWidth: 0.3 + rng() * 0.15, // 0.30–0.45
                tabHeight: 0.28 + rng() * 0.12, // 0.28–0.40
                asymmetry: (rng() - 0.5) * 0.08, // slight left/right shift
                neckWidth: 0.18 + rng() * 0.08 // 0.18–0.26
            }
        }
    }

    const vParams = []
    for (let r = 0; r < rows; r++) {
        vParams[r] = []
        for (let c = 0; c < cols - 1; c++) {
            vParams[r][c] = {
                tabWidth: 0.3 + rng() * 0.15,
                tabHeight: 0.28 + rng() * 0.12,
                asymmetry: (rng() - 0.5) * 0.08,
                neckWidth: 0.18 + rng() * 0.08
            }
        }
    }

    return { hParams, vParams }
}

// ── Bezier tab outline ────────────────────────────────

// Generate points along an edge from (0,0) to (edgeLen, 0)
// direction: 1 for POS (tab goes up/outward in +Y), -1 for NEG (blank)
function generateEdgePoints(edgeLen, direction, params) {
    const { tabWidth, tabHeight, asymmetry, neckWidth } = params

    const tw = tabWidth * edgeLen
    const th = tabHeight * edgeLen * direction
    const nw = neckWidth * edgeLen
    const asym = asymmetry * edgeLen

    const mid = edgeLen / 2 + asym
    const halfTab = tw / 2
    const halfNeck = nw / 2

    const startTab = mid - halfTab
    const endTab = mid + halfTab
    const startNeck = mid - halfNeck
    const endNeck = mid + halfNeck

    const points = []

    // Straight segment to tab start
    points.push([0, 0])

    // Bezier curve into the tab
    // Segment 1: approach to neck
    const seg1 = flattenCubicBezier(
        [startTab, 0],
        [startTab + (startNeck - startTab) * 0.3, 0],
        [startNeck - (startNeck - startTab) * 0.1, th * 0.4],
        [startNeck, th * 0.6],
        0.8
    )
    // Segment 2: neck to top of tab
    const seg2 = flattenCubicBezier(
        [startNeck, th * 0.6],
        [startNeck - halfNeck * 0.3, th],
        [endNeck + halfNeck * 0.3, th],
        [endNeck, th * 0.6],
        0.8
    )
    // Segment 3: tab back down
    const seg3 = flattenCubicBezier(
        [endNeck, th * 0.6],
        [endNeck + (endTab - endNeck) * 0.1, th * 0.4],
        [endTab - (endTab - endNeck) * 0.3, 0],
        [endTab, 0],
        0.8
    )

    points.push(...seg1)
    points.push(...seg2)
    points.push(...seg3)

    // Straight to end
    points.push([edgeLen, 0])

    return points
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
            // From top piece's perspective, this was the bottom edge
            // Our top = neighbor's bottom, so we invert
            const dir = -edgeType // invert because we see it from the other side
            const params = hParams[row - 1][col]
            const pts = generateEdgePoints(pieceW, dir, params)
            // Points go left→right along top (y stays near 0)
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
            // Invert because we're on the other side
            const dir = -edgeType
            const pts = generateEdgePoints(pieceH, dir, vParams[row][col - 1])
            // Edge goes from (0, pieceH) to (0, 0)
            // Transform: (x, y) in edge space → (-y, pieceH - x) in piece space
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

            pieces.push({
                id,
                col: c,
                row: r,
                outline,
                vbo,
                ibo,
                triCount,
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
