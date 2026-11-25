// 桌面比格：高清分层素材 + 2D 骨骼网格动画 + 行为状态机。
// 素材数据在 assets/beagle/puppy/rig-data.js（tools/build_hd.py 生成），怎么画在 rig.js，这里是行为和每帧的姿势。
(() => {
const HD = window.BEAGLE_HD, RIG = window.PetRig;
const api = window.petApi || { setInteractive(){}, showMenu(){}, load: async () => ({}), save(){}, onCommand(){}, heartbeat(){}, setTooltip(){}, smokeShot: async () => {}, smokeDone(){} };
const PL = window.PetLogic;
let DIAG = false;
const diagCount = {};
function diag(kind, info){ diagCount[kind] = (diagCount[kind] || 0) + 1; if (DIAG) console.log(`[diag] ${new Date().toISOString().slice(11, 23)} ${kind} ${info == null ? '' : info}`); }
// 玩法里的距离沿用老单位：S × dog.k 个屏幕像素 ≈ 老素材的 1 像素（站姿从地面到头顶 163 个这样的单位）
const S = 3, D2R = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const pick = list => { let s = 0; for (const [, w] of list) s += w; let r = Math.random() * s; for (const [k, w] of list){ if ((r -= w) <= 0) return k; } return list[0][0]; };
let reduce = false; try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
const MOT = reduce ? .4 : 1;
const { mul, ap, Tm, Rm, Sm } = RIG || {};

// ---------- WebGL ----------
const stage = document.getElementById('stage'), cv = document.getElementById('gl'), ov = document.getElementById('ov'), octx = ov.getContext('2d');
const R = RIG && RIG.createRenderer(cv);
if (!R || !HD){ stage.insertAdjacentHTML('beforeend', `<p class="err">${R ? '素材数据没加载到，先运行 python tools/build_hd.py。' : '这台电脑没开 WebGL，看不了动画。'}</p>`); return; }
const gl = R.gl, tex = R.tex, quadMesh = R.quad;
let drawCalls = 0;
const drawMesh = (m, t, a) => { drawCalls++; R.drawMesh(m, t, a); };
// cur 是当前的分层骨架，trans 同时保留上一个姿势的骨架和朝向。
let SETS = null, KIT = null, cur = null, trans = null, reverseTurn = null, nextStop = null, rk = .15, PH = 130;
// 换姿势只能走相邻的路：睡觉一定先趴下，醒来一定先趴着再起来
const ROUTE = { stand:['sit', 'prone'], sit:['stand', 'prone'], prone:['sit', 'stand', 'sleep'], sleep:['prone'] };
const TDUR = { 'stand|sit':.6, 'sit|stand':.55, 'stand|prone':.8, 'prone|stand':.7, 'sit|prone':.65, 'prone|sit':.6, 'prone|sleep':.95, 'sleep|prone':.8 };
const BETWEEN = { 'stand|sit':'crouch', 'stand|prone':'crouch', 'sit|prone':'lie-down', 'prone|sleep':'curl' };
const TURN = .36;   // 老素材包没有转身层时的转身时间
const dogLayer = R.target(), prevLayer = R.target();

// ---------- 程序画的小零件：碗、阴影 ----------
const BOWL = { w:66 * S, h:24 * S, rimRy:6.5 * S };
let bowlFood = -1, bowlBackTex = null, bowlFrontTex = null;
function bowlBackCanvas(food){
  const sc = .7, c = document.createElement('canvas'); c.width = Math.ceil(BOWL.w * sc); c.height = Math.ceil((BOWL.rimRy * 2 + 26 * S) * sc);
  const x = c.getContext('2d'); x.scale(sc, sc);
  const cx = BOWL.w / 2, cy = 24 * S + BOWL.rimRy, rx = BOWL.w / 2 - 2, ry = BOWL.rimRy;
  x.fillStyle = '#BFE0F2'; x.strokeStyle = '#7A5238'; x.lineWidth = S * .9;
  x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, TAU); x.fill(); x.stroke();
  x.fillStyle = '#5E93B8'; x.beginPath(); x.ellipse(cx, cy + S * .6, rx - 4 * S, ry - 1.8 * S, 0, 0, TAU); x.fill();
  const n = Math.round(food * 46), r = (i => { let a = 1234 + i * 977; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; });
  const pts = [];
  for (let i = 0; i < 46; i++){ const R = r(i); const u = R() * 2 - 1, layer = i < 16 ? 0 : 1; const mound = layer ? (9 * (1 - u * u) + 1) * R() : R() * 2; pts.push([cx + u * (rx - 7 * S), cy + S * 1.2 - mound * S * 1.1, R() * TAU]); }
  pts.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < n; i++){ const [px, py, a] = pts[i]; x.save(); x.translate(px, py); x.rotate(a); x.fillStyle = '#8E552A'; x.beginPath(); x.ellipse(0, 0, 3.2 * S, 2.5 * S, 0, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,230,190,.45)'; x.beginPath(); x.ellipse(-.8 * S, -.8 * S, 1.2 * S, .8 * S, 0, 0, TAU); x.fill(); x.restore(); }
  return c;
}
function bowlFrontCanvas(){
  const sc = .7, c = document.createElement('canvas'); c.width = Math.ceil(BOWL.w * sc); c.height = Math.ceil((BOWL.rimRy * 2 + 26 * S) * sc);
  const x = c.getContext('2d'); x.scale(sc, sc);
  const cx = BOWL.w / 2, cy = 24 * S + BOWL.rimRy, rx = BOWL.w / 2 - 2, ry = BOWL.rimRy, bot = cy + 15 * S;
  const g = x.createLinearGradient(0, cy, 0, bot); g.addColorStop(0, '#9CCBE8'); g.addColorStop(1, '#6EA4C9');
  x.fillStyle = g; x.strokeStyle = '#7A5238'; x.lineWidth = S * .9;
  x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); x.lineTo(cx - rx + 6 * S, bot); x.quadraticCurveTo(cx, bot + 3 * S, cx + rx - 6 * S, bot); x.closePath(); x.fill(); x.stroke();
  x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = S * 1.6; x.beginPath(); x.moveTo(cx - rx + 9 * S, cy + 6 * S); x.lineTo(cx - rx + 11 * S, bot - 3 * S); x.stroke();
  return c;
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
const ACT_NAME = { walk:'溜达', sniff:'闻地面', idle:'站着', sit:'坐着', lie:'趴着', sleep:'睡觉', bow:'邀你玩', hungry:'饿了，在碗边等', eat:'吃饭', seek:'想你理它', greet:'迎接你', courier:'送纸条' };
const ONCE_NAME = { yawn:'打哈欠', shake:'抖毛', stretch:'伸懒腰', tilt:'歪头', hop:'蹦一下', poke:'被戳了一下', glance:'瞟一眼碗', nudge:'拱一拱纸条' };
const ACT_EXPR = { walk:['happy', 'neutral'], sniff:['curious'], idle:['neutral', 'curious'], sit:['neutral', 'content'], lie:['content', 'neutral'], sleep:['sleepy'], bow:['happy'], hungry:['beg'], eat:['content'], seek:['curious'], greet:['happy'], courier:['happy'] };
const POSE_KEYS = ['lie', 'sit', 'bow', 'sniff', 'rest', 'low'];

// ---------- 狗 ----------
const dog = { x:300, y:0, k:.55, faceS:1, facing:1, tilt:0, action:'walk', actT:0, actDur:12, auto:true, expr:'happy', once:null,
  target:null, pause:.8, phase:0, wb:0, moving:false, speed:0, held:false, falling:false, vx:0, vy:0, gdx:0, gdy:0,
  t:0, belly:.55, wag:8, hop:-9, land:-9, ea:0, ev:0, e1:0, e1v:0, prevH:null, prevV:[0, 0], blinkS:-9, blinkAt:1.5,
  look:0, P:{ lie:0, sit:0, bow:0, sniff:0, rest:0, low:0 }, E:{ ...EXPR.happy }, pet:0, petAt:-9, neckFix:[0, 0], eatPhase:'', lickT:0,
  dreamAt:5, dreamS:-9, sighAt:4, sighS:-9, twitchAt:3, behindT:0, parts:{}, particles:[], spawnT:0, onceAt:6,
  needs:PL.initNeeds(), visible:true, alpha:1, nearT:0, userIdle:0, userAway:false, lastInteract:-99, turnHop:-9, glanceAt:20, courier:null, carry:null, shakeOnLand:false, lastShake:-9, notes:[], seekPhase:'', seekT:0,
  face:{ eye:'open', eyeP:null, eyeT:-9, mouth:'neutral', mouthP:null, mouthT:-9 } };
const world = { food:.35, bowlX:0, groundNote:null, noteRect:null };
let W = 800, Hh = 420, GY = 386, dpr = 1, CH = 420, CT = 0;
// FR：工作区在屏幕上的位置和大小（主进程给）。页面坐标 = 屏幕坐标 - 工作区左上角；舞台始终和工作区一样高
let FR = null;
function applyFrame(f){ if (!f || !(f.wh > 0)) return; FR = f; stage.style.height = f.wh + 'px'; }
function resize(){
  const r = stage.getBoundingClientRect(); W = r.width; Hh = r.height; GY = Hh - 3; fitSize(); dpr = Math.min(2, window.devicePixelRatio || 1);
  // 画布只做窗口露出来的那么高（平时是底部一条），省掉一整屏的显存和合成
  CH = Math.max(1, Math.min(Hh, Math.ceil(window.innerHeight || Hh))); CT = Hh - CH;
  const pw = Math.round(W * dpr), ph = Math.round(CH * dpr);
  if (cv.width !== pw || cv.height !== ph){ cv.style.height = ov.style.height = CH + 'px'; cv.width = ov.width = pw; cv.height = ov.height = ph; ovRect = null; }
  gl.viewport(0, 0, cv.width, cv.height);
  world.bowlX = W - 160 * dog.k / .33;
  if (!dog.held && !dog.falling) dog.y = GY;
  if (!(dog.courier && ['leave', 'away', 'return'].includes(dog.courier.phase))) dog.x = clamp(dog.x, minX(), maxX());
}
const minX = () => 24 + SETS.stand.back * rk, maxX = () => W - 24 - SETS.stand.front * rk;
// 姿势坐标（素材原图像素）→ 屏幕坐标：以身体中心正下方的地面为原点，按朝向翻转、按 rk 缩放、按倾斜旋转
function MG(set, facing = dog.faceS){
  const a = dog.tilt * D2R, c = Math.cos(a), s = Math.sin(a), m = set.mirror ? -1 : 1;
  // 转身：横向先收窄到一半左右再展开，像在原地转过来，而不是一下翻面
  const tp = (dog.t - dog.turnHop) / TURN, sq = !SETS.turn && tp > 0 && tp < 1 && !dog.held && !dog.falling ? 1 - .48 * Math.sin(Math.PI * tp) : 1;
  return mul(mul([c, s, -s, c, dog.x + (dog.offX || 0), dog.y], Sm(rk * facing * m * sq, rk)), Tm(-set.ax, -set.ground));
}
const setPt = (set, bone, p) => ap(mul(MG(set), set.bones[bone].w), p[0], p[1]);
const headLocalPt = (set, lx, ly) => ap(mul(mul(MG(set), set.bones.head.w), set.HL), lx, ly);
const headPt = () => headLocalPt(cur, cur.headW * .5, cur.headH * .38);
const mouthPt = () => cur.facePoints && cur.facePoints.mouthHold ? headLocalPt(cur, ...cur.facePoints.mouthHold) : headPt();
const eyePt = () => cur.facePoints && cur.facePoints.eyeCenter ? headLocalPt(cur, ...cur.facePoints.eyeCenter) : headPt();
// 站着时嘴在身体中心前面多远（屏幕像素）：叼纸条、走到碗边时用
function mouthReach(){
  const st = SETS.stand, m = KIT ? KIT.points.mouthHold : [st.headW * .9, st.headH * .7], q = ap(st.HL, m[0], m[1]);
  return (q[0] - st.ax) * rk;
}
function turnTo(f){ if (f !== dog.facing){ dog.facing = f; if (!SETS.turn) dog.turnHop = dog.t; } }
// 走到 tx：起步加速、快到了减速；正在转身或换姿势（比如还没站起来）时原地等
function walkTo(tx, dt, slow, mulSpeed){
  const dx = tx - dog.x;
  if (dog.t - (dog.walkSeen || -9) > .25) dog.vel = 0;
  dog.walkSeen = dog.t;
  if (Math.abs(dx) < 2){ dog.vel = 0; dog.moving = false; return true; }
  turnTo(dx > 0 ? 1 : -1);
  if (dog.faceS !== dog.facing || trans || cur.name !== 'stand'){ dog.vel = 0; dog.moving = false; return false; }
  const vmax = (slow ? 45 : 120) * dog.k / .55 * (mulSpeed || 1), acc = vmax * 3;
  const want = Math.sign(dx) * Math.min(vmax, Math.max(Math.sqrt(2 * acc * Math.abs(dx)), vmax * .15));
  dog.vel = (dog.vel || 0) + clamp(want - (dog.vel || 0), -acc * dt, acc * dt);
  const step = dog.vel * dt;
  if (Math.abs(step) >= Math.abs(dx) || Math.sign(step) !== Math.sign(dx)){ dog.x = tx; dog.vel = 0; dog.moving = false; return true; }
  dog.x += step; dog.speed = Math.abs(dog.vel); dog.moving = dog.speed > 3; return false;
}
function wander(dt, slow, pr){
  if (dog.pause > 0){ dog.pause -= dt; return; }
  if (dog.target == null){ let tx, k = 0; do { tx = clamp(dog.x + rand(-460, 460) * dog.k / .33, minX(), Math.min(maxX(), world.bowlX - 60 * S * dog.k)); } while (Math.abs(tx - dog.x) < 90 && ++k < 10); dog.target = tx; }
  if (walkTo(dog.target, dt, slow)){
    dog.target = null; dog.pause = rand(pr[0], pr[1]);
    if (dog.thenAct){ const a = dog.thenAct; dog.thenAct = null; setAction(a); }   // 走到地方再做下一件事（比如吃饱了走开再趴下）
  }
}

let DIGEST = PL.digestRate(false), SPEED = 1, AWAY_SEC = PL.AWAY_IDLE_SEC, SETTINGS = { auto:true, size:'medium' };
const COURIER_AWAY = 7;   // 演示：出门转一圈的秒数；接上合养后换成真的去朋友桌面
function needCtx(){ const h = new Date().getHours(); return { userPresent: !dog.userAway && dog.userIdle < 60, night: h >= 23 || h < 7 }; }
const REST_OLD = (171 - 8) * S;   // 老素材站姿从地面到头顶；玩法里的距离（走多快、离碗多远）还按这个单位
function fitSize(){ PH = PL.petHeightFor(Hh); dog.k = PH / REST_OLD; if (SETS) rk = PH / SETS.stand.restH; }
const DUR = { walk:[8, 14], sniff:[6, 10], idle:[5, 8], sit:[6, 10], lie:[8, 12], sleep:[14, 22], bow:[3.5, 5], seek:[60, 60], greet:[5, 6], courier:[999, 999] };
const NEXT = { walk:[['sniff', 3], ['sit', 2], ['idle', 2], ['bow', 1], ['lie', 1]], sniff:[['walk', 3], ['sit', 1], ['idle', 1]], idle:[['walk', 3], ['sit', 2], ['lie', 1], ['sniff', 1]],
  sit:[['lie', 2], ['walk', 2], ['idle', 1]], lie:[['sleep', 2], ['sit', 1], ['walk', 1]], bow:[['walk', 2], ['idle', 1]] };
function setAction(a, manual){
  const prev = dog.action;
  dog.action = a; dog.actT = 0; const d = DUR[a] || [8, 12]; dog.actDur = rand(d[0], d[1]); dog.target = null; dog.pause = .2; dog.thenAct = null;
  if (a === 'eat') dog.eatPhase = 'walk';
  if (a === 'seek'){ dog.seekPhase = 'go'; dog.seekT = dog.t; }
  if (!manual || !dog.exprLock){ const list = ACT_EXPR[a] || ['neutral']; dog.expr = list[Math.floor(Math.random() * list.length)]; if (needCtx().night && ['idle', 'sit', 'lie'].includes(a) && Math.random() < .5) dog.expr = 'sleepy'; }
  if (prev === 'sleep' && a !== 'sleep' && !manual) startOnce('stretch');
  syncUI();
}
function startOnce(type){
  const dur = { yawn:1.9, shake:1.3, stretch:2.8, tilt:2.4, hop:.45, poke:1.3, glance:1.6, nudge:1.2 }[type];
  if (!dur) return;
  dog.once = { type, t0:dog.t, dur }; if (type === 'hop'){ dog.hop = dog.t; } if (type === 'shake') dog.lastShake = dog.t; syncUI();
}
function autoStep(dt){
  const a = dog.action;
  if (['eat', 'courier', 'greet'].includes(a)) return;
  // 饿分四档：吃饱 → 偶尔瞟一眼碗 → 去碗边坐着等 → 等得委屈
  const stage = PL.hungerStage(dog.belly);
  if ((stage === 'hungry' || stage === 'starving') && !['hungry', 'sleep'].includes(a)){ setAction('hungry'); return; }
  if (a === 'hungry'){ if (stage === 'fed' || stage === 'peckish') setAction('idle'); else dog.expr = stage === 'starving' ? 'sad' : 'beg'; return; }
  if (dog.actT > dog.actDur){
    if (a === 'sleep'){ if (dog.userAway){ dog.actT = 0; return; } setAction('idle'); startOnce('stretch'); dog.onceAt = dog.t + 4; return; }
    setAction(PL.chooseNext(a, dog.needs, needCtx()));
    return;
  }
  if (stage === 'peckish' && !dog.once && dog.t > dog.glanceAt && ['idle', 'sit', 'lie', 'walk'].includes(a) && !dog.moving){ dog.glanceAt = dog.t + rand(12, 25); startOnce('glance'); return; }
  if (!dog.once && dog.t > dog.onceAt){
    dog.onceAt = dog.t + rand(5, 10);
    const opts = a === 'walk' || a === 'idle' ? [['shake', 1], ['tilt', 2], ['yawn', 1 + (1 - dog.needs.energy) * 2], ['hop', dog.needs.energy]] : a === 'sit' ? [['yawn', 2], ['tilt', 2]] : a === 'lie' ? [['yawn', 1]] : a === 'bow' ? [['hop', 3]] : null;
    if (opts && !(a === 'walk' && dog.moving)) startOnce(pick(opts));
  }
}

// ---------- 每帧更新 ----------
const ptr = { x:-999, y:-999, movedAt:-9, down:false, downX:0, downY:0, downT:0, over:false, speed:0 };
function update(dt){
  const t = (dog.t += dt); dog.actT += dt;
  if (dog.action !== 'eat') dog.belly = Math.max(0, dog.belly - dt * DIGEST * (dog.action === 'sleep' ? .5 : 1));
  if (!dog.auto && dog.manualUntil && t > dog.manualUntil){ dog.auto = SETTINGS.auto; dog.manualUntil = 0; dog.exprLock = false; }
  const nctx = needCtx();
  dog.needs = PL.tickNeeds(dog.needs, dt, { sleeping:dog.action === 'sleep', active:dog.moving || dog.action === 'bow', playing:dog.action === 'bow' || dog.pet > .35 || dog.held,
    interacted:dog.pet > .35 || t - dog.lastInteract < 2, userPresent:nctx.userPresent, night:nctx.night, speed:SPEED });
  if (dog.auto && !dog.held && !dog.falling) autoStep(dt);
  const T = { lie:0, sit:0, bow:0, sniff:0, rest:0, low:0 };
  const X = { neck:0, head:0, jaw:0, lid:0, closed:false, tongue:0, offX:0, rootLift:0, wig:0, wagMul:1, chew:0 };
  let exprName = dog.expr;
  dog.moving = false;
  const a = dog.action, once = dog.once;
  if (dog.held){
    const tx = ptr.x - dog.gdx, ty = ptr.y - dog.gdy;
    dog.vx = lerp(dog.vx, (tx - dog.x) / dt, .35); dog.vy = lerp(dog.vy, (ty - dog.y) / dt, .35);
    dog.x = tx; dog.y = ty; dog.tilt = lerp(dog.tilt, clamp(dog.vx * .02, -20, 20), .25);
    const heldFor = dog.t - dog.heldT;
    exprName = heldFor < .9 ? 'surprised' : heldFor < 2.5 ? 'happy' : 'sad';
    if (heldFor > 2.5) X.struggle = Math.min(1, (heldFor - 2.5) * 2);
  } else if (dog.falling){
    dog.vy += 2400 * dt; dog.y += dog.vy * dt; dog.x = clamp(dog.x + dog.vx * dt, minX(), maxX()); dog.vx *= 1 - 1.2 * dt; dog.tilt = lerp(dog.tilt, 0, .12);
    if (dog.y >= GY){ dog.y = GY; if (dog.vy > 250) dog.land = t; dog.vy = 0; dog.vx = 0; dog.falling = false; if (dog.shakeOnLand){ dog.shakeOnLand = false; startOnce('shake'); } }
  } else {
    dog.tilt = lerp(dog.tilt, 0, .2);
    const busy = once && ['stretch', 'shake'].includes(once.type);
    if (a === 'walk'){ if (!busy) wander(dt, false, [1, 2.6]); }
    else if (a === 'sniff'){ if (!busy) wander(dt, true, [.5, 1.4]); T.sniff = 1; X.wig = 1; }
    else if (a === 'sit') T.sit = 1;
    else if (a === 'lie') T.lie = 1;
    else if (a === 'sleep'){ T.lie = 1; T.rest = 1; X.closed = true;
      if (t > dog.dreamAt){ dog.dreamS = t; dog.dreamAt = t + rand(7, 12); }
      const dp = t - dog.dreamS; if (dp < 2.4){ const e = Math.sin(Math.PI * dp / 2.4); X.paddle = Math.sin(dp * TAU * 3.4) * e; X.dreamWag = e; }
      if (t > dog.spawnT){ dog.spawnT = t + 1.1; const hp = headPt(); spawn('z', hp[0] + dog.faceS * 10 * dog.k * S, hp[1] - 36 * dog.k); }
    }
    else if (a === 'bow'){ T.bow = 1; X.offX = 9 * dog.k / .55 * Math.sin(t * TAU * .85) * MOT; if (!once && Math.random() < dt * .6) startOnce('hop'); }
    else if (a === 'hungry'){
      const tx = world.bowlX - SETS.sit.front * rk - BOWL.w * dog.k * .5 - 4;
      if (walkTo(tx, dt, false, 1.3)){ turnTo(1); T.sit = 1;
        const lookBowl = Math.sin(t * TAU / 4.2) > 0; X.head = lookBowl ? 14 : -6; X.lookBowl = lookBowl;
        if (t > dog.sighAt){ dog.sighS = t; dog.sighAt = t + rand(3, 5); }
        const lp = (t - dog.sighS) / .6; if (lp >= 0 && lp <= 1) X.tongue = Math.sin(Math.PI * lp) * .5;
      }
    }
    else if (a === 'seek'){
      // 想你理它：走到鼠标附近坐下抬头看你；理它就开心，久不理就委屈地趴下
      const px = ptr.x > 0 && ptr.x < W ? ptr.x : W * .5, side = px > dog.x ? 1 : -1;
      if (dog.seekPhase === 'go'){ if (walkTo(clamp(px - side * 75 * S * dog.k, minX(), maxX()), dt)){ dog.seekPhase = 'wait'; dog.seekT = t; } }
      else {
        T.sit = 1; turnTo(side);
        const waited = t - dog.seekT;
        exprName = waited > 25 ? 'sad' : Math.sin(t * .8) > 0 ? 'curious' : 'beg';
        if (t - dog.lastInteract < 1){ dog.needs.attention = 0; setAction('idle'); dog.expr = 'happy'; startOnce('hop'); }
        else if (waited > 40){ setAction('lie'); dog.expr = 'sad'; }
      }
    }
    else if (a === 'greet'){
      // 你回到电脑前：醒过来跑到鼠标那儿，摇尾巴蹦两下
      const px = ptr.x > 0 && ptr.x < W ? ptr.x : dog.x, side = px > dog.x ? 1 : -1;
      if (!(dog.once && dog.once.type === 'stretch') && walkTo(clamp(px - side * 70 * S * dog.k, minX(), maxX()), dt, false, 1.5) && !dog.once && Math.random() < dt * 1.2) startOnce('hop');
      exprName = 'happy'; X.wagMul = 1.7;
      if (dog.actT > 7.5) setAction('idle');
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
        if (walkTo(c.edge > 0 ? W + off : -off, dt, false, 1.25)){ c.phase = 'away'; c.awayT = t; dog.visible = false; api.setTooltip('桌面比格：出门送纸条了'); }
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
        if (t - c.dropT > .9){ world.groundNote = { x:dog.x + dog.facing * mouthDX, text:c.text, mine:false }; dog.carry = null; c.phase = 'wait'; c.waitT = t; }
      } else {
        T.sit = 1; exprName = Math.sin(t * .7) > -.3 ? 'curious' : 'happy'; X.wagMul = 1.3;
        if (!dog.once && t - c.waitT > 8 && Math.random() < dt * .12) startOnce('nudge');
        if (!world.groundNote){ dog.courier = null; setAction('idle'); dog.expr = 'content'; }
      }
    }
    else if (a === 'eat'){
      if (dog.eatPhase === 'walk'){
        const tx = world.bowlX - mouthReach() * .8;
        if (walkTo(tx, dt, false, 1.6)){ turnTo(1); if (dog.faceS === 1){ dog.eatPhase = 'down'; dog.downT = dog.t; } }
      } else if (dog.eatPhase === 'down' || dog.eatPhase === 'eat'){
        T.sniff = .85; T.bow = .5; X.neck = 0; dog.eatAmt = Math.min(1, (dog.eatAmt || 0) + dt * 2);
        if (dog.eatPhase === 'eat'){
          X.chew = Math.sin(t * TAU * 3.2);
          const d = Math.min(world.food, dt * .14); world.food -= d; dog.belly = Math.min(1, dog.belly + d * .9);
          if (Math.random() < dt * 3) { const m = mouthPt(); spawn('crumb', m[0], m[1]); }
          if (world.food <= 0){ world.food = 0; dog.eatPhase = 'lick'; dog.lickT = 0; }
        } else if (dog.t - dog.downT > 1) dog.eatPhase = 'eat';
      } else {
        dog.lickT += dt; X.tongue = Math.sin(Math.min(1, dog.lickT / .9) * Math.PI) * .6; exprName = 'content';
        if (dog.lickT > 1.4){
          if (dog.belly > .6){
            // 吃撑了：转身走开几步再趴下，别趴在碗上
            setAction('walk'); dog.expr = 'content'; dog.pause = .3; dog.thenAct = 'lie';
            dog.target = clamp(dog.x - 1.4 * PH, minX(), maxX());
          } else { setAction('idle'); dog.expr = 'content'; }
        }
      }
    }
    // 单次动作
    if (once){
      const p = (t - once.t0) / once.dur;
      if (p >= 1){ dog.once = null; syncUI(); }
      else if (once.type === 'yawn'){ const o = Math.sin(Math.PI * p); X.jaw += 15 * o; X.closed = X.closed || o > .35; X.neck += -9 * o; X.tongue -= .3 * o; }
      else if (once.type === 'shake'){ const env = Math.sin(Math.PI * p), s = Math.sin(t * TAU * 7) * env * MOT; X.shake = s; X.lid = Math.max(X.lid, .45 * env); }
      else if (once.type === 'stretch'){ const b = smooth(0, .25, p) * (1 - smooth(.6, .85, p)); T.bow = Math.max(T.bow, b); T.lie = 0; T.rest = 0; T.sit = 0; const y = Math.sin(Math.PI * clamp((p - .15) / .5, 0, 1)); X.jaw += 13 * y; X.closed = X.closed || y > .4; X.neck += -12 * y; X.closed = X.closed && a !== 'sleep' ? X.closed : X.closed; if (a === 'sleep') X.closed = y > .4; }
      else if (once.type === 'tilt'){ const s = p < .5 ? -1 : 1; X.head += 13 * s * smooth(0, .12, p) * (1 - smooth(.9, 1, p)); exprName = 'curious'; }
      else if (once.type === 'poke'){ exprName = 'surprised'; }
      else if (once.type === 'glance'){ const o = Math.sin(Math.PI * p), ahead = Math.sign(world.bowlX - dog.x) === dog.facing; X.head += (ahead ? 9 : -5) * o; exprName = 'beg'; if (p > .55 && p < .8) X.tongue = .5; }
      else if (once.type === 'nudge'){ const o = Math.sin(Math.PI * p); X.neck += 22 * o; X.head += 8 * o; }
      if (once && once.type === 'hop'){}
    }
    const th = (t - dog.turnHop) / .32;
    if (!SETS.turn && th >= 0 && th <= 1) X.rootLift = Math.max(X.rootLift, Math.sin(Math.PI * th) * 10 * dog.k * MOT);
    const hp = (t - dog.hop) / .45;
    if (hp >= 0 && hp <= 1){ X.rootLift = Math.sin(Math.PI * hp) * 26 * dog.k * MOT; X.tuck = Math.sin(Math.PI * hp); if (exprName === 'neutral') exprName = 'happy'; }
    if (!dog.held && !dog.falling) dog.y = GY;
  }
  // 摸摸
  const overHead = ptr.over && !dog.held;
  if (overHead && t - ptr.movedAt < .15 && ptr.speed > 40) dog.pet = Math.min(2, dog.pet + dt * 1.6); else dog.pet = Math.max(0, dog.pet - dt * .6);
  if (dog.pet > .35) dog.lastInteract = t;
  if (dog.pet > .35){
    exprName = a === 'sleep' ? 'sleepy' : 'content'; X.head += -5; X.wagMul = 1.8;
    if (t > dog.spawnT){ dog.spawnT = t + .55; const hp2 = headPt(); spawn('heart', hp2[0] + rand(-20, 20) * dog.k, hp2[1] - 40 * dog.k); }
  }
  // 看鼠标
  let lookTgt = 0;
  if (!dog.held && !['sleep', 'eat'].includes(a) && !dog.moving && t - ptr.movedAt < 2.5){
    const hp3 = eyePt(), dx = (ptr.x - hp3[0]) * Math.sign(dog.faceS), dy = ptr.y - hp3[1];
    if (dx > -30){ lookTgt = clamp(Math.atan2(dy, Math.max(30, dx)) / D2R * .45, -14, 16); dog.behindT = 0; }
    else { dog.behindT += dt; if (dog.behindT > 1.2 && ['idle', 'sit'].includes(a)){ turnTo(-dog.facing); dog.behindT = 0; } }
  }
  dog.look = lerp(dog.look, lookTgt, Math.min(1, dt * 4));
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
  const TE = EXPR[exprName] || EXPR.neutral, re = 1 - Math.exp(-dt * 6), rp = 1 - Math.exp(-dt * (dog.held ? 10 : 3.2));
  for (const k of EKEYS) dog.E[k] += (TE[k] - dog.E[k]) * re;
  for (const k of POSE_KEYS) dog.P[k] += (T[k] - dog.P[k]) * rp;
  dog.curExpr = exprName;
  // 选哪套素材：被拎着、掉落时总是站姿
  const want = dog.held || dog.falling ? 'stand' : T.rest > .5 ? 'sleep' : T.lie > .5 ? 'prone' : T.sit > .5 ? 'sit' : 'stand';
  if (trans){ trans.t += dt; if (trans.t >= trans.dur) trans = null; }
  if ((dog.held || dog.falling) && cur.name !== 'stand') {
    nextStop = null; startTrans(SETS.stand, .22, dog.facing);
  } else if (!trans) advancePose(want);
  applyPose(dt, X);
  if (trans) posePrev();
  chooseFace(exprName, X);
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
    nextStop = {from, to, via, dur:dur * .8};
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
  trans = { from, fromFacing, facingRelation:fromFacing * facing, yaw:from.name === 'turn' && to.name === 'turn', t:0, dur, base:RIG.snapshot(from) };
  cur = to; dog.faceS = facing;
  if (fromFacing !== facing){ dog.prevH = null; dog.prevV = [0,0]; diag('flip', facing); }
  (dog.route = dog.route || []).push(from.name + '>' + to.name); if (dog.route.length > 24) dog.route.shift();
  diag('pose', from.name + '>' + to.name);
}
const transE = () => trans ? smooth(0, 1, trans.t / trans.dur) : 1;
// 旧姿势：停在开始换的那一刻，再一点点靠向新姿势
function posePrev(){
  const P = trans.from, e = transE();
  RIG.restore(P, trans.base);
  if (trans.yaw){ RIG.solve(P); return; }
  RIG.morphToward(P, cur, e, trans.facingRelation);
  RIG.solve(P);
  for (const n of Object.keys(P.legs)){ const f = RIG.footToward(P, cur, n, e, trans.facingRelation); RIG.ik(P, n, f[0], f[1], 1); }
  RIG.solve(P);
}
// 眼睛、嘴巴：按表情选零件，再叠上眨眼、打哈欠、咀嚼、舔嘴、叼东西
function chooseFace(exprName, X){
  const t = dog.t, f = dog.face;
  let [eye, mouth] = FACE[exprName] || FACE.neutral;
  const bp = t - dog.blinkS;
  if (X.closed) eye = 'closed';
  else {
    if (X.lid > .6) eye = 'closed'; else if (X.lid > .25) eye = 'half';
    if (bp >= 0 && bp < .2){ if (eye !== 'closed') eye = bp < .04 || bp > .14 ? 'half' : 'closed'; }
    else if (eye === 'open' && dog.look < -7) eye = 'look-up';
    if (X.lookBowl && eye === 'look-up') eye = 'open';
  }
  if (X.jaw > 7) mouth = 'yawn';
  else if (X.chew) mouth = X.chew > .2 ? 'chew' : 'neutral';
  else if (X.tongue > .15) mouth = 'lick';
  if (dog.carry){ mouth = 'hold'; if (eye === 'open' || eye === 'wide') eye = 'look-up'; }
  if (eye !== f.eye){ f.eyeP = f.eye; f.eye = eye; f.eyeT = t; }
  if (mouth !== f.mouth){ f.mouthP = f.mouth; f.mouth = mouth; f.mouthT = t; }
}
function faceState(){
  const f = dog.face, t = dog.t;
  return { eye:f.eye, eyeP:f.eyeP, eyeF:clamp((t - f.eyeT) / .07, 0, 1), mouth:f.mouth, mouthP:f.mouthP, mouthF:clamp((t - f.mouthT) / .09, 0, 1), carry:!!dog.carry };
}

function applyPose(dt, X){
  const t = dog.t, P = dog.P, E = dog.E, set = cur, Bn = set.bones, st = set.name, u = set.restH / 163;
  RIG.reset(set);
  // 走路：步频跟着移动速度走，脚落地时不打滑
  dog.wb = lerp(dog.wb, dog.moving ? 1 : 0, Math.min(1, dt * 8));
  const stride = 11 * u;
  if (dog.moving) dog.phase += dt * clamp(dog.speed / rk / stride, 4, 16);
  else if (dog.wb > .02) dog.phase += dt * 6;
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
  } else {
    Bn.neck.rot += X.neck * .5;
    Bn.head.rot += (X.head + dog.look) * (st === 'sleep' ? .2 : .8);
  }
  // 被拎起：腿垂下来晃
  if (st === 'stand' && dog.held){
    const sw = clamp(-dog.vx * .035, -28, 28) + (X.struggle ? 22 * X.struggle * Math.sin(t * TAU * 5.5) : 0);
    Bn.fnU.rot += sw + 5 * Math.sin(t * 4); Bn.ffU.rot += sw + 5 * Math.sin(t * 4 + 1); Bn.hnU.rot += sw * .8 + 5 * Math.sin(t * 4 + 2); Bn.hfU.rot += sw * .8 + 5 * Math.sin(t * 4 + 3);
    Bn.fnL.rot += 10; Bn.ffL.rot += 10; Bn.hnL.rot -= 6; Bn.hfL.rot -= 6;
  } else if (st === 'stand' && dog.falling){ Bn.fnU.rot -= 12; Bn.ffU.rot -= 12; Bn.hnU.rot += 12; Bn.hfU.rot += 12; }
  if (X.paddle && st === 'sleep'){ const k = X.paddle * 5; for (const [n, d] of [['fnL', 1], ['ffL', -1], ['hnL', .7], ['hfL', -.7]]) if (Bn[n]) Bn[n].rot += k * d; }
  // 抖毛
  if (X.shake){ const s = X.shake; Bn.chest.rot += 5 * s; Bn.hip.rot -= 4 * s; Bn.neck.rot += 6 * Math.sin(t * TAU * 7 + .6) * Math.abs(s); Bn.head.rot += 8 * Math.sin(t * TAU * 7 + 1.2) * Math.abs(s); if (Bn.tail0) Bn.tail0.rot += 20 * s; Bn.belly.tx += 2 * u * s; }
  // 呼吸、肚子（吃得多肚子鼓起来）
  const sleeping = st === 'sleep', lying = sleeping || st === 'prone', brF = sleeping ? .25 : (E.pant > .6 ? 1.3 : .45);
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
  const lp = (t - dog.land) / .35; if (lp >= 0 && lp <= 1){ const q = Math.sin(Math.PI * lp) * .07; Bn.chest.sy -= q; Bn.hip.sy -= q; }
  if (!dog.held && !dog.falling) dog.y = GY - lift;
  dog.offX = X.offX;
  if (dog.faceS !== dog.facing && (dog.held || dog.falling || (!SETS.turn && (t - dog.turnHop > TURN / 2 || t - dog.turnHop < 0)))){
    dog.faceS = dog.facing; dog.prevH = null; dog.prevV = [0, 0];   // 在身子最窄的时候翻面；头的位置会跳，别让耳朵弹簧当成猛甩
    diag('flip', dog.facing);
  }
  // 吃饭时把嘴对准碗
  const eating = dog.action === 'eat' && (dog.eatPhase === 'down' || dog.eatPhase === 'eat');
  if (!eating){ dog.neckFix[0] *= .9; dog.neckFix[1] *= .9; }
  if (st === 'stand'){ Bn.neck.tx += dog.neckFix[0]; Bn.neck.ty += dog.neckFix[1]; }
  // 换姿势刚开始：新姿势先摆成接近旧姿势的样子，再慢慢回到自己
  const mw = trans && !trans.yaw ? 1 - transE() : 0;
  if (mw > 0) RIG.morphToward(set, trans.from, mw, trans.facingRelation);
  RIG.solve(set);
  // 站着时四只爪子踩在地上；走路时按对角步态抬脚、落脚
  if (st === 'stand' && !dog.held && !dog.falling){
    for (const n of ['fn', 'ff', 'hn', 'hf']){
      const g = set.legs[n]; if (!g) continue;
      const ph = dog.phase + (n === 'fn' || n === 'hf' ? 0 : Math.PI), s = Math.sin(ph), c = Math.cos(ph), f0 = RIG.footToward(set, mw > 0 ? trans.from : null, n, mw, trans ? trans.facingRelation : 1);
      let tx = f0[0] + stride * s * dog.wb, ty = f0[1] - Math.max(0, c) * 8 * u * dog.wb;
      if (n[0] === 'f') tx += P.bow * 48 * u + P.sniff * 4 * u;   // 邀玩时前腿往前伸直趴低，不是折起来
      if (X.tuck) ty -= X.tuck * 10 * u;
      RIG.ik(set, n, tx, ty, 1);
    }
    RIG.solve(set);
  } else if (mw > 0){
    for (const n of Object.keys(set.legs)){ const f = RIG.footToward(set, trans.from, n, mw, trans.facingRelation); RIG.ik(set, n, f[0], f[1], 1); }
    RIG.solve(set);
  }
  // 耳朵弹簧：头一晃耳朵就甩，角度限制在素材允许的范围里（再大会露出耳根）
  const hp = setPt(set, 'head', [Bn.head.px, Bn.head.py]);
  if (!dog.prevH) dog.prevH = hp;
  const v = [(hp[0] - dog.prevH[0]) / dt, (hp[1] - dog.prevH[1]) / dt];
  const acc = [clamp((v[0] - dog.prevV[0]) / dt, -6000, 6000), clamp((v[1] - dog.prevV[1]) / dt, -6000, 6000)];
  dog.prevH = hp; dog.prevV = v;
  const fs = (Math.sign(dog.faceS) || 1) * (set.mirror ? -1 : 1), f = (acc[0] * fs * .9 - acc[1]) * .6 / (dog.k / .55);
  if (dog.t > dog.twitchAt){ dog.twitchAt = dog.t + rand(4, 9); dog.ev += rand(-1, 1) > 0 ? 220 : -220; }
  dog.ev += (-160 * (dog.ea - earBase) - 9 * dog.ev + f) * dt; dog.ea = clamp(dog.ea + dog.ev * dt, -14 + earBase, 14 + earBase);
  dog.e1v += (-190 * (dog.e1 - (dog.ea - earBase) * .45) - 8 * dog.e1v + f * .55) * dt; dog.e1 = clamp(dog.e1 + dog.e1v * dt, -10, 10);
  if (Bn.ear0){ const ER = HD.earRange || [-12, 12]; Bn.ear0.rot += clamp(dog.ea - (Bn.head.rot + Bn.neck.rot) * .3, ER[0], ER[1]); Bn.ear1.rot += dog.e1 * .6; RIG.solve(set); }
  if (eating && st === 'stand'){
    const m = mouthPt(), tgt = [world.bowlX, GY - BOWL.h * dog.k * .72], g = .125 / rk;
    dog.neckFix[0] = clamp(dog.neckFix[0] + (tgt[0] - m[0]) * g * Math.sign(dog.faceS), -14 * u, 16 * u);
    dog.neckFix[1] = clamp(dog.neckFix[1] + (tgt[1] - m[1]) * g, -8 * u, 20 * u);
  }
  // 眨眼
  if (dog.t > dog.blinkAt){ dog.blinkS = dog.t; dog.blinkAt = dog.t + (Math.random() < .15 ? .32 : rand(2.4, 5.5)); }
  dog.X = X;
}

// ---------- 粒子：Z、小心心、叹气、碎渣 ----------
function spawn(type, x, y){ dog.particles.push({ type, x, y, t0:dog.t, vx:type === 'crumb' ? rand(-30, 30) : rand(-6, 6), vy:type === 'crumb' ? rand(-60, -20) : -18, life:type === 'crumb' ? .7 : 1.8 }); }
function drawParticles(dt){
  dog.particles = dog.particles.filter(p => dog.t - p.t0 < p.life);
  for (const p of dog.particles){
    const a = (dog.t - p.t0) / p.life;
    if (p.type === 'crumb'){ p.vy += 400 * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    octx.globalAlpha = Math.sin(Math.PI * Math.min(1, a * 1.2)) * .9;
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
const shadowMesh = quadMesh(), pawShadow = quadMesh(), bowlBackMesh = quadMesh(), bowlFrontMesh = quadMesh(), noteMesh = quadMesh();
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
  const sw = (set.bbox[2] - set.bbox[0]) * rk * .78 * (1 - .35 * liftAmt), shh = PH * .09 * (1 - .3 * liftAmt);
  quadAt(shadowMesh, [[sx - sw / 2, GY - shh / 2], [sx + sw / 2, GY - shh / 2], [sx + sw / 2, GY + shh / 2], [sx - sw / 2, GY + shh / 2]]);
  if (dog.visible) drawMesh(shadowMesh, shadowTex, (.85 - .55 * liftAmt) * dog.alpha);
  // 爪子接地阴影
  if (dog.visible && set.name !== 'sleep') for (const n of Object.keys(set.legs)){
    const g = set.legs[n], p = ap(mul(M, set.bones[n + 'L'].w), g.ft[0], g.ft[1]), dy = GY - p[1], lim = PH * .08;
    if (dy < lim){ const a = clamp(1 - dy / lim, 0, 1), r = PH * .075; quadAt(pawShadow, [[p[0] - r, GY - r * .22], [p[0] + r, GY - r * .22], [p[0] + r, GY + r * .22], [p[0] - r, GY + r * .22]]); drawMesh(pawShadow, shadowTex, a * .8 * dog.alpha); }
  }
  // 碗的后半（在狗后面）、地上的纸条
  const bk = dog.k, bxw = BOWL.w * bk, bh = (BOWL.rimRy * 2 + 26 * S) * bk, bTop = GY - bh + 6 * S * bk;
  if (Math.round(world.food * 46) !== bowlFood){ bowlFood = Math.round(world.food * 46); bowlBackTex = tex(bowlBackCanvas(world.food), bowlBackTex); }
  const bq = [[world.bowlX - bxw / 2, bTop], [world.bowlX + bxw / 2, bTop], [world.bowlX + bxw / 2, bTop + bh], [world.bowlX - bxw / 2, bTop + bh]];
  quadAt(bowlBackMesh, bq); quadAt(bowlFrontMesh, bq);
  drawMesh(bowlBackMesh, bowlBackTex);
  drawGroundNote();
  // 狗：整只画进离屏层，再按透明度贴回来；换姿势时旧姿势盖在上面淡出
  if (dog.visible){
    const box = dogBox(), parts = {}; lastBox = box;
    R.bindTarget(dogLayer, box.pw, box.ph); R.setView(box.x, box.y, box.w, box.h);
    const blend = trans && trans.from !== set, e = transE();
    RIG.drawSet(R, set, KIT, M, faceState(), parts, trans?.yaw ? 1 - e : 0);
    if (blend){ R.bindTarget(prevLayer, box.pw, box.ph); R.setView(box.x, box.y, box.w, box.h); RIG.drawSet(R, trans.from, KIT, MG(trans.from, trans.fromFacing), faceState(), {}, trans.yaw ? e : 0); }
    R.bindScreen(); R.setView(0, CT, W, CH);
    // 新姿势垫在下面先慢慢出现，旧姿势盖在上面、过了中点才淡掉：中间不会两只都半透明
    R.drawTarget(dogLayer, box.x, box.y, box.w, box.h, dog.alpha * (blend ? smooth(.24, .53, e) : 1));
    if (blend) R.drawTarget(prevLayer, box.x, box.y, box.w, box.h, dog.alpha * (1 - smooth(.43, .77, e)));
    dog.parts = parts;
    const all = Object.values(parts);
    dog.bbox = all.length ? [Math.min(...all.map(b => b[0])), Math.min(...all.map(b => b[1])), Math.max(...all.map(b => b[2])), Math.max(...all.map(b => b[3]))] : null;
  } else { dog.parts = {}; dog.bbox = null; lastBox = null; }
  drawMesh(bowlFrontMesh, bowlFrontTex);
  // 叠加层：只在有粒子（Z、小心心、碎渣）或刚清空时才重画，不然这一整层每帧都要重新合成
  if (dog.particles.length || ovRect){
    octx.setTransform(dpr, 0, 0, dpr, 0, -CT * dpr);
    if (ovRect) octx.clearRect(ovRect[0], ovRect[1], ovRect[2] - ovRect[0], ovRect[3] - ovRect[1]);
    ovRect = drawParticles(lastDt);
  }
}
let lastBox = null, ovRect = null;

// ---------- 鼠标 ----------
function local(e){
  if (FR) return [e.screenX - FR.wx, e.screenY - FR.wy];
  const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top];
}
const inBox = (b, x, y, pad) => b && x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad;
stage.addEventListener('pointerdown', e => {
  const [x, y] = local(e);
  if (world.groundNote && world.noteRect && inBox(world.noteRect, x, y, 6)){ openCard(); return; }
  if (!dog.visible || !inBox(dog.bbox, x, y, 0)) return;
  ptr.down = true; ptr.downX = x; ptr.downY = y; ptr.downT = performance.now(); ptr.x = x; ptr.y = y;
  try { stage.setPointerCapture(e.pointerId); } catch (err) {}
});
stage.addEventListener('pointermove', e => {
  const [x, y] = local(e), now = performance.now() / 1000;
  const dtm = Math.max(.008, now - (ptr.lastT || now - .016)); ptr.speed = Math.hypot(x - ptr.x, y - ptr.y) / dtm; ptr.lastT = now;
  ptr.x = x; ptr.y = y; ptr.movedAt = dog.t;
  ptr.over = inBox(dog.parts.head, x, y, 4) || inBox(dog.parts.ear, x, y, 2);
  if (ptr.down && !dog.held && Math.hypot(x - ptr.downX, y - ptr.downY) > 7){
    dog.held = true; dog.falling = false; dog.heldT = dog.t; dog.gdx = x - dog.x; dog.gdy = y - dog.y; dog.vx = dog.vy = 0; stage.style.cursor = 'grabbing';
  }
  if (!dog.held) stage.style.cursor = inBox(dog.bbox, x, y, 0) ? (ptr.over ? 'pointer' : 'grab') : 'default';
});
const up = () => {
  if (dog.held){ if (dog.t - dog.heldT > 2.5) dog.shakeOnLand = true; dog.lastInteract = dog.t; dog.held = false; dog.falling = true; dog.vx = clamp(dog.vx, -900, 900); dog.vy = clamp(dog.vy, -900, 600); dog.target = null; stage.style.cursor = 'default'; if (['sit', 'lie', 'sleep', 'bow'].includes(dog.action)) setAction(dog.auto ? 'idle' : dog.action, !dog.auto); }
  else if (ptr.down && performance.now() - ptr.downT < 350){ dog.lastInteract = dog.t; startOnce('poke'); dog.hop = dog.t; if (dog.action === 'sleep') setAction('sit'); }
  ptr.down = false;
  updateInteractive(ptr.x, ptr.y);
};
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('pointerleave', () => { ptr.over = false; });

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
    if (dog.action === 'sleep' && dog.auto){ setAction('greet'); startOnce('stretch'); }
  }
}
function handleCommand(cmd){
  if (cmd.type === 'feed'){ abortCourier(); world.food = 1; setAction('eat', !dog.auto); }
  else if (cmd.type === 'action'){ abortCourier(); manual(); dog.exprLock = false; setAction(cmd.value, true); }
  else if (cmd.type === 'once') startOnce(cmd.value);
  else if (cmd.type === 'auto'){ SETTINGS.auto = cmd.value; dog.auto = cmd.value; dog.manualUntil = 0; if (cmd.value) dog.actT = dog.actDur - 1; }
  else if (cmd.type === 'idle') onIdle(cmd.value);
  else if (cmd.type === 'cursor') onCursor(cmd.value);
  else if (cmd.type === 'frame') applyFrame(cmd.value);
  else if (cmd.type === 'note'){
    const text = PL.cleanNote(cmd.value);
    if (!text || dog.held) return;
    if (!card.hidden) closeCard();
    abortCourier(); world.groundNote = null;
    dog.courier = { text, phase:'pick' }; dog.visible = true;
    setAction('courier', true);
  }
}
api.onCommand(handleCommand);

// ---------- 展开的纸条 ----------
const card = document.getElementById('noteCard'), cardText = document.getElementById('noteText'), cardFrom = document.getElementById('noteFrom');
function inCard(x, y){
  if (card.hidden) return false;
  const r = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return x >= r.left - s.left && x <= r.right - s.left && y >= r.top - s.top && y <= r.bottom - s.top;
}
function openCard(){
  const n = world.groundNote; if (!n || !world.noteRect) return;
  cardText.textContent = n.text;
  cardFrom.textContent = n.mine ? '你写的，它还没叼走' : '演示：这是你写的那张，它出门转了一圈又叼回来了。接上合养后，这里会是朋友写给你的。';
  card.hidden = false;
  const r = card.getBoundingClientRect(), nr = world.noteRect;
  card.style.left = clamp((nr[0] + nr[2]) / 2 - r.width / 2, 8, Math.max(8, W - r.width - 8)) + 'px';
  const visTop = Math.max(0, Hh - (window.innerHeight || Hh));
  card.style.top = clamp(nr[1] - r.height - 14, visTop + 8, Math.max(visTop + 8, Hh - r.height - 8)) + 'px';
  dog.lastInteract = dog.t; updateInteractive(ptr.x, ptr.y);
}
function closeCard(){
  if (card.hidden) return;
  card.hidden = true;
  const n = world.groundNote;
  if (n){ dog.notes.push({ text:n.text, at:Date.now() }); dog.notes = dog.notes.slice(-20); world.groundNote = null; world.noteRect = null; }
  dog.lastInteract = dog.t;
  if (dog.visible && dog.parts.head){ if (!dog.once) startOnce('hop'); const hp = headPt(); for (let i = 0; i < 3; i++) spawn('heart', hp[0] + rand(-25, 25) * dog.k, hp[1] - 40 * dog.k); }
  api.save(snapshot()); updateInteractive(ptr.x, ptr.y);
}
document.getElementById('noteClose').addEventListener('click', closeCard);

stage.addEventListener('contextmenu', e => { e.preventDefault(); api.showMenu(); });
// 鼠标离开窗口（比如移到任务栏）时，恢复点穿
document.addEventListener('mouseleave', () => { ptr.over = false; if (!dog.held && !ptr.down && interactive){ interactive = false; api.setInteractive(false); } });

// ---------- 点穿：鼠标下面是透明像素就让点击穿到桌面 ----------
let interactive = false;
const px = new Uint8Array(4);
function hitTest(x, y){
  if (world.noteRect && inBox(world.noteRect, x, y, 2)) return true;
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
  const want = dog.held || ptr.down || inCard(x, y) || (interactive ? hitNear(x, y, 6) : hitTest(x, y));
  if (want === interactive){ pendingWant = null; return; }
  // 关掉可点（恢复点穿）的时候稍等一下，短时间内反复进出只切一次
  const now = performance.now();
  if (!want && now - lastSwitch < 120){ pendingWant = false; return; }
  interactive = want; lastSwitch = now; pendingWant = null; api.setInteractive(want); diag('interactive', want);
}
function pointerAt(x, y, minDt){
  const now = performance.now() / 1000, dtm = Math.max(minDt, now - (ptr.lastT || now - minDt));
  if (!ptr.down){ ptr.speed = Math.hypot(x - ptr.x, y - ptr.y) / dtm; ptr.lastT = now; ptr.x = x; ptr.y = y; ptr.movedAt = dog.t;
    ptr.over = inBox(dog.parts.head, x, y, 4) || inBox(dog.parts.ear, x, y, 2); }
  updateInteractive(x, y);
}
// 鼠标在狗身上（窗口可点）时有真实的移动事件；点穿时靠主进程轮询告诉我们鼠标在哪
window.addEventListener('mousemove', e => { const [x, y] = local(e); pointerAt(x, y, .008); });
function onCursor(p){ if (Array.isArray(p) && !ptr.down && !dog.held) pointerAt(p[0], p[1], .02); }

// ---------- 存档：位置、肚子、碗里的粮 ----------
function snapshot(){
  const gn = world.groundNote ? { text:world.groundNote.text, x:world.groundNote.x / Math.max(1, W) } : dog.carry ? { text:dog.carry, x:.5 } : null;
  return { v:1, savedAt:Date.now(), x:clamp(dog.x, 0, W) / Math.max(1, W), facing:dog.facing, belly:dog.belly, food:world.food, needs:dog.needs, notes:dog.notes, groundNote:gn };
}
setInterval(() => api.save(snapshot()), 15000);
window.addEventListener('beforeunload', () => api.save(snapshot()));

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
    await strip('tr-sit', () => handleCommand({ type:'action', value:'sit' }), 12, 3);
    await strip('tr-lie', () => handleCommand({ type:'action', value:'lie' }), 12, 3);
    await strip('tr-sleep', () => handleCommand({ type:'action', value:'sleep' }), 17, 3);
    await strip('tr-wake', () => handleCommand({ type:'action', value:'idle' }), 28, 3);
    const wakeRoute = ['sleep', SETS.curl && 'curl', 'prone', SETS.crouch && 'crouch', 'stand'].filter(Boolean);
    const wakeEdges = wakeRoute.slice(1).map((name, i) => wakeRoute[i] + '>' + name).join(',');
    check('睡醒先趴着再站起来', (dog.route || []).join(',').includes(wakeEdges), (dog.route || []).join(','));
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
    // 喂食
    handleCommand({ type:'feed' }); steps(720); await shot('eat');
    check('吃完碗空了', world.food < .05, world.food.toFixed(2));
    check('吃完肚子饱', dog.belly > .6, dog.belly.toFixed(2));
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
    let sawTurn = false; for (let i = 0; i < 34; i++){ steps(1); sawTurn ||= cur.name === 'turn'; }
    check('转身结束时朝向对侧', dog.faceS === -beforeTurn && cur.name === 'stand', dog.faceS);
    check('转身不出现正脸', !sawTurn, (dog.route || []).join(','));
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
    // 存档往返
    const snap = snapshot(), clean = PL.sanitizeState(JSON.parse(JSON.stringify(snap)));
    check('存档能读回来', clean && Math.abs(clean.belly - dog.belly) < 1e-9 && clean.notes.length === dog.notes.length, clean && clean.belly);
    // 自由活动连续跑 5 分钟（模拟时间）
    dog.auto = true; dog.manualUntil = 0; const seen = {};
    for (let i = 0; i < 300; i++){ steps(30); seen[dog.action] = 1; }
    check('自由活动 5 分钟没出错', Object.keys(seen).length >= 3, Object.keys(seen).join(','));
  } catch (err){
    errors.push('脚本异常: ' + (err && err.stack || err));
  }
  api.smokeDone({ ok:errors.length === 0, passed:checks.filter(c => c.pass).length, total:checks.length, errors, checks });
}

// ---------- 启动 ----------
(async () => {
  try {
    KIT = await RIG.buildKit(R, HD);
    SETS = {};
    // 转身不经过正面那张图（看着怪）：不加载 turn，转身走原地收窄、翻面、再展开
    for (const name of Object.keys(HD.poses)) if (name !== 'turn') SETS[name] = await RIG.buildSet(R, name, HD.poses[name], KIT);
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
    stage.insertAdjacentHTML('beforeend', '<p class="err">素材加载失败，重新运行 python tools/build_hd.py 试试。</p>');
    return;
  }
  // 坐下时前爪留在原地：坐姿的落脚点按前爪对齐站姿；转身仍然绕站姿的身体中心
  const frontPaws = st => (st.legs.fn.ft[0] + st.legs.ff.ft[0]) / 2;
  if (SETS.sit && SETS.sit.legs.fn && SETS.stand.legs.fn) RIG.setAnchor(SETS.sit, frontPaws(SETS.sit) - (frontPaws(SETS.stand) - SETS.stand.ax));
  cur = SETS.stand;
  const sc = document.createElement('canvas'); sc.width = 128; sc.height = 32; const sx = sc.getContext('2d'); const g = sx.createRadialGradient(64, 16, 1, 64, 16, 64); g.addColorStop(0, 'rgba(20,24,30,.34)'); g.addColorStop(.6, 'rgba(20,24,30,.12)'); g.addColorStop(1, 'rgba(20,24,30,0)'); sx.fillStyle = g; sx.setTransform(1, 0, 0, .25, 0, 12); sx.beginPath(); sx.arc(64, 16, 64, 0, TAU); sx.fill();
  shadowTex = tex(sc);
  bowlFrontTex = tex(bowlFrontCanvas());
  noteTex = tex(noteCanvas());
  const boot = await api.load().catch(() => ({}));
  if (boot.settings) SETTINGS = Object.assign(SETTINGS, boot.settings);
  SETTINGS.auto = true; dog.auto = true;   // 菜单里不再有手动姿势，一直随机自由活动
  if (boot.bench){ SETTINGS.auto = false; dog.auto = false; }
  if (boot.dev){ DIAG = true; DIGEST *= 60; SPEED = 20; AWAY_SEC = 20; window.addEventListener('error', e => console.error('[pet] 出错', e.message, e.lineno)); }
  applyFrame(boot.frame);
  resize(); dog.x = W * .3;
  const st0 = PL.sanitizeState(boot.state);
  if (st0 && !boot.smoke){
    const st = PL.settleAway(st0, boot.now || Date.now(), boot.dev ? 60 : 1);
    dog.belly = st.belly; world.food = st.food; dog.needs = st.needs; dog.notes = st.notes;
    dog.x = clamp(st.x * W, minX(), maxX()); dog.facing = dog.faceS = st.facing;
    if (st.groundNote) world.groundNote = { x:clamp(st.groundNote.x * W, minX(), maxX()), text:st.groundNote.text, mine:false };
    if (st.awaySec > 4 * 3600) startOnce('stretch'); else if (st.awaySec > 600) setAction('greet');
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', () => { resize(); render(); });   // 窗口变高（被拎起来）或变回底部一条
  syncUI();
  // 帧率分档：被拎、被摸、转身、蹦跳 30；走路、吃饭、换姿势、眨眼、耳朵在甩 24；站坐趴着 8（呼吸每帧不到 1 像素）；睡觉 5；
  // 出门送纸条（看不见）4；窗口藏起来 2（只算消化，不画）。帧率是 CPU 占用的大头，平时尽量低。
  const quick = () => dog.held || dog.falling || ptr.down || interactive || dog.pet > .05 || dog.t - dog.turnHop < TURN + .1 || dog.t - dog.hop < .6 || dog.t - dog.land < .5;
  const lively = () => dog.moving || !!trans || !!nextStop || (SETS.turn && dog.faceS !== dog.facing) || !!dog.once || dog.action === 'eat' || dog.particles.some(p => p.type !== 'z') ||
    Math.abs(dog.wag) > 12 || Math.abs(dog.alpha - (dog.fading ? .5 : 1)) > .01 || Math.abs(dog.ev) > 60 ||
    (dog.action !== 'sleep' && (dog.blinkAt - dog.t < .12 || dog.t - dog.blinkS < .22));
  const busy = () => quick() || lively();
  const targetFps = () => boot.benchFps ? boot.benchFps : document.hidden ? 2 : !dog.visible ? 4 : quick() ? 30 : lively() ? 24 : dog.action === 'sleep' ? 5 : 8;
  let last = performance.now(), expandReq = false, frames = 0, renderMs = 0, updateMs = 0, boxSent = '', boxSentAt = 0;
  if (boot.bench) setInterval(() => { console.log(`[bench] ${(frames / 5).toFixed(1)} 帧/秒 每帧 update ${(updateMs / Math.max(1, frames)).toFixed(2)}ms render ${(renderMs / Math.max(1, frames)).toFixed(2)}ms 画 ${drawCalls / Math.max(1, frames) | 0} 次 动作=${dog.action}`); frames = 0; renderMs = 0; updateMs = 0; drawCalls = 0; }, 5000);
  const frame = () => {
    const now = performance.now();
    if (pendingWant === false && now - lastSwitch >= 120) updateInteractive(ptr.x, ptr.y);
    let gap = (now - last) / 1000; last = now;
    if (gap > 1.2){ diag('gap', Math.round(gap * 1000) + 'ms'); catchUp(gap - .1); gap = .1; }   // 系统睡眠、卡顿：消化和需求按真实时间补上
    // 低帧率时一帧要走的时间拆成几小步，动作和物理不会跳
    const u0 = performance.now();
    for (let left = gap || .016; left > 1e-4; left -= .1){ lastDt = Math.min(.1, left); update(lastDt); }
    updateMs += performance.now() - u0;
    lastDt = gap || .016;
    const wantExp = dog.held || dog.falling;
    // 告诉主进程狗大概在哪（最多每秒 4 次，变了才发），它据此决定鼠标位置多久报一次
    if (api.setBox && now - boxSentAt > 250){ const b = dog.visible && dog.bbox ? dog.bbox.map(Math.round) : null, k = b ? b.join(',') : '';
      if (k !== boxSent){ boxSent = k; boxSentAt = now; api.setBox(b); } }
    if (wantExp !== expandReq){ expandReq = wantExp; if (api.setExpanded) api.setExpanded(wantExp); }
    if (!document.hidden && !boot.benchNoRender){ const r0 = performance.now(); render(); renderMs += performance.now() - r0; frames++ }
    schedule();
  };
  const schedule = () => {
    const wait = Math.max(0, 1000 / targetFps() - (performance.now() - last) - 6);
    setTimeout(() => { if (document.hidden) frame(); else requestAnimationFrame(frame); }, wait);
  };
  // 两帧之间隔得太久（电脑睡眠、窗口被挂起）：不逐帧模拟，直接按时长扣消化、更新需求
  function catchUp(sec){
    const sleeping = dog.action === 'sleep';
    if (dog.action !== 'eat') dog.belly = Math.max(0, dog.belly - sec * DIGEST * (sleeping ? .5 : 1));
    const nctx = needCtx();
    dog.needs = PL.tickNeeds(dog.needs, sec, { sleeping, userPresent:nctx.userPresent, night:nctx.night, speed:SPEED });
  }
  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); diag('contextlost'); console.error('[pet] WebGL 上下文丢失'); }, false);
  cv.addEventListener('webglcontextrestored', () => { diag('contextrestored'); location.reload(); }, false);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => diag('resize', `${Math.round(stage.clientWidth)}x${Math.round(stage.clientHeight)}`)).observe(stage);
  setInterval(() => { if (DIAG && Object.keys(diagCount).length){ console.log('[diag] 每分钟统计 ' + JSON.stringify(diagCount)); for (const k in diagCount) delete diagCount[k]; } }, 60000);
  update(1 / 60); render();
  if (!boot.smoke){ schedule(); setInterval(() => api.heartbeat(), 1000); }
  if (boot.bench){ handleCommand({ type:'action', value:boot.bench }); dog.manualUntil = 1e12; }
  if (boot.dev) console.log(`[pet] 启动完成 窗口 ${Math.round(W)}x${Math.round(Hh)} dpr=${dpr} 狗高=${Math.round(PH)}px 渲染=${R.gl2 ? 'WebGL2' : 'WebGL1'} 肚子=${dog.belly.toFixed(2)}`);
  if (boot.dev || boot.smoke) window.__rig = { step:(n, dt) => { for (let i = 0; i < n; i++){ lastDt = dt || 1 / 60; update(dt || 1 / 60); } render(); }, dog, get set(){ return cur; }, SETS, KIT, world, ptr, setAction, startOnce, resize, handleCommand, hitTest, openCard, closeCard };
  if (boot.smoke){ document.body.classList.add('smoke'); runSmoke(); }
})();
})();
