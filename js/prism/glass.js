/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Raw WebGL2 glass prism renderer (halo spec 5d). No dependencies.
 */
import { prismMeshData } from './prism-mesh.js';
import { SHADERS } from './glass-shaders.js';
import { createProgram, enableFloatTargets, createRenderTarget, deleteRenderTarget } from './gl-util.js';

const IOR = 1.645;
const F0 = ((IOR - 1) / (IOR + 1)) ** 2;
const REFLECTION_STRENGTH = 2.14;
const ABSORPTION_PER_SIDE = Object.freeze([1.0, 1.0, 0.54]);
const REFERENCE_SIDE = 0.57;
const CONTEXT_OPTIONS = Object.freeze({
  antialias: true,
  alpha: false,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
  depth: true,
});

function buildResources(gl) {
  if (!enableFloatTargets(gl)) throw new Error('No float render target extension');
  const probe = createRenderTarget(gl, 4, 4);
  if (!probe) throw new Error('Half-float render target is not renderable');
  deleteRenderTarget(gl, probe);
  const programs = {
    bg: createProgram(gl, SHADERS.fullscreenVert, SHADERS.bgFrag, 'bg'),
    blit: createProgram(gl, SHADERS.fullscreenVert, SHADERS.blitFrag, 'blit'),
    back: createProgram(gl, SHADERS.glassVert, SHADERS.glassBackFrag, 'glass-back'),
    front: createProgram(gl, SHADERS.glassVert, SHADERS.glassFrontFrag, 'glass-front'),
  };
  const lightTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lightTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {
    programs,
    lightTex,
    emptyVao: gl.createVertexArray(),
    mesh: null,
    target: null,
  };
}

function uploadMesh(gl, S) {
  const data = prismMeshData(S);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
  const stride = 24;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const planes = new Float32Array(20);
  data.planes.forEach((p, i) => planes.set([...p.normal, p.offset], i * 4));
  return { S, vao, vbo, ibo, count: data.indices.length, planes };
}

function freeMesh(gl, mesh) {
  if (!mesh) return;
  gl.deleteVertexArray(mesh.vao);
  gl.deleteBuffer(mesh.vbo);
  gl.deleteBuffer(mesh.ibo);
}

function setGlassUniforms(gl, prog, mesh, camera, S) {
  const u = prog.uniforms;
  const k = REFERENCE_SIDE / S;
  gl.uniformMatrix4fv(u.uViewProj, false, camera.viewProj);
  gl.uniform3fv(u.uCamPos, camera.eye);
  gl.uniform4fv(u.uPlanes, mesh.planes);
  gl.uniform1f(u.uIor, IOR);
  gl.uniform1f(u.uF0, F0);
  gl.uniform1f(u.uRefl, REFLECTION_STRENGTH);
  gl.uniform3f(u.uAbsorb, ABSORPTION_PER_SIDE[0] * k, ABSORPTION_PER_SIDE[1] * k, ABSORPTION_PER_SIDE[2] * k);
}

function drawFullscreen(gl, res) {
  gl.bindVertexArray(res.emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function uploadLight(gl, res, fxCanvas) {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, res.lightTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  // Premultiplied upload keeps the canvas' native precision; un-premultiplying
  // low-alpha bloom pixels quantizes rgb into visible blocks.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const { width, height } = fxCanvas;
  if (width <= 0 || height <= 0) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    res.lightSize = null;
    return;
  }
  // Allocate storage only when the size changes; otherwise update in place.
  const sized = res.lightSize && res.lightSize.w === width && res.lightSize.h === height;
  if (sized) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, fxCanvas);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fxCanvas);
    res.lightSize = { w: width, h: height };
  }
}

function passBackground(gl, res, w, h) {
  const p = res.programs.bg;
  gl.bindFramebuffer(gl.FRAMEBUFFER, res.target.fbo);
  gl.useProgram(p.program);
  gl.uniform1i(p.uniforms.uLight, 1);
  gl.uniform2f(p.uniforms.uRes, w, h);
  drawFullscreen(gl, res);
}

function passBack(gl, res, layout, camera) {
  const p = res.programs.back;
  gl.useProgram(p.program);
  setGlassUniforms(gl, p, res.mesh, camera, layout.S);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(res.mesh.vao);
  gl.drawElements(gl.TRIANGLES, res.mesh.count, gl.UNSIGNED_SHORT, 0);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
}

function passBlit(gl, res, w, h) {
  const p = res.programs.blit;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, res.target.texture);
  gl.useProgram(p.program);
  gl.uniform1i(p.uniforms.uScene, 0);
  gl.uniform2f(p.uniforms.uRes, w, h);
  drawFullscreen(gl, res);
}

function passFront(gl, res, layout, camera, w, h) {
  const p = res.programs.front;
  gl.useProgram(p.program);
  setGlassUniforms(gl, p, res.mesh, camera, layout.S);
  gl.uniform1i(p.uniforms.uScene, 0);
  gl.uniform2f(p.uniforms.uRes, w, h);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.bindVertexArray(res.mesh.vao);
  gl.drawElements(gl.TRIANGLES, res.mesh.count, gl.UNSIGNED_SHORT, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
}

function renderFrame(gl, res, fxCanvas, layout, camera, w, h) {
  gl.viewport(0, 0, w, h);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  uploadLight(gl, res, fxCanvas);
  passBackground(gl, res, w, h);
  passBack(gl, res, layout, camera);
  passBlit(gl, res, w, h);
  passFront(gl, res, layout, camera, w, h);
}

/**
 * Create the WebGL2 glass renderer.
 * @param {HTMLCanvasElement} glCanvas canvas to render into
 * @param {HTMLCanvasElement} fxCanvas 2D light canvas (screen space, same stage size)
 * @param {() => void} [onChange] called after context loss / restore so the caller can redraw
 * @returns {null | { resize(layout: object): void, render(frame: {layout: object, camera: object}): boolean, dispose(): void, lost: boolean }}
 *   null when WebGL2 or a renderable half-float target is unavailable.
 *   render returns false when nothing was drawn (lost context, no render target).
 */
export function createGlass(glCanvas, fxCanvas, onChange = () => {}) {
  const gl = glCanvas.getContext('webgl2', CONTEXT_OPTIONS);
  if (!gl) return null;
  let res;
  try {
    res = buildResources(gl);
  } catch (error) {
    return null;
  }
  let lost = false;
  let size = { w: 0, h: 0 };

  const resize = (layout) => {
    const w = Math.max(1, Math.round(layout.W * layout.dpr));
    const h = Math.max(1, Math.round(layout.H * layout.dpr));
    if (w === size.w && h === size.h && res.target) return;
    glCanvas.width = w;
    glCanvas.height = h;
    deleteRenderTarget(gl, res.target);
    res.target = createRenderTarget(gl, w, h);
    size = { w, h };
  };
  const onLost = (event) => {
    event.preventDefault();
    lost = true;
    onChange();
  };
  const onRestored = () => {
    try {
      res = buildResources(gl);
      size = { w: 0, h: 0 };
      lost = false;
    } catch (error) {
      lost = true;
    }
    onChange();
  };
  glCanvas.addEventListener('webglcontextlost', onLost);
  glCanvas.addEventListener('webglcontextrestored', onRestored);

  const render = ({ layout, camera }) => {
    if (lost || gl.isContextLost()) return false;
    resize(layout);
    if (!res.target) return false;
    if (!res.mesh || res.mesh.S !== layout.S) {
      freeMesh(gl, res.mesh);
      res.mesh = uploadMesh(gl, layout.S);
    }
    renderFrame(gl, res, fxCanvas, layout, camera, size.w, size.h);
    return true;
  };
  const dispose = () => {
    glCanvas.removeEventListener('webglcontextlost', onLost);
    glCanvas.removeEventListener('webglcontextrestored', onRestored);
    if (!gl.isContextLost()) {
      freeMesh(gl, res.mesh);
      deleteRenderTarget(gl, res.target);
    }
    lost = true;
  };
  return {
    resize,
    render,
    dispose,
    get lost() {
      return lost;
    },
  };
}
