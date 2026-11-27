// 高清分层素材的骨骼网格渲染。
// 每个姿势（站、坐、趴、睡）是一套独立的图层和骨骼，坐标一律用素材原图像素（rig.json 的画布坐标）。
// 这里只管"怎么画"：建网格、算骨骼、蒙皮、两节腿的 IK、眼睛嘴巴零件、叼纸条、离屏合成。
// 动作和行为在 pet.js。数据来自 tools/build_hd.py 生成的 window.BEAGLE_HD。
(function (root) {
'use strict';
const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- 2D 仿射矩阵 [a b c d e f]：x' = a x + c y + e，y' = b x + d y + f ----------
const I = () => [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const Tm = (x, y) => [1, 0, 0, 1, x, y];
const Rm = deg => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [c, s, -s, c, 0, 0]; };
const Sm = (x, y) => [x, 0, 0, y, 0, 0];
// 骨骼的局部变换：绕自己的枢轴 p 旋转、缩放，再平移 t。静止时是单位矩阵，所以素材原样摆放。
function localM(b) {
  const c = Math.cos(b.rot * D2R), s = Math.sin(b.rot * D2R);
  const a = c * b.sx, bb = s * b.sx, cc = -s * b.sy, d = c * b.sy;
  return [a, bb, cc, d, b.px + b.tx - (a * b.px + cc * b.py), b.py + b.ty - (bb * b.px + d * b.py)];
}

// ---------- WebGL ----------
function createRenderer(cv) {
  // 不开抗锯齿、不保留上一帧：整只狗是先画进离屏层再贴上来的，屏幕这层不需要这两样，省掉每帧一整屏的拷贝
  const opts = { premultipliedAlpha: true, alpha: true, depth: false, antialias: false, preserveDrawingBuffer: false };
  let gl = null, gl2 = false;
  try { gl = cv.getContext('webgl2', opts); gl2 = !!gl; } catch (e) { gl = null; }
  if (!gl) gl = cv.getContext('webgl', opts);
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 aP;attribute vec2 aU;attribute vec2 aU2;attribute vec2 aF;uniform vec2 uO;uniform vec2 uR;varying vec2 vU;varying vec2 vU2;varying vec2 vF;void main(){vU=aU;vU2=aU2;vF=aF;vec2 c=(aP-uO)/uR*2.0-1.0;gl_Position=vec4(c.x,-c.y,0.0,1.0);}'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 vU;varying vec2 vU2;uniform sampler2D uT;uniform sampler2D uT2;uniform float uA;uniform float uMix;varying vec2 vF;void main(){vec4 col=texture2D(uT,vU);if(uMix!=0.0){col=mix(col,texture2D(uT2,vU2),uMix<0.0?vF.x:uMix);if(uMix<0.0)col*=1.0-vF.y;}gl_FragColor=col*uA;}'));
  gl.linkProgram(prog); gl.useProgram(prog);
  const aP = gl.getAttribLocation(prog, 'aP'), aU = gl.getAttribLocation(prog, 'aU');
  const uO = gl.getUniformLocation(prog, 'uO'), uR = gl.getUniformLocation(prog, 'uR'), uA = gl.getUniformLocation(prog, 'uA');
  const aU2 = gl.getAttribLocation(prog, 'aU2'), uT2 = gl.getUniformLocation(prog, 'uT2'), uMix = gl.getUniformLocation(prog, 'uMix');
  // 两个基础顶点属性在整次渲染会话中始终启用；姿势混合只切换自己的额外属性。
  gl.enableVertexAttribArray(aP); gl.enableVertexAttribArray(aU);
  let lastOpacity = -1;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

  // 画布坐标（逻辑像素）里的哪块区域映射到当前绘制目标
  function setView(x, y, w, h) { gl.uniform2f(uO, x, y); gl.uniform2f(uR, w, h); }
  // mip=true 的贴图生成多级纹理，狗缩得很小时边缘也不闪（只有 WebGL2 支持非 2 的幂尺寸）
  function tex(src, t, mip) {
    t = t || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const useMip = !!(mip && gl2);
    if (useMip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, useMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function bufs(m) {
    m.pb = gl.createBuffer(); m.ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.ub); gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.STATIC_DRAW);
    m.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    return m;
  }
  const quad = () => bufs({ pos: new Float32Array(8), uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]) });
  function drawMesh(m, t, alpha) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    const opacity = alpha == null ? 1 : alpha;
    if (opacity !== lastOpacity){ gl.uniform1f(uA, opacity); lastOpacity = opacity; }
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.ub); gl.vertexAttribPointer(aU, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib); gl.drawElements(gl.TRIANGLES, m.idx.length, gl.UNSIGNED_SHORT, 0);
  }
  // 两幅分层贴图有不同的 UV，使用同一组屏幕顶点，在一个片元里混合预乘颜色。
  const aF = gl.getAttribLocation(prog, 'aF');
  let fadeBuffer;
  function drawMatched(a, b, textureA, textureB, progress, alpha, fades) {
    if (fades) {
      fadeBuffer ||= gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fadeBuffer);
      // 首分量让两张纹理在同一个轮廓上交接，可选第二分量只羽化新生成的边沿。
      const components = fades.length===a.pos.length ? 2 : 1;
      gl.bufferData(gl.ARRAY_BUFFER, fades, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(aF); gl.vertexAttribPointer(aF,components,gl.FLOAT,false,0,0);
    }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, textureB);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(uT2, 1); gl.uniform1f(uMix, fades ? -1 : progress);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.ub); gl.enableVertexAttribArray(aU2); gl.vertexAttribPointer(aU2, 2, gl.FLOAT, false, 0, 0);
    drawMesh(a, textureA, alpha);
    if (fades) gl.disableVertexAttribArray(aF);
    gl.disableVertexAttribArray(aU2); gl.uniform1f(uMix, 0); gl.uniform1i(uT2, 0);
  }
  // 离屏层：整只狗先画进一张贴图，再整体按透明度贴到屏幕上（变淡、换姿势时不会透出身体后面的腿）
  const target = () => ({ fb: null, t: null, w: 0, h: 0 });
  function bindTarget(tg, w, h) {
    if (!tg.fb || tg.w !== w || tg.h !== h) {
      if (tg.t) gl.deleteTexture(tg.t);
      if (tg.fb) gl.deleteFramebuffer(tg.fb);
      tg.t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tg.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tg.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tg.t, 0);
      tg.w = w; tg.h = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, tg.fb); gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  // 屏幕上只有底部 clipH 个物理像素露在窗口里，清屏和画都只动这一块
  let clipH = 0;
  function setClip(h) { clipH = h; }
  function bindScreen() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cv.width, cv.height);
    if (clipH > 0 && clipH < cv.height) { gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, cv.width, clipH); } else gl.disable(gl.SCISSOR_TEST);
  }
  // 离屏贴图的第 0 行在下面，所以贴回屏幕时 v 要上下翻
  const flipQuad = bufs({ pos: new Float32Array(8), uv: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), idx: new Uint16Array([0, 1, 2, 0, 2, 3]) });
  function drawTarget(tg, x, y, w, h, alpha) {
    const p = flipQuad.pos; p[0] = x; p[1] = y; p[2] = x + w; p[3] = y; p[4] = x + w; p[5] = y + h; p[6] = x; p[7] = y + h;
    drawMesh(flipQuad, tg.t, alpha);
  }
  return { gl, gl2, setView, tex, bufs, quad, drawMesh, drawMatched, target, bindTarget, bindScreen, drawTarget, setClip };
}

// ---------- 读图、建网格 ----------
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('素材图片加载失败')); im.src = src; });
}
function alphaOf(im) {
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
  const pixels = x.getImageData(0, 0, im.width, im.height).data;
  c.width = c.height = 0;
  return pixels;
}
// 按网格切图层，只保留有像素的格子；每个顶点记下各骨骼的权重
function buildMesh(R, layer, im, wf, bones, grid, al) {
  const W = layer.w, H = layer.h, sx = im.width / W, sy = im.height / H, iw = im.width, ih = im.height;
  const nx = Math.ceil(W / grid), ny = Math.ceil(H / grid);
  const rest = [], uv = [], wts = [], idx = [];
  const used = (i0, j0) => {
    const x0 = Math.max(0, Math.floor(i0 * grid * sx) - 1), x1 = Math.min(iw, Math.ceil((i0 + 1) * grid * sx) + 1);
    const y0 = Math.max(0, Math.floor(j0 * grid * sy) - 1), y1 = Math.min(ih, Math.ceil((j0 + 1) * grid * sy) + 1);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (al[(y * iw + x) * 4 + 3] > 3) return true;
    return false;
  };
  const vUsed = new Uint8Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!used(i, j)) continue;
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    idx.push(a, b, e, a, e, d); vUsed[a] = vUsed[b] = vUsed[d] = vUsed[e] = 1;
  }
  // 全透明的格子不产生三角形，也不需要骨骼权重、逐帧蒙皮和上传。
  const vertex = new Uint32Array(vUsed.length);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++){
    const index = j * (nx+1) + i;
    if (!vUsed[index]) continue;
    const u = Math.min(i*grid, W), v = Math.min(j*grid, H);
    const x = layer.x + u, y = layer.y + v;
    vertex[index] = wts.length;
    rest.push(x,y); uv.push(u/W,v/H); wts.push(wf(x,y));
  }
  const indices = Uint16Array.from(idx, i => vertex[i]);
  return R.bufs({ rest:new Float32Array(rest), wts, bones, pos:new Float32Array(rest.length), uv:new Float32Array(uv), idx:indices });
}
function segProj(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const u = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1), ex = a[0] + dx * u - x, ey = a[1] + dy * u - y;
  return [u, ex * ex + ey * ey];
}

// ---------- 表情零件、纸条 ----------
async function buildKit(R, data) {
  const F = data.face;
  if (!F) return null;
  const kit = { w: F.w, h: F.h, points: F.points, eyes: {}, mouths: {}, note: null, lipTex: null, noteCfg: data.note || null };
  const headIm = await loadImage(F.head);
  kit.headImage = headIm;
  kit.headTex = R.tex(headIm, null, true);
  for (const g of ['eyes', 'mouths']) {
    for (const [k, e] of Object.entries(F[g])) {
      const im = await loadImage(e.src);
      kit[g][k] = { x: e.x, y: e.y, w: e.w, h: e.h, tex: R.tex(im, null, true), im };
    }
  }
  const np = data.props && data.props['note-folded'];
  if (np) {
    const im = await loadImage(np.src);
    kit.note = { w: np.w, h: np.h, anchors: np.anchors, tex: R.tex(im, null, true) };
  }
  // 叼纸条时上嘴唇压在纸条前面：按 composition.json 的遮挡边界，从头部底图+叼物嘴型里抠出这一小块
  if (kit.noteCfg && kit.noteCfg.lipClip && kit.mouths.hold && typeof Path2D !== 'undefined') {
    const s = data.texScale || 1, c = document.createElement('canvas');
    c.width = Math.round(F.w * s); c.height = Math.round(F.h * s);
    const x = c.getContext('2d'); x.scale(s, s); x.clip(new Path2D(kit.noteCfg.lipClip));
    x.drawImage(headIm, 0, 0, F.w, F.h);
    const m = kit.mouths.hold; x.drawImage(m.im, m.x, m.y, m.w, m.h);
    kit.lipTex = R.tex(c, null, true);
    c.width = c.height = 0;
  }
  // 回头时要让眼睛、嘴跟着同一张脸的曲面变形。仅表情改变时重绘一张小纹理。
  let faceCanvas, context, faceKey, uploadedKey, faceTexture;
  kit.faceImage = face => {
    const key = [face.eye,face.eyeP,face.eyeF,face.mouth,face.mouthP,face.mouthF,face.carry].join('/');
    if (faceCanvas && faceKey === key) return faceCanvas;
    if (!faceCanvas) {
      faceCanvas = document.createElement('canvas'); faceCanvas.width = headIm.width; faceCanvas.height = headIm.height;
      // 像素只作为纹理上传，不把这张中间画布交给窗口合成器。
      context = faceCanvas.getContext('2d', {willReadFrequently:true}); context.scale(headIm.width / kit.w, headIm.height / kit.h);
    }
    context.clearRect(0,0,kit.w,kit.h); context.drawImage(headIm,0,0,kit.w,kit.h);
    for (const [group,cur,prev,f] of [[kit.eyes,face.eye,face.eyeP,face.eyeF],[kit.mouths,face.carry ? 'hold' : face.mouth,face.mouthP,face.mouthF]]) {
      const a = group[cur], b = group[prev];
      if (a) context.drawImage(a.im,a.x,a.y,a.w,a.h);
      if (b && prev !== cur && f < 1) { context.globalAlpha = 1-f; context.drawImage(b.im,b.x,b.y,b.w,b.h); context.globalAlpha = 1; }
    }
    faceKey = key; kit.faceRevision = key; return faceCanvas;
  };
  kit.releaseFaceCanvas = () => {
    if(!faceCanvas)return;
    faceCanvas.width=faceCanvas.height=0;
    faceCanvas=context=faceKey=kit.faceRevision=null;
  };
  kit.curvedFace = face => {
    const image = kit.faceImage(face);
    if (!faceTexture || uploadedKey !== faceKey) {
      faceTexture = R.tex(image,faceTexture,true); uploadedKey = faceKey;
    }
    return faceTexture;
  };
  return kit;
}

// ---------- 一个姿势：骨骼、权重、网格 ----------
const LEGS = { 'hind-leg-far': 'hf', 'front-leg-far': 'ff', 'hind-leg-near': 'hn', 'front-leg-near': 'fn' };
// 每个横截面的轮廓中心和宽度，用于把两侧斜视图投影到同一个正面轮廓。
function turnRows(layer, im) {
  const pixels = alphaOf(im), rows = [];
  for (let y = 0; y < im.height; y++) {
    let left = im.width, right = -1;
    for (let x = 0; x < im.width; x++) if (pixels[(y * im.width + x) * 4 + 3] > 80) { left = Math.min(left, x); right = x; }
    rows.push(right < left ? null : [layer.x + (left + right + 1) * .5 * layer.w / im.width, (right - left + 1) * layer.w / im.width]);
  }
  let last = rows.find(Boolean) || [layer.x + layer.w / 2, layer.w];
  return rows.map(row => last = row || last);
}
function prepareTurnProjection(ax, layers, geometry, rows) {
  for (const part of layers) {
    if (!part.mesh) continue;
    const id = part.id, otherId = id.endsWith('-near') ? id.replace('-near','-far') : id.endsWith('-far') ? id.replace('-far','-near') : id;
    const L = geometry[id], other = geometry[otherId], a = rows[id], b = rows[otherId], rest = part.mesh.rest;
    const offsets = new Float32Array(rest.length * 2);
    for (let i = 0; i < rest.length; i += 2) {
      const u = clamp((rest[i + 1] - L.y) / L.h, 0, 1);
      const src = a[Math.round(u * (a.length - 1))], dst = b[Math.round(u * (b.length - 1))];
      const j = i * 2;
      offsets[j] = 2 * ax - dst[0] - src[0];
      offsets[j + 1] = other.y + u * other.h - rest[i + 1];
      offsets[j + 2] = rest[i] - src[0];
      offsets[j + 3] = clamp(dst[1] / Math.max(5,src[1]), .55, 1.85) - 1;
    }
    part.mesh.turnOffsets = offsets;
  }
}
async function buildSet(R, name, P, kit) {
  const L = {};
  for (const l of P.layers) L[l.id] = l;
  const c = (l, p) => [l.x + p[0], l.y + p[1]];
  const bones = {}, order = [];
  const bone = (n, parent, p) => { bones[n] = { n, parent, px: p[0], py: p[1], rot: 0, sx: 1, sy: 1, tx: 0, ty: 0, w: I() }; order.push(n); };
  const body = L.body, head = L.head;
  const pivB = c(body, body.pivot), hipC = c(body, body.hip), chestC = c(body, body.chest), bellyC = c(body, body.belly), neckC = c(body, body.neckBase);
  const ax = pivB[0], ground = P.ground;
  bone('root', null, [ax, ground]);
  bone('body', 'root', pivB);
  bone('hip', 'body', hipC); bone('chest', 'body', chestC); bone('belly', 'body', bellyC);
  bone('neck', 'chest', [lerp(chestC[0], neckC[0], .5), lerp(chestC[1], neckC[1], .5)]);
  const headP = c(head, head.pivot);
  bone('head', 'neck', headP);
  let e0 = null, et = null;
  if (L.ear) { e0 = c(L.ear, L.ear.pivot); et = c(L.ear, L.ear.tip); bone('ear0', 'head', e0); bone('ear1', 'ear0', [lerp(e0[0], et[0], .5), lerp(e0[1], et[1], .5)]); }
  let ch = null;
  if (L.tail) { ch = L.tail.chain.map(p => c(L.tail, p)); bone('tail0', 'hip', ch[0]); bone('tail1', 'tail0', ch[1]); bone('tail2', 'tail1', ch[2]); }
  const legs = {};
  for (const id of Object.keys(LEGS)) {
    const l = L[id]; if (!l) continue;
    const n = LEGS[id], pv = c(l, l.pivot), jt = c(l, l.joint), ft = c(l, l.foot);
    bone(n + 'U', n[0] === 'f' ? 'chest' : 'hip', pv); bone(n + 'L', n + 'U', jt);
    const r1 = Math.atan2(jt[1] - pv[1], jt[0] - pv[0]), r2 = Math.atan2(ft[1] - jt[1], ft[0] - jt[0]), base = Math.atan2(ft[1] - pv[1], ft[0] - pv[0]);
    legs[n] = { id, pv, jt, ft, len1: dist(pv, jt), len2: dist(jt, ft), r1, r2, bend: Math.sign(wrap(r1 - base)) || 1 };
  }

  // 权重：躯干按"臀→胸"的位置在两块骨头间过渡，肚子和脖子各有一团影响区
  const axv = [chestC[0] - hipC[0], chestC[1] - hipC[1]], al2 = axv[0] * axv[0] + axv[1] * axv[1] || 1, Lb = Math.sqrt(al2);
  const bRx = Lb * .42, bRy = Lb * .22, nr = Lb * .3;
  const bodyW = (x, y) => {
    const t = clamp(((x - hipC[0]) * axv[0] + (y - hipC[1]) * axv[1]) / al2, 0, 1);
    let belly = Math.exp(-(((x - bellyC[0]) / bRx) ** 2 + ((y - bellyC[1]) / bRy) ** 2)) * .9;
    let neck = Math.exp(-((x - neckC[0]) ** 2 + (y - neckC[1]) ** 2) / (nr * nr));
    const s = belly + neck; if (s > 1) { belly /= s; neck /= s; }
    const rem = 1 - belly - neck, tt = smooth(0, 1, t);
    return [rem * (1 - tt), rem * tt, belly, neck];
  };
  const legW = g => (x, y) => {
    const [u1, d1] = segProj(x, y, g.pv, g.jt), [u2, d2] = segProj(x, y, g.jt, g.ft);
    const s = d1 <= d2 ? u1 * g.len1 : g.len1 + u2 * g.len2, band = (g.len1 + g.len2) * .09;
    const t = smooth(g.len1 - band, g.len1 + band, s);
    return [1 - t, t];
  };
  const tailW = (x, y) => {
    let best = 1e18, bi = 0, bt = 0;
    for (let i = 0; i < 3; i++) { const [u, d] = segProj(x, y, ch[i], ch[i + 1]); if (d < best) { best = d; bi = i; bt = u; } }
    const w = [0, 0, 0]; w[bi] = 1;
    if (bi < 2 && bt > .6) { const b = (bt - .6) / .4 * .5; w[bi] -= b; w[bi + 1] += b; }
    if (bi > 0 && bt < .4) { const b = (.4 - bt) / .4 * .5; w[bi] -= b; w[bi - 1] += b; }
    return w;
  };
  const earW = (x, y) => { const [u] = segProj(x, y, e0, et); const t = smooth(.35, .8, u); return [1 - t, t]; };

  const ts = 1; // 网格格子按素材原图像素算
  const layers = [], yawRows = {};
  let sweepHead, sweepEar;
  for (const l of P.layers) {
    if (l.id === 'head') {
      const im = l.shared ? kit?.headImage : await loadImage(l.src);
      if (name==='prone' || name==='curl') sweepHead = {layer:l,image:im};
      const t = l.shared ? kit?.headTex : R.tex(im, null, true);
      const points = l.shared ? kit?.points : P.facePoints;
      const profile = im && root.PetRiseMotion?.headProfile(R,name,l,im,points,chestC[0] < hipC[0],kit);
      const turnSection=name==='stand' && im ? root.PetTurn?.contour(name,l,im,alphaOf(im)) : null;
      layers.push({ id: 'head', kind: 'head', tex:t, profile, turnSection });
      continue;
    }
    const im = await loadImage(l.src);
    if ((name==='prone'||name==='curl') && l.id==='ear') sweepEar = {layer:l,image:im};
    if (name === 'turn') yawRows[l.id] = turnRows(l, im);
    let wf, bs, grid = 22 * ts;
    if (l.id === 'body') { wf = bodyW; bs = ['hip', 'chest', 'belly', 'neck']; grid = 26 * ts; }
    else if (l.id === 'tail') { wf = tailW; bs = ['tail0', 'tail1', 'tail2']; }
    else if (l.id === 'ear') { wf = earW; bs = ['ear0', 'ear1']; }
    else if (LEGS[l.id]) { const n = LEGS[l.id]; wf = legW(legs[n]); bs = [n + 'U', n + 'L']; }
    else { const p = l.parent && bones[l.parent] ? l.parent : 'body'; wf = () => [1]; bs = [p]; }
    const pixels = alphaOf(im);
    const profile = root.PetRiseMotion?.profile(R, name, l, im, pixels, wf, bs, chestC[0] < hipC[0]);
    layers.push({ id: l.id, kind: 'mesh', mesh: buildMesh(R, l, im, wf, bs, grid, pixels), tex: R.tex(im, null, true), profile, turnSection:root.PetTurn?.contour(name,l,im,pixels) });
  }
  if (name === 'turn') prepareTurnProjection(ax, layers, L, yawRows);
  // 头部局部坐标（表情零件、叼物点用的坐标）→ 画布坐标：先放到 (x,y)，再绕枢轴转 rotation
  const HL = mul(mul(Tm(headP[0], headP[1]), Rm(head.rotation || 0)), Tm(head.x - headP[0], head.y - headP[1]));
  const bb = P.bbox || [0, 0, P.canvas[0], P.canvas[1]];
  // 胸在臀左边 = 这张图里狗的身体朝左（现有幼犬睡姿就是这样），画的时候镜像过来，和其他姿势同一个朝向
  const mirror = chestC[0] < hipC[0];
  // 关键点：换姿势时两套图之间按这些点对齐、渐变
  const facePoints = head.shared && kit ? kit.points : P.facePoints;
  const eye = facePoints?.eyeCenter || [head.w * .63, head.h * .54];
  const nose = facePoints?.nose || [head.w * .94, head.h * .63];
  const lm = { hip: hipC, chest: chestC, belly: bellyC, head: headP, eye:ap(HL, ...eye), nose:ap(HL,...nose), headRot: head.rotation || 0, tail: ch ? ch[0] : null, tailTip: ch ? ch[3] : null };
  lm.earRoot = e0 || ap(HL,head.w*.27,head.h*.24);
  lm.earTip = et || ap(HL,head.w*.17,head.h*.76);
  const set = {
    name, ground, ax, bbox: bb, restH: ground - bb[1], back: 0, front: 0, mirror, lm,
    bones, order, layers, legs, HL, headW: head.w, headH: head.h, headP,
    faceKit: !!(head.shared && kit), facePoints, eye, nose, muzzleWarp:null,
    defaultFace: P.face || null, earPivot: e0
  };
  setAnchor(set, ax);
  if(name==='sleep' || name==='curl'){
    const tail=layers.find(l=>l.id==='tail');
    const head=layers.find(l=>l.id==='head');
    if(tail && head) {layers.splice(layers.indexOf(tail),1);layers.splice(layers.indexOf(head),0,tail);}
  }
  if (sweepHead?.image && sweepEar && root.PetRiseMotion?.faceView){
    const front = P.turnFace?.src ? await loadImage(P.turnFace.src) : null;
    set.faceView = root.PetRiseMotion.faceView(R,set,sweepHead,sweepEar,kit,front);
  }
  return set;
}

// 换落脚点（姿势坐标里哪一点对着 dog.x）
function setAnchor(set, ax) {
  set.ax = ax; set.bones.root.px = ax;
  const l = ax - set.bbox[0], r = set.bbox[2] - ax;
  set.back = set.mirror ? r : l; set.front = set.mirror ? l : r;
}
function reset(set) { set.muzzleWarp = null; for (const n of set.order) { const b = set.bones[n]; b.rot = 0; b.sx = 1; b.sy = 1; b.tx = 0; b.ty = 0; } }
function solve(set) { for (const n of set.order) { const b = set.bones[n], L = localM(b); b.w = b.parent ? mul(set.bones[b.parent].w, L) : L; } }

// 两节腿的 IK：让爪子落到 (tx,ty)（姿势坐标）。膝盖朝哪边弯沿用素材里的弯法。amt 是混合比例。
function ik(set, n, tx, ty, amt) {
  const g = set.legs[n]; if (!g || amt <= 0) return;
  const U = set.bones[n + 'U'], Lo = set.bones[n + 'L'], P = set.bones[U.parent];
  const S = ap(P.w, U.px + U.tx, U.py + U.ty);
  const dx = tx - S[0], dy = ty - S[1], d = Math.hypot(dx, dy) || 1, L1 = g.len1, L2 = g.len2;
  const dd = clamp(d, Math.abs(L1 - L2) + 1, L1 + L2 - .5);
  const a = Math.acos(clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1));
  const a1 = Math.atan2(dy, dx) + g.bend * a;
  const J = [S[0] + Math.cos(a1) * L1, S[1] + Math.sin(a1) * L1];
  const a2 = Math.atan2(ty - J[1], tx - J[0]);
  const pr = Math.atan2(P.w[1], P.w[0]);
  const rotU = wrap(a1 - g.r1 - pr), rotL = wrap(a2 - g.r2 - a1 + g.r1);
  U.rot = lerp(U.rot, rotU / D2R, amt); Lo.rot = lerp(Lo.rot, rotL / D2R, amt);
}

// ---------- 换姿势时的渐变 ----------
// rel：姿势坐标 → 以落脚点为原点、朝右为正的统一坐标（镜像的姿势在这里翻回来），两套图才能比较
const rel = (S, p) => [(p[0] - S.ax) * (S.mirror ? -1 : 1), p[1] - S.ground];
const fromRel = (S, r) => [r[0] * (S.mirror ? -1 : 1) + S.ax, r[1] + S.ground];
function delta(S, O, k, w, facing) {
  const a = rel(S, S.lm[k]), b = rel(O, O.lm[k]), m = S.mirror ? -1 : 1;
  return [(b[0] * facing - a[0]) * m * w, (b[1] - a[1]) * w];
}
// 让 S 这套图的臀、胸、肚子、头、尾巴朝 O 那套图的位置挪 w（0~1）。
// wr 是后半身（臀、尾巴）的进度，不给就和前半身一样；起身、趴下时前后不同步，动作才像真狗
function morphToward(S, O, w, facing = 1, wr = w) {
  if (!O || O === S || (!(w > 0) && !(wr > 0))) return;
  const B = S.bones, mS = S.mirror ? -1 : 1, mO = (O.mirror ? -1 : 1) * facing;
  const dh = delta(S, O, 'hip', wr, facing), dc = delta(S, O, 'chest', w, facing), db = delta(S, O, 'belly', (w + wr) / 2, facing), dd = delta(S, O, 'eye', w, facing);
  // 两张头的转轴可能在不同位置。以实际眼位衔接，补偿头绕脖子转动时产生的位移。
  const headAngle = w * (O.lm.headRot * mO - S.lm.headRot * mS) * mS;
  const ex = S.lm.eye[0] - S.headP[0], ey = S.lm.eye[1] - S.headP[1], er = ap(Rm(headAngle), ex, ey);
  dd[0] += ex - er[0]; dd[1] += ey - er[1];
  // 回头时鼻尖从眼睛的一侧转向另一侧。只牵动口鼻附近的网格，保持头颅的体积。
  const sx = S.lm.nose[0] - S.lm.eye[0], sy = S.lm.nose[1] - S.lm.eye[1];
  const ox = (O.lm.nose[0] - O.lm.eye[0]) * mO * mS, oy = O.lm.nose[1] - O.lm.eye[1];
  const nr = ap(Rm(headAngle), sx, sy);
  const move = ap(Rm(-S.lm.headRot - headAngle), lerp(sx,ox,w) - nr[0], lerp(sy,oy,w) - nr[1]);
  S.muzzleWarp = Math.hypot(...move) > 2 ? move : null;
  if (B.ear0) {
    // 回望尾巴时，同一只耳朵会从眼睛的一侧掠到另一侧。对齐耳根并绕耳根转动耳尖。
    const ax=S.lm.earRoot[0]-S.lm.eye[0], ay=S.lm.earRoot[1]-S.lm.eye[1];
    const bx=(O.lm.earRoot[0]-O.lm.eye[0])*mO*mS, by=O.lm.earRoot[1]-O.lm.eye[1];
    const rotated=ap(Rm(headAngle),ax,ay);
    const offset=ap(Rm(-headAngle),lerp(ax,bx,w)-rotated[0],lerp(ay,by,w)-rotated[1]);
    B.ear0.tx += offset[0]; B.ear0.ty += offset[1];
    const earAngle=(l,sign)=>Math.atan2(l.earTip[1]-l.earRoot[1],sign*(l.earTip[0]-l.earRoot[0]));
    B.ear0.rot += w*wrap(earAngle(O.lm,mO*mS)-earAngle(S.lm,1))/D2R-headAngle;
  }
  B.hip.tx += dh[0]; B.hip.ty += dh[1];
  B.chest.tx += dc[0]; B.chest.ty += dc[1];
  B.belly.tx += db[0]; B.belly.ty += db[1];
  B.neck.tx += dd[0] - dc[0]; B.neck.ty += dd[1] - dc[1];
  B.head.rot += headAngle;
  if (B.tail0 && S.lm.tail && O.lm.tail) {
    const dt = delta(S, O, 'tail', wr, facing);
    B.tail0.tx += dt[0] - dh[0]; B.tail0.ty += dt[1] - dh[1];
    const ang = (X, sign) => { const a = rel(X, X.lm.tail), b = rel(X, X.lm.tailTip); return Math.atan2(b[1] - a[1], (b[0] - a[0]) * sign); };
    B.tail0.rot += wr * wrap(ang(O, facing) - ang(S, 1)) / D2R * mS;
  }
}
// 渐变时这条腿的爪子应该落在哪（S 的姿势坐标）：自己的爪子位置和 O 的之间插 w
function footToward(S, O, n, w, facing = 1) {
  const g = S.legs[n];
  if (!g) return null;
  if (!O || !O.legs[n] || !(w > 0)) return [g.ft[0], g.ft[1]];
  const a = rel(S, g.ft), b = rel(O, O.legs[n].ft);
  return fromRel(S, [lerp(a[0], b[0] * facing, w), lerp(a[1], b[1], w)]);
}
function snapshot(S) { const o = {}; for (const n of S.order) { const b = S.bones[n]; o[n] = [b.rot, b.sx, b.sy, b.tx, b.ty]; } return o; }
function restore(S, o) { S.muzzleWarp = null; for (const n of S.order) { const b = S.bones[n], v = o[n]; if (v) { b.rot = v[0]; b.sx = v[1]; b.sy = v[2]; b.tx = v[3]; b.ty = v[4]; } } }

// ---------- 画一个姿势 ----------
// MG：姿势坐标 → 屏幕坐标（含位置、朝向、缩放、倾斜）。face：{eye, eyeP, eyeF, mouth, mouthP, mouthF, carry}
let qm = null;
function quadLocal(R, M, x, y, w, h, t, alpha) {
  if (!qm) qm = R.quad();
  const p = qm.pos, a = ap(M, x, y), b = ap(M, x + w, y), c = ap(M, x + w, y + h), d = ap(M, x, y + h);
  p[0] = a[0]; p[1] = a[1]; p[2] = b[0]; p[3] = b[1]; p[4] = c[0]; p[5] = c[1]; p[6] = d[0]; p[7] = d[1];
  R.drawMesh(qm, t, alpha);
  return [Math.min(a[0], b[0], c[0], d[0]), Math.min(a[1], b[1], c[1], d[1]), Math.max(a[0], b[0], c[0], d[0]), Math.max(a[1], b[1], c[1], d[1])];
}
let faceMesh = null;
function muzzleWeight(set, x, y) {
  const dx = set.nose[0] - set.eye[0], dy = set.nose[1] - set.eye[1], len2 = dx*dx + dy*dy || 1;
  const rx = x - set.eye[0], ry = y - set.eye[1];
  const along = clamp((rx*dx + ry*dy) / len2, 0, 1), across = (rx*dy - ry*dx) / len2;
  return along * Math.exp(-across*across*2.3);
}
function facePatch(R, set, M, x, y, w, h, texture, alpha) {
  if (!set.muzzleWarp) return quadLocal(R,M,x,y,w,h,texture,alpha);
  const n = 20;
  if (!faceMesh) {
    const uv = [], idx = [];
    for (let j=0;j<=n;j++) for (let i=0;i<=n;i++) {
      uv.push(i/n,j/n);
      if (j<n && i<n) { const a=j*(n+1)+i; idx.push(a,a+1,a+n+2,a,a+n+2,a+n+1); }
    }
    faceMesh = R.bufs({pos:new Float32Array(uv.length),uv:new Float32Array(uv),idx:new Uint16Array(idx)});
  }
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for (let i=0;i<faceMesh.uv.length;i+=2) {
    let lx=x+faceMesh.uv[i]*w, ly=y+faceMesh.uv[i+1]*h;
    const u=muzzleWeight(set,lx,ly);
    lx+=u*set.muzzleWarp[0]; ly+=u*set.muzzleWarp[1];
    const px=M[0]*lx+M[2]*ly+M[4], py=M[1]*lx+M[3]*ly+M[5];
    faceMesh.pos[i]=px; faceMesh.pos[i+1]=py;
    x0=Math.min(x0,px); y0=Math.min(y0,py); x1=Math.max(x1,px); y1=Math.max(y1,py);
  }
  R.drawMesh(faceMesh,texture,alpha);
  return [x0,y0,x1,y1];
}
function deform(m, mats, yaw, MG, foreshorten) {
  const r = m.rest, pos = m.pos, wts = m.wts, nb = mats.length;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0, k = 0; i < r.length; i += 2, k++) {
    const x = r[i], y = r[i + 1], w = wts[k];
    let X = 0, Y = 0;
    for (let b = 0; b < nb; b++) { const wb = w[b]; if (!(wb > 0)) continue; const M = mats[b]; X += wb * (M[0] * x + M[2] * y + M[4]); Y += wb * (M[1] * x + M[3] * y + M[5]); }
    if (yaw > 0 && m.turnOffsets) {
      const j = i * 2, p = m.turnOffsets;
      const dx = yaw * p[j] + p[j + 2] * ((1 + yaw * p[j + 3]) * foreshorten - 1);
      const dy = yaw * p[j + 1];
      X += MG[0] * dx + MG[2] * dy; Y += MG[1] * dx + MG[3] * dy;
    }
    pos[i] = X; pos[i + 1] = Y;
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
  }
  return [x0, y0, x1, y1];
}
function drawHead(R, set, kit, MH, face, parts, texture) {
  if (texture) parts.head = facePatch(R, set, MH, 0, 0, set.headW, set.headH, texture, 1);
  if (!kit || !face) return;
  // 新的零件先画满，旧的盖在上面慢慢淡出，切换时不会露出底下没有眼睛的头
  if (set.faceKit) for (const [group, cur, prev, f] of [[kit.eyes, face.eye, face.eyeP, face.eyeF], [kit.mouths, face.carry && kit.mouths.hold ? 'hold' : face.mouth, face.mouthP, face.mouthF]]) {
    const a = group[cur]; if (a) facePatch(R, set, MH, a.x, a.y, a.w, a.h, a.tex, 1);
    const b = prev && prev !== cur ? group[prev] : null;
    if (b && f < 1) facePatch(R, set, MH, b.x, b.y, b.w, b.h, b.tex, 1 - f);
  }
  if (face.carry && kit.note && kit.noteCfg && set.facePoints && set.facePoints.mouthHold) {
    const nc = kit.noteCfg, n = kit.note, s = nc.width / n.w, mh = set.facePoints.mouthHold;
    const biteWeight = set.muzzleWarp ? muzzleWeight(set,...mh) : 0;
    const mx = mh[0] + (set.muzzleWarp?.[0] || 0)*biteWeight, my = mh[1] + (set.muzzleWarp?.[1] || 0)*biteWeight;
    const MN = mul(MH, mul(mul(Tm(mx + (nc.dx || 0), my + (nc.dy || 0)), Rm(nc.rotation || 0)), mul(Sm(s, s), Tm(-nc.grip[0], -nc.grip[1]))));
    parts.note = quadLocal(R, MN, 0, 0, n.w, n.h, n.tex, 1);
    if (set.faceKit && kit.lipTex) facePatch(R, set, MH, 0, 0, kit.w, kit.h, kit.lipTex, 1);
  }
}
function drawSet(R, set, kit, MG, face, parts, yaw = 0) {
  if (!qm) qm = R.quad();
  const mats = {};
  for (const n of set.order) mats[n] = mul(MG, set.bones[n].w);
  const frontality = Math.sin(Math.PI * yaw);
  for (const ly of set.layers) {
    if (ly.kind === 'mesh') {
      const narrowing = ly.id === 'body' ? .46 : ly.id === 'tail' ? .68 : 0;
      parts[ly.id] = deform(ly.mesh, ly.mesh.bones.map(b => mats[b]), yaw, MG, 1 - narrowing * frontality);
      R.drawMesh(ly.mesh, ly.tex, ly.id === 'tail' ? 1 - .93 * frontality : 1);
      continue;
    }
    let MH = mul(mats.head, set.HL);
    if (yaw > 0) {
      const shift = 2 * (set.ax - set.lm.eye[0]) * yaw;
      MH = [MH[0],MH[1],MH[2],MH[3],MH[4] + MG[0] * shift,MH[5] + MG[1] * shift];
    }
    drawHead(R, set, kit, MH, face, parts, ly.tex);
  }
  return mats;
}

root.PetRig = { createRenderer, loadImage, buildKit, buildSet, setAnchor, morphToward, footToward, snapshot, restore, rel, fromRel, reset, solve, ik, drawSet, drawHead, quadLocal, mul, ap, Tm, Rm, Sm, wrap, localM };
})(typeof self !== 'undefined' ? self : this);
