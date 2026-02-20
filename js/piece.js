import { mat3, vec2, degToRad, pointInPolygon, aabbFromPoints, pointInAABB } from "./math-utils.js"

// ── Chunk class ───────────────────────────────────────

export class Chunk {
    constructor(id, x, y, rotation = 0) {
        this.id = id
        this.pieces = new Set()
        this.x = x
        this.y = y
        this.rotation = rotation // 0, 90, 180, 270
        this._matrixDirty = true
        this._worldMatrix = mat3.identity()
    }

    get worldMatrix() {
        if (this._matrixDirty) {
            const rad = degToRad(this.rotation)
            let m = mat3.identity()
            m = mat3.multiply(mat3.translate(this.x, this.y), m)
            if (this.rotation !== 0) {
                m = mat3.multiply(m, mat3.rotate(rad))
            }
            this._worldMatrix = m
            this._matrixDirty = false
        }
        return this._worldMatrix
    }

    setPosition(x, y) {
        this.x = x
        this.y = y
        this._matrixDirty = true
    }

    setRotation(r) {
        this.rotation = ((r % 360) + 360) % 360
        this._matrixDirty = true
    }

    addPiece(pieceId) {
        this.pieces.add(pieceId)
    }

    removePiece(pieceId) {
        this.pieces.delete(pieceId)
    }

    markDirty() {
        this._matrixDirty = true
    }
}

// ── ChunkManager ──────────────────────────────────────

export class ChunkManager {
    constructor() {
        this.chunks = new Map() // chunkId → Chunk
        this.pieces = [] // all pieces array (from puzzle generation)
        this.puzzleData = null // reference to puzzle generation data
        this.nextChunkId = 0
    }

    init(puzzleData, pieces) {
        this.puzzleData = puzzleData
        this.pieces = pieces
        this.chunks.clear()
        this.nextChunkId = 0
    }

    createChunk(x, y, rotation = 0) {
        const id = this.nextChunkId++
        const chunk = new Chunk(id, x, y, rotation)
        this.chunks.set(id, chunk)
        return chunk
    }

    removeChunk(id) {
        this.chunks.delete(id)
    }

    getChunkForPiece(pieceId) {
        return this.chunks.get(this.pieces[pieceId].chunkId)
    }

    // ── Shuffle / Initial placement ───────────────────

    shuffle(rotationEnabled) {
        const { cols, rows, pieceW, pieceH } = this.puzzleData
        const puzzleW = cols * pieceW
        const puzzleH = rows * pieceH

        // Scatter area: somewhat larger than puzzle
        const scatterW = puzzleW * 2.5
        const scatterH = puzzleH * 2.5
        const offsetX = -scatterW / 2
        const offsetY = -scatterH / 2

        this.chunks.clear()
        this.nextChunkId = 0

        for (const piece of this.pieces) {
            const x = offsetX + Math.random() * scatterW
            const y = offsetY + Math.random() * scatterH
            const rotation = rotationEnabled ? [0, 90, 180, 270][Math.floor(Math.random() * 4)] : 0

            const chunk = this.createChunk(x, y, rotation)
            chunk.addPiece(piece.id)
            piece.chunkId = chunk.id
        }
    }

    // ── Restore from save ─────────────────────────────

    restoreChunks(savedChunks) {
        this.chunks.clear()
        this.nextChunkId = 0

        for (const sc of savedChunks) {
            const chunk = new Chunk(sc.id, sc.x, sc.y, sc.rotation)
            for (const pid of sc.pieces) {
                chunk.addPiece(pid)
                this.pieces[pid].chunkId = sc.id
            }
            this.chunks.set(sc.id, chunk)
            if (sc.id >= this.nextChunkId) this.nextChunkId = sc.id + 1
        }
    }

    // ── Snap detection ────────────────────────────────

    // Get where a piece's grid neighbor should be in world space
    _getExpectedNeighborWorldPos(piece, neighborCol, neighborRow, chunk) {
        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH

        // In piece-local coordinates, each piece at (c, r) has origin at (c*pw - anchorPiece.col*pw, r*ph - anchorPiece.row*ph) relative to chunk
        // But we simplify: piece origin in chunk space = (piece.col * pw, piece.row * ph) relative to the chunk's reference
        // The chunk's reference frame has the first piece at its origin offset

        // The offset of this piece within the chunk (relative to chunk origin) at rotation=0
        // Actually, the chunk origin IS where pieces are drawn. Each piece in the chunk at (c, r)
        // is drawn at local position ((c - anchorC) * pw, (r - anchorR) * ph).
        // But we don't track an anchor. Instead, the chunk's position IS the world origin for drawing.
        // Pieces in the chunk are at their grid positions relative to a common reference.

        // For snapping, we need: where would the neighbor piece be in world space?
        // The piece at (col, row) has local offset = (piece.col * pw, piece.row * ph) in solved-puzzle space
        // The neighbor at (neighborCol, neighborRow) has local offset = (neighborCol * pw, neighborRow * ph)
        // The delta in solved space is ((neighborCol - piece.col) * pw, (neighborRow - piece.row) * ph)
        // Transform this delta through the chunk's rotation, then add to chunk's world position
        // Plus add the piece's own local offset (also rotated)

        // Local position of our piece in the chunk
        // We need to know where the first piece in the chunk was placed
        // Let's think differently: piece world position = chunk.worldMatrix * localPieceOffset
        // where localPieceOffset for a piece is relative to the chunk's local origin

        // The simplest approach: compute world pos of this piece's center, then compute
        // where the neighbor's center should be based on grid delta

        const delta = [(neighborCol - piece.col) * pw, (neighborRow - piece.row) * ph]
        const rad = degToRad(chunk.rotation)
        const rotDelta = chunk.rotation === 0 ? delta : vec2.rotate(delta, rad)

        // We need the world position of our piece first
        const pieceWorldPos = this._getPieceWorldPos(piece, chunk)

        return vec2.add(pieceWorldPos, rotDelta)
    }

    _getPieceWorldPos(piece, chunk) {
        // Get the world position of a piece's origin corner
        // Each piece in a chunk is positioned relative to the chunk's origin
        // The local offset of a piece = its grid position relative to the chunk's "base"
        // We store each piece's absolute grid position, so we compute the local offset
        // as the difference from the "first" piece in the chunk

        // Actually, the chunk's (x,y) IS the world position of the LOCAL origin.
        // In the chunk's local space, pieces are arranged by their grid coords.
        // We need a consistent reference. Let's use: the chunk's origin = position where
        // piece (0,0) would be if it were in this chunk.
        // So piece (c,r) local pos = (c*pw, r*ph)

        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH
        const localPos = [piece.col * pw, piece.row * ph]

        return mat3.transformPoint(chunk.worldMatrix, localPos)
    }

    // Check and perform snapping after dropping a chunk
    trySnap(droppedChunkId) {
        const droppedChunk = this.chunks.get(droppedChunkId)
        if (!droppedChunk) return false

        const { cols, rows, pieceW } = this.puzzleData
        const snapThreshold = pieceW * 0.3
        const snapThresholdSq = snapThreshold * snapThreshold

        let snapped = false

        // Check each piece in the dropped chunk for neighbors in other chunks
        for (const pieceId of droppedChunk.pieces) {
            const piece = this.pieces[pieceId]
            const neighbors = [
                { dc: 0, dr: -1 }, // top
                { dc: 1, dr: 0 }, // right
                { dc: 0, dr: 1 }, // bottom
                { dc: -1, dr: 0 } // left
            ]

            for (const { dc, dr } of neighbors) {
                const nc = piece.col + dc
                const nr = piece.row + dr
                if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue

                const neighborId = nr * cols + nc
                const neighborPiece = this.pieces[neighborId]
                if (neighborPiece.chunkId === droppedChunkId) continue // already in same chunk

                const neighborChunk = this.chunks.get(neighborPiece.chunkId)
                if (!neighborChunk) continue

                // Rotations must match
                if (droppedChunk.rotation !== neighborChunk.rotation) continue

                // Check distance
                const expectedPos = this._getExpectedNeighborWorldPos(piece, nc, nr, droppedChunk)
                const actualPos = this._getPieceWorldPos(neighborPiece, neighborChunk)
                const distSq = vec2.distanceSq(expectedPos, actualPos)

                if (distSq < snapThresholdSq) {
                    // Snap! Merge the neighbor chunk into the dropped chunk
                    this._mergeChunks(droppedChunkId, neighborPiece.chunkId)
                    snapped = true
                    break // Restart checking since pieces changed
                }
            }

            if (snapped) break
        }

        // If we snapped, recurse to check for cascading snaps
        if (snapped) {
            this.trySnap(droppedChunkId)
        }

        return snapped
    }

    _mergeChunks(keepId, mergeId) {
        const keepChunk = this.chunks.get(keepId)
        const mergeChunk = this.chunks.get(mergeId)
        if (!keepChunk || !mergeChunk) return

        // Compute offset to align pieces
        // Both chunks at same rotation. Find the correct position for keepChunk
        // so that all pieces line up.
        // Average the expected position based on grid alignment

        // Pick any piece from mergeChunk and compute where keepChunk should be
        // for perfect grid alignment
        const mergePieceId = mergeChunk.pieces.values().next().value
        const mergePiece = this.pieces[mergePieceId]
        const mergeWorldPos = this._getPieceWorldPos(mergePiece, mergeChunk)

        // Where would this piece be in keepChunk's frame?
        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH
        const localPos = [mergePiece.col * pw, mergePiece.row * ph]
        const expectedWorldPos = mat3.transformPoint(keepChunk.worldMatrix, localPos)

        // Adjust keepChunk position to align
        const dx = mergeWorldPos[0] - expectedWorldPos[0]
        const dy = mergeWorldPos[1] - expectedWorldPos[1]
        keepChunk.setPosition(keepChunk.x + dx, keepChunk.y + dy)

        // Move all pieces from merge to keep
        for (const pid of mergeChunk.pieces) {
            this.pieces[pid].chunkId = keepId
            keepChunk.addPiece(pid)
        }

        this.removeChunk(mergeId)
    }

    // ── Win detection ─────────────────────────────────

    isComplete() {
        if (this.chunks.size !== 1) return false
        const chunk = this.chunks.values().next().value
        const totalPieces = this.puzzleData.cols * this.puzzleData.rows
        return chunk.pieces.size === totalPieces
    }

    // ── Hit testing ───────────────────────────────────

    hitTest(worldX, worldY) {
        // Test from top (last drawn) to bottom
        const chunkArray = Array.from(this.chunks.values())

        for (let i = chunkArray.length - 1; i >= 0; i--) {
            const chunk = chunkArray[i]
            const invMatrix = mat3.invert(chunk.worldMatrix)
            if (!invMatrix) continue

            const localPoint = mat3.transformPoint(invMatrix, [worldX, worldY])

            for (const pieceId of chunk.pieces) {
                const piece = this.pieces[pieceId]
                const pw = this.puzzleData.pieceW
                const ph = this.puzzleData.pieceH

                // Translate to piece-local coords
                const px = localPoint[0] - piece.col * pw
                const py = localPoint[1] - piece.row * ph

                // Quick AABB check
                const aabb = aabbFromPoints(piece.outline)
                if (!pointInAABB([px, py], aabb)) continue

                // Precise polygon check
                if (pointInPolygon([px, py], piece.outline)) {
                    return { pieceId, chunkId: chunk.id }
                }
            }
        }

        return null
    }

    // Get all pieces whose centers fall within a world-space rect
    getPiecesInRect(x1, y1, x2, y2) {
        const minX = Math.min(x1, x2)
        const minY = Math.min(y1, y2)
        const maxX = Math.max(x1, x2)
        const maxY = Math.max(y1, y2)

        const result = []
        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH

        for (const chunk of this.chunks.values()) {
            for (const pieceId of chunk.pieces) {
                const piece = this.pieces[pieceId]
                // Piece center in chunk-local space
                const cx = piece.col * pw + pw / 2
                const cy = piece.row * ph + ph / 2
                // Transform to world
                const worldCenter = mat3.transformPoint(chunk.worldMatrix, [cx, cy])
                if (worldCenter[0] >= minX && worldCenter[0] <= maxX && worldCenter[1] >= minY && worldCenter[1] <= maxY) {
                    result.push({ pieceId, chunkId: chunk.id })
                }
            }
        }

        return result
    }

    // ── Cleanup (reorganize) ──────────────────────────

    _getChunkWorldSize(chunk) {
        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH
        let minCol = Infinity,
            maxCol = -Infinity,
            minRow = Infinity,
            maxRow = -Infinity
        for (const pieceId of chunk.pieces) {
            const piece = this.pieces[pieceId]
            minCol = Math.min(minCol, piece.col)
            maxCol = Math.max(maxCol, piece.col)
            minRow = Math.min(minRow, piece.row)
            maxRow = Math.max(maxRow, piece.row)
        }
        const localW = (maxCol - minCol + 1) * pw
        const localH = (maxRow - minRow + 1) * ph
        const rot = chunk.rotation % 360
        return {
            w: rot === 90 || rot === 270 ? localH : localW,
            h: rot === 90 || rot === 270 ? localW : localH
        }
    }

    // Check what fraction of a chunk's bounding box overlaps the overlay area
    _chunkOverlapFraction(chunk) {
        const center = this.getChunkWorldCenter(chunk.id)
        const size = this._getChunkWorldSize(chunk)
        const puzzleW = this.puzzleData.puzzleWidth
        const puzzleH = this.puzzleData.puzzleHeight

        const cL = center[0] - size.w / 2
        const cR = center[0] + size.w / 2
        const cT = center[1] - size.h / 2
        const cB = center[1] + size.h / 2

        const oL = Math.max(cL, -puzzleW / 2)
        const oR = Math.min(cR, puzzleW / 2)
        const oT = Math.max(cT, -puzzleH / 2)
        const oB = Math.min(cB, puzzleH / 2)

        if (oL >= oR || oT >= oB) return 0
        return ((oR - oL) * (oB - oT)) / (size.w * size.h)
    }

    cleanup(canvasAspect, skipInside = false) {
        const pw = this.puzzleData.pieceW
        const minMargin = pw * 0.75

        const allChunks = Array.from(this.chunks.values())
        if (allChunks.length === 0) return null

        // Separate chunks: leave ones mostly inside the overlay area alone
        const toOrganize = []
        for (const chunk of allChunks) {
            if (skipInside && this._chunkOverlapFraction(chunk) > 0.5) continue
            toOrganize.push(chunk)
        }

        const n = toOrganize.length
        if (n === 0) return null

        // Compute world center for chunks to organize
        const chunkCenters = toOrganize.map((chunk) => ({
            chunk,
            center: this.getChunkWorldCenter(chunk.id)
        }))

        // Compute bounding size of each chunk accounting for rotation
        const sizes = toOrganize.map((chunk) => this._getChunkWorldSize(chunk))
        const maxChunkW = Math.max(...sizes.map((s) => s.w))
        const maxChunkH = Math.max(...sizes.map((s) => s.h))

        // Cell size: minimum needed to fit chunks with margin
        const cellW = maxChunkW + minMargin
        const cellH = maxChunkH + minMargin

        // Reserve zone for the solution overlay (centered at origin, with margin)
        const puzzleW = this.puzzleData.puzzleWidth
        const puzzleH = this.puzzleData.puzzleHeight
        const reservePad = pw * 0.5
        const reserveLeft = -puzzleW / 2 - reservePad
        const reserveRight = puzzleW / 2 + reservePad
        const reserveTop = -puzzleH / 2 - reservePad
        const reserveBottom = puzzleH / 2 + reservePad

        // Build grid, expanding until enough cells exist outside the reserve zone
        let cols = Math.max(1, Math.round(Math.sqrt(n * canvasAspect)))
        let rows = Math.ceil(n / cols)
        let freeCells

        while (true) {
            const totalW = cols * cellW
            const totalH = rows * cellH
            const sx = -totalW / 2
            const sy = -totalH / 2

            freeCells = []
            for (let gr = 0; gr < rows; gr++) {
                for (let gc = 0; gc < cols; gc++) {
                    const cx = sx + (gc + 0.5) * cellW
                    const cy = sy + (gr + 0.5) * cellH
                    // Skip if cell overlaps the reserve zone
                    if (
                        cx + cellW / 2 > reserveLeft &&
                        cx - cellW / 2 < reserveRight &&
                        cy + cellH / 2 > reserveTop &&
                        cy - cellH / 2 < reserveBottom
                    ) {
                        continue
                    }
                    freeCells.push({ gc, gr })
                }
            }

            if (freeCells.length >= n) break
            if (cols / rows < canvasAspect) cols++
            else rows++
        }

        // Sort spatially: match chunk bands to how many free cells each grid row has
        // so rows near the hole (with fewer cells) get fewer chunks
        const cellsPerRow = new Array(rows).fill(0)
        for (const { gr } of freeCells) {
            cellsPerRow[gr]++
        }
        chunkCenters.sort((a, b) => a.center[1] - b.center[1])
        const sorted = []
        let ci = 0
        for (let r = 0; r < rows; r++) {
            const count = cellsPerRow[r]
            const band = chunkCenters.slice(ci, ci + count)
            band.sort((a, b) => a.center[0] - b.center[0])
            sorted.push(...band.map((cc) => cc.chunk))
            ci += count
        }

        // Place chunks in free cells with deterministic jitter for a natural look
        const totalW = cols * cellW
        const totalH = rows * cellH
        const startX = -totalW / 2
        const startY = -totalH / 2
        const jitter = minMargin * 0.3

        for (let i = 0; i < n; i++) {
            const chunk = sorted[i]
            const { gc, gr } = freeCells[i]

            // Deterministic jitter from chunk ID so repeated cleanups are stable
            const h = chunk.id * 2654435761
            const jx = ((h >>> 0) % 1000) / 1000 - 0.5
            const jy = (((h * 2246822519) >>> 0) % 1000) / 1000 - 0.5
            const cellCenterX = startX + (gc + 0.5) * cellW + jx * jitter
            const cellCenterY = startY + (gr + 0.5) * cellH + jy * jitter

            // Place chunk so its visual center lands on the cell center
            const localCenter = this._getChunkLocalCenter(chunk)
            const rad = degToRad(chunk.rotation)
            const rotatedCenter = chunk.rotation === 0 ? localCenter : vec2.rotate(localCenter, rad)

            chunk.setPosition(cellCenterX - rotatedCenter[0], cellCenterY - rotatedCenter[1])
        }

        // Compute actual bounding box of ALL chunks (organized + skipped)
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity
        for (const chunk of allChunks) {
            const center = this.getChunkWorldCenter(chunk.id)
            const size = this._getChunkWorldSize(chunk)
            minX = Math.min(minX, center[0] - size.w / 2)
            maxX = Math.max(maxX, center[0] + size.w / 2)
            minY = Math.min(minY, center[1] - size.h / 2)
            maxY = Math.max(maxY, center[1] + size.h / 2)
        }

        return { totalW: maxX - minX, totalH: maxY - minY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 }
    }

    // ── Rotation around center ──────────────────────────

    _getChunkLocalCenter(chunk) {
        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH
        let cx = 0,
            cy = 0,
            n = 0
        for (const pieceId of chunk.pieces) {
            const piece = this.pieces[pieceId]
            cx += piece.col * pw + pw / 2
            cy += piece.row * ph + ph / 2
            n++
        }
        return n > 0 ? [cx / n, cy / n] : [0, 0]
    }

    getChunkWorldCenter(chunkId) {
        const chunk = this.chunks.get(chunkId)
        if (!chunk) return [0, 0]
        return mat3.transformPoint(chunk.worldMatrix, this._getChunkLocalCenter(chunk))
    }

    rotateChunkAroundCenter(chunkId) {
        const chunk = this.chunks.get(chunkId)
        if (!chunk) return

        const localCenter = this._getChunkLocalCenter(chunk)
        const worldCenterBefore = mat3.transformPoint(chunk.worldMatrix, localCenter)

        chunk.setRotation(chunk.rotation + 90)

        const worldCenterAfter = mat3.transformPoint(chunk.worldMatrix, localCenter)

        chunk.setPosition(
            chunk.x + worldCenterBefore[0] - worldCenterAfter[0],
            chunk.y + worldCenterBefore[1] - worldCenterAfter[1]
        )
    }

    // Move chunk to top of draw order
    bringToFront(chunkId) {
        const chunk = this.chunks.get(chunkId)
        if (!chunk) return
        this.chunks.delete(chunkId)
        this.chunks.set(chunkId, chunk)
    }

    // ── Serialization ─────────────────────────────────

    serialize() {
        const chunks = []
        for (const chunk of this.chunks.values()) {
            chunks.push({
                id: chunk.id,
                x: chunk.x,
                y: chunk.y,
                rotation: chunk.rotation,
                pieces: Array.from(chunk.pieces)
            })
        }
        return chunks
    }
}
