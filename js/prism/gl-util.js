/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Small raw-WebGL2 helpers: shader/program creation and render targets.
 */

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed (${label}): ${log}`);
  }
  return shader;
}

/**
 * Compile and link a program; returns {program, uniforms} with all active
 * uniform locations keyed by name (array suffix "[0]" stripped).
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertSrc
 * @param {string} fragSrc
 * @param {string} label
 * @throws {Error} with the info log on failure
 */
export function createProgram(gl, vertSrc, fragSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${label}.frag`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed (${label}): ${log}`);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return Object.freeze({ program, uniforms });
}

/** Enable a color-renderable half-float extension and return true if present. */
export function enableFloatTargets(gl) {
  const full = gl.getExtension('EXT_color_buffer_float');
  const half = gl.getExtension('EXT_color_buffer_half_float');
  return Boolean(full || half);
}

/**
 * Create an RGBA16F color render target; returns null when incomplete.
 * @param {WebGL2RenderingContext} gl
 * @param {number} width
 * @param {number} height
 */
export function createRenderTarget(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    return null;
  }
  return Object.freeze({ texture, fbo, width, height });
}

/** Free a render target made by createRenderTarget. */
export function deleteRenderTarget(gl, target) {
  if (!target) return;
  gl.deleteFramebuffer(target.fbo);
  gl.deleteTexture(target.texture);
}
