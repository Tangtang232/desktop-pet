// 桌面比格：高清分层素材 + 2D 骨骼网格动画 + 行为状态机。
// 素材数据在 assets/beagle/puppy/rig-data.js（tools/build_hd.py 生成），怎么画在 rig.js，这里是行为和每帧的姿势。
(() => {
const HD = window.BEAGLE_HD, RIG = window.PetRig;
const api = window.petApi || { diag(){}, setInteractive(){}, showMenu(){}, showNoteMenu(){}, setUnread(){}, raise(){}, notify(){}, setExpanded(){}, setBox(){}, load: async () => ({}), save(){}, onCommand(){}, heartbeat(){}, setTooltip(){}, togetherDeparted(){}, togetherArrived(){}, togetherNoteRead(){}, togetherEvent(){}, togetherKeep(){}, togetherSnapshot(){}, diary(){}, togetherCall: async () => ({ ok:false }), openWatch(){}, crossScreen: async () => ({ ok:false }), smokeShot: async () => {}, smokeDone(){} };
const PL = window.PetLogic, PM = window.PetMind, PG = window.PetGrow;
let DIAG = false;
const diagCount = {};
function diag(kind, info){ diagCount[kind] = (diagCount[kind] || 0) + 1; if (DIAG) console.log(`[diag] ${new Date().toISOString().slice(11, 23)} ${kind} ${info == null ? '' : info}`); }
// 玩法里的距离沿用老单位：S × dog.k 个屏幕像素 ≈ 老素材的 1 像素（站姿从地面到头顶 163 个这样的单位）
const S = 3, D2R = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
let reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
const MOT = reduce ? .4 : 1;
const { mul, ap, Tm, Rm, Sm } = RIG || {};

// ---------- WebGL ----------
const stage = document.getElementById('stage'), cv = document.getElementById('gl'), ov = document.getElementById('ov'), octx = ov.getContext('2d');
const R = RIG && RIG.createRenderer(cv);
// 显示不出来（没有 WebGL、素材坏了）：托盘提示一次，照常报平安（不然看门狗会一遍遍重载），窗口保持点穿，不挡桌面
function cantShow(text, kind, err){
  api.diag({ kind, detail:err ? String(err && err.stack || err).slice(0, 800) : '' });
  api.notify(text);
  setInterval(() => api.heartbeat(), 1000);
}
if (!R || !HD){ cantShow(R ? '程序文件好像不完整，狗显示不出来。重新安装一下试试' : '这台电脑的显卡用不了 WebGL，狗显示不出来', R ? 'asset-missing' : 'no-webgl'); return; }
const gl = R.gl, tex = R.tex, quadMesh = R.quad;
let drawCalls = 0;
const drawMesh = (m, t, a) => { drawCalls++; R.drawMesh(m, t, a); };
// cur 是当前的分层骨架，trans 同时保留上一个姿势的骨架和朝向。
let SETS = null, KIT = null, cur = null, trans = null, reverseTurn = null, nextStop = null, rk = .15, PH = 130;
let motionArt = null, motion = null;
// 时间窗使用整段进度，爪子抬高量使用站立身高的比例。来回经过同一条路径。
const GROUND_MOTIONS = {
  rise: {
    keys:['prone','lie-down','crouch','stand'], times:[0,.34,.63,1], seconds:[1.36,1.29],
    steps:{ff:[.035,.25,.0306], fn:[.18,.42,.0401], hf:[.43,.66,.0401], hn:[.61,.86,.0517]}
  },
  sit: {
    keys:['stand','crouch','sit'], times:[0,.49,1], seconds:[.70,.60],
    steps:{ff:null, fn:null, hf:[.07,.32,.024], hn:[.32,.67,.035]}
  },
  lower: {
    keys:['sit','lie-down','prone'], times:[0,.23,1], seconds:[.90,.72],
    steps:{ff:[.08,.60,.039], fn:[.36,.84,.044], hf:[.72,.93,.012], hn:[.73,.94,0]}
  }
};
// 每一小段先移动远侧的爪，近侧的前爪最后收。高度都是站立身高的比例。
const CURL_STEPS = {
  hf:[.03, .37, .014], ff:[.18, .53, .019], hn:[.45, .77, .014], fn:[.59, .94, .020]
};
const CURL_IN_SECONDS = 2.20, CURL_OUT_SECONDS = 1.22, HALF_CURLED = .65;
// 缺少连续过渡素材时仍可走相邻姿势。
const ROUTE = { stand:['sit'], sit:['stand', 'prone'], prone:['sit', 'sleep'], sleep:['prone'] };
const TDUR = { 'stand|sit':.6, 'sit|stand':.55, 'stand|prone':.8, 'prone|stand':.7, 'sit|prone':.65, 'prone|sit':.6, 'prone|sleep':.95, 'sleep|prone':.8 };
const BETWEEN = { 'stand|sit':'crouch', 'stand|prone':'crouch', 'sit|prone':'lie-down', 'prone|sleep':'curl' };
const TURN = .42;
let turnArt = null, pivotTurn = null;
const dogLayer = R.target(), prevLayer = R.target();

// ---------- 程序画的小零件：碗、阴影 ----------
const BOWL = { w:66 * S, h:24 * S, canvasH:40 * S };
let bowlFood = -1, bowlBackTex = null, bowlFrontTex = null;
// 从碗底往上堆；同一粒始终留在原位。最后一点粮也能在碗口看见。
const kibble = [
  [23, [-13, 12, 0, -23, 23, -6, 6, -18, 18]],
  [20, [3, -15, 16, -8, 10, -23, 23, -2]],
  [16.5, [-4, 10, -17, 18, 3, -11]],
  [13, [1, -13, 13, -6, 7]],
  [9.5, [-2, 6, -9]],
  [6.5, [0]]
].flatMap(([y, offsets], row) => offsets.map((dx, i) => ({
  x:33 + dx, y:y + Math.sin(i * 2.1 + row) * .85,
  shape:(i + row) % 3, angle:Math.sin(i * 2.4 - row) * .45
})));
const kibbleCount = food => Math.ceil(clamp(food, 0, 1) * kibble.length);
function bowlContext(){
  const c = document.createElement('canvas'); c.width = BOWL.w; c.height = BOWL.canvasH;
  const ctx = c.getContext('2d'); ctx.scale(S, S);
  return ctx;
}
function bowlBackCanvas(count){
  const x = bowlContext();
  x.fillStyle = '#C7E3F0'; x.strokeStyle = '#647B82'; x.lineWidth = 1;
  x.beginPath(); x.ellipse(33, 22, 31.5, 7, 0, 0, TAU); x.fill(); x.stroke();
  const inside = x.createLinearGradient(0, 16, 0, 28);
  inside.addColorStop(0, '#588299'); inside.addColorStop(1, '#B5D5E4');
  x.fillStyle = inside; x.beginPath(); x.ellipse(33, 22, 28.5, 5.4, 0, 0, TAU); x.fill();
  for (const grain of kibble.slice(0, count)){
    x.save(); x.translate(grain.x, grain.y); x.rotate(grain.angle);
    x.fillStyle = ['#AB6939','#C18149','#995A34'][grain.shape];
    x.strokeStyle = '#754325'; x.lineWidth = .85; x.beginPath();
    if (grain.shape === 1){
      x.moveTo(-3.6, .3); x.quadraticCurveTo(-3.2, -2.4, -.5, -2.7);
      x.quadraticCurveTo(2.7, -2.9, 3.8, .7); x.quadraticCurveTo(4, 2.7, .1, 2.8);
      x.quadraticCurveTo(-3.8, 2.9, -3.6, .3); x.closePath();
    } else x.ellipse(0, 0, grain.shape === 0 ? 4.0 : 3.3, 2.8, 0, 0, TAU);
    x.fill(); x.stroke();
    x.fillStyle = '#DBA46C'; x.beginPath(); x.ellipse(-.9, -1.1, 1.35, .65, -.2, 0, TAU); x.fill(); x.restore();
  }
  return x.canvas;
}
function bowlFrontCanvas(){
  const x = bowlContext(), g = x.createLinearGradient(0, 22, 0, 39);
  g.addColorStop(0, '#C1DFED'); g.addColorStop(.45, '#A1CDE4'); g.addColorStop(1, '#739FB7');
  x.fillStyle = g; x.strokeStyle = '#647B82'; x.lineWidth = 1;
  x.beginPath(); x.ellipse(33, 22, 31.5, 7, 0, 0, Math.PI);
  x.lineTo(6, 35); x.bezierCurveTo(8, 40, 58, 40, 60, 35); x.closePath(); x.fill(); x.stroke();
  x.strokeStyle = '#DEEFF5'; x.lineWidth = 1.4; x.beginPath(); x.ellipse(33, 22.5, 30.4, 7.2, 0, .12, Math.PI-.12); x.stroke();
  return x.canvas;
}

// ---------- 表情：每个表情是一组参数，切换时平滑过渡 ----------
const EXPR = {
  neutral:  { eyeWide:1,    browUp:0,    browWorry:0,  lidC:.06, lidTilt:0,  lidLower:0,   tongue:.75, jaw:0,  earBack:0,   earLift:0,  wag:8,  wagF:1.4, tail:0,   tuck:0, blush:0,   pant:.3 },
  happy:    { eyeWide:1,    browUp:.3,   browWorry:0,  lidC:.12, lidTilt:0,  lidLower:.32, tongue:1,   jaw:2,  earBack:0,   earLift:.2, wag:26, wagF:3.2, tail:-8,  tuck:0, blush:.55, pant:1 },
  curious:  { eyeWide:1.14, browUp:1,    browWorry:0,  lidC:0,   lidTilt:0,  lidLower:0,   tongue:.3,  jaw:-3, earBack:0,   earLift:.8, wag:6,  wagF:1.2, tail:-4,  tuck:0, blush:0,   pant:0 },
  sad:      { eyeWide:1.08, browUp:0,    browWorry:1,  lidC:.3,  lidTilt:1,  lidLower:0,   tongue:.2,  jaw:-4, earBack:1,   earLift:0,  wag:0,  wagF:1,   tail:0,   tuck:1, blush:0,   pant:0 },
  sleepy:   { eyeWide:1,    browUp:-.3,  browWorry:.2, lidC:.58, lidTilt:.2, lidLower:.05, tongue:.5,  jaw:-2, earBack:.3,  earLift:0,  wag:2,  wagF:.8,  tail:0,   tuck:0, blush:0,   pant:0 },
  surprised:{ eyeWide:1.24, browUp:1.4,  browWorry:0,  lidC:0,   lidTilt:0,  lidLower:0,   tongue:.4,  jaw:6,  earBack:0,   earLift:1,  wag:0,  wagF:1,   tail:-14, tuck:0, blush:0,   pant:0 },
  content:  { eyeWide:1,    browUp:.2,   browWorry:0,  lidC:.46, lidTilt:0,  lidLower:.26, tongue:.9,  jaw:1,  earBack:.15, earLift:0,  wag:10, wagF:1.2, tail:0,   tuck:0, blush:.5,  pant:.35 },
  beg:      { eyeWide:1.12, browUp:.2,   browWorry:.85,lidC:.1,  lidTilt:.5, lidLower:0,   tongue:.3,  jaw:-2, earBack:.25, earLift:0,  wag:7,  wagF:1,   tail:0,   tuck:0, blush:0,   pant:0 }
};
const EKEYS = Object.keys(EXPR.neutral);
// 每个表情用哪张眼睛、哪张嘴（素材 face/eyes、face/mouths）
const FACE = { neutral:['open', 'neutral'], happy:['open', 'pant'], curious:['wide', 'neutral'], sad:['sad', 'frown'], sleepy:['half', 'neutral'],
  surprised:['wide', 'surprised'], content:['happy', 'smile'], beg:['look-up', 'neutral'] };
const EXPR_NAME = { neutral:'平常', happy:'开心', curious:'好奇', sad:'委屈', sleepy:'犯困', surprised:'吃惊', content:'满足', beg:'讨吃的' };
const ACT_NAME = { stash:'把纸条收起来', walk:'溜达', sniff:'闻地面', idle:'站着', sit:'坐着', lie:'趴着', sleep:'睡觉', bow:'邀你玩', hungry:'饿了，在碗边等', eat:'吃饭', seek:'想你理它', greet:'迎接你', courier:'送纸条' };
const ONCE_NAME = { yawn:'打哈欠', shake:'抖毛', stretch:'伸懒腰', tilt:'歪头', hop:'蹦一下', poke:'被戳了一下', glance:'瞟一眼碗', nudge:'拱一拱纸条' };
// 有明确事由的动作开头挂什么表情（平常动作的表情看心情，见 FREE_ACTS）
const ACT_EXPR = { stash:'content', hungry:'beg', eat:'happy', seek:'curious', greet:'happy', courier:'happy', bringBowl:'beg' };
const POSE_KEYS = ['lie', 'sit', 'bow', 'sniff', 'rest', 'low'];

// ---------- 狗 ----------
const dog = { x:300, y:0, k:.55, faceS:1, facing:1, tilt:0, action:'walk', actT:0, actDur:12, auto:true, expr:'happy', once:null,
  target:null, pause:.8, phase:0, wb:0, moving:false, speed:0, held:false, falling:false, vx:0, vy:0, gdx:0, gdy:0,
  t:0, belly:.55, wag:8, hop:-9, land:-9, ea:0, ev:0, e1:0, e1v:0, prevH:null, prevV:[0, 0], blinkS:-9, blinkAt:1.5,
  look:0, P:{ lie:0, sit:0, bow:0, sniff:0, rest:0, low:0 }, E:{ ...EXPR.happy }, pet:0, petAt:-9, neckFix:[0, 0], eatPhase:'', lickT:0,
  dreamAt:5, dreamS:-9, sighAt:4, sighS:-9, twitchAt:3, behindT:0, parts:{}, particles:[], spawnT:0,
  needs:PL.initNeeds(), mind:PM.initMind(), blinkD:.2, dozing:false, settle:null, disturb:0, visible:true, alpha:1, nearT:0, userIdle:0, userAway:false, lastInteract:-99, turnHop:-9, glanceAt:20, courier:null, carry:null, shakeOnLand:false, lastShake:-9, notes:[], seekPhase:'', seekT:0,
  face:{ eye:'open', eyeP:null, eyeT:-9, mouth:'neutral', mouthP:null, mouthT:-9 } };
// 碗：bowlX 中心、bowlY 底边（平时就是地面 GY）；bowlN 是你摆的位置（占屏幕宽度的比例，记进存档），没摆过是 null
// bowlHeld 你拎着、bowlFalling 往下掉、bowlCarried 狗叼着
const world = { food:.35, bowlX:0, bowlY:0, bowlN:null, bowlTilt:0, bowlVx:0, bowlVy:0, bowlHeld:false, bowlFalling:false, bowlCarried:false, bowlGdx:0, bowlGdy:0, groundNote:null, noteRect:null };
let W = 800, Hh = 420, GY = 386, dpr = 1, CH = 420, CT = 0;
// FR：工作区在屏幕上的位置和大小（主进程给）。页面坐标 = 屏幕坐标 - 工作区左上角；舞台始终和工作区一样高
let FR = null;
// 被别的程序窗口整只盖住（主进程告诉我们）：不画，只算消化
let occluded = false;
function applyFrame(f){ if (!f || !(f.wh > 0)) return; FR = f; stage.style.height = f.wh + 'px'; }
function resize(){
  const r = stage.getBoundingClientRect(); W = r.width; Hh = r.height; GY = Hh - 3; fitSize(); dpr = Math.min(2, window.devicePixelRatio || 1);
  // 画布只做窗口露出来的那么高（平时是底部一条），省掉一整屏的显存和合成
  CH = Math.max(1, Math.min(Hh, Math.ceil(window.innerHeight || Hh))); CT = Hh - CH;
  const pw = Math.round(W * dpr), ph = Math.round(CH * dpr);
  if (cv.width !== pw || cv.height !== ph){ cv.style.height = ov.style.height = CH + 'px'; cv.width = ov.width = pw; cv.height = ov.height = ph; ovRect = null; }
  gl.viewport(0, 0, cv.width, cv.height);
  if (!world.bowlHeld && !world.bowlFalling && !world.bowlCarried) world.bowlX = world.bowlN != null ? clamp(world.bowlN * W, bowlMinX(), bowlMaxX()) : W - 160 * dog.k / .33;
  if (!dog.held && !dog.falling) dog.y = GY;
  if (!(dog.courier && ['leave', 'away', 'return'].includes(dog.courier.phase))) dog.x = clamp(dog.x, minX(), maxX());
}
const minX = () => 24 + SETS.stand.back * rk, maxX = () => W - 24 - SETS.stand.front * rk;
// 碗能放的范围、碗现在的底边、能点中碗的范围（碗口以下那一截）
const bowlMinX = () => BOWL.w * dog.k / 2 + 12, bowlMaxX = () => W - BOWL.w * dog.k / 2 - 12;
const bowlBottom = () => world.bowlHeld || world.bowlFalling || world.bowlCarried ? world.bowlY : GY;
function bowlRect(){ const w = BOWL.w * dog.k, h = BOWL.canvasH * dog.k, b = bowlBottom(); return [world.bowlX - w / 2, b - h * .62, world.bowlX + w / 2, b]; }
const bowlHit = (x, y) => !world.bowlCarried && inBox(bowlRect(), x, y, 3);
// 狗从哪边去碗：它在哪边就从哪边（-1 左边、1 右边）；那边放不下就换另一边
function bowlSide(gap){
  let s = dog.x <= world.bowlX ? -1 : 1;
  const tx = world.bowlX + s * gap;
  if (tx < minX() || tx > maxX()) s = -s;
  return s;
}
// 姿势坐标（素材原图像素）→ 屏幕坐标：以身体中心正下方的地面为原点，按朝向翻转、按 rk 缩放、按倾斜旋转
function MG(set, facing = dog.faceS){
  const a = dog.tilt * D2R, c = Math.cos(a), s = Math.sin(a), m = set.mirror ? -1 : 1;
  const sq=pivotTurn && !turnArt ? 1-.15*Math.sin(Math.PI*pivotTurn.progress) : 1;
  return mul(mul([c, s, -s, c, dog.x + (dog.offX || 0), dog.y], Sm(rk * facing * m * sq, rk)), Tm(-set.ax, -set.ground));
}
const setPt = (set, bone, p) => ap(mul(MG(set), set.bones[bone].w), p[0], p[1]);
function headLocalPt(set, lx, ly){
  if(pivotTurn && turnArt && set===SETS.stand)return turnArt.headPoint(MG(set,pivotTurn.start),lx,ly,pivotTurn.progress);
  if (motion && set === cur){
    const {from, to, u, options} = motion.frame;
    // 渲染矩阵原点在本段第一张脸。以眼位对齐，睡姿的头图尺寸和常用侧脸不同。
    return ap(motionArt.headMatrix(from, to, u, MG(from), MG(to), options), lx + from.eye[0] - set.eye[0], ly + from.eye[1] - set.eye[1]);
  }
  return ap(mul(mul(MG(set), set.bones.head.w), set.HL), lx, ly);
}
const headPt = () => headLocalPt(cur, cur.headW * .5, cur.headH * .38);
const mouthPt = () => cur.facePoints && cur.facePoints.mouthHold ? headLocalPt(cur, ...cur.facePoints.mouthHold) : headPt();
const eyePt = () => cur.facePoints && cur.facePoints.eyeCenter ? headLocalPt(cur, ...cur.facePoints.eyeCenter) : headPt();
// 站着时嘴在身体中心前面多远（屏幕像素）：叼纸条、走到碗边时用
function mouthReach(){
  const st = SETS.stand, m = KIT ? KIT.points.mouthHold : [st.headW * .9, st.headH * .7], q = ap(st.HL, m[0], m[1]);
  return (q[0] - st.ax) * rk;
}
function turnTo(f){ dog.facing = f; }
function updateTurn(dt){
  // 头抬起来、站直了才开始转（转身按站直抬头的样子算，低着头转会把头和前腿拉成一长条）
  if (!pivotTurn && dog.faceS !== dog.facing && !motion && !trans && cur === SETS.stand && dog.P.sniff < .12 && dog.P.bow < .12 && (dog.scentWeight || 0) < .05){
    pivotTurn={start:dog.faceS,progress:0};dog.turnHop=dog.t;
  }
  if (!pivotTurn)return;
  const sign=dog.facing===pivotTurn.start ? -1 : 1;
  const p=pivotTurn.progress+sign*dt/TURN*(dog.held||dog.falling ? 2 : 1);
  if(p>=1 || p<=0){
    dog.faceS=p>=1?-pivotTurn.start:pivotTurn.start;
    pivotTurn=null;dog.prevH=null;dog.prevV=[0,0];return;
  }
  pivotTurn.progress=p;
  if(!turnArt)dog.faceS=p<.5?pivotTurn.start:-pivotTurn.start;
}
// 走到 tx：起步加速、快到了减速；正在转身或换姿势（比如还没站起来）时原地等
function walkTo(tx, dt, slow, mulSpeed){
  const dx = tx - dog.x;
  if (dog.t - (dog.walkSeen || -9) > .25) dog.vel = 0;
  dog.walkSeen = dog.t;
  if (Math.abs(dx) < 2){ dog.vel = 0; dog.moving = false; return true; }
  const standingUp = cur===SETS.sit && motionArt?.supports(GROUND_MOTIONS.sit.keys);
  if (motion || standingUp || (cur === SETS.prone && motionArt?.canRise) || (cur === SETS.sleep && motionArt?.canCurl)){ dog.vel = 0; dog.moving = false; return false; }
  turnTo(dx > 0 ? 1 : -1);
  if (pivotTurn || dog.faceS !== dog.facing || trans || cur.name !== 'stand'){ dog.vel = 0; dog.moving = false; return false; }
  const vmax = (slow ? 45 : 120) * dog.k / .55 * (mulSpeed || 1), acc = vmax * 3;
  const want = Math.sign(dx) * Math.min(vmax, Math.max(Math.sqrt(2 * acc * Math.abs(dx)), vmax * .15));
  dog.vel = (dog.vel || 0) + clamp(want - (dog.vel || 0), -acc * dt, acc * dt);
  const step = dog.vel * dt;
  if (Math.abs(step) >= Math.abs(dx) || Math.sign(step) !== Math.sign(dx)){ dog.x = tx; dog.vel = 0; dog.moving = false; return true; }
  dog.x += step; dog.speed = Math.abs(dog.vel); dog.moving = dog.speed > 3; return false;
}
function wander(dt, slow, pr){
  if (dog.pause > 0){ dog.pause -= dt; return; }
  if (dog.target == null){
    const clear = 60 * S * dog.k;
    let tx, k = 0;
    do {
      tx = clamp(dog.x + rand(-460, 460) * dog.k / .33, minX(), maxX());
      if (Math.abs(tx - world.bowlX) < clear) tx = clamp(world.bowlX + (dog.x < world.bowlX ? -1 : 1) * clear, minX(), maxX());   // 别正好停在碗上
    } while (Math.abs(tx - dog.x) < 90 && ++k < 10);
    dog.target = tx;
  }
  if (walkTo(dog.target, dt, slow)){
    dog.target = null; dog.pause = rand(pr[0], pr[1]);
    if (dog.thenAct){ const a = dog.thenAct; dog.thenAct = null; setAction(a); }   // 走到地方再做下一件事（比如吃饱了走开再趴下）
  }
}

// ---------- 多块屏幕：跟着你去旁边那块屏幕 ----------
// 鼠标在左边 / 右边挨着的那块屏幕上（相对这块屏幕的坐标跑到了 0 左边、宽度右边）；最近两分钟动过才算
function otherScreenSide(){
  if (!FR || !FR.edges || dog.t - ptr.movedAt > 120) return 0;
  if (ptr.x < -4 && FR.edges.left) return -1;
  if (ptr.x > W + 4 && FR.edges.right) return 1;
  return 0;
}
let ptrSide = { side:0, since:0 }, dragCrossing = false;
// 走出这边的屏幕边 → 主进程把窗口挪过去 → 从那边的屏幕边走进来（then：进来以后接着做什么）
function startCross(dir, then){
  setAction('cross');
  dog.cross = { phase:'out', dir, then:then || 'idle' };
}
function enterFrom(edge, then){
  const off = (SETS.stand.back + SETS.stand.front) * rk + 16;
  setAction('cross');
  dog.visible = true; dog.x = edge > 0 ? W + off : -off; dog.facing = dog.faceS = -edge;
  dog.cross = { phase:'in', inX:edge > 0 ? W * rand(.7, .85) : W * rand(.15, .3), then:then || 'idle' };
}
// ---------- 养成：先天特质、后天性格、胖瘦、日记（规则在 grow.js） ----------
// 特质：单机的狗用存档里的种子；合养的狗用宠物 id 当种子（组里每台电脑算出来一样）。性格和胖瘦跟着狗走（换地方时带过去）
let GROW = PG.initGrow((Math.random() * 4294967296) >>> 0), groupSeed = null;
let TRAITS = PG.traitsFromSeed(GROW.seed), EFF = PG.effects(TRAITS, GROW.persona);
// 冒烟测试、测占用时用一只"一般"的狗（特质全是 0），结果才稳定
let neutralTraits = false;
function refreshGrow(){ TRAITS = neutralTraits ? Object.fromEntries(PG.TRAITS.map(k => [k, 0])) : PG.traitsFromSeed(groupSeed != null ? groupSeed : GROW.seed); EFF = PG.effects(TRAITS, GROW.persona); }
const today = () => new Date().toISOString().slice(0, 10);
// 它在干嘛（给别人看）：被拎着算"被拎着玩"；叼着纸条走才是"送纸条"，空着嘴往屏幕外走是"正要出门"
const actName = () => dog.held ? 'held' : dog.action === 'courier' && !dog.carry ? 'leaving' : dog.action === 'cross' ? 'walk' : dog.action;
const HEART_KINDS = new Set(['pet', 'feed', 'answer', 'noteWrite', 'noteRead', 'play', 'struggle']);
// 你和它的互动：改它的性格；合养时顺带算心动值
function growEvent(kind){
  GROW.persona = PG.personaAfter(GROW.persona, kind, today()); refreshGrow();
  if (HEART_KINDS.has(kind)) api.togetherEvent(kind);
}
// 观察到的"证据"：攒够了，日记里写一句它是什么样的狗
const clue = k => { GROW.clues[k] = (GROW.clues[k] || 0) + 1; };
// 每分钟看一眼：发现了新特质、胖瘦变了、性格变了、来了整一周……写进日记
function growCheck(){
  if (dog.abroad) return;
  for (const f of PG.discover(TRAITS, GROW.clues, GROW.known)){ GROW.known.push(f.trait); api.diary(f.text); }
  const ww = PG.weightWord(GROW.weight);
  if (ww !== (GROW.words.weight || '')){ GROW.words.weight = ww; api.diary(ww ? `最近${ww}` : '身材又回到刚刚好'); }
  const pw = PG.warmthWord(GROW.persona.warmth);
  if (pw && pw !== GROW.words.warmth){ GROW.words.warmth = pw; api.diary(`它${pw}`); }
  const mark = PG.ageMark(PG.ageDays(GROW), GROW.words.age);
  if (mark){ GROW.words.age = mark; api.diary(`来这儿 ${mark} 天了`); }
}
let DIGEST = PL.digestRate(false), SPEED = 1, AWAY_SEC = PL.AWAY_IDLE_SEC, SETTINGS = { auto:true, size:'medium' };
const COURIER_AWAY = 7;
const NOTE_WAIT = 180;
const FULL = .96;   // 吃到这么饱就停嘴，碗里剩下的下回再吃   // 地上的纸条 3 分钟没人看，它就叼走收起来（之后在托盘菜单"看纸条"里看）   // 演示：出门转一圈的秒数；接上合养后换成真的去朋友桌面
function needCtx(){ const h = new Date().getHours(); return { userPresent: !dog.userAway && dog.userIdle < 60, night: h >= 23 || h < 7 }; }
const REST_OLD = (171 - 8) * S;   // 老素材站姿从地面到头顶；玩法里的距离（走多快、离碗多远）还按这个单位
function fitSize(){ PH = PL.petHeightFor(Hh); dog.k = PH / REST_OLD; if (SETS) rk = PH / SETS.stand.restH; }
const DUR = { cross:[999, 999], bringBowl:[999, 999], walk:[8, 14], sniff:[6, 10], idle:[5, 8], sit:[6, 10], lie:[8, 12], sleep:[14, 22], bow:[3.5, 5], seek:[60, 60], greet:[5, 6], courier:[999, 999], stash:[999, 999] };
const NEXT = { walk:[['sniff', 3], ['sit', 2], ['idle', 2], ['bow', 1], ['lie', 1]], sniff:[['walk', 3], ['sit', 1], ['idle', 1]], idle:[['walk', 3], ['sit', 2], ['lie', 1], ['sniff', 1]],
  sit:[['lie', 2], ['walk', 2], ['idle', 1]], lie:[['sleep', 2], ['sit', 1], ['walk', 1]], bow:[['walk', 2], ['idle', 1]] };
// 表情不跟着动作随机抽：溜达、站、坐、趴、睡这些平常动作的表情每帧由心情和困意定（mind.js），
// 吃饭、求关注、送纸条这些有明确事由的动作才在各自分支里定表情
const FREE_ACTS = ['walk', 'sniff', 'idle', 'sit', 'lie', 'sleep', 'bow'];
function setAction(a, manual){
  const prev = dog.action, prevT = dog.actT, en = dog.needs.energy;
  dog.action = a; dog.actT = 0; const d = DUR[a] || [8, 12]; dog.target = null; dog.pause = .2; dog.thenAct = null;
  // 一件事做多久看精神：累了坐、趴得久，走、闻得短；精神好反过来
  dog.actDur = rand(d[0], d[1]) * (['sit', 'lie'].includes(a) ? 1 + 1.5 * (1 - en) : ['walk', 'sniff'].includes(a) ? .6 + .6 * en : 1);
  if (a === 'eat'){ dog.eatPhase = 'walk'; dog.eatSide = null; }
  if (a === 'hungry') dog.hungrySide = null;
  if (a === 'bringBowl') dog.bring = { phase:'go', t:dog.t };
  // 嘴里叼着碗去干别的（被拎起来、有粮了、出门……）：先松口，碗掉在原地
  if (a !== 'bringBowl' && world.bowlCarried) dropCarriedBowl();
  if (a === 'seek'){ dog.seekPhase = 'go'; dog.seekT = dog.t; }
  if (ACT_EXPR[a] && (!manual || !dog.exprLock)) dog.expr = ACT_EXPR[a];
  if (a === 'sleep'){
    // 自己犯困：先趴着眼皮越来越沉，睡着了才蜷起来；人在时只打个盹，越累睡越久。菜单里点"睡觉"直接睡
    dog.dozing = !manual; if (manual) dog.mind.drowsy = 1;
    dog.actDur = PM.napLength(en, needCtx().userPresent);
  } else dog.dozing = false;
  // 自己决定趴下、去睡时，站着的话先低头闻闻地方、原地转一圈再趴
  dog.settle = !manual && (a === 'lie' || a === 'sleep') && !['lie', 'sleep'].includes(prev) && cur === SETS.stand && !trans && !motion ? { phase:'sniff', t:dog.t, dur:rand(.8, 1.5) } : null;
  dog.shakeAfterRise = 0;
  if (prev === 'sleep' && a !== 'sleep'){ PM.wake(dog.mind); dog.shakeAfterRise = dog.t; if (!manual) startOnce('stretch'); }
  else if (prev === 'lie' && prevT > 30 && !['sleep', 'sit'].includes(a)) dog.shakeAfterRise = dog.t;   // 趴久了起来先抖一抖
  syncUI();
}
function startOnce(type){
  const dur = { yawn:1.9, shake:1.3, stretch:2.8, tilt:2.4, hop:.45, poke:1.3, glance:1.6, nudge:1.2 }[type];
  if (!dur) return;
  dog.once = { type, t0:dog.t, dur }; if (type === 'hop'){ dog.hop = dog.t; } if (type === 'shake') dog.lastShake = dog.t; syncUI();
}
// 自己趴下前的准备：低头闻闻这块地方 → 原地转一圈 → 再趴（转身用的是转身动作，转不了三秒后直接趴）
function settleDown(T, X){
  const s = dog.settle, el = dog.t - s.t;
  if (s.phase === 'sniff'){ T.sniff = 1; X.scent = smooth(.1, .5, el); if (el > s.dur){ s.phase = 'turn'; s.t = dog.t; turnTo(-dog.facing); } }
  else if ((!pivotTurn && dog.faceS === dog.facing) || el > 3) dog.settle = null;
}
function autoStep(dt){
  const a = dog.action;
  if (['eat', 'courier', 'greet', 'stash', 'bringBowl', 'cross'].includes(a)) return;
  const gn = world.groundNote;
  if (gn && !gn.mine && card.hidden && dog.t - (gn.since || 0) > NOTE_WAIT && !dog.held){ startStash(); return; }
  // 饿分四档：吃饱 → 偶尔瞟一眼碗 → 去碗边坐着等 → 等得委屈
  const stage = PL.hungerStage(dog.belly);
  // 碗里有粮：饿了很快过去吃；有点饿时过一阵子去；不饿时偶尔随机去吃几口；吃撑了不理
  if (world.food > .02 && a !== 'sleep' && !dog.held && dog.belly < EFF.fullAt - .1){
    const perSec = stage === 'starving' || stage === 'hungry' ? 1.2 : stage === 'peckish' ? EFF.snackMul / 25 : (1 - dog.belly) / 300 * EFF.snackMul;
    if (Math.random() < dt * perSec){ clue('appetite'); setAction('eat'); return; }
  }
  if ((stage === 'hungry' || stage === 'starving') && !['hungry', 'sleep'].includes(a)){ setAction('hungry'); return; }
  if (a === 'hungry'){
    if (stage === 'fed' || stage === 'peckish'){ setAction('idle'); return; }
    dog.expr = stage === 'starving' ? 'sad' : 'beg';
    // 在碗边干等了 12 秒还是空碗，你在电脑前、鼠标离碗挺远：叼着碗去找你（十分钟最多一次）
    const px = ptr.x > 0 && ptr.x < W && dog.t - ptr.movedAt < 120 ? ptr.x : null;
    if (dog.actT > 12 && world.food < .02 && !world.bowlHeld && !world.bowlFalling && needCtx().userPresent && px != null && Math.abs(px - world.bowlX) > 2.5 * PH && dog.t > (dog.bringBowlAt || 0)){
      dog.bringBowlAt = dog.t + 600; setAction('bringBowl');
    }
    return;
  }
  // 多块屏幕：你在旁边那块屏幕上干活一分半了，它醒着、闲着，就走过去找你
  const side = otherScreenSide();
  if (side !== ptrSide.side) ptrSide = { side, since:dog.t };
  if (side && dog.t - ptrSide.since > 90 && !dog.once && FREE_ACTS.includes(a) && a !== 'sleep' && needCtx().userPresent){ startCross(side); return; }
  if (dog.actT > dog.actDur){
    if (a === 'sleep'){ if (dog.userAway){ dog.actT = 0; return; } setAction('idle'); return; }   // 睡醒：setAction 里伸懒腰、迷糊一会儿
    if (a === 'lie' && dog.mind.drowsy > .4){ dog.actT = dog.actDur - 3; return; }   // 趴着正犯困，就接着趴
    const nx = PL.chooseNext(a, dog.needs, { ...needCtx(), seekCooldown:dog.t < (dog.seekRestUntil || 0), drowsy:dog.mind.drowsy,
      mul:{ walk:EFF.walkMul, lie:EFF.lieMul, sniff:EFF.sniffMul, seek:EFF.attentionMul } });
    if (nx === 'walk' || nx === 'lie') clue('energy'); else if (nx === 'sniff') clue('curious'); else if (nx === 'seek') clue('clingy');
    setAction(nx);
    return;
  }
  // 趴着越来越困、眼皮快睁不开了：就这么睡过去
  if (a === 'lie' && dog.mind.drowsy > .7 && !dog.settle){ setAction('sleep'); return; }
  // 睡醒、趴久了站起来：伸完懒腰抖一抖毛（站稳了才抖；十秒内没站起来就算了）
  if (dog.shakeAfterRise && !dog.once){
    if (dog.t - dog.shakeAfterRise > 10) dog.shakeAfterRise = 0;
    else if (cur === SETS.stand && !motion && !trans && !pivotTurn){ dog.shakeAfterRise = 0; startOnce('shake'); return; }
  }
  if (stage === 'peckish' && !dog.once && dog.t > dog.glanceAt && ['idle', 'sit', 'lie', 'walk'].includes(a) && !dog.moving){ dog.glanceAt = dog.t + rand(20, 45); startOnce('glance'); return; }
  // 小动作都有起因：困了打哈欠，又开心又兴奋才蹦，你的鼠标在它跟前动它才歪头看（mind.js 里的概率）
  if (!dog.once){
    const watching = !ptr.covered && dog.t - ptr.movedAt < 1.5 && Math.abs(ptr.x - dog.x) < 4 * PH && ptr.y > GY - 4 * PH;
    const k = PM.pickOnce(PM.onceRates(dog.mind, { action:a, moving:dog.moving, watching }), dt);
    if (k) startOnce(k);
  }
}

// ---------- 每帧更新 ----------
const ptr = { x:-999, y:-999, movedAt:-9, down:false, downX:0, downY:0, downT:0, over:false, speed:0 };
function update(dt){
  const t = (dog.t += dt); dog.actT += dt;
  updateBowl(dt);
  // 合养：狗在别人桌面上。这边不画它、不算它的肚子和心情（那边在算），碗和地上的纸条照旧
  if (dog.abroad){ dog.visible = false; dog.moving = false; return; }
  if (dog.action !== 'eat') dog.belly = Math.max(0, dog.belly - dt * DIGEST * EFF.digestMul * (dog.action === 'sleep' ? .5 : 1));
  GROW.weight = PG.weightTick(GROW.weight, dt * SPEED, { belly:dog.belly, walking:dog.moving && dog.action === 'walk' });
  if (!dog.auto && dog.manualUntil && t > dog.manualUntil){ dog.auto = SETTINGS.auto; dog.manualUntil = 0; dog.exprLock = false; }
  const nctx = needCtx();
  dog.needs = PL.tickNeeds(dog.needs, dt, { sleeping:dog.action === 'sleep', active:dog.moving || dog.action === 'bow', playing:dog.action === 'bow' || dog.pet > .35 || dog.held,
    interacted:dog.pet > .35 || t - dog.lastInteract < 2, userPresent:nctx.userPresent, night:nctx.night, speed:SPEED, drainMul:EFF.drainMul, attentionMul:EFF.attentionMul });
  // 心情和困意（mind.js）：慢慢变，平常的表情、眨眼、小动作、什么时候睡着都看它
  const nearPtr = !ptr.covered && t - ptr.movedAt < 4 && Math.abs(ptr.x - dog.x) < 3 * PH && ptr.y > GY - 4 * PH;
  PM.tickMind(dog.mind, dt, { energy:dog.needs.energy, boredom:dog.needs.boredom, attention:dog.needs.attention, hunger:PL.hungerStage(dog.belly),
    night:nctx.night, userPresent:nctx.userPresent, dozing:dog.action === 'sleep' && dog.dozing, asleep:dog.action === 'sleep' && !dog.dozing,
    posture:dog.moving ? 'move' : cur === SETS.prone || cur === SETS.sleep ? 'lie' : cur === SETS.sit ? 'sit' : 'stand',
    quiet:t - dog.lastInteract > 20 && !nearPtr, petting:dog.pet > .35, heldFor:dog.held ? t - dog.heldT : -1 });
  if (dog.auto && !dog.held && !dog.falling) autoStep(dt);
  const T = { lie:0, sit:0, bow:0, sniff:0, rest:0, low:0 };
  const X = { neck:0, head:0, jaw:0, lid:0, closed:false, tongue:0, offX:0, rootLift:0, wig:0, wagMul:1, chew:0 };
  let exprName = dog.expr;
  if (!dog.exprLock && FREE_ACTS.includes(dog.action)){
    exprName = dog.expr = PM.exprFor(dog.mind, t);
    if (dog.action === 'sniff' && exprName !== 'sleepy') exprName = 'curious';   // 闻东西时专心
    else if (dog.action === 'bow') exprName = 'happy';                            // 邀你玩本来就是乐的
  }
  dog.moving = false;
  const a = dog.action, once = dog.once;
  if (dog.held){
    // 拎着时狗只在主屏幕里跟着鼠标：拖到另一块屏幕、拖到任务栏上、拖出屏幕顶上，狗停在边上，不会跑出窗口看不见
    const tx = clamp(ptr.x - dog.gdx, minX(), maxX()), ty = clamp(ptr.y - dog.gdy, PH * 1.05, GY);
    dog.vx = lerp(dog.vx, (tx - dog.x) / dt, .35); dog.vy = lerp(dog.vy, (ty - dog.y) / dt, .35);
    dog.x = tx; dog.y = ty; dog.tilt = lerp(dog.tilt, clamp(dog.vx * .02, -20, 20), .25);
    const heldFor = dog.t - dog.heldT;
    // 刚拎起来吓一跳 → 睁大眼睛四处看 → 拎久了不乐意
    exprName = heldFor < .9 ? 'surprised' : heldFor < 2.5 ? 'curious' : 'sad';
    if (heldFor > 2.5){ X.struggle = Math.min(1, (heldFor - 2.5) * 2); if (dog.struggleEventAt !== dog.heldT){ dog.struggleEventAt = dog.heldT; growEvent('struggle'); } }
  } else if (dog.falling){
    dog.vy += 2400 * dt; dog.y += dog.vy * dt; dog.x = clamp(dog.x + dog.vx * dt, minX(), maxX()); dog.vx *= 1 - 1.2 * dt; dog.tilt = lerp(dog.tilt, 0, .12);
    if (dog.y >= GY){ dog.y = GY; if (dog.vy > 250) dog.land = t; PM.kick(dog.mind, 'land'); dog.vy = 0; dog.vx = 0; dog.falling = false; if (dog.shakeOnLand){ dog.shakeOnLand = false; startOnce('shake'); }
      if (dog.pendingNote){ const n = dog.pendingNote; dog.pendingNote = null; handleCommand({ type:'note', value:n }); }
      if (pendingDepart){ const d = pendingDepart; pendingDepart = null; startDeparture(d); } }
  } else {
    dog.tilt = lerp(dog.tilt, 0, .2);
    const busy = once && ['stretch', 'shake'].includes(once.type);
    if (a === 'walk'){ if (!busy) wander(dt, false, [1, 2.6]); }
    else if (a === 'sniff'){ if (!busy) wander(dt, true, [.5, 1.4]); T.sniff = 1; X.scent = smooth(.16, .65, dog.actT); }
    else if (a === 'sit') T.sit = 1;
    else if (a === 'lie' || (a === 'sleep' && (dog.dozing || dog.settle))){
      if (dog.settle) settleDown(T, X);
      else {
        T.lie = 1;
        // 犯困：眼皮一点点耷拉下来，头也慢慢沉；眼睛闭上、趴稳了才算睡着，蜷起来
        const dz = dog.mind.drowsy;
        X.lid = Math.max(X.lid, smooth(.6, .95, dz) * .75); X.neck += 10 * smooth(.4, 1, dz);
        if (a === 'sleep' && dz > .9 && cur === SETS.prone && !trans && !motion){ dog.dozing = false; dog.dreamAt = t + rand(15, 30); }
      }
    }
    else if (a === 'sleep'){ T.lie = 1; T.rest = 1; X.closed = true;
      // 做梦（腿划、尾巴摇）隔一阵才有一次，不是一直在动
      if (t > dog.dreamAt){ dog.dreamS = t; dog.dreamAt = t + rand(25, 50); }
      const dp = t - dog.dreamS; if (dp < 2.4){ const e = Math.sin(Math.PI * dp / 2.4); X.paddle = Math.sin(dp * TAU * 3.4) * e; X.dreamWag = e; }
      if (t > dog.spawnT && (!motionArt?.canCurl || (!motion && cur === SETS.sleep))){ dog.spawnT = t + 1.1; const hp = headPt(); spawn('z', hp[0] + dog.faceS * 10 * dog.k * S, hp[1] - 36 * dog.k); }
      // 睡得浅：鼠标在它身边晃，耳朵抖一下；一直晃个不停就被吵醒了（摸头不算，摸着它接着睡）
      const stir = nearPtr && t - ptr.movedAt < .3 && !ptr.over;
      dog.disturb = stir ? dog.disturb + dt : Math.max(0, dog.disturb - dt * .25);
      if (stir && t - (dog.stirAt || -9) > 2){ dog.stirAt = t; dog.twitchAt = t; }
      if (dog.disturb > 4 && dog.auto && !dog.userAway){ dog.disturb = 0; setAction('sit'); PM.kick(dog.mind, 'woken'); PM.wake(dog.mind, 'startled'); }
    }
    else if (a === 'bow'){ T.bow = 1; X.offX = 9 * dog.k / .55 * Math.sin(t * TAU * .85) * MOT; if (!once && dog.actT > .8 && Math.random() < dt * .3) startOnce('hop'); }   // 邀玩时压低前身，偶尔蹦一下
    else if (a === 'hungry' && (world.bowlHeld || world.bowlFalling)){ X.head -= 10; exprName = 'beg'; }   // 你拿着它的碗：抬头望着
    else if (a === 'hungry'){
      const gap = SETS.sit.front * rk + BOWL.w * dog.k * .5 + 4;
      if (dog.hungrySide == null) dog.hungrySide = bowlSide(gap);
      const tx = world.bowlX + dog.hungrySide * gap;
      if (walkTo(tx, dt, false, 1.3)){ turnTo(-dog.hungrySide); T.sit = 1;
        // 一会儿看碗、一会儿看你（狗要吃的就是这样来回看），每次看多久不固定，头转过去也要时间
        if (t > (dog.gazeUntil || 0)){ dog.gazeBowl = !dog.gazeBowl; dog.gazeUntil = t + (dog.gazeBowl ? rand(1.2, 2.6) : rand(1.8, 4)); }
        dog.gazeH = lerp(dog.gazeH || 0, dog.gazeBowl ? 14 : -6, 1 - Math.exp(-dt * 5));
        X.head = dog.gazeH; X.lookBowl = dog.gazeBowl;
        if (t > dog.sighAt){ dog.sighS = t; dog.sighAt = t + rand(4, 9); }
        const lp = (t - dog.sighS) / .6; if (lp >= 0 && lp <= 1) X.tongue = Math.sin(Math.PI * lp) * .5;
      }
    }
    else if (a === 'seek'){
      // 想你理它：走到鼠标附近坐下抬头看你；理它就开心，久不理就委屈地趴下
      const px = ptr.x > 0 && ptr.x < W ? ptr.x : W * .5, side = px > dog.x ? 1 : -1;
      // 想你理它，你却在旁边那块屏幕上：走过去找你
      if (dog.seekPhase === 'go' && otherScreenSide()){ startCross(otherScreenSide(), 'seek'); }
      else if (dog.seekPhase === 'go'){ if (walkTo(clamp(px - side * 75 * S * dog.k, minX(), maxX()), dt)){ dog.seekPhase = 'wait'; dog.seekT = t; } }
      else {
        T.sit = 1; turnTo(side);
        const waited = t - dog.seekT;
        // 刚坐下竖着耳朵看你 → 眼巴巴地等 → 等久了委屈；中间时不时歪歪头
        exprName = waited < 4 ? 'curious' : waited < 25 ? 'beg' : 'sad';
        if (!dog.once && waited > 4 && waited < 30 && t > (dog.seekTiltAt || 0)){ dog.seekTiltAt = t + rand(9, 14); startOnce('tilt'); }
        if (t - dog.lastInteract < 1){ dog.needs.attention = 0; setAction('idle'); PM.kick(dog.mind, 'play'); startOnce('hop'); growEvent('answer'); }
        // 等了 40 秒没人理：委屈地趴下，死心十到二十分钟再说（你可能在忙）
        else if (waited > 40){ setAction('lie'); PM.kick(dog.mind, 'ignored'); growEvent('ignored'); clue('clingy'); dog.needs.attention = Math.min(dog.needs.attention, .3); dog.seekRestUntil = t + rand(600, 1200); }
      }
    }
    else if (a === 'greet'){
      // 你回到电脑前：醒过来跑到鼠标那儿，摇尾巴蹦两下
      const px = ptr.x > 0 && ptr.x < W ? ptr.x : dog.x, side = px > dog.x ? 1 : -1;
      if (!(dog.once && dog.once.type === 'stretch') && walkTo(clamp(px - side * 70 * S * dog.k, minX(), maxX()), dt, false, 1.5) && !dog.once && Math.random() < dt * 1.2) startOnce('hop');
      exprName = 'happy'; X.wagMul = 1.7;
      if (dog.actT > 7.5) setAction('idle');
    }
    else if (a === 'cross'){
      // 去旁边那块屏幕：走出屏幕边，窗口挪过去以后从那边的屏幕边走进来
      const c = dog.cross;
      if (!c){ setAction('idle'); }
      else if (c.phase === 'out'){
        exprName = 'curious';
        const off = (SETS.stand.back + SETS.stand.front) * rk + 16;
        if (walkTo(c.dir > 0 ? W + off : -off, dt, false, 1.15)){
          c.phase = 'moving'; dog.visible = false;
          api.crossScreen(c.dir).then(r => setTimeout(() => enterFrom(r && r.ok ? -c.dir : c.dir, c.then), r && r.ok ? 150 : 0), () => enterFrom(c.dir, c.then));
        }
      } else if (c.phase === 'in'){
        exprName = 'happy'; X.wagMul = 1.4;
        if (walkTo(c.inX, dt, false, 1.15)){ const next = c.then; dog.cross = null; setAction(next); }
      }
    }
    else if (a === 'courier'){
      // 送纸条：低头叼起 → 走出屏幕 → （演示：在外面转一圈）→ 叼回来放到你鼠标附近 → 坐着等你看
      const c = dog.courier, mouthDX = mouthReach() * .92;
      if (!c){ setAction('idle'); }
      else if (c.phase === 'pick'){
        if (!world.groundNote) world.groundNote = { x:dog.x + dog.facing * mouthDX, text:c.text, mine:true };
        T.sniff = .9; T.bow = .45; exprName = 'curious';
        if (dog.actT > 1.1){ world.groundNote = null; dog.carry = c.text; c.phase = 'leave'; c.edge = dog.x > W / 2 ? 1 : -1; }
      } else if (c.phase === 'leave'){
        exprName = 'happy'; X.wagMul = 1.4;
        const off = (SETS.stand.back + SETS.stand.front) * rk + 16;   // 整只狗（含尾巴）都走出屏幕
        if (walkTo(c.edge > 0 ? W + off : -off, dt, false, 1.25)){
          if (c.net){
            // 合养：走出屏幕就到了路上。告诉主进程（带上肚子、心情），由它通知服务器换地方；被别人接走的那种（vanish）不用报
            c.phase = 'gone'; dog.visible = false; dog.abroad = true; dog.carry = null;
            if (!c.vanish) api.togetherDeparted(travelState());
            api.setTooltip(`桌面比格：去找${c.toName || '朋友'}了`);
          } else { c.phase = 'away'; c.awayT = t; dog.visible = false; api.setTooltip('桌面比格：出门送纸条了'); }
        }
      } else if (c.phase === 'away'){
        if (t - c.awayT > COURIER_AWAY){
          c.phase = 'return'; dog.visible = true; const off = (SETS.stand.back + SETS.stand.front) * rk + 16; dog.x = c.edge > 0 ? W + off : -off; dog.facing = dog.faceS = -c.edge; api.setTooltip('桌面比格');
          c.dropX = clamp(ptr.x > 0 && ptr.x < W ? ptr.x : W * .5, minX() + 60, maxX() - 60);
        }
      } else if (c.phase === 'return'){
        exprName = 'happy'; X.wagMul = 1.6;
        if (walkTo(c.dropX - dog.facing * mouthDX, dt, false, 1.25)){ c.phase = 'drop'; c.dropT = t; }
      } else if (c.phase === 'drop'){
        T.sniff = .9; T.bow = .45;
        if (t - c.dropT > .9){
          world.groundNote = { x:dog.x + dog.facing * mouthDX, text:c.text, mine:false, since:t, noteId:c.noteId || null, from:c.from || null };
          dog.carry = null; c.phase = 'wait'; c.waitT = t;
          api.notify(c.from ? `${c.from} 托它带来一张纸条，回桌面点一下就能看` : '它叼回来一张纸条，回桌面点一下就能看');
        }
      } else {
        T.sit = 1; exprName = t - c.waitT < 3 ? 'happy' : 'curious'; X.wagMul = 1.3;   // 放下时得意，然后看着你等你看
        if (!dog.once && t - c.waitT > 8 && Math.random() < dt * .12) startOnce('nudge');
        if (!world.groundNote){ dog.courier = null; setAction('idle'); PM.kick(dog.mind, 'noteRead'); }
        else if (card.hidden && t - c.waitT > NOTE_WAIT){ dog.courier = null; startStash(); }
      }
    }
    else if (a === 'stash'){
      // 把地上的纸条叼起来，挪到一边收好：走过去 → 低头叼 → 走开几步 → 放下收好
      const s = dog.stash, n = world.groundNote, mouthDX = mouthReach() * .92;
      if (!s){ setAction('idle'); }
      else if (s.phase === 'go'){
        if (!n){ dog.stash = null; setAction('idle'); }
        else {
          const side = n.x >= dog.x ? 1 : -1;
          if (walkTo(n.x - side * mouthDX, dt, false, 1.1)){ turnTo(side); if (dog.faceS === side){ s.phase = 'pick'; s.t = t; } }
        }
      } else if (s.phase === 'pick'){
        T.sniff = .9; T.bow = .45; exprName = 'curious';
        if (t - s.t > 1){
          if (world.groundNote){ s.text = world.groundNote.text; s.from = world.groundNote.from; s.noteId = world.groundNote.noteId; dog.carry = s.text; world.groundNote = null; world.noteRect = null; }
          s.phase = 'walk'; s.tx = clamp(dog.x - dog.facing * 1.6 * PH, minX(), maxX());
        }
      } else if (s.phase === 'walk'){
        exprName = 'content';
        if (walkTo(s.tx, dt, false, 1)){ s.phase = 'put'; s.t = t; }
      } else {
        T.sniff = .9; T.bow = .3;
        if (t - s.t > .8){ dog.carry = null; if (s.text){ addNote(s.text, true, s.from); if (s.noteId) dog.notes[dog.notes.length - 1].noteId = s.noteId; } dog.stash = null; setAction('sit'); }
      }
    }
    else if (a === 'eat' && (world.bowlHeld || world.bowlFalling)){ dog.eatPhase = 'walk'; dog.eatSide = null; X.head -= 10; exprName = 'beg'; }   // 吃着被你端走了：抬头望着，落地再过去
    else if (a === 'eat'){
      if (dog.eatPhase === 'walk'){
        if (dog.eatSide == null) dog.eatSide = bowlSide(mouthReach() * .8);
        const tx = world.bowlX + dog.eatSide * mouthReach() * .8;
        if (walkTo(tx, dt, false, 1.6)){ turnTo(-dog.eatSide); if (dog.faceS === -dog.eatSide){ dog.eatPhase = 'down'; dog.downT = dog.t; } }
      } else if (dog.eatPhase === 'down' || dog.eatPhase === 'eat'){
        T.sniff = .85; T.bow = .5; X.neck = 0; dog.eatAmt = Math.min(1, (dog.eatAmt || 0) + dt * 2); exprName = 'content';
        if (dog.eatPhase === 'eat'){
          X.chew = Math.sin(t * TAU * 3.2);
          const d = Math.min(world.food, dt * .14); world.food -= d; dog.belly = Math.min(1, dog.belly + d * .9);
          if (Math.random() < dt * 3) { const m = mouthPt(); spawn('crumb', m[0], m[1]); }
          if (world.food <= 0){ world.food = 0; dog.eatPhase = 'lick'; dog.lickT = 0; }
          else if (dog.belly >= EFF.fullAt){ dog.eatPhase = 'lick'; dog.lickT = 0; clue('stomach'); }   // 吃饱了，剩下的不吃了
        } else if (dog.t - dog.downT > 1) dog.eatPhase = 'eat';
      } else {
        dog.lickT += dt; X.tongue = Math.sin(Math.min(1, dog.lickT / .9) * Math.PI) * .6; exprName = 'content';
        if (dog.lickT > 1.4){
          if (dog.belly > .6){
            // 吃撑了：转身走开几步再趴下，别趴在碗上
            setAction('walk'); PM.kick(dog.mind, 'ate'); dog.pause = .3; dog.thenAct = 'lie';
            dog.target = clamp(dog.x - 1.4 * PH, minX(), maxX());
          } else { setAction('idle'); PM.kick(dog.mind, 'ate'); }
        }
      }
    }
    else if (a === 'bringBowl'){
      const b = dog.bring, reach = mouthReach() * .85;
      if (!b || world.bowlHeld){ setAction('hungry'); }
      else if (b.phase === 'go'){
        if (b.side == null) b.side = bowlSide(reach);
        if (walkTo(world.bowlX + b.side * reach, dt, false, 1.2)){ turnTo(-b.side); if (dog.faceS === -b.side){ b.phase = 'pick'; b.t = t; } }
      } else if (b.phase === 'pick'){
        T.sniff = .9; T.bow = .5; exprName = 'curious';
        if (t - b.t > .9){
          world.bowlCarried = true; dog.carryBowl = true; b.phase = 'carry';
          const px = ptr.x > 0 && ptr.x < W ? ptr.x : W * .5, dir = px > dog.x ? 1 : -1;
          b.tx = clamp(px - dir * (reach + BOWL.w * dog.k * .4), minX(), maxX());
        }
      } else if (b.phase === 'carry'){
        exprName = 'happy'; X.head -= 4;
        if (walkTo(b.tx, dt, false, 1.05)){ b.phase = 'drop'; b.t = t; }
      } else {
        T.sniff = .9; T.bow = .45;
        if (t - b.t > .7){ placeCarriedBowl(); dog.bring = null; setAction('hungry'); dog.hungrySide = -dog.faceS; }
      }
    }
    // 单次动作
    if (once){
      const p = (t - once.t0) / once.dur;
      if (p >= 1){ dog.once = null; syncUI(); }
      else if (once.type === 'yawn'){ const o = Math.sin(Math.PI * p); X.jaw += 15 * o; X.closed = X.closed || o > .35; X.neck += -9 * o; X.tongue -= .3 * o; }
      else if (once.type === 'shake'){
        const env = smooth(0, .14, p) * (1 - smooth(.62, 1, p));
        X.shake = env * MOT; X.shakePhase = TAU * (3 * p + 2.4 * p * p);
        X.lid = Math.max(X.lid, .65 * env);
      }
      else if (once.type === 'stretch'){ const b = smooth(0, .25, p) * (1 - smooth(.6, .85, p)); T.bow = Math.max(T.bow, b); T.lie = 0; T.rest = 0; T.sit = 0; const y = Math.sin(Math.PI * clamp((p - .15) / .5, 0, 1)); X.jaw += 13 * y; X.closed = X.closed || y > .4; X.neck += -12 * y; X.closed = X.closed && a !== 'sleep' ? X.closed : X.closed; if (a === 'sleep') X.closed = y > .4; }
      else if (once.type === 'tilt'){ const s = p < .5 ? -1 : 1; X.head += 13 * s * smooth(0, .12, p) * (1 - smooth(.9, 1, p)); if (!['beg', 'sad', 'sleepy'].includes(exprName)) exprName = 'curious'; }   // 眼巴巴、委屈时歪头不换脸
      else if (once.type === 'poke'){ exprName = 'surprised'; }
      else if (once.type === 'glance'){ const o = Math.sin(Math.PI * p), ahead = Math.sign(world.bowlX - dog.x) === dog.facing; X.head += (ahead ? 9 : -5) * o; exprName = 'beg'; if (p > .55 && p < .8) X.tongue = .5; }
      else if (once.type === 'nudge'){ const o = Math.sin(Math.PI * p); X.neck += 22 * o; X.head += 8 * o; }
      if (once && once.type === 'hop'){}
    }
    // 要掉头了：先抬头站直再转，转完接着做原来的事（闻地面时掉头、趴下前转圈都走这里）
    if (pivotTurn || dog.faceS !== dog.facing){ T.sniff = 0; T.bow = 0; X.scent = 0; }
    if(pivotTurn && !turnArt){const lift=Math.sin(Math.PI*pivotTurn.progress);X.rootLift=Math.max(X.rootLift,PH*.065*lift*MOT);X.head+=9*lift;}
    const hp = (t - dog.hop) / .45;
    if (hp >= 0 && hp <= 1){ X.rootLift = Math.sin(Math.PI * hp) * 26 * dog.k * MOT; X.tuck = Math.sin(Math.PI * hp); if (exprName === 'neutral') exprName = 'happy'; }
    if (!dog.held && !dog.falling) dog.y = GY;
  }
  // 摸摸
  const overHead = ptr.over && !dog.held;
  if (overHead && t - ptr.movedAt < .15 && ptr.speed > 40) dog.pet = Math.min(2, dog.pet + dt * 1.6); else dog.pet = Math.max(0, dog.pet - dt * .6);
  if (dog.pet > .35){ dog.lastInteract = t; if (t - (dog.petEventAt || -99) > 60){ dog.petEventAt = t; growEvent('pet'); } }
  if (dog.pet > .35){
    exprName = a === 'sleep' ? 'sleepy' : 'content'; X.head += -5; X.wagMul = 1.8;
    if (t > dog.spawnT){ dog.spawnT = t + .55; const hp2 = headPt(); spawn('heart', hp2[0] + rand(-20, 20) * dog.k, hp2[1] - 40 * dog.k); }
  }
  // 看鼠标：鼠标离得远、在别的窗口上、好一会儿没动，就慢慢不看了
  let lookTgt = 0;
  if (!dog.held && !['sleep', 'eat'].includes(a) && !dog.moving && !ptr.covered && t - ptr.movedAt < 2.5){
    const hp3 = eyePt(), dxRaw = ptr.x - hp3[0], dx = dxRaw * Math.sign(dog.faceS), dy = ptr.y - hp3[1];
    const w = 1 - smooth(4 * PH, 8 * PH, Math.hypot(dxRaw, dy));   // 越远越不在意
    // 角度用横向距离的绝对值算，鼠标从它面前绕到身后时头只是慢慢回正，不会一下跳回去
    const front = lerp(.5, 1, smooth(-.3 * PH, .3 * PH, dx));
    lookTgt = clamp(Math.atan2(dy, Math.max(.5 * PH, Math.abs(dx))) / D2R * .45, -14, 16) * w * front;
    // 鼠标在它身后、离得不远、待了 3 秒：转过来看你；转完 12 秒内不再为这个转
    const behind = dx < -.3 * PH && Math.abs(dxRaw) < 3 * PH;
    dog.behindT = behind ? dog.behindT + dt : 0;
    if (dog.behindT > 3 && ['idle', 'sit'].includes(a) && t - (dog.lookTurnAt || -99) > 12){ turnTo(-dog.facing); dog.behindT = 0; dog.lookTurnAt = t; }
  } else dog.behindT = 0;
  // 头用弹簧跟过去并限速：鼠标一跳一跳（远处每 0.25 秒才报一次位置）头也不会跟着抽
  dog.lookTgt = lookTgt;
  dog.lookV = clamp((dog.lookV || 0) + ((lookTgt - dog.look) * 22 - 9.4 * (dog.lookV || 0)) * dt, -45, 45);
  dog.look += dog.lookV * dt;
  // 送纸条、迎接、求关注本来就是要凑到鼠标边上，这几种不躲
  const parked = t - ptr.movedAt > .8 && !interactive && !ptr.down;
  const near = dog.visible && !dog.held && !dog.moving && parked && !['courier', 'greet', 'seek', 'hungry', 'eat'].includes(a) && inBox(dog.bbox, ptr.x, ptr.y, dog.fading ? 70 : 24);
  dog.nearT = near ? Math.min(6.5, dog.nearT + dt) : Math.min(2.4, Math.max(0, dog.nearT - dt * 3));   // 鼠标一动或离开就立刻不再变淡
  const fadeNow = dog.nearT > 2.5;
  if (fadeNow !== !!dog.fading){ dog.fading = fadeNow; diag('fade', fadeNow ? 'on' : 'off'); }
  dog.alpha = lerp(dog.alpha, dog.fading ? .5 : 1, Math.min(1, dt * 1.6));
  if (dog.nearT > 6 && dog.auto && ['idle', 'sit', 'lie'].includes(a)){
    setAction('walk'); dog.target = clamp(dog.x + (dog.x > ptr.x ? 1 : -1) * 280 * dog.k / .33, minX(), maxX()); dog.pause = 0; dog.nearT = 0;
  }
  // 表情和姿势平滑过渡
  // 表情的耳朵、眉毛、尾巴：吃惊一下子就上来，别的情绪零点几秒慢慢变过去
  const TE = EXPR[exprName] || EXPR.neutral, re = 1 - Math.exp(-dt * (exprName === 'surprised' ? 12 : 3)), rp = 1 - Math.exp(-dt * (dog.held ? 10 : 3.2));
  for (const k of EKEYS) dog.E[k] += (TE[k] - dog.E[k]) * re;
  for (const k of POSE_KEYS) dog.P[k] += (T[k] - dog.P[k]) * rp;
  // 吃饭只降胸和头，前爪留在碗外；被打断时也从当前落点平滑过渡。
  dog.foreReach = lerp(dog.foreReach || 0, a === 'eat' ? 0 : T.bow*48 + T.sniff*4, rp);
  dog.scentWeight = X.scent || Math.max(0, (dog.scentWeight || 0) - dt*3);
  dog.curExpr = exprName;
  // 选哪套素材：被拎着、掉落时总是站姿
  const want = dog.held || dog.falling ? 'stand' : T.rest > .5 ? 'sleep' : T.lie > .5 ? 'prone' : T.sit > .5 ? 'sit' : 'stand';
  updateTurn(dt);
  if (trans){ trans.t += dt; if (trans.t >= trans.dur) trans = null; }
  if (motion?.kind === 'curl') updateCurl(want, dt);
  else if (motion) updateGround(want, dt);
  else if ((dog.held || dog.falling) && cur.name !== 'stand') {
    if (cur===SETS.sleep && motionArt?.canCurl) beginCurl(false);
    else if (cur===SETS.prone && motionArt?.canRise) beginGround('rise',true);
    else if (cur===SETS.sit && motionArt?.supports(GROUND_MOTIONS.sit.keys)) beginGround('sit',false);
    else { nextStop = null; startTrans(SETS.stand, .22, dog.facing); }
  } else if (!trans) advancePose(want);
  applyPose(dt, X);
  if (world.bowlCarried) bowlAtMouth();
  if (trans) posePrev();
  if (motion?.kind === 'curl'){
    // 把“睡觉”指令的闭眼推迟到头埋下去，过程中仍可自然眨眼。
    const eyelid = motion.frame.options.eyelid;
    X.closed = eyelid >= .8; X.lid = eyelid >= .3 ? .46 : 0;
    if (motion.wakeMix > .5 && !X.closed && exprName === 'sleepy') exprName = 'neutral';
  }
  chooseFace(exprName, X);
}

function pawTargets(from, to, steps, progress){
  const paws = {};
  for (const [leg, window] of Object.entries(steps)){
    const a = RIG.rel(from, from.legs[leg].ft), b = RIG.rel(to, to.legs[leg].ft);
    if (!window){ paws[leg]=a; continue; }
    const [start, end, lift] = window, step = smooth(start, end, progress);
    paws[leg] = [lerp(a[0], b[0], step), lerp(a[1], b[1], step) - SETS.stand.restH * lift * Math.sin(Math.PI * step)];
  }
  return paws;
}
function groundFrame(kind, progress){
  const {keys,times,steps} = GROUND_MOTIONS[kind];
  const t = smooth(0,1,progress);
  let i = 0;
  while (i + 2 < times.length && t >= times[i+1]) i++;
  const u = (t - times[i]) / (times[i+1] - times[i]);
  const first=SETS[keys[0]], last=SETS[keys.at(-1)];
  const options = {fromLive:i === 0, toLive:i === keys.length-2, paws:pawTargets(first,last,steps,progress)};
  const h=SETS.stand.restH, arc=Math.sin(Math.PI*u), beat=Math.sin(Math.PI*progress);
  if (kind === 'rise'){
    const lift = smooth(0,.21,progress) * (1-smooth(.25,.64,progress));
    const settle = smooth(.72,.87,progress) * (1-smooth(.87,1,progress));
    options.headLift=h*(.0243*lift-.0084*settle); options.headAngle=-4*lift+1.8*settle;
    options.earLag=4*lift-3*settle;
  } else if (kind === 'sit'){
    // 重心先移到前爪。后腿先折，最后腰臀稍快地落下；反向播放时头胸先离座。
    options.rear=clamp(u+.12*arc,0,1); options.front=clamp(u-.10*arc,0,1);
    options.foldHind=true;
    options.head=options.front; options.headForward=h*.037*beat; options.headAngle=4.8*beat;
    options.earLag=-3.2*beat;
  } else {
    // 后脚在臀下承重。两只前爪错开伸出时低头，胸和手肘随后落地。
    options.front=clamp(u+.20*arc,0,1); options.rear=clamp(u-.04*arc,0,1);
    options.articulateFront=true;
    options.head=options.front; options.headLift=-h*.027*beat; options.headAngle=7*beat;
    options.earLag=-3.6*beat;
  }
  return {from:SETS[keys[i]],to:SETS[keys[i+1]],u,options};
}
function beginGround(kind, forward){
  const keys=GROUND_MOTIONS[kind].keys, progress=forward?0:1;
  recordPose(cur.name,kind === 'sit' ? 'sit-down' : kind);
  motion={kind,progress,direction:forward?1:-1,frame:groundFrame(kind,progress)};
  cur=SETS[forward?keys.at(-1):keys[0]]; nextStop=null;
}
function updateGround(want, dt){
  const {kind,progress}=motion, {keys,seconds}=GROUND_MOTIONS[kind];
  const first=keys[0], last=keys.at(-1);
  const pickedUp = dog.held || dog.falling;
  const goal=want==='sleep'?'prone':want;
  const forward=goal===last || (goal!==first && (kind==='sit' ? goal==='prone' : kind==='lower' ? false : progress>=.5));
  motion.direction=forward?1:-1;
  const next=progress+motion.direction*dt*(pickedUp?3.3:1)/seconds[forward?0:1];
  if (next <= 0 || next >= 1){
    cur=SETS[next<=0?first:last]; motion=null;
    recordPose(kind === 'sit' ? 'sit-down' : kind,cur.name);
    return;
  }
  motion.progress=next; motion.frame=groundFrame(kind,next);
}

function curlFrame(p, wakeMix){
  const first = p < HALF_CURLED;
  const from = first ? SETS.prone : SETS.curl, to = first ? SETS.curl : SETS.sleep;
  const t = first ? p / HALF_CURLED : (p - HALF_CURLED) / (1 - HALF_CURLED);
  // 入睡有一拍搁下巴的停顿；醒来时头先探出，身体和尾巴随后展开。
  // 改主意时两种节奏短暂衔接，从当前进度继续。
  const track = (inStart, inEnd, outStart, outEnd) => lerp(smooth(inStart,inEnd,t), smooth(outStart,outEnd,t), wakeMix);
  const front = first ? track(.46,1,0,1) : track(0,.9,0,.78);
  const rear  = first ? track(.39,1,.04,1) : track(0,.88,.02,.75);
  const head  = first ? track(.52,1,0,1) : track(0,1,.04,1);
  const tail  = first ? track(.43,1,.08,1) : track(0,.91,.04,.80);
  const chin = smooth(0,.20,p) * (1 - smooth(.31,.64,p)) * (1 - wakeMix);
  const peek = smooth(.29,.76,p) * (1 - smooth(.77,1,p)) * wakeMix;
  const pawPhase = first ? lerp(clamp((t - .38)/.62,0,1),t,wakeMix) : t;
  const paws = pawTargets(from, to, CURL_STEPS, pawPhase);
  const eyelid = lerp(.52 * smooth(0,.12,p) + .48 * smooth(.48,.71,p), smooth(.75,.99,p), wakeMix);
  const options = {curl:true, fromLive:first, toLive:!first, front, rear, head, tail, chin, eyelid, paws,
    headLift:SETS.prone.headH * (-.35 * chin + .15 * peek),
    headAngle:13 * chin - 5 * peek, earLag:-4 * chin + 3 * peek};
  return {from, to, u:(front + rear) / 2, options};
}
function beginCurl(entering){
  const p = entering ? 0 : 1, wakeMix = entering ? 0 : 1;
  recordPose(cur.name, 'curl');
  // 抬头时最后一声呼吸很快散去，字粒子不会落到睁开的眼睛上。
  if (!entering) for (const puff of dog.particles) if (puff.type === 'z') puff.wakeAt = dog.t;
  motion = {kind:'curl', progress:p, direction:entering ? 1 : -1, wakeMix, frame:curlFrame(p,wakeMix)};
  cur = entering ? SETS.sleep : SETS.prone;
  nextStop = null; dog.prevH = null; dog.prevV = [0,0];
}
function updateCurl(want, dt){
  const held = dog.held || dog.falling;
  const entering = !held && want === 'sleep';
  motion.direction = entering ? 1 : -1;
  const duration = entering ? CURL_IN_SECONDS : CURL_OUT_SECONDS;
  const p = motion.progress + motion.direction * dt / duration * (held ? 3.4 : 1);
  if (p <= 0 || p >= 1){
    cur = p <= 0 ? SETS.prone : SETS.sleep;
    motion = null; recordPose('curl',cur.name);
    // 这三组表面只在头转向镜头时绘制。离开过渡后一次释放，下一次转头再生成。
    SETS.prone.faceView?.release();SETS.curl.faceView?.release();
    KIT?.releaseFaceCanvas?.();
    return;
  }
  motion.progress = p;
  motion.wakeMix = lerp(motion.wakeMix, entering ? 0 : 1, 1-Math.exp(-dt*7));
  if (p < .09) cur = SETS.prone;
  else if (p > .91) cur = SETS.sleep;
  motion.frame = curlFrame(p, motion.wakeMix);
}
function recordPose(from, to){
  (dog.route = dog.route || []).push(from + '>' + to);
  if (dog.route.length > 24) dog.route.shift();
  diag('pose', from + '>' + to);
}

// 换姿势：一次只走一步（站↔坐、站↔趴、坐↔趴、趴↔睡），每一步两套图的关键点互相靠拢，中间再淡入淡出
function nextHop(from, to){
  const prev = { [from]:null }, q = [from];
  while (q.length){ const a = q.shift(); if (a === to) break; for (const b of ROUTE[a] || []) if (SETS[b] && !(b in prev)){ prev[b] = a; q.push(b); } }
  if (!(to in prev)) return to;
  let n = to; while (prev[n] && prev[n] !== from) n = prev[n];
  return n;
}
function advancePose(want){
  if (pivotTurn) return;
  if (dog.faceS !== dog.facing && cur===SETS.sit && want==='sit') want='stand';
  if (dog.faceS !== dog.facing && want === 'stand' && cur === SETS.stand) return;
  if (motionArt?.canCurl && cur === SETS.prone && want === 'sleep'){ beginCurl(true); return; }
  if (motionArt?.canCurl && cur === SETS.sleep && want !== 'sleep'){ beginCurl(false); return; }
  const goal=want==='sleep'?'prone':want;
  if (!dog.held && !dog.falling && cur.name!==goal){
    for (const [kind, spec] of Object.entries(GROUND_MOTIONS)){
      if (!motionArt?.supports(spec.keys)) continue;
      const start=spec.keys[0], end=spec.keys.at(-1);
      if (cur.name===start && goal===end){ beginGround(kind,true); return; }
      if (cur.name===end && goal===start){ beginGround(kind,false); return; }
    }
  }
  // 转身经过两个斜身视角。两幅转身图共用纹理，骨架独立，正脸处也能连续插值。
  if (cur.name === 'turn'){
    if (cur === SETS.turn && dog.facing !== dog.faceS) startTrans(reverseTurn, .30, dog.facing);
    else startTrans(SETS.stand, .32);
    return;
  }
  if (SETS.turn && dog.faceS !== dog.facing && !dog.held && !dog.falling){
    if (cur === SETS.stand){ dog.turnHop = dog.t; startTrans(SETS.turn, .32); return; }
    want = 'stand';
  }
  if (nextStop && cur.name === nextStop.via){
    const step = nextStop; nextStop = null;
    startTrans(SETS[want === step.from ? step.from : step.to], step.dur);
    return;
  }
  if (want === cur.name) return;
  const from = cur.name, to = nextHop(from, want);
  const via = BETWEEN[from + '|' + to] || BETWEEN[to + '|' + from];
  const dur = TDUR[from + '|' + to] || .6;
  if (via && SETS[via]){
    nextStop = {from, to, via, dur:dur * .72};
    // 趴着回头看尾巴，比单纯合眼需要更长的时间。
    const tuckingHead = from === 'prone' && via === 'curl';
    startTrans(SETS[via], tuckingHead ? dur * 1.10 : nextStop.dur);
  } else startTrans(SETS[to], dur);
}
function startTrans(to, dur, facing = dog.faceS){
  if (!to || to === cur) return;
  const useOld = trans && transE() <= .5;
  const from = useOld ? trans.from : cur, fromFacing = useOld ? trans.fromFacing : dog.faceS;
  if (from === to){ trans = null; cur = to; dog.faceS = fromFacing; return; }
  const pair = from.name + '|' + to.name, lead = /lie-down|(sit\|prone)|(prone\|sit)/.test(pair) ? 'front' : /crouch|(stand\|sit)|(sit\|stand)/.test(pair) ? 'rear' : null;
  trans = { from, fromFacing, facingRelation:fromFacing * facing, yaw:from.name === 'turn' && to.name === 'turn', t:0, dur, lead, base:RIG.snapshot(from) };
  cur = to; dog.faceS = facing;
  if (fromFacing !== facing){ dog.prevH = null; dog.prevV = [0,0]; diag('flip', facing); }
  recordPose(from.name, to.name);
}
const transE = () => trans ? smooth(0, 1, trans.t / trans.dur) : 1;
// 前半身、后半身各走到哪了（0~1）：先动的那一半提前，后动的那一半推后
function transW(){
  if (!trans) return [1, 1];
  const p = clamp(trans.t / trans.dur, 0, 1), early = smooth(0, .7, p), late = smooth(.3, 1, p);
  return trans.lead === 'front' ? [early, late] : trans.lead === 'rear' ? [late, early] : [smooth(0, 1, p), smooth(0, 1, p)];
}
// 旧姿势：停在开始换的那一刻，再一点点靠向新姿势
function posePrev(){
  const P = trans.from, e = transE();
  RIG.restore(P, trans.base);
  if (trans.yaw){ RIG.solve(P); return; }
  const [ef, er] = transW();
  RIG.morphToward(P, cur, ef, trans.facingRelation, er);
  RIG.solve(P);
  for (const n of Object.keys(P.legs)){ const f = RIG.footToward(P, cur, n, n[0] === 'f' ? ef : er, trans.facingRelation); RIG.ik(P, n, f[0], f[1], 1); }
  RIG.solve(P);
}
// 眼睛、嘴巴：按表情选零件，再叠上眨眼、打哈欠、咀嚼、舔嘴、叼东西
function chooseFace(exprName, X){
  const t = dog.t, f = dog.face;
  let [eye, mouth] = FACE[exprName] || FACE.neutral;
  const bp = t - dog.blinkS, BD = dog.blinkD || .2;
  if (X.closed) eye = 'closed';
  else {
    if (X.lid > .6) eye = 'closed'; else if (X.lid > .25) eye = 'half';
    if (bp >= 0 && bp < BD){ if (eye !== 'closed') eye = bp < BD * .2 || bp > BD * .7 ? 'half' : 'closed'; }
    else if (eye === 'open'){ if (dog.look < -8) dog.lookUp = true; else if (dog.look > -4) dog.lookUp = false; if (dog.lookUp) eye = 'look-up'; }   // 带回差，不在边界来回换
    if (X.lookBowl && eye === 'look-up') eye = 'open';
  }
  if (X.jaw > 7) mouth = 'yawn';
  else if (X.chew) mouth = X.chew > .2 ? 'chew' : 'neutral';
  else if (X.tongue > .15) mouth = 'lick';
  if (dog.carry || dog.carryBowl){ mouth = 'hold'; if (eye === 'open' || eye === 'wide') eye = 'look-up'; }
  // 换图的淡入时间：眨眼、咀嚼、舔嘴、打哈欠是快动作；表情变了要慢一点淡过去，不是一下换一张脸
  if (eye !== f.eye){ f.eyeD = (bp >= 0 && bp < BD) || eye === 'closed' || f.eye === 'closed' ? .07 : .22; f.eyeP = f.eye; f.eye = eye; f.eyeT = t; }
  if (mouth !== f.mouth){ f.mouthD = X.chew || ['chew', 'yawn', 'lick'].includes(mouth) || ['chew', 'yawn', 'lick'].includes(f.mouth) ? .09 : .22; f.mouthP = f.mouth; f.mouth = mouth; f.mouthT = t; }
}
function faceState(){
  const f = dog.face, t = dog.t;
  return { eye:f.eye, eyeP:f.eyeP, eyeF:clamp((t - f.eyeT) / (f.eyeD || .07), 0, 1), mouth:f.mouth, mouthP:f.mouthP, mouthF:clamp((t - f.mouthT) / (f.mouthD || .09), 0, 1), carry:!!dog.carry };
}

function applyPose(dt, X){
  const t = dog.t, P = dog.P, E = dog.E, set = cur, Bn = set.bones, st = set.name, u = set.restH / 163;
  RIG.reset(set);
  // 走路：步频跟着移动速度走，脚落地时不打滑
  dog.wb = lerp(dog.wb, dog.moving ? 1 : 0, Math.min(1, dt * 8));
  // 半个步态周期内身体前进两个半步幅，承重爪同时往后移相同距离。
  const stride = 14 * u;
  if (dog.moving) dog.phase += Math.PI * dt * dog.speed / (2 * rk * stride);
  const lift = Math.abs(Math.sin(dog.phase)) * 3 * dog.k * dog.wb + (X.rootLift || 0);
  Bn.head.rot += 2 * dog.wb * Math.sin(dog.phase * 2);
  Bn.body.rot += .8 * dog.wb * Math.sin(dog.phase * 2 + .5);
  if (st === 'stand'){
    // 邀玩、闻地面、低落：前半身压低，脖子往下
    Bn.chest.ty += u * (P.bow * 24 + P.low * 4 + P.sniff * 12);
    Bn.hip.ty += u * (P.bow * -4 + P.low * 5);
    Bn.chest.rot += P.bow * 6 + P.sniff * 4;
    Bn.neck.rot += P.sniff * 50 + P.bow * -10 + P.low * 12 + X.neck;
    Bn.head.rot += P.sniff * 12 + P.low * 6 + X.head + dog.look;
    if (dog.scentWeight){
      const sniff = Math.sin(t * TAU * 2.2), weight = dog.scentWeight;
      Bn.chest.ty += 8 * u * weight;
      Bn.neck.ty += u * weight * (8 + 2 * sniff * MOT);
      Bn.neck.rot += weight * (7 + 3 * sniff * MOT);
      Bn.head.rot += weight * (2 - 1.6 * sniff * MOT);
    }
  } else {
    Bn.neck.rot += X.neck * .5;
    Bn.head.rot += (X.head + dog.look) * (st === 'sleep' ? .2 : .8);
  }
  // 被拎起：腿垂下来晃
  if (st === 'stand' && dog.held){
    const sway = clamp(-dog.vx * .035, -28, 28), struggle = (X.struggle || 0) * MOT;
    const beat = (t - dog.heldT) * TAU * 2.4, kick = Math.sin(beat);
    for (const [i,leg] of ['fn','ff','hn','hf'].entries()){
      const front = i < 2, swing = (i === 0 || i === 3 ? 1 : -1) * kick;
      Bn[leg+'U'].rot += sway * (front ? 1 : .8) + 5 * Math.sin(t*4+i) + struggle * swing * (front ? 23 : 19);
      Bn[leg+'L'].rot += (front ? 10 : -6) + struggle * (front ? 1 : -1) * (8 + 13 * Math.max(0,swing));
    }
    Bn.chest.rot += 1.8 * struggle * kick; Bn.hip.rot -= 2.3 * struggle * kick;
  } else if (st === 'stand' && dog.falling){ Bn.fnU.rot -= 12; Bn.ffU.rot -= 12; Bn.hnU.rot += 12; Bn.hfU.rot += 12; }
  if (X.paddle && st === 'sleep'){ const k = X.paddle * 5; for (const [n, d] of [['fnL', 1], ['ffL', -1], ['hnL', .7], ['hfL', -.7]]) if (Bn[n]) Bn[n].rot += k * d; }
  // 抖毛
  if (X.shake){
    const a=X.shake, p=X.shakePhase;
    Bn.head.rot += 9*a*Math.sin(p); Bn.neck.rot += 6*a*Math.sin(p-.35);
    Bn.chest.rot += 5*a*Math.sin(p-.95); Bn.hip.rot += 4*a*Math.sin(p-1.65);
    Bn.belly.tx += 2*u*a*Math.sin(p-1.1);
    if (Bn.tail0) Bn.tail0.rot += 13*a*Math.sin(p-2.1);
  }
  // 呼吸、肚子（吃得多肚子鼓起来）
  const sleeping = st === 'sleep', lying = sleeping || st === 'prone', brF = sleeping ? .25 : (E.pant > .6 ? 1.3 : .45 - .15 * dog.mind.drowsy);   // 犯困时呼吸也慢下来
  dog.brPh = (dog.brPh || 0) + dt * TAU * brF;
  const br = Math.sin(dog.brPh) * MOT * (lying ? 1.6 : 1);
  Bn.chest.sy *= 1 + .012 * br; Bn.chest.sx *= 1 + .005 * br;
  const bw = dog.wb * Math.sin(dog.phase * 2) * dog.belly;
  Bn.belly.ty += (lying ? -2 * dog.belly : dog.belly * 9 + .6 * br + bw * 1.5) * u;
  Bn.belly.sx *= 1 + .1 * dog.belly; Bn.belly.sy *= 1 + (lying ? .06 : .12) * dog.belly + (lying ? .012 * br : 0);
  if (sleeping) Bn.head.rot += .8 * br;
  // 耳朵基础角度
  const earBase = E.earBack * 8 - E.earLift * 6;
  if (Bn.ear0) Bn.ear0.ty += -E.earLift * 1.5 * u;
  // 尾巴：坐着、趴着时尾巴贴地，摇得小
  const wagA = (E.wag + (X.dreamWag ? 5 : 0)) * X.wagMul * MOT * (st === 'stand' ? 1 : st === 'sit' ? .3 : st === 'prone' ? .45 : .12);
  dog.wag = lerp(dog.wag, wagA, Math.min(1, dt * 3));
  dog.wagPh = (dog.wagPh || 0) + dt * TAU * (E.wagF * (X.wagMul > 1 ? 1.4 : 1));
  if (Bn.tail0){
    const om = dog.wagPh, up = st === 'stand' ? -E.tuck * 60 + (E.wag > 20 ? 8 : 0) + P.bow * 14 + P.sniff * 8 : 0;
    Bn.tail0.rot += up + dog.wag * Math.sin(om); Bn.tail1.rot += dog.wag * .7 * Math.sin(om - .7) + (st === 'stand' ? E.tuck * 10 : 0); Bn.tail2.rot += dog.wag * .6 * Math.sin(om - 1.4);
  }
  // 落地一沉
  const impact = (t - dog.land) / .36;
  if (st === 'stand' && impact >= 0 && impact < 1 && !dog.held && !dog.falling){
    const front = smooth(0, .20, impact) * (1 - smooth(.23, 1, impact)) * MOT;
    const rear = smooth(.06, .31, impact) * (1 - smooth(.33, 1, impact)) * MOT;
    Bn.chest.ty += 13 * u * front; Bn.hip.ty += 9 * u * rear;
    Bn.chest.sy -= .035 * front; Bn.head.rot += 4.5 * front;
  }
  if (!dog.held && !dog.falling) dog.y = GY - lift;
  dog.offX = X.offX;

  // 吃饭时把嘴对准碗
  const eating = dog.action === 'eat' && (dog.eatPhase === 'down' || dog.eatPhase === 'eat');
  if (!eating){ dog.neckFix[0] *= .9; dog.neckFix[1] *= .9; }
  if (st === 'stand'){ Bn.neck.tx += dog.neckFix[0]; Bn.neck.ty += dog.neckFix[1]; }
  // 换姿势刚开始：新姿势先摆成接近旧姿势的样子，再慢慢回到自己
  const mw = trans && !trans.yaw ? 1 - transE() : 0;
  const [wf0, wr0] = trans && !trans.yaw ? transW() : [1, 1], mwF = trans && !trans.yaw ? 1 - wf0 : 0, mwR = trans && !trans.yaw ? 1 - wr0 : 0;
  if (mw > 0) RIG.morphToward(set, trans.from, mwF, trans.facingRelation, mwR);
  // 肚子：刚吃饱鼓一点，长胖了圆一点（养成里的胖瘦），往下、往两边撑
  const round = Math.max(0, dog.belly - .8) * .35 + Math.max(0, GROW.weight) * .22;
  if (round > .002 && Bn.belly){ Bn.belly.sy *= 1 + round; Bn.belly.sx *= 1 + round * .5; Bn.belly.ty += round * 14 * u; }
  RIG.solve(set);
  // 站着时四只爪子踩在地上；走路时按对角步态抬脚、落脚
  if (st === 'stand' && !dog.held && !dog.falling){
    for (const n of ['fn', 'ff', 'hn', 'hf']){
      const g = set.legs[n]; if (!g) continue;
      const q = (dog.phase / TAU + (n === 'fn' || n === 'hf' ? .25 : .75)) % 1;
      const swing = Math.max(0, 2*q-1);
      // 离地和接地两端的水平速度与承重段一致。
      const reach = q < .5 ? 1-4*q : -1-2*swing+4*smooth(0,1,swing);
      const f0 = RIG.footToward(set, mw > 0 ? trans.from : null, n, n[0] === 'f' ? mwF : mwR, trans ? trans.facingRelation : 1);
      let tx = f0[0] + stride * reach * dog.wb;
      let ty = f0[1] + (lift - (X.rootLift || 0)) / rk - 10*u*dog.wb*Math.sin(Math.PI*swing)**2;
      if (n[0] === 'f') tx += dog.foreReach * u;   // 邀玩时前腿往前伸直趴低，不是折起来
      if (X.tuck) ty -= X.tuck * 10 * u;
      RIG.ik(set, n, tx, ty, 1);
    }
    RIG.solve(set);
  } else if (mw > 0){
    for (const n of Object.keys(set.legs)){ const f = RIG.footToward(set, trans.from, n, n[0] === 'f' ? mwF : mwR, trans.facingRelation); RIG.ik(set, n, f[0], f[1], 1); }
    RIG.solve(set);
  }
  // 耳朵弹簧：头一晃耳朵就甩，角度限制在素材允许的范围里（再大会露出耳根）
  const hp = setPt(set, 'head', [Bn.head.px, Bn.head.py]);
  if (!dog.prevH) dog.prevH = hp;
  const v = [(hp[0] - dog.prevH[0]) / dt, (hp[1] - dog.prevH[1]) / dt];
  const acc = [clamp((v[0] - dog.prevV[0]) / dt, -6000, 6000), clamp((v[1] - dog.prevV[1]) / dt, -6000, 6000)];
  dog.prevH = hp; dog.prevV = v;
  const fs = (Math.sign(dog.faceS) || 1) * (set.mirror ? -1 : 1), f = (acc[0] * fs * .9 - acc[1]) * .6 / (dog.k / .55);
  if (dog.t > dog.twitchAt){ dog.twitchAt = dog.t + (dog.action === 'sleep' && !dog.dozing ? rand(12, 30) : rand(6, 15)); dog.ev += rand(-1, 1) > 0 ? 220 : -220; }
  dog.ev += (-160 * (dog.ea - earBase) - 9 * dog.ev + f) * dt; dog.ea = clamp(dog.ea + dog.ev * dt, -14 + earBase, 14 + earBase);
  dog.e1v += (-190 * (dog.e1 - (dog.ea - earBase) * .45) - 8 * dog.e1v + f * .55) * dt; dog.e1 = clamp(dog.e1 + dog.e1v * dt, -10, 10);
  if (Bn.ear0){ const ER = HD.earRange || [-12, 12]; Bn.ear0.rot += clamp(dog.ea - (Bn.head.rot + Bn.neck.rot) * .3, ER[0], ER[1]); Bn.ear1.rot += dog.e1 * .6; RIG.solve(set); }
  if (eating && st === 'stand'){
    const m = mouthPt(), tgt = [world.bowlX, GY - BOWL.h * dog.k * .72], g = .125 / rk;
    dog.neckFix[0] = clamp(dog.neckFix[0] + (tgt[0] - m[0]) * g * Math.sign(dog.faceS), -14 * u, 16 * u);
    dog.neckFix[1] = clamp(dog.neckFix[1] + (tgt[1] - m[1]) * g, -8 * u, 20 * u);
  }
  // 眨眼
  // 眨眼：盯着你的鼠标时眨得少，犯困时眨得勤、一闭就是大半秒（mind.js）
  if (dog.t > dog.blinkAt){ const [gap, dur] = PM.nextBlink(dog.mind, Math.abs(dog.lookTgt || 0) > 1 && dog.t - ptr.movedAt < 1.5); dog.blinkS = dog.t; dog.blinkD = dur; dog.blinkAt = dog.t + Math.max(gap, dur + .1); }
  dog.X = X;
}

// ---------- 粒子：Z、小心心、叹气、碎渣 ----------
function spawn(type, x, y){ dog.particles.push({ type, x, y, t0:dog.t, vx:type === 'crumb' ? rand(-30, 30) : rand(-6, 6), vy:type === 'crumb' ? rand(-60, -20) : -18, life:type === 'crumb' ? .7 : 1.8 }); }
function drawParticles(dt){
  dog.particles = dog.particles.filter(p => dog.t - p.t0 < p.life && (p.wakeAt == null || dog.t - p.wakeAt < .15));
  for (const p of dog.particles){
    const a = (dog.t - p.t0) / p.life;
    if (p.type === 'crumb'){ p.vy += 400 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    octx.globalAlpha = Math.sin(Math.PI * Math.min(1, a * 1.2)) * .9 * (p.wakeAt == null ? 1 : 1-smooth(0,.15,dog.t-p.wakeAt));
    if (p.type === 'z'){ octx.fillStyle = '#6B4A33'; octx.font = `600 ${Math.round((11 + a * 8) * dog.k / .55)}px sans-serif`; octx.fillText('z', p.x + Math.sin(a * 6) * 4, p.y); }
    else if (p.type === 'heart'){ const s = (5 + a * 3) * dog.k / .55; octx.fillStyle = '#F08A93'; octx.beginPath(); octx.moveTo(p.x, p.y + s * .9); octx.bezierCurveTo(p.x - s * 1.4, p.y - s * .2, p.x - s * .6, p.y - s * 1.2, p.x, p.y - s * .35); octx.bezierCurveTo(p.x + s * .6, p.y - s * 1.2, p.x + s * 1.4, p.y - s * .2, p.x, p.y + s * .9); octx.fill(); }
    else if (p.type === 'crumb'){ octx.fillStyle = '#8E552A'; octx.beginPath(); octx.arc(p.x, p.y, 2.2 * dog.k / .55, 0, TAU); octx.fill(); }
  }
  octx.globalAlpha = 1;
  // 这一帧画到的范围（下一帧只擦这一块）
  if (!dog.particles.length) return null;
  const pad = 40 * dog.k / .55 + 8;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of dog.particles){ if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

// ---------- 画 ----------
const shadowMesh = quadMesh(), pawShadow = quadMesh(), bowlShadowMesh = quadMesh(), bowlBackMesh = quadMesh(), bowlFrontMesh = quadMesh(), noteMesh = quadMesh();
let shadowTex, noteTex;
// 素材里没有纸条时的备用画法
function noteCanvas(){
  const c = document.createElement('canvas'); c.width = 96; c.height = 64; const x = c.getContext('2d');
  x.translate(48, 32); x.rotate(-.06);
  x.fillStyle = '#FFF8EA'; x.strokeStyle = '#8A5A3A'; x.lineWidth = 2.2; x.beginPath(); x.roundRect(-40, -25, 80, 50, 6); x.fill(); x.stroke();
  const hx = 19, hy = 3, h = 10; x.fillStyle = '#E8707A'; x.beginPath(); x.moveTo(hx, hy + h * .9); x.bezierCurveTo(hx - h * 1.4, hy - h * .2, hx - h * .6, hy - h * 1.2, hx, hy - h * .35); x.bezierCurveTo(hx + h * .6, hy - h * 1.2, hx + h * 1.4, hy - h * .2, hx, hy + h * .9); x.fill();
  return c;
}
function quadAt(m, c){ for (let i = 0; i < 4; i++){ m.pos[i * 2] = c[i][0]; m.pos[i * 2 + 1] = c[i][1]; } }
// 地上的纸条：和叼在嘴里的是同一张折好的纸，立在地上
function drawGroundNote(){
  const n = world.groundNote; if (!n){ world.noteRect = null; return; }
  const np = KIT && KIT.note, w = (KIT && KIT.noteCfg ? KIT.noteCfg.width : 180) * rk, h = np ? w * np.h / np.w : w * .66;
  const bob = n.mine ? 0 : Math.max(0, Math.sin(dog.t * 2.4)) * 3 * dog.k / .33;
  const cx = n.x, by = GY + 1 - bob, a = -5 * D2R, c = Math.cos(a), s = Math.sin(a), P = (x, y) => [cx + x * c - y * s, by + x * s + y * c];
  quadAt(noteMesh, [P(-w / 2, -h), P(w / 2, -h), P(w / 2, 0), P(-w / 2, 0)]);
  drawMesh(noteMesh, np ? np.tex : noteTex);
  world.noteRect = [cx - w / 2 - 2, by - h - 2, cx + w / 2 + 2, by];
}
// 整只狗先画进离屏层的那块区域（对齐到物理像素，贴回去不会糊）
function dogBox(){
  const bw = 3.6 * PH, bh = 2.5 * PH, pw = Math.ceil(bw * dpr), ph = Math.ceil(bh * dpr);
  const x = Math.floor((dog.x - bw / 2) * dpr) / dpr, y = CT + Math.floor((dog.y - 1.95 * PH - CT) * dpr) / dpr;
  return { x, y, w: pw / dpr, h: ph / dpr, pw, ph };
}
let lastDt = 1 / 60;
function render(){
  R.bindScreen(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); R.setView(0, CT, W, CH);
  const set = cur, M = MG(set);
  // 身体阴影
  const liftAmt = clamp((GY - dog.y) / (110 * dog.k), 0, 1), sx = dog.x + (dog.offX || 0);
  const width = s => s.bbox[2] - s.bbox[0];
  const shadowWidth = motion ? lerp(width(motion.frame.from), width(motion.frame.to), motion.frame.u) : width(set);
  const sw = shadowWidth * rk * .78 * (1 - .35 * liftAmt), shh = PH * .09 * (1 - .3 * liftAmt);
  quadAt(shadowMesh, [[sx - sw / 2, GY - shh / 2], [sx + sw / 2, GY - shh / 2], [sx + sw / 2, GY + shh / 2], [sx - sw / 2, GY + shh / 2]]);
  if (dog.visible) drawMesh(shadowMesh, shadowTex, (.85 - .55 * liftAmt) * dog.alpha);
  // 爪子接地阴影
  const pawOpacity = motion?.kind === 'curl' ? 1 - smooth(.68,1,motion.progress) : set.name === 'sleep' ? 0 : 1;
  if (dog.visible && pawOpacity > 0) for (const n of Object.keys(set.legs)){
    const g = set.legs[n];
    const p = pivotTurn && turnArt ? ap(M,...turnArt.foot(n,pivotTurn.progress)) : motion ? ap(M, ...RIG.fromRel(set, motion.frame.options.paws[n])) : ap(mul(M, set.bones[n + 'L'].w), g.ft[0], g.ft[1]);
    const dy = GY - p[1], lim = PH * .08;
    if (dy < lim){ const a = clamp(1 - dy / lim, 0, 1), r = PH * .075; quadAt(pawShadow, [[p[0] - r, GY - r * .22], [p[0] + r, GY - r * .22], [p[0] + r, GY + r * .22], [p[0] - r, GY + r * .22]]); drawMesh(pawShadow, shadowTex, pawOpacity * a * .8 * dog.alpha); }
  }
  // 碗的后半（在狗后面）、地上的纸条
  const bk = dog.k, bxw = BOWL.w * bk, bh = BOWL.canvasH * bk, bb = bowlBottom(), ba = world.bowlTilt * D2R, bc = Math.cos(ba), bs = Math.sin(ba);
  const count = kibbleCount(world.food);
  if (count !== bowlFood){ bowlBackTex = tex(bowlBackCanvas(count), bowlBackTex); bowlFood = count; }
  // 以碗底中点为轴倾斜
  const bq = [[-bxw / 2, -bh], [bxw / 2, -bh], [bxw / 2, 0], [-bxw / 2, 0]].map(([u, v]) => [world.bowlX + u * bc - v * bs, bb + u * bs + v * bc]);
  quadAt(bowlBackMesh, bq); quadAt(bowlFrontMesh, bq);
  const bowlUp = bb < GY - .5;
  if (bowlUp){ const lift = clamp((GY - bb) / (3 * PH), 0, 1), r = bxw * .42 * (1 - .4 * lift); quadAt(bowlShadowMesh, [[world.bowlX - r, GY - r * .14], [world.bowlX + r, GY - r * .14], [world.bowlX + r, GY + r * .14], [world.bowlX - r, GY + r * .14]]); drawMesh(bowlShadowMesh, shadowTex, .6 * (1 - .6 * lift)); }
  if (!bowlUp && !world.bowlCarried) drawMesh(bowlBackMesh, bowlBackTex);
  drawGroundNote();
  // 狗：整只画进离屏层，再按透明度贴回来；换姿势时旧姿势盖在上面淡出
  if (dog.visible){
    const box = dogBox(), parts = {}; lastBox = box; bboxAt[0] = dog.x; bboxAt[1] = dog.y;
    R.bindTarget(dogLayer, box.pw, box.ph); R.setView(box.x, box.y, box.w, box.h);
    const blend = trans && trans.from !== set, e = transE();
    if (pivotTurn && turnArt){
      turnArt.draw(MG(set,pivotTurn.start),KIT,faceState(),parts,pivotTurn.progress);
    } else if (motion){
      const {from, to, u, options} = motion.frame;
      motionArt.draw(from, to, u, MG(from), MG(to), KIT, faceState(), parts, options);
    } else RIG.drawSet(R, set, KIT, M, faceState(), parts, trans?.yaw ? 1 - e : 0);
    if (blend){ R.bindTarget(prevLayer, box.pw, box.ph); R.setView(box.x, box.y, box.w, box.h); RIG.drawSet(R, trans.from, KIT, MG(trans.from, trans.fromFacing), faceState(), {}, trans.yaw ? e : 0); }
    R.bindScreen(); R.setView(0, CT, W, CH);
    // 新姿势垫在下面先慢慢出现，旧姿势盖在上面、过了中点才淡掉：中间不会两只都半透明
    R.drawTarget(dogLayer, box.x, box.y, box.w, box.h, dog.alpha * (blend ? smooth(.24, .53, e) : 1));
    if (blend) R.drawTarget(prevLayer, box.x, box.y, box.w, box.h, dog.alpha * (1 - smooth(.43, .77, e)));
    dog.parts = parts;
    const all = Object.values(parts);
    dog.bbox = all.length ? [Math.min(...all.map(b => b[0])), Math.min(...all.map(b => b[1])), Math.max(...all.map(b => b[2])), Math.max(...all.map(b => b[3]))] : null;
  } else { dog.parts = {}; dog.bbox = null; lastBox = null; }
  if (bowlUp || world.bowlCarried) drawMesh(bowlBackMesh, bowlBackTex);   // 拿着、叼着、掉落时碗在狗前面
  drawMesh(bowlFrontMesh, bowlFrontTex);
  // 叠加层：只在有粒子（Z、小心心、碎渣）或刚清空时才重画，不然这一整层每帧都要重新合成
  if (dog.particles.length || ovRect){
    octx.setTransform(dpr, 0, 0, dpr, 0, -CT * dpr);
    if (ovRect) octx.clearRect(ovRect[0], ovRect[1], ovRect[2] - ovRect[0], ovRect[3] - ovRect[1]);
    ovRect = drawParticles(lastDt);
  }
}
let lastBox = null, ovRect = null;
const bboxAt = [0, 0];   // 上一次画的时候狗在哪

// ---------- 鼠标 ----------
function local(e){
  if (FR) return [e.screenX - FR.wx, e.screenY - FR.wy];
  const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top];
}
const inBox = (b, x, y, pad) => b && x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad;
// 按下：页面自己的事件和主进程盯键的结果两路都收（不抢焦点的窗口，第一下按下可能被吃掉），谁先到算谁，300 毫秒内的第二次不算
let lastPress = { t:-9, src:'' };
function pressAt(x, y, src){
  const now = performance.now();
  if (src === 'dom' && window.__dropDomDown) return false;   // 测试用：假装页面自己的"按下"被吃掉了，只靠主进程那一路
  if (now - lastPress.t < 300){ if (src !== lastPress.src) inputLog('both', src); return false; }
  if (ptr.down || dog.held || inCard(x, y)) return false;   // 点在展开的纸条上（比如"收好"按钮）不算按狗
  if (world.groundNote && world.noteRect && inBox(world.noteRect, x, y, 6)){ lastPress = { t:now, src }; openCard(); return true; }
  // 狗和碗叠在一起时先算狗：按在狗的不透明像素上、或者狗身体范围的中间那一块（腿缝、肚子底下也算），就是拎狗；
  // 只有按在碗露出来、又不在狗身体中间的地方，才是拿碗
  const bb = dog.visible ? dog.bbox : null;
  const dogCore = bb && inBox([bb[0] + (bb[2] - bb[0]) * .15, bb[1] + (bb[3] - bb[1]) * .1, bb[2] - (bb[2] - bb[0]) * .15, bb[3]], x, y, 0);
  const onDog = bb && inBox(bb, x, y, 0) && (dogCore || hitDog(x, y));
  if (!onDog && bowlHit(x, y)){
    lastPress = { t:now, src };
    ptr.down = true; ptr.target = 'bowl'; ptr.downX = x; ptr.downY = y; ptr.downT = now; ptr.x = x; ptr.y = y;
    inputLog('down', src + ':bowl');
    return true;
  }
  if (!dog.visible || !inBox(dog.bbox, x, y, 0)){ if (src === 'main') inputLog('press-miss', `${Math.round(x)},${Math.round(y)}`); return false; }
  lastPress = { t:now, src };
  ptr.down = true; ptr.target = 'dog'; ptr.downX = x; ptr.downY = y; ptr.downT = now; ptr.x = x; ptr.y = y;
  inputLog('down', src);
  // 主进程先报了按下：200 毫秒内页面自己的按下没来，就是被吃掉了，记一笔（已经靠主进程那一路接住了）
  if (src === 'main') setTimeout(() => { if (lastPress.t === now && lastPress.src === 'main') inputLog('dom-down-missing', '', true); }, 200);
  return true;
}
// 拿起来：按住以后挪了 7 像素以上
function startHold(x, y){
  if (ptr.target === 'bowl'){
    // 拎起碗：抓在哪儿就一直抓着哪儿
    world.bowlHeld = true; world.bowlFalling = false; world.bowlY = GY; world.bowlGdx = x - world.bowlX; world.bowlGdy = y - GY; world.bowlVx = world.bowlVy = 0;
    stage.style.cursor = 'grabbing'; inputLog('hold', 'bowl');
    return;
  }
  if (world.bowlCarried) dropCarriedBowl();   // 叼着碗被拎起来：碗掉下去
  dog.held = true; dog.falling = false; dog.heldT = dog.t; PM.kick(dog.mind, 'pickup'); dog.gdx = x - dog.x; dog.gdy = y - dog.y; dog.vx = dog.vy = 0; stage.style.cursor = 'grabbing';
  inputLog('hold', '');
}
stage.addEventListener('pointerdown', e => {
  const [x, y] = local(e);
  if (pressAt(x, y, 'dom')) try { stage.setPointerCapture(e.pointerId); } catch (err) {}
});
stage.addEventListener('pointermove', e => {
  const [x, y] = local(e), now = performance.now() / 1000;
  const dtm = Math.max(.008, now - (ptr.lastT || now - .016)); ptr.speed = Math.hypot(x - ptr.x, y - ptr.y) / dtm; ptr.lastT = now;
  ptr.x = x; ptr.y = y; ptr.movedAt = dog.t;
  ptr.over = inBox(dog.parts.head, x, y, 4) || inBox(dog.parts.ear, x, y, 2);
  if (ptr.down && !dog.held && !world.bowlHeld && Math.hypot(x - ptr.downX, y - ptr.downY) > 7) startHold(x, y);
  if (!dog.held && !world.bowlHeld) stage.style.cursor = inBox(dog.bbox, x, y, 0) ? (ptr.over ? 'pointer' : 'grab') : bowlHit(x, y) ? 'grab' : 'default';
});
const up = () => {
  if (world.bowlHeld){
    // 松开碗：带着甩出去的速度往下掉
    world.bowlHeld = false; world.bowlFalling = true; world.bowlVx = clamp(world.bowlVx * .5, -450, 450); world.bowlVy = clamp(world.bowlVy * .5, -500, 400);   // 碗比狗沉，甩出去滑得不远
    stage.style.cursor = 'default'; inputLog('up', 'bowl'); ptr.down = false; ptr.target = null; updateInteractive(ptr.x, ptr.y); return;
  }
  if (ptr.down && ptr.target === 'bowl'){
    // 只点了一下碗：狗瞟一眼它的碗
    inputLog('up', 'bowl-click');
    const quickTap = performance.now() - ptr.downT < 350;
    // 狗不在这台电脑上时，碗就是"呼唤小物件"：点一下看它在谁那儿、在干嘛，能叫它回来、远程看看它
    if (quickTap && together.mode === 'ready' && !together.here && together.host) showAwayBubble();
    else if (quickTap && dog.visible && !dog.abroad && !dog.once && !dog.held && !['sleep', 'eat', 'courier', 'stash', 'bringBowl'].includes(dog.action)) startOnce('glance');
    ptr.down = false; ptr.target = null; updateInteractive(ptr.x, ptr.y); return;
  }
  if (dog.held || ptr.down) inputLog('up', dog.held ? 'drop' : 'click');
  if (dog.held){ if (dog.t - dog.heldT > 2.5) dog.shakeOnLand = true; dog.lastInteract = dog.t; dog.held = false; dog.falling = true; dog.vx = clamp(dog.vx, -900, 900); dog.vy = clamp(dog.vy, -900, 600); dog.target = null; stage.style.cursor = 'default'; if (['sit', 'lie', 'sleep', 'bow'].includes(dog.action)) setAction(dog.auto ? 'idle' : dog.action, !dog.auto); }
  else if (ptr.down && performance.now() - ptr.downT < 350){ dog.lastInteract = dog.t; startOnce('poke'); dog.hop = dog.t; PM.kick(dog.mind, 'poke'); growEvent('poke'); if (dog.action === 'sleep'){ setAction('sit'); PM.kick(dog.mind, 'woken'); PM.wake(dog.mind, 'startled'); } }
  ptr.down = false;
  updateInteractive(ptr.x, ptr.y);
};
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('pointerleave', () => { ptr.over = false; });

// ---------- 碗：你拎着时跟着手、松手掉回地上（弹一下）；狗叼着时挂在它嘴边 ----------
function updateBowl(dt){
  if (world.bowlHeld){
    const tx = clamp(ptr.x - world.bowlGdx, bowlMinX(), bowlMaxX()), ty = clamp(ptr.y - world.bowlGdy, PH * .5, GY);
    world.bowlVx = lerp(world.bowlVx, (tx - world.bowlX) / dt, .35); world.bowlVy = lerp(world.bowlVy, (ty - world.bowlY) / dt, .35);
    world.bowlX = tx; world.bowlY = ty; world.bowlTilt = lerp(world.bowlTilt, clamp(world.bowlVx * .03, -25, 25), .25);
    // 甩得太快会撒出几粒（只是看着，粮不少）
    if (world.food > .02 && Math.abs(world.bowlVx) > 700 && Math.random() < dt * 8) spawn('crumb', world.bowlX, world.bowlY - BOWL.canvasH * dog.k * .45);
  } else if (world.bowlFalling){
    world.bowlVy += 2400 * dt; world.bowlY += world.bowlVy * dt;
    world.bowlX = clamp(world.bowlX + world.bowlVx * dt, bowlMinX(), bowlMaxX()); world.bowlVx *= 1 - 3 * dt; world.bowlTilt = lerp(world.bowlTilt, 0, .2);
    if (world.bowlY >= GY){
      world.bowlY = GY;
      if (world.bowlVy > 420){ world.bowlVy *= -.22; if (world.food > .02) for (let i = 0; i < 3; i++) spawn('crumb', world.bowlX + rand(-10, 10) * dog.k, GY - BOWL.canvasH * dog.k * .4); }   // 磕一下弹起来
      else { world.bowlFalling = false; world.bowlVy = world.bowlVx = 0; world.bowlTilt = 0; world.bowlN = world.bowlX / Math.max(1, W); api.save(snapshot()); }
    }
  }
}
// 叼着碗：咬住靠近自己那一侧的碗沿，碗挂在嘴前面、往下垂一点
function bowlAtMouth(){
  const m = mouthPt(), w = BOWL.w * dog.k, h = BOWL.canvasH * dog.k;
  world.bowlX = m[0] + dog.faceS * (w / 2 - 4 * S * dog.k);
  world.bowlY = m[1] + h * .48;
  world.bowlTilt = 14 * Math.sign(dog.faceS) + 4 * Math.sin(dog.phase * 2) * dog.wb;
}
// 放下叼着的碗（到地方了）：轻轻放在嘴前面的地上
function placeCarriedBowl(){
  world.bowlCarried = false; dog.carryBowl = false;
  world.bowlX = clamp(world.bowlX, bowlMinX(), bowlMaxX()); world.bowlY = GY; world.bowlTilt = 0; world.bowlVx = world.bowlVy = 0;
  world.bowlN = world.bowlX / Math.max(1, W); api.save(snapshot());
}
// 半路松口（被拎起来、有粮了、要出门）：碗从嘴边掉下去
function dropCarriedBowl(){
  if (!world.bowlCarried) return;
  world.bowlCarried = false; dog.carryBowl = false; world.bowlFalling = true; world.bowlVx = 0; world.bowlVy = 0;
  if (dog.bring) dog.bring = null;
}
// ---------- 输入记录：最近 120 条留在内存里；出现异常时连同最近 20 条一起写进 userData/diag.log ----------
const inputRing = [], diagWritten = {};
function inputLog(kind, detail, anomaly){
  inputRing.push([Math.round(performance.now()), kind, detail, interactive, dog.action]);
  if (inputRing.length > 120) inputRing.shift();
  if (anomaly && api.diag && performance.now() - (diagWritten[kind] || -1e9) > 60000){
    diagWritten[kind] = performance.now();
    api.diag({ kind, detail, recent:inputRing.slice(-20) });
  }
}
// ---------- 合养：狗去别人桌面、从别人桌面来（联网在主进程 together.js，这里只管动画） ----------
let together = { mode:'off', here:true }, pendingDepart = null, hereTimer = null;
const num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
// 换地方时带过去的：肚子、需求、心情
function travelState(){ return { belly:dog.belly, needs:{ ...dog.needs }, mind:{ val:dog.mind.val, aro:dog.mind.aro, drowsy:dog.mind.drowsy }, grow:{ persona:GROW.persona, weight:GROW.weight } }; }
function applyTravelState(s){
  if (!s || typeof s !== 'object') return;
  const away = s.at ? Math.max(0, (Date.now() - s.at) / 1000) : 0;   // 路上和对方上传以后过去的时间，照样消化
  if (typeof s.belly === 'number') dog.belly = clamp(s.belly - away * DIGEST * EFF.digestMul, 0, 1);
  // 性格、胖瘦是这只狗的，跟着它从别人那儿带过来
  if (s.grow && typeof s.grow === 'object'){
    const g = PG.sanitizeGrow({ seed:GROW.seed, persona:s.grow.persona, weight:s.grow.weight });
    if (g){ GROW.persona = g.persona; GROW.weight = g.weight; refreshGrow(); }
  }
  if (s.needs && typeof s.needs === 'object') dog.needs = { energy:clamp(num(s.needs.energy, .8), 0, 1), boredom:clamp(num(s.needs.boredom, .2), 0, 1), attention:clamp(num(s.needs.attention, .15), 0, 1) };
  if (s.mind && typeof s.mind === 'object') for (const k of ['val', 'aro', 'drowsy']) if (typeof s.mind[k] === 'number') dog.mind[k] = clamp(s.mind[k], k === 'val' ? -1 : 0, 1);
}
// 狗不在画面里：直接摆成站姿，免得走进来时还在播上一个姿势的过渡
function snapToStand(){
  motion = null; trans = null; nextStop = null; pivotTurn = null; reverseTurn = null; cur = SETS.stand;
  for (const k of POSE_KEYS) dog.P[k] = 0;
  dog.prevH = null; dog.prevV = [0, 0]; dog.once = null; dog.held = false; dog.falling = false; dog.y = GY;
}
function onTogether(v){
  together = v;
  const gs = v.mode === 'ready' && v.petKey ? PG.seedFrom(v.petKey) : null;
  if (gs !== groupSeed){ groupSeed = gs; refreshGrow(); }
  // 不在组里了（退出、被拒）：狗回到这儿单机过日子
  if (v.mode === 'none' || v.mode === 'off'){ if (dog.abroad) startArrival({ state:null }); return; }
  if (v.mode !== 'ready') return;
  if (!v.here && !dog.abroad && !v.traveling && !(dog.courier && dog.courier.net)) goAbroad();
  // 狗算在这儿、画面上却没有（比如重开程序时它正好在路上）：等一下"到达"指令，没等到就自己走进来
  clearTimeout(hereTimer);
  if (v.here && dog.abroad && !v.traveling) hereTimer = setTimeout(() => { if (dog.abroad && together.here) startArrival({ state:null }); }, 2500);
}
// 主进程决定它要走了：叼起纸条（有的话），走出屏幕
function startDeparture(d){
  if (dog.abroad) return;
  hideBubble('call');
  if (dog.held || dog.falling){ pendingDepart = d; return; }
  if (!card.hidden) closeCard();
  abortCourier(); dog.stash = null;
  const note = d.note && d.note.text ? d.note : null;
  dog.courier = { net:true, toName:d.toName, text:note ? note.text : null, noteId:note ? note.id : null, phase:note ? 'pick' : 'leave', edge:dog.x > W / 2 ? 1 : -1 };
  if (!note) dog.carry = null;
  dog.visible = true; setAction('courier');
}
function cancelDeparture(){
  const c = dog.courier;
  if (c && c.net && (c.phase === 'pick' || c.phase === 'leave')){ dog.courier = null; dog.carry = null; if (world.groundNote && world.groundNote.mine) world.groundNote = null; setAction('idle'); }
}
// 服务器没换成（断网之类）：它从屏幕边上走回来
function comeBack(){ if (dog.abroad || (dog.courier && dog.courier.net)) startArrival({ state:null }); }
// 被别人接走了（这台电脑睡眠、断网时）：画面上还有它的话就自己走出去，不然直接不见
function goAbroad(){
  if (dog.abroad) return;
  const name = together.host ? together.host.nickname : '朋友';
  abortCourier(); dog.carry = null;
  if (dog.visible && !dog.held && !dog.falling && cur === SETS.stand){
    dog.courier = { net:true, vanish:true, toName:name, phase:'leave', edge:dog.x > W / 2 ? 1 : -1 };
    setAction('courier');
  } else {
    dog.abroad = true; dog.visible = false; dog.courier = null;
    api.setTooltip(`桌面比格：在${name}那儿`);
  }
}
// 它从别人桌面过来了：从屏幕边上走进来；带着纸条的放到你鼠标附近、坐着等你看，没带的就跑过来迎接你
function startArrival(a){
  clearTimeout(hereTimer); pendingDepart = null; hideBubble('away');
  if (a.state) applyTravelState(a.state);
  snapToStand();
  dog.abroad = false; dog.visible = true; dog.stash = null; dog.target = null;
  const off = (SETS.stand.back + SETS.stand.front) * rk + 16, edge = Math.random() < .5 ? 1 : -1;
  dog.x = edge > 0 ? W + off : -off; dog.facing = dog.faceS = -edge;
  if (a.note && a.note.text){
    dog.carry = a.note.text;
    dog.courier = { net:true, phase:'return', text:a.note.text, noteId:a.note.id, from:a.note.fromName, edge, dropX:clamp(ptr.x > 0 && ptr.x < W ? ptr.x : W * .5, minX() + 60, maxX() - 60) };
    setAction('courier');
  } else { dog.courier = null; dog.carry = null; setAction('greet'); }
  api.setTooltip('桌面比格');
  api.togetherArrived();
}

// ---------- 菜单命令 ----------
function syncUI(){}
function manual(){ dog.auto = false; dog.manualUntil = dog.t + 90; }
// 送纸条途中被打断：嘴里叼着的放到地上，狗回到屏幕里
function abortCourier(){
  if (!dog.courier) return;
  if (dog.carry) world.groundNote = { x:clamp(dog.x, minX() + 40, maxX() - 40), text:dog.carry, mine:false };
  dog.courier = null; dog.carry = null; dog.visible = true; dog.x = clamp(dog.x, minX(), maxX());
}
// 人在不在电脑前：主进程每 5 秒发一次键鼠空闲秒数
function onIdle(sec){
  dog.userIdle = sec;
  const away = PL.isAway(sec, AWAY_SEC);
  if (away && !dog.userAway){
    dog.userAway = true;
    if (!['eat', 'courier'].includes(dog.action) && !dog.held && dog.auto) setAction('sleep');
  } else if (!away && dog.userAway && sec < 3){
    dog.userAway = false;
    if (dog.action === 'sleep' && dog.auto){ setAction('greet'); startOnce('stretch'); PM.kick(dog.mind, 'greet'); }
  }
}
function handleCommand(cmd){
  if (cmd.type === 'feed'){ world.food = 1; dog.fedAt = dog.t; PM.kick(dog.mind, 'fed'); if (dog.belly < .6 && !dog.abroad) growEvent('feed'); if (!dog.once && dog.visible && !['sleep', 'eat', 'courier', 'stash'].includes(dog.action) && !dog.held) startOnce('glance'); }
  else if (cmd.type === 'action'){ abortCourier(); manual(); dog.exprLock = false; setAction(cmd.value, true); }
  else if (cmd.type === 'once') startOnce(cmd.value);
  else if (cmd.type === 'auto'){ SETTINGS.auto = cmd.value; dog.auto = cmd.value; dog.manualUntil = 0; if (cmd.value) dog.actT = dog.actDur - 1; }
  else if (cmd.type === 'idle') onIdle(cmd.value);
  else if (cmd.type === 'cursor') onCursor(cmd.value);
  else if (cmd.type === 'frame') applyFrame(cmd.value);
  else if (cmd.type === 'noteAction'){ if (cmd.value === 'open') openCard(); else if (cmd.value === 'stash') startStash(); }
  else if (cmd.type === 'readNote') openStoredNote();
  // 主进程发现鼠标键其实已经松开了，页面却没收到"松开"：替它放手，免得狗粘在鼠标上
  else if (cmd.type === 'mouseDown'){ if (Array.isArray(cmd.value)) pressAt(cmd.value[0], cmd.value[1], 'main'); }
  else if (cmd.type === 'mouseUp'){ if (dog.held || ptr.down || world.bowlHeld){ diag('mouseUp', 'main'); up(); } }
  else if (cmd.type === 'together') onTogether(cmd.value || {});
  // 别人远程喂了一碗：碗倒满，碗上冒个气泡说是谁喂的（不算你的心动值）
  else if (cmd.type === 'remoteFeed'){
    world.food = 1; dog.fedAt = dog.t; PM.kick(dog.mind, 'fed');
    if (!dog.once && dog.visible && !['sleep', 'eat', 'courier', 'stash'].includes(dog.action) && !dog.held) startOnce('glance');
    const b = bowlRect(); for (let i = 0; i < 2; i++) spawn('heart', (b[0] + b[2]) / 2 + rand(-15, 15), b[1] - 8);
    showBubble('feed', `${(cmd.value && cmd.value.fromName) || 'TA'} 隔空喂了一碗`, b, [], 5000);
  }
  // 有人呼唤它、你正在和它玩：问你一句，可以留它一次
  else if (cmd.type === 'callAsk'){
    const by = (cmd.value && cmd.value.byName) || 'TA';
    if (dog.visible && !dog.abroad && dog.bbox) showBubble('call', `${by} 在叫它回去`, dog.bbox, [
      { label:'让它去', onClick:() => { hideBubble('call'); api.togetherKeep(false); } },
      { label:'再玩一会儿', primary:true, onClick:() => { hideBubble('call'); api.togetherKeep(true); } }], 20000);
    else api.togetherKeep(false);
  }
  else if (cmd.type === 'callAskDone') hideBubble('call');
  // 有人在远程看它：截一张狗的小图传过去
  else if (cmd.type === 'snapshot'){ const img = takeSnapshot(); if (img) api.togetherSnapshot(img, actName()); }
  else if (cmd.type === 'depart') startDeparture(cmd.value || {});
  else if (cmd.type === 'departCancel') cancelDeparture();
  else if (cmd.type === 'departFailed') comeBack();
  else if (cmd.type === 'arrive') startArrival(cmd.value || {});
  else if (cmd.type === 'abroad') goAbroad();
  else if (cmd.type === 'occluded'){ occluded = !!cmd.value; diag('occluded', occluded); if (!occluded && cur) render(); }
  else if (cmd.type === 'note'){
    const text = PL.cleanNote(cmd.value);
    if (!text) return;
    // 正被拎着、正在往下掉：纸条先记着，落地以后再叼去送（以前会直接丢掉）
    if (dog.held || dog.falling){ dog.pendingNote = text; return; }
    if (!card.hidden) closeCard();
    abortCourier(); world.groundNote = null;
    dog.courier = { text, phase:'pick' }; dog.visible = true; PM.kick(dog.mind, 'noteArrive');
    setAction('courier', true);
  }
}
api.onCommand(handleCommand);

// ---------- 展开的纸条 ----------
const card = document.getElementById('noteCard'), cardText = document.getElementById('noteText'), cardFrom = document.getElementById('noteFrom');
const bubble = document.getElementById('bubble'), bubbleText = document.getElementById('bubbleText'), bubbleBtns = document.getElementById('bubbleBtns');
// 鼠标在展开的纸条、小气泡上：这块要能点
function inCard(x, y){
  const s = stage.getBoundingClientRect();
  for (const el of [card, bubble]){
    if (el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left - s.left && x <= r.right - s.left && y >= r.top - s.top && y <= r.bottom - s.top) return true;
  }
  return false;
}

// ---------- 小气泡：点碗时"它在谁那儿"、被呼唤时"让它去 / 再玩一会儿"、有人远程喂了一碗 ----------
// 按钮用"松开"触发：这个窗口不抢焦点，第一下"按下"偶尔会被吃掉，只收到松开
let bubbleTimer = null, bubbleKind = null;
function showBubble(kind, text, anchor, buttons, ms){
  clearTimeout(bubbleTimer);
  bubbleKind = kind; bubbleText.textContent = text; bubbleBtns.textContent = '';
  for (const b of buttons || []){
    const e = document.createElement('button'); e.type = 'button'; e.className = b.primary ? 'go' : 'ghost'; e.textContent = b.label;
    e.disabled = !!b.disabled; if (b.title) e.title = b.title;
    let done = false; const fire = ev => { ev.stopPropagation(); if (done || e.disabled) return; done = true; b.onClick(); };
    e.addEventListener('pointerup', fire); e.addEventListener('click', fire);
    bubbleBtns.append(e);
  }
  bubble.hidden = false;
  const r = bubble.getBoundingClientRect(), cx = (anchor[0] + anchor[2]) / 2;
  const left = clamp(cx - r.width / 2, 8, Math.max(8, W - r.width - 8));
  bubble.style.left = left + 'px';
  bubble.style.setProperty('--tail', clamp(cx - left, 16, r.width - 16) + 'px');
  const visTop = Math.max(0, Hh - (window.innerHeight || Hh));
  bubble.style.top = clamp(anchor[1] - r.height - 12, visTop + 8, Math.max(visTop + 8, Hh - r.height - 8)) + 'px';
  if (ms) bubbleTimer = setTimeout(() => hideBubble(kind), ms);
  updateInteractive(ptr.x, ptr.y);
}
function hideBubble(kind){
  if (bubble.hidden || (kind && kind !== bubbleKind)) return;
  clearTimeout(bubbleTimer); bubble.hidden = true; bubbleKind = null;
  updateInteractive(ptr.x, ptr.y);
}
// 狗不在这台电脑上：碗上冒个气泡，说它在谁那儿、在干嘛；能叫它回来、远程看看它
function showAwayBubble(){
  const v = together, mine = !!v.onMyOther;
  const where = mine ? '它在你另一台电脑上' : `它在 ${v.host.nickname} 那儿`;
  const text = v.traveling ? '它在路上……' : where + (v.doing ? `，${v.doing}` : '') + (v.kept ? '。TA 想再和它玩一会儿' : '');
  const why = { cooldown:'刚叫过，过一会儿再叫', 'just-arrived':'它刚到那边，让它待一会儿' }[v.callWhy] || '';
  const call = async () => {
    const r = await api.togetherCall();
    showBubble('away', r && r.ok ? (mine ? '叫了，那台闲下来它就过来' : '叫了，它马上就来') : (r && r.error) || '没叫成，再试一次', bowlRect(), [], 3500);
  };
  const btns = v.traveling ? [] : [
    ...(mine ? [] : [{ label:'看看它', onClick:() => { hideBubble('away'); api.openWatch(); } }]),
    { label:mine ? '叫它过来' : '叫它回来', primary:true, disabled:!mine && !v.canCall, title:why, onClick:call }];
  showBubble('away', text, bowlRect(), btns, 8000);
}
// 远程看它：把狗那一块画面截成一张小图（只有狗，截不到你的桌面和别的窗口）
function takeSnapshot(){
  if (!dog.visible || dog.abroad || !dog.bbox) return null;
  render();
  const b = dog.bbox, pad = 16 * dog.k;
  const x0 = Math.max(0, b[0] - pad), x1 = Math.min(W, b[2] + pad), y0 = Math.max(CT, b[1] - pad * 2), y1 = Math.min(Hh, b[3] + pad * .5);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const sw = (x1 - x0) * dpr, sh = (y1 - y0) * dpr, s = Math.min(1, 240 / sw, 180 / sh);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * s)); c.height = Math.max(1, Math.round(sh * s));
  const x = c.getContext('2d'), sx = x0 * dpr, sy = (y0 - CT) * dpr;
  x.drawImage(cv, sx, sy, sw, sh, 0, 0, c.width, c.height);
  x.drawImage(ov, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
let cardMode = null, cardNote = null;
function openCard(){
  const n = world.groundNote; if (!n || !world.noteRect) return;
  cardMode = 'ground'; cardNote = null;
  showCard(n.text, !n.mine && n.from ? `—— ${n.from}` : '', world.noteRect);
}
// 托盘"看纸条"：它收起来的、还没看的那几张，从最早的开始
function openStoredNote(){
  const n = dog.notes.find(x => x.unread) || dog.notes[dog.notes.length - 1]; if (!n) return;
  if (!card.hidden) closeCard();
  cardMode = 'stored'; cardNote = n;
  const b = dog.visible && dog.bbox ? dog.bbox : [W * .5 - 40, GY - 90, W * .5 + 40, GY];
  showCard(n.text, n.from ? `—— ${n.from}` : '', [b[0], b[1], b[2], b[1] + 10]);
}
function addNote(text, unread, from){
  dog.notes.push({ text, at:Date.now(), unread:!!unread, ...(from ? { from } : {}) }); dog.notes = dog.notes.slice(-20);
  reportUnread(); api.save(snapshot());
}
const reportUnread = () => api.setUnread(dog.notes.filter(x => x.unread).length);
function startStash(){
  if (!world.groundNote || dog.held) return;
  if (!card.hidden) closeCard();
  if (dog.courier && dog.courier.phase === 'wait') dog.courier = null;
  abortCourier();
  dog.stash = { phase:'go' }; dog.visible = true;
  setAction('stash', true);
}
function showCard(text, from, nr){
  cardText.textContent = text;
  cardFrom.textContent = from;
  card.hidden = false;
  api.raise(true);
  const r = card.getBoundingClientRect();
  card.style.left = clamp((nr[0] + nr[2]) / 2 - r.width / 2, 8, Math.max(8, W - r.width - 8)) + 'px';
  const visTop = Math.max(0, Hh - (window.innerHeight || Hh));
  card.style.top = clamp(nr[1] - r.height - 14, visTop + 8, Math.max(visTop + 8, Hh - r.height - 8)) + 'px';
  dog.lastInteract = dog.t; updateInteractive(ptr.x, ptr.y);
}
function closeCard(){
  if (card.hidden) return;
  card.hidden = true;
  api.raise(false);
  if (cardMode === 'stored'){ if (cardNote){ cardNote.unread = false; if (cardNote.noteId){ api.togetherNoteRead(cardNote.noteId); delete cardNote.noteId; } } reportUnread(); }
  else { const n = world.groundNote; if (n){ addNote(n.text, false, n.from); if (n.noteId) api.togetherNoteRead(n.noteId); world.groundNote = null; world.noteRect = null; } }
  cardMode = null; cardNote = null;
  dog.lastInteract = dog.t;
  if (dog.visible && dog.parts.head){ if (!dog.once) startOnce('hop'); const hp = headPt(); for (let i = 0; i < 3; i++) spawn('heart', hp[0] + rand(-25, 25) * dog.k, hp[1] - 40 * dog.k); }
  api.save(snapshot()); updateInteractive(ptr.x, ptr.y);
}
document.getElementById('noteClose').addEventListener('click', closeCard);

stage.addEventListener('contextmenu', e => {
  e.preventDefault();
  const [x, y] = local(e);
  if (world.groundNote && world.noteRect && inBox(world.noteRect, x, y, 6) && api.showNoteMenu) api.showNoteMenu(); else api.showMenu();
});
// 鼠标离开窗口（比如移到任务栏）时，恢复点穿
document.addEventListener('mouseleave', () => { ptr.over = false; if (!dog.held && !ptr.down && interactive){ interactive = false; api.setInteractive(false); } });

// ---------- 点穿：鼠标下面是透明像素就让点击穿到桌面 ----------
let interactive = false;
const px = new Uint8Array(4);
function hitTest(x, y){
  if (world.noteRect && inBox(world.noteRect, x, y, 2)) return true;
  if (bowlHit(x, y)) return true;
  return hitDog(x, y);
}
// 狗身上这一点是不是不透明（读离屏层的像素）
function hitDog(x, y){
  const b = lastBox; if (!b || !dog.visible || !dogLayer.fb || !inBox(dog.bbox, x, y, 10)) return false;
  const ix = Math.floor((x - b.x) * dpr), iy = Math.floor((y - b.y) * dpr);
  if (ix < 0 || iy < 0 || ix >= b.pw || iy >= b.ph) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dogLayer.fb);
  gl.readPixels(ix, b.ph - 1 - iy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return px[3] > 24;
}
function hitNear(x, y, r){
  if (hitTest(x, y)) return true;
  for (let i = 0; i < 8; i++){ const a = i * Math.PI / 4; if (hitTest(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true; }
  return false;
}
let lastSwitch = 0, pendingWant = null;
function updateInteractive(x, y){
  // 鼠标在盖住狗的别的窗口上时，不算在狗身上
  const want = dog.held || ptr.down || (!ptr.covered && (inCard(x, y) || (interactive ? hitNear(x, y, 6) : hitTest(x, y))));
  if (want === interactive){ pendingWant = null; return; }
  // 关掉可点（恢复点穿）的时候稍等一下，短时间内反复进出只切一次
  const now = performance.now();
  if (!want && now - lastSwitch < 120){ pendingWant = false; return; }
  interactive = want; lastSwitch = now; pendingWant = null; api.setInteractive(want); diag('interactive', want);
}
function pointerAt(x, y, minDt, real){
  const now = performance.now() / 1000, dtm = Math.max(minDt, now - (ptr.lastT || now - minDt));
  if (!ptr.down){ ptr.speed = Math.hypot(x - ptr.x, y - ptr.y) / dtm; ptr.lastT = now; ptr.x = x; ptr.y = y; ptr.movedAt = dog.t;
    ptr.over = real ? !ptr.covered && (inBox(dog.parts.head, x, y, 4) || inBox(dog.parts.ear, x, y, 2)) : ptr.over && interactive; }
  updateInteractive(x, y);
}
// 鼠标在狗身上（窗口可点）时有真实的移动事件；点穿时靠主进程轮询告诉我们鼠标在哪
window.addEventListener('mousemove', e => { const [x, y] = local(e); ptr.covered = false; pointerAt(x, y, .008, true); });
function onCursor(p){
  if (!Array.isArray(p)) return;
  // 按着、拎着的时候，主进程报的位置也用上：页面自己的移动事件不一定收得到
  if (ptr.down || dog.held || world.bowlHeld){
    // 拎着狗拖过了屏幕边：窗口跟着挪到那块屏幕上，接着拖（拖碗不跨屏幕）
    const xs = p[0] < -2 && FR && FR.edges && FR.edges.left ? -1 : p[0] > W + 2 && FR && FR.edges && FR.edges.right ? 1 : 0;
    if (dog.held && xs && !dragCrossing){ dragCrossing = true; api.crossScreen(xs).finally(() => setTimeout(() => { dragCrossing = false; }, 400)); }
    const [x, y] = p, now = performance.now() / 1000, dtm = Math.max(.02, now - (ptr.lastT || now - .02));
    ptr.speed = Math.hypot(x - ptr.x, y - ptr.y) / dtm; ptr.lastT = now; ptr.x = x; ptr.y = y; ptr.movedAt = dog.t;
    if (ptr.down && !dog.held && !world.bowlHeld && Math.hypot(x - ptr.downX, y - ptr.downY) > 7) startHold(x, y);
    return;
  }
  ptr.covered = !!p[2]; pointerAt(p[0], p[1], .02);
}

// ---------- 存档：位置、肚子、碗里的粮 ----------
function snapshot(){
  const gn = world.groundNote ? { text:world.groundNote.text, x:world.groundNote.x / Math.max(1, W) } : dog.carry ? { text:dog.carry, x:.5 } : null;
  return { v:1, savedAt:Date.now(), act:actName(), grow:GROW, x:clamp(dog.x, 0, W) / Math.max(1, W), facing:dog.facing, belly:dog.belly, food:world.food, needs:dog.needs, notes:dog.notes, groundNote:gn, bowl:world.bowlN };
}
// 读到存档以后才存：开机时素材还在解码、存档还没读进来，这时存下去的是一只默认小狗，会把真存档盖掉
let booted = false;
setInterval(() => { if (booted) api.save(snapshot()); }, 15000);
window.addEventListener('beforeunload', () => { if (booted) api.save(snapshot()); });

// ---------- 冒烟测试（npm run smoke）：按剧本跑一遍，截图给开发者看，最后报告哪些检查没过 ----------
async function runSmoke(){
  const errors = [], checks = [];
  const check = (name, pass, info) => { checks.push({ name, pass:!!pass, info:info == null ? '' : String(info) }); if (!pass) errors.push(`${name}（${info}）`); };
  window.addEventListener('error', e => errors.push('页面报错: ' + e.message));
  const nanBones = () => cur.order.filter(n => cur.bones[n].w.some(v => !isFinite(v)));
  const steps = (n, dt) => {
    for (let i = 0; i < n; i++){ lastDt = dt || 1 / 30; update(lastDt); }
    render();
    const bad = nanBones(); if (bad.length) errors.push('骨骼出现坏数值: ' + bad.join(','));
  };
  const shot = async name => {
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const x = c.getContext('2d'); x.fillStyle = '#D6DEE6'; x.fillRect(0, 0, c.width, c.height); x.drawImage(cv, 0, 0); x.drawImage(ov, 0, 0);
    if (!card.hidden){ const r = card.getBoundingClientRect(); x.fillStyle = 'rgba(255,248,234,.95)'; x.fillRect(r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr); x.fillStyle = '#4A3426'; x.font = `${14 * dpr}px sans-serif`; x.fillText(cardText.textContent.slice(0, 24), (r.left + 12) * dpr, (r.top + 28) * dpr); }
    await api.smokeShot(name, c.toDataURL('image/png'));
  };
  try {
    dog.auto = false; dog.x = W * .3; dog.belly = .6; world.food = .4;
    // 七个姿势
    const poseOf = {};
    for (const [a, n] of [['idle', 60], ['walk', 90], ['sniff', 120], ['sit', 150], ['lie', 150], ['sleep', 200], ['bow', 150]]){ handleCommand({ type:'action', value:a }); steps(n); poseOf[a] = cur.name; await shot('pose-' + a); }
    // 过渡：每 0.1 秒截一帧，只给人看动作连不连贯
    const strip = async (name, fn, n, every) => { fn(); for (let i = 0; i < n; i++){ steps(every); await shot(`${name}-${i}`); } };
    handleCommand({ type:'action', value:'idle' }); steps(60);
    async function checkGroundStrip(name,kind,action,forward,anchorLeg){
      const spec=GROUND_MOTIONS[kind], from=cur, expected=SETS[forward?spec.keys.at(-1):spec.keys[0]];
      const contact=ap(MG(from),...from.legs[anchorLeg].ft), x=dog.x;
      let heldFrames=0, drift=0, early=false, sawBody=false;
      handleCommand({type:'action',value:action});
      for(let i=0;i<48;i++){
        steps(1);
        if(motion?.kind===kind){
          sawBody ||= !!dog.parts.body && !!dog.parts.head;
          early ||= Math.abs(dog.x-x)>.01;
          const {from:key,options}=motion.frame, window=spec.steps[anchorLeg];
          if (!window || (forward? motion.progress<=window[0] : motion.progress>=window[1])){
            const p=ap(MG(key),...RIG.fromRel(key,options.paws[anchorLeg]));
            drift=Math.max(drift,Math.hypot(p[0]-contact[0],p[1]-contact[1]));
            heldFrames++;
          }
        }
        if(i%3===2 && name) await shot(name+'-'+Math.floor(i/3));
      }
      if(motionArt?.supports(spec.keys)) check(from.name+'→'+expected.name+' 承重爪踩稳',
        heldFrames>=2 && drift<.1 && !early && sawBody && !motion && cur===expected,
        '承重 '+heldFrames+' 帧，屏幕漂移 '+drift.toFixed(3));
    }
    await checkGroundStrip('tr-sit','sit','sit',true,'fn');
    await checkGroundStrip('tr-sit-stand','sit','idle',false,'ff');
    await checkGroundStrip('tr-stand-lie','rise','lie',false,'fn');
    await checkGroundStrip('tr-prone-sit','lower','sit',false,'ff');
    await checkGroundStrip('tr-lie','lower','lie',true,'fn');
    async function checkCurlStrip(name, action, samples){
      const floorPoint = ap(MG(SETS.prone), ...SETS.prone.legs.fn.ft);
      let contactFrames = 0, drift = 0, headAndTail = true;
      handleCommand({type:'action',value:action});
      for (let i=0; i<samples*3; i++){
        steps(1);
        if (motion?.kind === 'curl'){
          headAndTail &&= !!dog.parts.head && !!dog.parts.tail;
          if (motion.progress < .23){
            const {from,options} = motion.frame;
            const foot = ap(MG(from), ...RIG.fromRel(from, options.paws.fn));
            drift = Math.max(drift, Math.hypot(foot[0]-floorPoint[0],foot[1]-floorPoint[1]));
            contactFrames++;
          }
        }
        if (i%3 === 2) await shot(name+'-'+Math.floor(i/3));
      }
      if (motionArt?.canCurl) check(action === 'sleep' ? '蜷睡时前爪承重不滑动' : '醒来舒展后前爪踩稳',
        contactFrames >= 5 && drift < .05 && headAndTail, '落地 '+contactFrames+' 帧，屏幕漂移 '+drift.toFixed(3));
    }
    await checkCurlStrip('tr-sleep','sleep',24);
    await checkCurlStrip('tr-wake','idle',29);
    const wakeRoute = ['sleep', SETS.curl && 'curl', 'prone', ...(motionArt?.canRise ? ['rise'] : [SETS['lie-down'] && 'lie-down', 'sit', SETS.crouch && 'crouch']), 'stand'].filter(Boolean);
    const wakeEdges = wakeRoute.slice(1).map((name, i) => wakeRoute[i] + '>' + name).join(',');
    check('睡醒先趴着再站起来', (dog.route || []).join(',').includes(wakeEdges), (dog.route || []).join(','));
    if (motionArt?.canRise){
      handleCommand({ type:'action', value:'lie' }); steps(85);
      const beforeX = dog.x, planted = RIG.rel(SETS.stand, SETS.stand.legs.fn.ft);
      handleCommand({ type:'action', value:'walk' }); dog.target = minX(); dog.pause = 0;
      let movingEarly = false, plantedFrames = 0, pawDrift = 0;
      for (let i = 0; i < 55; i++){
        steps(1);
        if (!motion) continue;
        movingEarly ||= Math.abs(dog.x - beforeX) > .01;
        if (motion.progress > GROUND_MOTIONS.rise.steps.fn[1]){
          const foot = motion.frame.options.paws.fn;
          pawDrift = Math.max(pawDrift, Math.hypot(foot[0] - planted[0], foot[1] - planted[1])); plantedFrames++;
        }
      }
      check('起身时前爪踩稳再迈步', plantedFrames > 10 && pawDrift < .01 && !movingEarly && !motion && cur === SETS.stand,
        '承重帧 ' + plantedFrames + ' 漂移 ' + pawDrift.toFixed(2));
      handleCommand({ type:'action', value:'idle' }); steps(20);
    }
    await strip('tr-turn', () => { handleCommand({ type:'action', value:'walk' }); dog.target = dog.facing > 0 ? dog.x - 300 : dog.x + 300; dog.pause = 0; }, 16, 2);
    handleCommand({ type:'action', value:'idle' }); steps(30);
    handleCommand({ type:'action', value:'walk' }); dog.target = dog.facing > 0 ? clamp(dog.x + 300, minX(), maxX()) : clamp(dog.x - 300, minX(), maxX()); dog.pause = 0;
    const stepsX = []; for (let i = 0; i < 20; i++){ const x0 = dog.x; steps(1); stepsX.push(Math.abs(dog.x - x0)); }
    const firstMove = stepsX.findIndex(v => v > .01);
    check('起步慢慢加速', firstMove >= 0 && stepsX[firstMove] < Math.max(...stepsX) * .5, stepsX.map(v => v.toFixed(1)).join(' '));
    check('四套姿势素材都用上了', poseOf.idle === 'stand' && poseOf.sit === 'sit' && poseOf.lie === 'prone' && poseOf.sleep === 'sleep' && poseOf.bow === 'stand', JSON.stringify(poseOf));
    // 表情
    handleCommand({ type:'action', value:'idle' }); steps(40);
    for (const e of ['happy', 'sad', 'surprised', 'content', 'beg']){ dog.expr = e; dog.exprLock = true; steps(60); await shot('expr-' + e); }
    dog.exprLock = false;
    // 点穿：狗身上能点，空白处点穿
    steps(1);
    const bb = dog.parts.body;
    check('狗身上可以点', hitTest((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), bb && bb.map(Math.round).join(','));
    check('空白处点击穿透', !hitTest(4, 4), '');
    // 喂食：倒进碗里不一定马上吃；不饿就不吃，饿了自己会去，吃到饱就停
    dog.auto = true; dog.manualUntil = 0; dog.userAway = false; dog.userIdle = 0;
    dog.belly = .97; setAction('idle'); handleCommand({ type:'feed' }); steps(150);
    check('不饿时倒了粮不马上去吃', dog.action !== 'eat' && world.food > .95, dog.action + ' 碗里 ' + world.food.toFixed(2));
    dog.belly = .15; let ateAt = -1; for (let i = 0; i < 240 && ateAt < 0; i++){ steps(1); if (dog.action === 'eat') ateAt = i; }
    check('饿了自己会去吃', ateAt >= 0 && ateAt < 150, ateAt);
    for (let k = 0; dog.action === 'eat' && k < 400; k++) steps(3);
    await shot('eat');
    check('吃到饱就停嘴', dog.belly >= .9, dog.belly.toFixed(2));
    check('碗里剩的留着下回吃', world.food > .03 && world.food < .3, world.food.toFixed(2));
    // 从实际合成后的碗里数粮色像素，覆盖前壁遮住粮堆、粮全挤在一侧这两类回归。
    {
      const wasVisible = dog.visible; dog.visible = false;
      const w = Math.ceil(BOWL.w * dog.k * dpr), h = Math.ceil(BOWL.canvasH * dog.k * dpr);
      const x = Math.round(world.bowlX * dpr - w / 2), y = Math.floor((Hh - GY) * dpr);
      const coverage = [0, .1, .5, 1].map(amount => {
        world.food = amount; render();
        const pixels = new Uint8Array(w * h * 4), sides = [0, 0];
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        for (let i = 0; i < pixels.length; i += 4){
          if (pixels[i + 3] > 190 && pixels[i] - pixels[i + 2] > 45) sides[(i / 4) % w < w / 2 ? 0 : 1]++;
        }
        return sides;
      });
      dog.visible = wasVisible;
      const distinct = [0, 1].every(side => coverage[0][side] === 0 &&
        coverage.slice(1).every((pair, i) => pair[side] > coverage[i][side] + w * h * .015));
      check('空盆、少粮、半盆和满盆在两侧都看得出差别', distinct, coverage.map(pair => pair.join('/')).join(' → '));
    }
    world.food = 0;
    // 饿的梯度（自由活动下）
    dog.auto = true; dog.manualUntil = 0; dog.userAway = false; dog.userIdle = 0;
    dog.belly = .12; setAction('idle'); steps(240);
    check('饿了会去碗边等', dog.action === 'hungry', dog.action); await shot('hungry');
    dog.belly = .03; steps(60);
    check('很饿时委屈', dog.expr === 'sad', dog.expr);
    dog.belly = .7; steps(60);
    check('喂饱以后离开碗', dog.action !== 'hungry', dog.action);
    // 人离开电脑 → 睡；回来 → 迎接
    handleCommand({ type:'idle', value:9999 }); steps(30);
    check('人走了它去睡', dog.action === 'sleep', dog.action);
    ptr.x = W * .7; ptr.y = GY - 80; ptr.movedAt = dog.t;
    handleCommand({ type:'idle', value:0 }); steps(15);
    check('人回来它迎接', dog.action === 'greet', dog.action);
    steps(110); await shot('greet');
    // 拎起来太久会挣扎，落地后抖毛
    dog.auto = false; handleCommand({ type:'action', value:'idle' }); steps(30);
    dog.held = true; dog.heldT = dog.t; dog.gdx = 0; dog.gdy = 0; ptr.x = dog.x; ptr.y = GY - 160; ptr.down = true;
    steps(100); await shot('struggle');
    check('拎久了委屈', dog.curExpr === 'sad', dog.curExpr);
    const released = dog.t; up(); steps(120);
    check('落地后抖毛', dog.lastShake > released, (dog.lastShake - released).toFixed(2));
    // 转身：原地收窄、翻面、再展开，不经过正面
    handleCommand({ type:'action', value:'walk' }); dog.target = dog.facing > 0 ? dog.x - 300 : dog.x + 300; dog.pause = 0;
    const beforeTurn = dog.faceS;
    let sawTurn = false, turnPlanted = 0, turnDrift=0, turnStartX=dog.x, turnTransfer=false, turnLastPaw=null;
    for (let i=0;i<34;i++){
      steps(1);sawTurn ||= cur.name==='turn';
      if(!pivotTurn)continue;
      turnTransfer=true;
      if(turnArt && pivotTurn.progress>.52 && pivotTurn.progress<.74){
        const foot=ap(MG(cur),...turnArt.foot('hn',pivotTurn.progress));
        if(turnLastPaw)turnDrift=Math.max(turnDrift,Math.hypot(foot[0]-turnLastPaw[0],foot[1]-turnLastPaw[1]));
        turnLastPaw=foot;turnPlanted++;
      }
      if(Math.abs(dog.x-turnStartX)>.1)turnDrift=Infinity;
    }
    if(turnArt)check('转身承重爪踩稳再起步',turnTransfer && turnPlanted>=2 && turnDrift<.1,'承重帧 '+turnPlanted+' 漂移 '+turnDrift.toFixed(2));
    check('转身结束时朝向对侧', dog.faceS === -beforeTurn && cur.name === 'stand', dog.faceS);
    check('转身不出现正脸', !sawTurn, (dog.route || []).join(','));
    // 闻地面时掉头：先抬头站直再转，不能低着头转（会把头拉成一长条）；转完接着闻
    { handleCommand({ type:'action', value:'sniff' }); steps(45);
      dog.target = clamp(dog.facing > 0 ? dog.x - 2.5 * PH : dog.x + 2.5 * PH, minX(), maxX()); dog.pause = 0;
      const f0 = dog.faceS; let headDown = 0, turned = false;
      for (let i = 0; i < 90; i++){ steps(1); if (pivotTurn){ turned = true; headDown = Math.max(headDown, dog.P.sniff, dog.P.bow, dog.scentWeight || 0); } }
      check('闻地面时掉头先抬头', turned && headDown < .15 && dog.faceS === -f0 && dog.P.sniff > .5, `转了 ${turned} 转身时低头 ${headDown.toFixed(2)} 转完又闻 ${dog.P.sniff.toFixed(2)}`); }
    // 鼠标在它附近绕圈（只靠轮询，没在它身上点）：不该频繁转身、眼睛来回换、头一跳一跳、被当成在摸
    for (const pose of ['sit', 'idle']){
    handleCommand({ type:'action', value:pose }); dog.auto = false; steps(120);
    const jit = { flips:0, eyeSwaps:0, fastSwaps:0, maxStep:0, pet:0 }; let lastSwapT = -9;
    { const c0 = eyePt(); let lastF = dog.faceS, lastE = dog.face.eye, lastL = dog.look;
      for (let i = 0; i < 240; i++){
        const a = i * .07, r = 1.4 * PH, x = c0[0] + Math.cos(a) * r, y = c0[1] - Math.abs(Math.sin(a)) * r * .8;
        onCursor([x, y, 0]); steps(1);
        if (dog.faceS !== lastF){ jit.flips++; lastF = dog.faceS; }
        const e = dog.face.eye;   // 只看睁眼和抬眼之间的切换，眨眼、换表情不算
        if ((e === 'open' || e === 'look-up') && (lastE === 'open' || lastE === 'look-up') && e !== lastE){ jit.eyeSwaps++; if (dog.t - lastSwapT < .5) jit.fastSwaps++; lastSwapT = dog.t; }
        if (e === 'open' || e === 'look-up') lastE = e;
        jit.maxStep = Math.max(jit.maxStep, Math.abs(dog.look - lastL)); lastL = dog.look; jit.pet = Math.max(jit.pet, dog.pet);
      } }
    check(`鼠标在旁边绕圈不抽搐（${pose}）`, jit.flips <= 1 && jit.fastSwaps === 0 && jit.maxStep < 2.5 && jit.pet < .35, JSON.stringify({ ...jit, maxStep:+jit.maxStep.toFixed(2), pet:+jit.pet.toFixed(2) }));
    }
    ptr.x = ptr.y = -999; ptr.movedAt = -99;
    // 让路：鼠标停在它旁边不碰它
    ptr.x = ptr.y = -999; handleCommand({ type:'action', value:'idle' }); steps(90);
    const b2 = dog.bbox; ptr.x = b2[2] + 12; ptr.y = (b2[1] + b2[3]) / 2; ptr.movedAt = dog.t; steps(20);
    check('鼠标刚停下时不变淡', dog.alpha > .95, dog.alpha.toFixed(2));
    steps(150);
    check('鼠标停在旁边几秒后变淡', dog.alpha < .6, dog.alpha.toFixed(2)); await shot('fade');
    ptr.x = ptr.y = -999; steps(80);
    check('鼠标走开后恢复', dog.alpha > .9, dog.alpha.toFixed(2));
    // 想你理它（需求驱动）
    dog.auto = true; dog.manualUntil = 0; dog.needs = { energy:.8, boredom:.2, attention:.95 }; ptr.x = W * .55; ptr.y = GY - 120; ptr.movedAt = dog.t;
    const seekSide = ptr.x > dog.x ? 1 : -1;
    const seekGoal = clamp(ptr.x - seekSide * 75 * S * dog.k, minX(), maxX());
    // 步速随宠物尺寸变化。给本次实际路程加上转身、起停和坐下的时间，仍须在上限内到达。
    const seekBudget = Math.ceil((Math.abs(seekGoal - dog.x) / (120 * dog.k / .55) + 4.5) * 30);
    setAction('seek');
    for (let i = 0; i < seekBudget && !(dog.seekPhase === 'wait' && cur.name === 'sit' && !trans); i += 3) steps(3);
    check('想被理时跑到鼠标那儿坐着', dog.action === 'seek' && dog.seekPhase === 'wait' && cur.name === 'sit' && !trans && Math.abs(dog.x-seekGoal)<2,
      dog.action + '/' + dog.seekPhase + ' 剩余距离 ' + Math.abs(dog.x-seekGoal).toFixed(1)); await shot('seek');
    dog.lastInteract = dog.t; steps(20);
    check('理了它就开心', dog.action !== 'seek', dog.action);
    // 多块屏幕：鼠标在右边那块屏幕上一分半，它走出右边的屏幕边，再从"那块屏幕"的左边走进来
    { const fr0 = FR; FR = { ...(FR || {}), edges:{ left:false, right:true } };
      dog.auto = true; dog.manualUntil = 0; dog.userAway = false; dog.userIdle = 0; dog.needs = { energy:.8, boredom:.2, attention:.1 };
      handleCommand({ type:'action', value:'idle' }); dog.auto = true; dog.manualUntil = 0; dog.mind = PM.initMind(); dog.actDur = 999; steps(10);
      let n = 0; while (dog.action !== 'cross' && n++ < 140){ ptr.x = W + 300; ptr.y = GY - 100; ptr.movedAt = dog.t; steps(30); }
      check('鼠标在旁边那块屏幕上一分半，它出发去找你', dog.action === 'cross' && dog.cross && dog.cross.phase === 'out', `${dog.action} ${(n * 1).toFixed(0)}s`);
      n = 0; while (dog.cross && dog.cross.phase === 'out' && n++ < 300) steps(3);
      check('走出了右边的屏幕边', dog.cross && dog.cross.phase === 'moving' && !dog.visible && dog.x > W, dog.cross && dog.cross.phase);
      await new Promise(r => setTimeout(r, 500)); ptr.x = W * .3; ptr.movedAt = dog.t;
      steps(6);
      check('从那块屏幕的左边走进来', dog.visible && dog.cross && dog.cross.phase === 'in' && dog.x < W * .3 && dog.facing > 0, dog.cross && `${dog.cross.phase} x=${dog.x.toFixed(0)}`);
      n = 0; while (dog.action === 'cross' && n++ < 300) steps(3);
      check('走进来以后接着平常活动', dog.action !== 'cross' && dog.visible, dog.action);
      FR = fr0; dog.auto = false; }
    // 养成：长胖了肚子圆一点；摸它慢慢变亲；胖了日记里记一句
    { handleCommand({ type:'action', value:'idle' }); dog.belly = .6; GROW.weight = 0; steps(40); await shot('grow-normal');
      const sy0 = cur.bones.belly ? cur.bones.belly.sy : 1;
      GROW.weight = 1; steps(4); const sy1 = cur.bones.belly ? cur.bones.belly.sy : 1; await shot('grow-fat');
      check('长胖了肚子圆一点', sy1 > sy0 + .1 && sy1 - sy0 < .35, `${sy0.toFixed(3)} → ${sy1.toFixed(3)}`);
      const w0 = GROW.persona.warmth; growEvent('pet'); growEvent('answer');
      check('摸它、回应它慢慢变亲', GROW.persona.warmth > w0, `${w0.toFixed(3)} → ${GROW.persona.warmth.toFixed(3)}`);
      GROW.weight = .7; GROW.words.weight = ''; growCheck();
      check('胖了日记里记一句', GROW.words.weight === '胖乎乎的', GROW.words.weight);
      GROW.weight = 0; GROW.words.weight = ''; steps(4); }
    // 叼纸条
    dog.auto = false; ptr.x = W * .6; ptr.y = GY - 100; handleCommand({ type:'action', value:'idle' }); steps(30);
    handleCommand({ type:'note', value:'冒烟测试：今天也要开心' }); steps(20); await shot('note-pick');
    let g = 0; while (dog.courier && dog.courier.phase !== 'leave' && g++ < 100) steps(5);
    steps(25); await shot('note-carry');
    check('嘴里叼着纸条', dog.carry === '冒烟测试：今天也要开心', dog.carry);
    check('纸条画在嘴上', !!dog.parts.note && dog.face.mouth === 'hold', dog.face.mouth);
    g = 0; while (dog.courier && dog.courier.phase !== 'away' && g++ < 600) steps(5);
    check('叼着纸条出了屏幕', dog.courier && dog.courier.phase === 'away' && !dog.visible && !hitTest(dog.x, GY - 40), dog.courier && dog.courier.phase);
    g = 0; while (dog.courier && dog.courier.phase !== 'wait' && g++ < 900) steps(5);
    steps(30); await shot('note-drop');
    check('叼回来放在地上', !!world.groundNote && !dog.carry, world.groundNote && world.groundNote.text);
    const nr = world.noteRect;
    check('地上的纸条可以点', nr && hitTest((nr[0] + nr[2]) / 2, (nr[1] + nr[3]) / 2), nr && nr.map(Math.round).join(','));
    openCard(); steps(1); await shot('note-open');
    check('纸条展开显示内容', !card.hidden && cardText.textContent.includes('今天也要开心'), cardText.textContent);
    closeCard(); steps(40);
    check('看完纸条它不再等', !dog.courier && !world.groundNote && dog.action === 'idle', dog.action);
    check('看过的纸条记下来了', dog.notes.length >= 1, dog.notes.length);
    // 纸条放在地上一直没人看：过一阵它叼走收起来，托盘"看纸条"能再看
    world.groundNote = { x:clamp(dog.x + 2 * PH, minX(), maxX()), text:'冒烟测试：没人看的纸条', mine:false, since:dog.t - NOTE_WAIT - 1 };
    dog.auto = true; dog.manualUntil = 0; steps(3);
    check('没人看的纸条它会去叼', dog.action === 'stash', dog.action);
    g = 0; while (dog.action === 'stash' && g++ < 400) steps(3);
    const stored = dog.notes.find(x => x.unread && x.text === '冒烟测试：没人看的纸条');
    check('叼走以后收好了，标成没看', !world.groundNote && !!stored, world.groundNote ? '还在地上' : stored ? 'ok' : '没记下');
    handleCommand({ type:'readNote' }); steps(1);
    check('托盘里能再看收起来的纸条', !card.hidden && cardText.textContent.includes('没人看的纸条'), cardText.textContent);
    closeCard(); steps(2);
    check('看过就不算没看了', !dog.notes.some(x => x.unread), dog.notes.filter(x => x.unread).length);
    dog.auto = false;
    // 存档往返
    const snap = snapshot(), clean = PL.sanitizeState(JSON.parse(JSON.stringify(snap)));
    check('存档能读回来', clean && Math.abs(clean.belly - dog.belly) < 1e-9 && clean.notes.length === dog.notes.length, clean && clean.belly);
    // 像真狗：自己趴下前先闻闻地方、转一圈；困了先眯眼、眼皮越来越沉、闭上，再蜷起来睡
    dog.auto = true; dog.manualUntil = 0; dog.userAway = false; dog.userIdle = 0; ptr.x = ptr.y = -999; ptr.movedAt = -99; dog.lastInteract = -99;
    setAction('idle'); steps(60);
    dog.belly = .8; world.food = 0; dog.needs = { energy:.08, boredom:.1, attention:0 }; dog.mind = PM.initMind(); dog.once = null;
    { const f0 = dog.faceS; let sniffed = false, turned = false;
      setAction('lie');
      for (let i = 0; i < 300 && !(cur.name === 'prone' && !motion && !trans); i++){ steps(1); sniffed ||= dog.settle?.phase === 'sniff' && dog.P.sniff > .5; turned ||= dog.faceS === -f0; }
      check('自己趴下前先闻闻、转一圈', sniffed && turned && cur.name === 'prone', `闻 ${sniffed} 转 ${turned} 姿势 ${cur.name}`);
      const t0 = dog.t; let halfAt = -1, closedAt = -1, asleepAt = -1, dozeShot = false;
      for (let i = 0; i < 900 && !(asleepAt > 0 && cur.name === 'sleep' && !motion); i++){
        steps(3);
        if (halfAt < 0 && dog.face.eye === 'half' && dog.mind.drowsy > .5) halfAt = dog.t - t0;
        if (!dozeShot && dog.mind.drowsy > .8){ dozeShot = true; await shot('doze'); }
        if (closedAt < 0 && dog.action === 'sleep' && dog.X.lid > .6) closedAt = dog.t - t0;
        if (asleepAt < 0 && dog.action === 'sleep' && !dog.dozing) asleepAt = dog.t - t0;
      }
      await shot('asleep-auto');
      check('困了先眯眼、再闭眼睡着，不是一趴下就睡', halfAt > 5 && closedAt > halfAt && asleepAt >= closedAt && cur.name === 'sleep',
        `眯眼 ${halfAt.toFixed(1)}s 闭眼 ${closedAt.toFixed(1)}s 睡着 ${asleepAt.toFixed(1)}s 姿势 ${cur.name}`); }
    // 自由活动连续跑 5 分钟（模拟时间）：平常的表情跟着心情慢慢变，不来回跳
    dog.auto = true; dog.manualUntil = 0; dog.needs = PL.initNeeds(); dog.mind = PM.initMind(); const seen = {};
    let exprFlips = 0, fastFlips = 0, lastE = dog.mind.expr, lastEAt = -99;
    for (let i = 0; i < 9000; i++){
      lastDt = 1 / 30; update(lastDt);
      if (dog.mind.expr !== lastE){ exprFlips++; if (dog.t - lastEAt < PM.HOLD - .05 && dog.mind.expr !== 'sleepy') fastFlips++; lastE = dog.mind.expr; lastEAt = dog.t; }
      if (i % 30 === 29){ render(); seen[dog.action] = 1; const bad = nanBones(); if (bad.length) errors.push('骨骼出现坏数值: ' + bad.join(',')); }
    }
    check('自由活动 5 分钟没出错', Object.keys(seen).length >= 3, Object.keys(seen).join(','));
    check('自由活动时表情不来回跳', fastFlips === 0, `换了 ${exprFlips} 次，太快的 ${fastFlips} 次`);
    // 用屏幕坐标核对六个日常动作中的真实爪位、地面与口鼻。
    handleCommand({type:'action',value:'idle'});
    dog.once = null; dog.hop = dog.land = -9; ptr.x = ptr.y = -999; dog.x = W*.4;
    dog.facing = dog.faceS = 1; steps(95);
    const foot = n => setPt(cur, n+'L', cur.legs[n].ft);
    const walkStart = dog.x;
    handleCommand({type:'action',value:'walk'}); dog.target = walkStart + PH*1.45; dog.pause = 0;
    let drift = 0, samples = 0, last = {};
    for (let i=0;i<55;i++){
      steps(1);
      for (const leg of ['fn','ff','hn','hf']){
        const q=(dog.phase/TAU + (leg==='fn'||leg==='hf' ? .25 : .75))%1;
        const planted = q>.07 && q<.43 && dog.wb>.98 && dog.moving;
        const x = foot(leg)[0];
        if (last[leg] != null && planted){ drift=Math.max(drift,Math.abs(x-last[leg])); samples++; }
        last[leg] = planted ? x : null;
      }
    }
    check('小跑时对角承重爪留在地面', samples>4 && drift<PH*.012, samples+' / '+drift.toFixed(2)+'px');
    handleCommand({type:'action',value:'sniff'}); dog.pause=10; steps(55);
    const sniffGap=GY-mouthPt()[1];
    check('嗅地时鼻口低下并保持爪子接地', sniffGap>0 && sniffGap<PH*.18 && Math.abs(GY-foot('fn')[1])<PH*.022, sniffGap.toFixed(2)+'px');
    handleCommand({type:'action',value:'idle'}); steps(65);
    dog.belly=.25; world.food=.45; dog.x=world.bowlX-mouthReach()*.8;
    handleCommand({type:'action',value:'eat'}); steps(65);
    const bowlGap=world.bowlX-Math.max(foot('fn')[0],foot('ff')[0]), mouthGap=Math.abs(world.bowlX-mouthPt()[0]);
    check('吃饭时爪子留在碗边，嘴对准碗', dog.eatPhase==='eat' && bowlGap>PH*.055 && mouthGap<PH*.085,
      bowlGap.toFixed(2)+' / '+mouthGap.toFixed(2)+'px');
    handleCommand({type:'action',value:'idle'}); dog.x=W*.4; steps(65);
    dog.held=true; dog.heldT=dog.t-3; dog.gdx=dog.gdy=0; ptr.down=true; ptr.x=dog.x; ptr.y=GY-PH*.8;
    let minSwing=Infinity, maxSwing=-Infinity;
    for (let i=0;i<24;i++){
      steps(1); const split=cur.bones.fnU.rot-cur.bones.ffU.rot;
      minSwing=Math.min(minSwing,split); maxSwing=Math.max(maxSwing,split);
    }
    check('拎久后前爪交替蹬动', maxSwing-minSwing>20*MOT && GY-foot('fn')[1]>PH*.45, (maxSwing-minSwing).toFixed(1)+'°');
    up(); let fallSteps=0;
    while (dog.falling && fallSteps++<40) steps(1);
    let sink=0, stanceError=0, shakeSamples=0;
    const frontX=foot('fn')[0];
    for (let i=0;i<45;i++){
      steps(1);
      if(i<11) sink=Math.max(sink,cur.bones.chest.ty);
      if(dog.X.shake && i>12){ shakeSamples++; stanceError=Math.max(stanceError,Math.abs(foot('fn')[0]-frontX)); }
    }
    check('落地后屈腿缓冲并踩稳', fallSteps>0 && !dog.falling && sink>cur.restH*.025*MOT && Math.abs(GY-foot('fn')[1])<PH*.022,
      '胸口下移 '+(sink*rk).toFixed(2)+'px');
    check('落地抖毛时承重前爪稳定', shakeSamples>6 && stanceError<PH*.022, shakeSamples+' / '+stanceError.toFixed(2)+'px');
    // 碗：鼠标能拎起来挪到别处，松手落回地上
    {
      handleCommand({ type:'action', value:'idle' }); dog.auto = false; steps(30);
      const bx0 = world.bowlX; dog.x = clamp(bx0 - 3 * PH, minX(), maxX()); steps(20);
      const r = bowlRect(), cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
      lastPress.t = -9;   // 冒烟测试的时间是模拟的，别被"300 毫秒内第二次不算"挡住
      const pressed = pressAt(cx, cy, 'dom');
      let lifted = false;
      for (let i = 1; i <= 12; i++){ onCursor([cx - i * 30, cy - i * 14, 0]); steps(1); lifted ||= world.bowlHeld && world.bowlY < GY - 40; }
      await shot('bowl-held');
      const relX = world.bowlX;
      up(); let f = 0; while (world.bowlFalling && f++ < 120) steps(1);
      await shot('bowl-dropped');
      check('碗能拎起来挪到别处，松手落回地上', pressed && lifted && !world.bowlFalling && world.bowlY === GY && Math.abs(relX - (bx0 - 360)) < 40 && Math.abs(world.bowlX - relX) < 3 * PH && world.bowlN != null,
        `按住 ${pressed} 拎起 ${lifted} 松手处离起点 ${Math.round(bx0 - relX)}px，又滑了 ${Math.round(Math.abs(world.bowlX - relX))}px`);
    }
    // 饿了、碗空着、你在电脑前：在碗边干等一阵，就叼着空碗走到你鼠标附近放下，坐旁边等
    {
      world.food = 0; dog.belly = .1; dog.auto = true; dog.manualUntil = 0; dog.userAway = false; dog.userIdle = 0; dog.bringBowlAt = 0; dog.once = null;
      ptr.x = clamp(world.bowlX + (world.bowlX > W / 2 ? -1 : 1) * 5 * PH, 80, W - 80); ptr.y = GY - 120; ptr.movedAt = dog.t;
      setAction('hungry');
      let carried = false, carryShot = false, g = 0;
      while (g++ < 1500 && !(carried && dog.action === 'hungry' && dog.actT > 1.5)){
        steps(2); ptr.movedAt = dog.t;
        if (world.bowlCarried){ carried = true; if (!carryShot && dog.moving){ carryShot = true; await shot('bowl-carry'); } }
      }
      await shot('bowl-brought');
      check('饿了叼着空碗来找你', carried && dog.action === 'hungry' && !world.bowlCarried && Math.abs(world.bowlX - ptr.x) < 2 * PH,
        `叼过 ${carried} 现在 ${dog.action} 碗离鼠标 ${Math.round(Math.abs(world.bowlX - ptr.x))}px`);
    }
  } catch (err){
    errors.push('脚本异常: ' + (err && err.stack || err));
  }
  api.smokeDone({ ok:errors.length === 0, passed:checks.filter(c => c.pass).length, total:checks.length, errors, checks });
}

// ---------- 启动 ----------
// 两张原画的镜头略有变化。把坐姿两只前爪的前后间距和远爪的落地深度
// 配准到站姿，避免前脚撑地时靠近镜头的那只爪仍向旁边滑动。
function registerSittingPaws(poses){
  const layers=['front-leg-near','front-leg-far'];
  const pair=pose=>layers.map(id=>pose?.layers.find(layer=>layer.id===id));
  const standing=pair(poses.stand), sitting=pair(poses.sit);
  if (![...standing,...sitting].every(l=>l?.foot)) return;
  const footX=l=>l.x+l.foot[0], center=ls=>(footX(ls[0])+footX(ls[1]))/2;
  const shift=center(sitting)-center(standing);
  for(let i=0;i<sitting.length;i++){
    const leg=sitting[i], ref=standing[i];
    leg.x+=footX(ref)+shift-footX(leg);
    leg.y+=(ref.y+ref.foot[1]-poses.stand.ground)-(leg.y+leg.foot[1]-poses.sit.ground);
  }
}
(async () => {
  try {
    KIT = await RIG.buildKit(R, HD);
    SETS = {};
    registerSittingPaws(HD.poses);
    // 转身不经过正面那张图（看着怪）：不加载 turn，转身走原地收窄、翻面、再展开
    for (const name of Object.keys(HD.poses)) if (name !== 'turn' && name !== 'turn-back') SETS[name] = await RIG.buildSet(R, name, HD.poses[name], KIT);
    if(window.PetTurn && HD.poses['turn-back'])turnArt=window.PetTurn.prepare(R,SETS.stand,await window.PetTurn.loadRear(R,HD.poses['turn-back']));
    // 贴图都建好了：丢掉素材数据里约 1 MB 的图片字符串
    for (const P of Object.values(HD.poses)) for (const l of P.layers) delete l.src;
    if (HD.face){ delete HD.face.head; for (const g of ['eyes', 'mouths']) for (const v of Object.values(HD.face[g])) delete v.src; }
    for (const v of Object.values(HD.props || {})) delete v.src;
    if (SETS.turn){
      // 镜头另一侧的转身姿势有独立的骨架矩阵，复用同一份网格和 GPU 纹理。
      const bones = {};
      for (const [key, bone] of Object.entries(SETS.turn.bones)) bones[key] = {...bone, w:bone.w.slice()};
      reverseTurn = {...SETS.turn, bones};
    }
  } catch (err){
    console.error('[pet] 素材加载失败', err);
    cantShow('程序文件好像不完整，狗显示不出来。重新安装一下试试', 'asset-failed', err);
    return;
  }
  // 坐下时前爪留在原地：坐姿的落脚点按前爪对齐站姿；转身仍然绕站姿的身体中心
  const frontPaws = st => (st.legs.fn.ft[0] + st.legs.ff.ft[0]) / 2;
  if (SETS.sit && SETS.sit.legs.fn && SETS.stand.legs.fn) RIG.setAnchor(SETS.sit, frontPaws(SETS.sit) - (frontPaws(SETS.stand) - SETS.stand.ax));
  if (SETS.sit?.legs.hn && SETS.prone?.legs.hn){
    // 坐趴之间绕靠近镜头的后爪落点折叠上身。蜷睡的所有关键姿势共用同一个平移。
    const dx=RIG.rel(SETS.sit,SETS.sit.legs.hn.ft)[0]-RIG.rel(SETS.prone,SETS.prone.legs.hn.ft)[0];
    for(const set of [SETS.prone,SETS.curl,SETS.sleep]) if(set) RIG.setAnchor(set,set.ax-dx*(set.mirror?-1:1));
  }
  if (KIT && SETS.prone) motionArt = (window.PetTransitions || window.PetRiseMotion)?.prepare(R, SETS) || null;
  cur = SETS.stand;
  const sc = document.createElement('canvas'); sc.width = 128; sc.height = 32; const sx = sc.getContext('2d'); const g = sx.createRadialGradient(64, 16, 1, 64, 16, 64); g.addColorStop(0, 'rgba(20,24,30,.34)'); g.addColorStop(.6, 'rgba(20,24,30,.12)'); g.addColorStop(1, 'rgba(20,24,30,0)'); sx.fillStyle = g; sx.setTransform(1, 0, 0, .25, 0, 12); sx.beginPath(); sx.arc(64, 16, 64, 0, TAU); sx.fill();
  shadowTex = tex(sc);
  bowlFrontTex = tex(bowlFrontCanvas());
  noteTex = tex(noteCanvas());
  const boot = await api.load().catch(() => ({}));
  if (boot.settings) SETTINGS = Object.assign(SETTINGS, boot.settings);
  SETTINGS.auto = true; dog.auto = true;   // 菜单里不再有手动姿势，一直随机自由活动
  if (boot.bench){ SETTINGS.auto = false; dog.auto = false; }
  if (boot.smoke || boot.bench){ neutralTraits = true; refreshGrow(); }
  if (boot.dev){ DIAG = true; DIGEST *= 60; SPEED = 20; AWAY_SEC = 20; window.addEventListener('error', e => console.error('[pet] 出错', e.message, e.lineno)); }
  applyFrame(boot.frame);
  resize(); dog.x = W * .3;
  const st0 = PL.sanitizeState(boot.state);
  if (st0 && !boot.smoke){
    const st = PL.settleAway(st0, boot.now || Date.now(), boot.dev ? 60 : 1);
    dog.belly = st.belly; world.food = st.food; dog.needs = st.needs; dog.notes = st.notes;
    if (st.bowl != null){ world.bowlN = st.bowl; world.bowlX = clamp(st.bowl * W, bowlMinX(), bowlMaxX()); }
    dog.x = clamp(st.x * W, minX(), maxX()); dog.facing = dog.faceS = st.facing;
    if (st.groundNote) world.groundNote = { x:clamp(st.groundNote.x * W, minX(), maxX()), text:st.groundNote.text, mine:false, since:0 };
    if (st.awaySec > 4 * 3600) startOnce('stretch'); else if (st.awaySec > 600) setAction('greet');
    const g = PG.sanitizeGrow(st.grow);
    // 老存档里还没有养成：生日按存档里最早的时间算（最早的纸条），没有就从现在算
    if (g){ GROW = g; refreshGrow(); } else { GROW.born = Math.min(st0.savedAt || Date.now(), ...dog.notes.map(n => n.at).filter(v => v > 0)); api.diary('开始记日记'); }
  } else if (!boot.smoke) api.diary('第一天来到这里');
  booted = true;
  if (!boot.smoke) setInterval(growCheck, 60000);
  // 合养：上次关程序时它在别人那儿，先别露面，等连上服务器再说（免得一开机闪一下又走）
  if (boot.abroad && !boot.smoke){ dog.abroad = true; dog.visible = false; }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(stage);
  reportUnread();
  window.addEventListener('resize', () => { resize(); render(); });   // 窗口变高（被拎起来）或变回底部一条
  syncUI();
  // 帧率分档：被拎、被摸、转身、蹦跳 30；走路、吃饭、换姿势、眨眼、耳朵在甩 24；站坐趴着 8（呼吸每帧不到 1 像素）；睡觉 5；
  // 出门送纸条（看不见）4；窗口藏起来 2（只算消化，不画）。帧率是 CPU 占用的大头，平时尽量低。
  const quick = () => !!pivotTurn || !!motion || dog.held || dog.falling || world.bowlHeld || world.bowlFalling || world.bowlCarried || ptr.down || interactive || dog.pet > .05 || dog.t - dog.turnHop < TURN + .1 || dog.t - dog.hop < .6 || dog.t - dog.land < .5;
  const lively = () => dog.moving || !!trans || !!nextStop || (SETS.turn && dog.faceS !== dog.facing) || !!dog.once || dog.action === 'eat' || dog.particles.some(p => p.type !== 'z') ||
    Math.abs(dog.wag) > 12 || Math.abs(dog.alpha - (dog.fading ? .5 : 1)) > .01 || Math.abs(dog.ev) > 60 || Math.abs(dog.lookV || 0) > 3 ||
    (!(dog.action === 'sleep' && !dog.dozing) && (dog.blinkAt - dog.t < .12 || dog.t - dog.blinkS < (dog.blinkD || .2) + .02)) ||
    dog.t - dog.face.eyeT < (dog.face.eyeD || .07) || dog.t - dog.face.mouthT < (dog.face.mouthD || .09);
  const busy = () => quick() || lively();
  const targetFps = () => boot.benchFps ? boot.benchFps : document.hidden || occluded || dog.abroad ? 2 : !dog.visible ? 4 : quick() ? 30 : lively() ? 24 : dog.action === 'sleep' ? 5 : 8;
  let last = performance.now(), expandReq = false, frames = 0, renderMs = 0, updateMs = 0, boxSent = '', boxSentAt = 0;
  if (boot.bench) setInterval(() => { console.log(`[bench] ${(frames / 5).toFixed(1)} 帧/秒 每帧 update ${(updateMs / Math.max(1, frames)).toFixed(2)}ms render ${(renderMs / Math.max(1, frames)).toFixed(2)}ms 画 ${drawCalls / Math.max(1, frames) | 0} 次 动作=${dog.action}`); frames = 0; renderMs = 0; updateMs = 0; drawCalls = 0; }, 5000);
  // 每一帧都包一层：一帧出错只记下来、接着画下一帧，不让整个动画停掉。
  // 连着出错（8 秒里没有一帧走完）就不再报平安，让主进程的看门狗重载页面
  let lastFrameOk = performance.now(), frameErrAt = 0;
  const frame = () => {
    try { frameBody(); lastFrameOk = performance.now(); }
    catch (err){
      const t = performance.now();
      if (t - frameErrAt > 60000){ frameErrAt = t; console.error('[pet] 这一帧出错', err); api.diag({ kind:'frame-error', detail:String(err && err.stack || err).slice(0, 800) }); }
    }
    schedule();
  };
  const frameBody = () => {
    const now = performance.now();
    if (pendingWant === false && now - lastSwitch >= 120) updateInteractive(ptr.x, ptr.y);
    // 鼠标不动、狗在动：每 0.1 秒按狗的新位置重新判断一次鼠标下面是不是狗。不然狗走到静止的鼠标底下点不着，
    // 狗走开了那一块还挡着桌面。只在鼠标在狗附近（或者正处于可点状态）时才判断，不额外费事
    else if (!ptr.down && !dog.held && now - (frame.lastRecheck || 0) > 100 && (interactive || inBox(dog.bbox, ptr.x, ptr.y, 12))){ frame.lastRecheck = now; updateInteractive(ptr.x, ptr.y); }
    let gap = (now - last) / 1000; last = now;
    if (gap > 1.2){ diag('gap', Math.round(gap * 1000) + 'ms'); catchUp(gap - .1); gap = .1; }   // 系统睡眠、卡顿：消化和需求按真实时间补上
    // 低帧率时一帧要走的时间拆成几小步，动作和物理不会跳
    const u0 = performance.now();
    for (let left = gap || .016; left > 1e-4; left -= .1){ lastDt = Math.min(.1, left); update(lastDt); }
    updateMs += performance.now() - u0;
    lastDt = gap || .016;
    const wantExp = dog.held || dog.falling || world.bowlHeld || world.bowlFalling;
    // 告诉主进程狗大概在哪（最多每秒 4 次，变了才发），它据此决定鼠标位置多久报一次
    if (api.setBox && now - boxSentAt > 250){
      const sx = occluded ? dog.x - bboxAt[0] : 0, sy = occluded ? dog.y - bboxAt[1] : 0;
      const b = dog.visible && dog.bbox ? [dog.bbox[0] + sx, dog.bbox[1] + sy, dog.bbox[2] + sx, dog.bbox[3] + sy].map(Math.round) : null, k = b ? b.join(',') : '';
      if (k !== boxSent){ boxSent = k; boxSentAt = now; api.setBox(b); } }
    if (wantExp !== expandReq){ expandReq = wantExp; if (api.setExpanded) api.setExpanded(wantExp); }
    // occluded 只代表狗被挡住，旁边的碗可能还露着。粮量改变时补画一帧即可。
    if (!document.hidden && (!occluded || kibbleCount(world.food) !== bowlFood) && !boot.benchNoRender){ const r0 = performance.now(); render(); renderMs += performance.now() - r0; frames++ }
  };
  const schedule = () => {
    const wait = Math.max(0, 1000 / targetFps() - (performance.now() - last) - 6);
    setTimeout(() => { if (document.hidden) frame(); else requestAnimationFrame(frame); }, wait);
  };
  // 两帧之间隔得太久（电脑睡眠、窗口被挂起）：不逐帧模拟，直接按时长扣消化、更新需求
  function catchUp(sec){
    const sleeping = dog.action === 'sleep';
    if (dog.action !== 'eat') dog.belly = Math.max(0, dog.belly - sec * DIGEST * EFF.digestMul * (sleeping ? .5 : 1));
    GROW.weight = PG.weightTick(GROW.weight, sec * SPEED, { belly:dog.belly });
    const nctx = needCtx();
    dog.needs = PL.tickNeeds(dog.needs, sec, { sleeping, userPresent:nctx.userPresent, night:nctx.night, speed:SPEED, drainMul:EFF.drainMul, attentionMul:EFF.attentionMul });
    PM.tickMind(dog.mind, sec, { ...dog.needs, hunger:PL.hungerStage(dog.belly), night:nctx.night, userPresent:nctx.userPresent, asleep:sleeping && !dog.dozing, posture:sleeping || dog.action === 'lie' ? 'lie' : 'stand', quiet:true, heldFor:-1 });
  }
  // 显卡重置、远程桌面、驱动更新会让 WebGL 上下文丢掉：等它恢复后重载页面；10 秒还没恢复也重载（不然狗一直看不见）
  let lostTimer = null;
  cv.addEventListener('webglcontextlost', e => {
    e.preventDefault(); diag('contextlost'); console.error('[pet] WebGL 上下文丢失'); api.diag({ kind:'gl-lost' });
    clearTimeout(lostTimer); lostTimer = setTimeout(() => location.reload(), 10000);
  }, false);
  cv.addEventListener('webglcontextrestored', () => { clearTimeout(lostTimer); diag('contextrestored'); location.reload(); }, false);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => diag('resize', `${Math.round(stage.clientWidth)}x${Math.round(stage.clientHeight)}`)).observe(stage);
  setInterval(() => { if (DIAG && Object.keys(diagCount).length){ console.log('[diag] 每分钟统计 ' + JSON.stringify(diagCount)); for (const k in diagCount) delete diagCount[k]; } }, 60000);
  update(1 / 60); render();
  // 报平安只在动画真的在走时报：动画停了（连续出错、卡住）看门狗才能发现。最慢一档每秒也有 2 帧，8 秒没走完一帧就是出事了
  if (!boot.smoke){ schedule(); setInterval(() => { if (performance.now() - lastFrameOk < 8000) api.heartbeat(); }, 1000); }
  if (boot.bench){ handleCommand({ type:'action', value:boot.bench }); dog.manualUntil = 1e12; }
  if (boot.dev) console.log(`[pet] 启动完成 窗口 ${Math.round(W)}x${Math.round(Hh)} dpr=${dpr} 狗高=${Math.round(PH)}px 渲染=${R.gl2 ? 'WebGL2' : 'WebGL1'} 肚子=${dog.belly.toFixed(2)}`);
  if (boot.dev || boot.smoke || boot.e2e) window.__rig = { step:(n, dt) => { for (let i = 0; i < n; i++){ lastDt = dt || 1 / 60; update(dt || 1 / 60); } render(); }, dog, get set(){ return cur; }, get turn(){return pivotTurn;}, get motion(){ return motion; }, get rise(){ return motion?.kind === 'rise' ? motion : null; }, get curl(){ return motion?.kind === 'curl' ? motion : null; }, SETS, KIT, world, ptr, setAction, startOnce, resize, handleCommand, hitTest, openCard, closeCard, get inputRing(){ return inputRing; }, get interactive(){ return interactive; }, bowlRect, showAwayBubble, startCross, enterFrom, get grow(){ return GROW; }, get traits(){ return TRAITS; }, get eff(){ return EFF; }, growEvent, growCheck };
  if (boot.smoke){ document.body.classList.add('smoke'); runSmoke(); }
})();
})();
