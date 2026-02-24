// -- vec2 ----------------------------------------------
export const vec2 = {
    create(x = 0, y = 0) {
        return [x, y]
    },
    add(a, b) {
        return [a[0] + b[0], a[1] + b[1]]
    },
    sub(a, b) {
        return [a[0] - b[0], a[1] - b[1]]
    },
    scale(a, s) {
        return [a[0] * s, a[1] * s]
    },
    dot(a, b) {
        return a[0] * b[0] + a[1] * b[1]
    },
    length(a) {
        return Math.sqrt(a[0] * a[0] + a[1] * a[1])
    },
    lengthSq(a) {
        return a[0] * a[0] + a[1] * a[1]
    },
    normalize(a) {
        const len = vec2.length(a)
        return len > 0 ? [a[0] / len, a[1] / len] : [0, 0]
    },
    distance(a, b) {
        return vec2.length(vec2.sub(a, b))
    },
    distanceSq(a, b) {
        return vec2.lengthSq(vec2.sub(a, b))
    },
    rotate(a, angle) {
        const c = Math.cos(angle),
            s = Math.sin(angle)
        return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]
    },
    lerp(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    },
    negate(a) {
        return [-a[0], -a[1]]
    },
    clone(a) {
        return [a[0], a[1]]
    }
}

// -- mat3 (column-major flat array [9]) ---------------
export const mat3 = {
    identity() {
        return [1, 0, 0, 0, 1, 0, 0, 0, 1]
    },

    multiply(a, b) {
        return [
            a[0] * b[0] + a[3] * b[1] + a[6] * b[2],
            a[1] * b[0] + a[4] * b[1] + a[7] * b[2],
            a[2] * b[0] + a[5] * b[1] + a[8] * b[2],
            a[0] * b[3] + a[3] * b[4] + a[6] * b[5],
            a[1] * b[3] + a[4] * b[4] + a[7] * b[5],
            a[2] * b[3] + a[5] * b[4] + a[8] * b[5],
            a[0] * b[6] + a[3] * b[7] + a[6] * b[8],
            a[1] * b[6] + a[4] * b[7] + a[7] * b[8],
            a[2] * b[6] + a[5] * b[7] + a[8] * b[8]
        ]
    },

    translate(tx, ty) {
        return [1, 0, 0, 0, 1, 0, tx, ty, 1]
    },

    rotate(angle) {
        const c = Math.cos(angle),
            s = Math.sin(angle)
        return [c, s, 0, -s, c, 0, 0, 0, 1]
    },

    scale(sx, sy) {
        if (sy === undefined) sy = sx
        return [sx, 0, 0, 0, sy, 0, 0, 0, 1]
    },

    invert(m) {
        const a00 = m[0],
            a01 = m[1],
            a02 = m[2]
        const a10 = m[3],
            a11 = m[4],
            a12 = m[5]
        const a20 = m[6],
            a21 = m[7],
            a22 = m[8]

        const b01 = a22 * a11 - a12 * a21
        const b11 = -a22 * a10 + a12 * a20
        const b21 = a21 * a10 - a11 * a20

        let det = a00 * b01 + a01 * b11 + a02 * b21
        if (!det) return null
        det = 1.0 / det

        return [
            b01 * det,
            (-a22 * a01 + a02 * a21) * det,
            (a12 * a01 - a02 * a11) * det,
            b11 * det,
            (a22 * a00 - a02 * a20) * det,
            (-a12 * a00 + a02 * a10) * det,
            b21 * det,
            (-a21 * a00 + a01 * a20) * det,
            (a11 * a00 - a01 * a10) * det
        ]
    },

    transformPoint(m, p) {
        return [m[0] * p[0] + m[3] * p[1] + m[6], m[1] * p[0] + m[4] * p[1] + m[7]]
    }
}

// -- Bezier --------------------------------------------
export function cubicBezier(t, p0, p1, p2, p3) {
    const mt = 1 - t
    const mt2 = mt * mt
    const t2 = t * t
    return [
        mt2 * mt * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t2 * t * p3[0],
        mt2 * mt * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t2 * t * p3[1]
    ]
}

export function flattenCubicBezier(p0, p1, p2, p3, tolerance = 0.5) {
    const points = [p0]
    _subdivide(p0, p1, p2, p3, tolerance * tolerance, points)
    points.push(p3)
    return points
}

function _subdivide(p0, p1, p2, p3, tolSq, points) {
    const mid = cubicBezier(0.5, p0, p1, p2, p3)
    const direct = vec2.lerp(p0, p3, 0.5)
    if (vec2.distanceSq(mid, direct) < tolSq) return

    const p01 = vec2.lerp(p0, p1, 0.5)
    const p12 = vec2.lerp(p1, p2, 0.5)
    const p23 = vec2.lerp(p2, p3, 0.5)
    const p012 = vec2.lerp(p01, p12, 0.5)
    const p123 = vec2.lerp(p12, p23, 0.5)
    const p0123 = vec2.lerp(p012, p123, 0.5)

    _subdivide(p0, p01, p012, p0123, tolSq, points)
    points.push(p0123)
    _subdivide(p0123, p123, p23, p3, tolSq, points)
}

// -- Seeded PRNG (mulberry32) --------------------------
export function mulberry32(seed) {
    let s = seed | 0
    return function () {
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// -- Geometry helpers ----------------------------------
export function pointInPolygon(point, vertices) {
    const [px, py] = point
    let inside = false
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const [xi, yi] = vertices[i]
        const [xj, yj] = vertices[j]
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}

export function aabbFromPoints(points) {
    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
    for (const p of points) {
        if (p[0] < minX) minX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] > maxY) maxY = p[1]
    }
    return { minX, minY, maxX, maxY }
}

export function aabbOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

export function pointInAABB(point, aabb) {
    return point[0] >= aabb.minX && point[0] <= aabb.maxX && point[1] >= aabb.minY && point[1] <= aabb.maxY
}

export function degToRad(deg) {
    return (deg * Math.PI) / 180
}

export function radToDeg(rad) {
    return (rad * 180) / Math.PI
}
