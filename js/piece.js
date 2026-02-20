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

    cleanup() {
        const pw = this.puzzleData.pieceW
        const spacing = pw * 1.5

        // Sort chunks: largest first, then by ID
        const sorted = Array.from(this.chunks.values()).sort((a, b) => {
            const sizeA = a.pieces.size
            const sizeB = b.pieces.size
            if (sizeB !== sizeA) return sizeB - sizeA
            return a.id - b.id
        })

        // Arrange in a grid
        const gridCols = Math.ceil(Math.sqrt(sorted.length))
        let idx = 0

        for (const chunk of sorted) {
            const gridCol = idx % gridCols
            const gridRow = Math.floor(idx / gridCols)

            // Estimate chunk bounding box (rough: use piece count)
            const chunkPieceCount = chunk.pieces.size
            const estSize = Math.ceil(Math.sqrt(chunkPieceCount))
            const cellSize = Math.max(estSize * pw + spacing, pw * 3)

            const x = gridCol * cellSize - (gridCols * cellSize) / 2
            const y = gridRow * cellSize - (Math.ceil(sorted.length / gridCols) * cellSize) / 2

            chunk.setPosition(x, y)
            idx++
        }
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
