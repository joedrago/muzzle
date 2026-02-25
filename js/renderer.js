import { mat3 } from "./math-utils.js"

// -- Shader sources ------------------------------------

const PIECE_VS = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  uniform mat3 u_camera;
  uniform mat3 u_model;
  varying vec2 v_uv;
  void main() {
    vec3 world = u_model * vec3(a_position, 1.0);
    vec3 screen = u_camera * world;
    gl_Position = vec4(screen.xy, 0.0, 1.0);
    v_uv = a_uv;
  }
`

const PIECE_FS = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  uniform float u_alpha;
  uniform float u_highlight;
  void main() {
    vec4 color = texture2D(u_texture, v_uv);
    vec3 tinted = mix(color.rgb, vec3(0.4, 0.6, 1.0), u_highlight);
    gl_FragColor = vec4(tinted, color.a * u_alpha);
  }
`

const FLAT_VS = `
  attribute vec2 a_position;
  uniform mat3 u_camera;
  uniform mat3 u_model;
  void main() {
    vec3 world = u_model * vec3(a_position, 1.0);
    vec3 screen = u_camera * world;
    gl_Position = vec4(screen.xy, 0.0, 1.0);
  }
`

const FLAT_FS = `
  precision mediump float;
  uniform vec4 u_color;
  void main() {
    gl_FragColor = u_color;
  }
`

// -- Shader compilation helpers ------------------------

function compileShader(gl, type, source) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compile error:", gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
    }
    return shader
}

function createProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
    const program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Program link error:", gl.getProgramInfoLog(program))
        return null
    }
    return program
}

// -- Renderer class ------------------------------------

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas
        this.gl =
            canvas.getContext("webgl", { alpha: false, premultipliedAlpha: false, antialias: true }) ||
            canvas.getContext("experimental-webgl", { alpha: false })
        if (!this.gl) throw new Error("WebGL not supported")

        const gl = this.gl

        // Programs
        this.pieceProgram = createProgram(gl, PIECE_VS, PIECE_FS)
        this.flatProgram = createProgram(gl, FLAT_VS, FLAT_FS)

        // Piece program locations
        this.pieceLocs = {
            a_position: gl.getAttribLocation(this.pieceProgram, "a_position"),
            a_uv: gl.getAttribLocation(this.pieceProgram, "a_uv"),
            u_camera: gl.getUniformLocation(this.pieceProgram, "u_camera"),
            u_model: gl.getUniformLocation(this.pieceProgram, "u_model"),
            u_texture: gl.getUniformLocation(this.pieceProgram, "u_texture"),
            u_alpha: gl.getUniformLocation(this.pieceProgram, "u_alpha"),
            u_highlight: gl.getUniformLocation(this.pieceProgram, "u_highlight")
        }

        // Flat program locations
        this.flatLocs = {
            a_position: gl.getAttribLocation(this.flatProgram, "a_position"),
            u_camera: gl.getUniformLocation(this.flatProgram, "u_camera"),
            u_model: gl.getUniformLocation(this.flatProgram, "u_model"),
            u_color: gl.getUniformLocation(this.flatProgram, "u_color")
        }

        // Camera state
        this.camera = { x: 0, y: 0, zoom: 1 }

        // Quad buffer for overlays
        this.quadVBO = gl.createBuffer()

        // Selection rect buffer
        this.rectVBO = gl.createBuffer()

        // Setup
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.disable(gl.DEPTH_TEST)
        gl.clearColor(0.1, 0.1, 0.12, 1.0)

        this.resize()
    }

    resize() {
        const dpr = window.devicePixelRatio || 1
        this.canvas.width = this.canvas.clientWidth * dpr
        this.canvas.height = this.canvas.clientHeight * dpr
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    }

    // Build camera matrix: world coords → clip space [-1,1]
    getCameraMatrix() {
        const w = this.canvas.width
        const h = this.canvas.height
        const z = this.camera.zoom

        // translate by -camera, scale by zoom, then to NDC
        let m = mat3.identity()
        m = mat3.multiply(mat3.translate(-this.camera.x, -this.camera.y), m)
        m = mat3.multiply(mat3.scale(z, z), m)
        m = mat3.multiply(mat3.scale(2 / w, -2 / h), m) // flip Y for screen coords
        return m
    }

    // Convert screen pixel position to world coordinates
    screenToWorld(sx, sy) {
        const dpr = window.devicePixelRatio || 1
        const px = sx * dpr
        const py = sy * dpr
        const w = this.canvas.width
        const h = this.canvas.height
        const z = this.camera.zoom

        // Invert the camera transform
        const wx = (px - w / 2) / z + this.camera.x
        const wy = (py - h / 2) / z + this.camera.y
        return [wx, wy]
    }

    // Convert world coordinates to screen pixels
    worldToScreen(wx, wy) {
        const dpr = window.devicePixelRatio || 1
        const w = this.canvas.width
        const h = this.canvas.height
        const z = this.camera.zoom

        const px = (wx - this.camera.x) * z + w / 2
        const py = (wy - this.camera.y) * z + h / 2
        return [px / dpr, py / dpr]
    }

    zoomAtScreen(sx, sy, factor) {
        const [wx, wy] = this.screenToWorld(sx, sy)
        this.camera.zoom *= factor
        this.camera.zoom = Math.max(0.1, Math.min(10, this.camera.zoom))
        // After zoom, world point under cursor should stay at same screen pos
        const [nwx, nwy] = this.screenToWorld(sx, sy)
        this.camera.x += wx - nwx
        this.camera.y += wy - nwy
    }

    // -- Texture management ------------------------------

    createTexture(source) {
        const gl = this.gl
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        if (source) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
        }
        return tex
    }

    updateTexture(tex, source) {
        const gl = this.gl
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    }

    // -- Buffer creation ---------------------------------

    createVBO(data) {
        const gl = this.gl
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
        return buf
    }

    createIBO(data) {
        const gl = this.gl
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW)
        return buf
    }

    // -- Drawing -----------------------------------------

    clear() {
        const gl = this.gl
        gl.clear(gl.COLOR_BUFFER_BIT)
    }

    drawPiece(vbo, ibo, triCount, modelMatrix, texture, alpha = 1.0, highlight = 0.0) {
        const gl = this.gl
        const locs = this.pieceLocs
        const cam = this.getCameraMatrix()

        gl.useProgram(this.pieceProgram)

        // Camera
        gl.uniformMatrix3fv(locs.u_camera, false, cam)
        gl.uniformMatrix3fv(locs.u_model, false, modelMatrix)
        gl.uniform1f(locs.u_alpha, alpha)
        gl.uniform1f(locs.u_highlight, highlight)

        // Texture
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.uniform1i(locs.u_texture, 0)

        // VBO: interleaved [x, y, u, v]
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
        gl.enableVertexAttribArray(locs.a_position)
        gl.vertexAttribPointer(locs.a_position, 2, gl.FLOAT, false, 16, 0)
        gl.enableVertexAttribArray(locs.a_uv)
        gl.vertexAttribPointer(locs.a_uv, 2, gl.FLOAT, false, 16, 8)

        // IBO
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
        gl.drawElements(gl.TRIANGLES, triCount * 3, gl.UNSIGNED_SHORT, 0)

        gl.disableVertexAttribArray(locs.a_position)
        gl.disableVertexAttribArray(locs.a_uv)
    }

    drawPieceOutline(outlineVBO, vertexCount, modelMatrix, color) {
        const gl = this.gl
        const locs = this.flatLocs
        const cam = this.getCameraMatrix()

        gl.useProgram(this.flatProgram)
        gl.uniformMatrix3fv(locs.u_camera, false, cam)
        gl.uniformMatrix3fv(locs.u_model, false, modelMatrix)
        gl.uniform4fv(locs.u_color, color)

        gl.bindBuffer(gl.ARRAY_BUFFER, outlineVBO)
        gl.enableVertexAttribArray(locs.a_position)
        gl.vertexAttribPointer(locs.a_position, 2, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexCount)
        gl.disableVertexAttribArray(locs.a_position)
    }

    drawRect(x, y, w, h, color) {
        const gl = this.gl
        const locs = this.flatLocs
        const cam = this.getCameraMatrix()

        const verts = new Float32Array([x, y, x + w, y, x + w, y + h, x, y, x + w, y + h, x, y + h])

        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectVBO)
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)

        gl.useProgram(this.flatProgram)
        gl.uniformMatrix3fv(locs.u_camera, false, cam)
        gl.uniformMatrix3fv(locs.u_model, false, mat3.identity())
        gl.uniform4fv(locs.u_color, color)

        gl.enableVertexAttribArray(locs.a_position)
        gl.vertexAttribPointer(locs.a_position, 2, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLES, 0, 6)
        gl.disableVertexAttribArray(locs.a_position)
    }

    drawScreenRect(sx, sy, sw, sh, color) {
        // Draw rectangle in screen space (for selection rect)
        const [wx1, wy1] = this.screenToWorld(sx, sy)
        const [wx2, wy2] = this.screenToWorld(sx + sw, sy + sh)
        this.drawRect(wx1, wy1, wx2 - wx1, wy2 - wy1, color)
    }

    // Draw solution overlay (full puzzle quad)
    // Draw a highlight outline around a piece (for gamepad focus / held indicator)
    drawPieceHighlight(outlineVBO, vertexCount, modelMatrix, color) {
        const gl = this.gl
        const locs = this.flatLocs
        const cam = this.getCameraMatrix()

        gl.useProgram(this.flatProgram)
        gl.uniformMatrix3fv(locs.u_camera, false, cam)
        gl.uniformMatrix3fv(locs.u_model, false, modelMatrix)
        gl.uniform4fv(locs.u_color, color)

        gl.bindBuffer(gl.ARRAY_BUFFER, outlineVBO)
        gl.enableVertexAttribArray(locs.a_position)
        gl.vertexAttribPointer(locs.a_position, 2, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexCount)
        gl.disableVertexAttribArray(locs.a_position)
    }

    drawSolutionOverlay(texture, puzzleX, puzzleY, puzzleW, puzzleH, alpha = 0.35) {
        const gl = this.gl
        const locs = this.pieceLocs
        const cam = this.getCameraMatrix()

        // Quad vertices with UV
        const verts = new Float32Array([
            puzzleX,
            puzzleY,
            0,
            0,
            puzzleX + puzzleW,
            puzzleY,
            1,
            0,
            puzzleX + puzzleW,
            puzzleY + puzzleH,
            1,
            1,
            puzzleX,
            puzzleY,
            0,
            0,
            puzzleX + puzzleW,
            puzzleY + puzzleH,
            1,
            1,
            puzzleX,
            puzzleY + puzzleH,
            0,
            1
        ])

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO)
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)

        gl.useProgram(this.pieceProgram)
        gl.uniformMatrix3fv(locs.u_camera, false, cam)
        gl.uniformMatrix3fv(locs.u_model, false, mat3.identity())
        gl.uniform1f(locs.u_alpha, alpha)
        gl.uniform1f(locs.u_highlight, 0.0)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.uniform1i(locs.u_texture, 0)

        gl.enableVertexAttribArray(locs.a_position)
        gl.vertexAttribPointer(locs.a_position, 2, gl.FLOAT, false, 16, 0)
        gl.enableVertexAttribArray(locs.a_uv)
        gl.vertexAttribPointer(locs.a_uv, 2, gl.FLOAT, false, 16, 8)

        gl.drawArrays(gl.TRIANGLES, 0, 6)

        gl.disableVertexAttribArray(locs.a_position)
        gl.disableVertexAttribArray(locs.a_uv)
    }

    destroy() {
        const gl = this.gl
        gl.deleteProgram(this.pieceProgram)
        gl.deleteProgram(this.flatProgram)
        gl.deleteBuffer(this.quadVBO)
        gl.deleteBuffer(this.rectVBO)
    }
}
