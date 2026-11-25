"""把侧面比格拆成零件：去背景、去鼠标指针、按多边形切零件、补被挡住的地方、放大 3 倍导出。

用法：python tools/build_parts.py，产物在 tools/out/；把 tools/out/parts.json 包成 assets/beagle/parts.js。
这是用一张 200 像素截图凑出来的临时零件，正式美术零件到位后由分层文件导入替代。
"""
import json, base64, io, os
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'beagle', 'source_side.png')   # 原图里裁出来的侧面比格
HERE = os.path.join(ROOT, 'tools', 'out')                          # 中间产物
os.makedirs(HERE, exist_ok=True)
crop = Image.open(SRC).convert('RGBA')
A = np.array(crop).astype(np.float32)
H, W = A.shape[:2]
rgb = A[..., :3].copy()
mx, mn = rgb.max(-1), rgb.min(-1)

# ---------- 1. 去背景：从边缘洪水填充近白、低饱和的像素 ----------
cand = (mn > 196) & ((mx - mn) < 24)
yy = np.arange(H)[:, None].repeat(W, 1)
cand |= (yy > 162) & (mn > 165) & ((mx - mn) < 28)   # 脚下的地面阴影
bg = np.zeros((H, W), bool)
q = deque()
for (y, x) in ((150, 95), (140, 100), (160, 85)):        # 四条腿之间被围住的背景
    if cand[y, x]:
        bg[y, x] = True; q.append((y, x))
for x in range(W):
    for y in (0, H - 1):
        if cand[y, x] and not bg[y, x]:
            bg[y, x] = True; q.append((y, x))
for y in range(H):
    for x in (0, W - 1):
        if cand[y, x] and not bg[y, x]:
            bg[y, x] = True; q.append((y, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < H and 0 <= nx < W and cand[ny, nx] and not bg[ny, nx]:
            bg[ny, nx] = True; q.append((ny, nx))
fg = ~bg
alpha = fg.astype(np.float32)
# 边缘一圈浅色像素做半透明，减少白边
edge = fg & (np.roll(bg, 1, 0) | np.roll(bg, -1, 0) | np.roll(bg, 1, 1) | np.roll(bg, -1, 1))
alpha[edge & (mn > 185)] = 0.45
alpha[edge & (mn <= 185)] = 0.85


def inpaint(rgb, fill, known, iters=900):
    """扩散补色：fill 区域的颜色由 known 区域一圈圈往里推。"""
    val = rgb.copy(); val[fill] = 0
    valid = known.copy()
    for _ in range(iters):
        s = np.zeros_like(val); c = np.zeros(val.shape[:2], np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sv = np.roll(val, (dy, dx), (0, 1)); sc = np.roll(valid, (dy, dx), (0, 1)).astype(np.float32)
            s += sv * sc[..., None]; c += sc
        upd = fill & (c > 0)
        val[upd] = s[upd] / c[upd][:, None]
        valid = valid | upd
    return val


# ---------- 2. 去掉截图里的鼠标指针 ----------
cur = np.zeros((H, W), bool)
cur[84:114, 35:56] = True
cur &= (((mx < 62) & ((mx - mn) < 12)) | (mn > 238)) & fg
d = cur.copy()
for _ in range(2):
    e = d.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        e |= np.roll(d, (dy, dx), (0, 1))
    d = e
cur = d & fg
rgb = inpaint(rgb, cur, fg & ~cur, 300)


# ---------- 3. 零件多边形（裁剪图坐标） ----------
def mask(poly, ss=4):
    im = Image.new('L', (W * ss, H * ss), 0)
    ImageDraw.Draw(im).polygon([(x * ss, y * ss) for x, y in poly], fill=255)
    return np.array(im.resize((W, H), Image.BOX)).astype(np.float32) / 255


P = {
    'tail': [(8, 58), (12, 51), (20, 50), (25, 57), (28, 66), (34, 72), (43, 75), (52, 78), (52, 92), (40, 93), (29, 89), (19, 82), (11, 72)],
    'body': [(36, 126), (32, 112), (33, 100), (37, 91), (43, 83), (50, 78), (65, 74), (90, 72), (110, 70), (124, 63), (134, 56), (142, 50),
             (152, 50), (164, 60), (170, 72), (169, 90), (167, 106), (163, 119), (150, 123), (136, 123), (122, 122), (112, 125), (100, 130),
             (85, 131), (70, 128), (58, 126), (48, 129)],
    'head': [(137, 14), (150, 8), (168, 8), (180, 14), (188, 25), (197, 31), (206, 33), (211, 40), (206, 49), (202, 55), (206, 60), (205, 72),
             (194, 73), (184, 72), (176, 76), (168, 81), (158, 84), (148, 83), (141, 75), (136, 63), (133, 49), (132, 35), (134, 23), (139, 15)],
    'ear': [(151, 12), (141, 14), (133, 20), (127, 31), (122, 45), (121, 58), (124, 70), (131, 79), (142, 83), (153, 83), (161, 78), (164, 66),
            (164, 50), (162, 36), (159, 23), (156, 15)],
    'hn': [(25, 112), (48, 112), (51, 128), (48, 140), (47, 152), (49, 162), (47, 171), (36, 172), (23, 170), (19, 163), (21, 150), (22, 134)],
    'hf': [(41, 114), (63, 114), (69, 134), (71, 150), (74, 160), (73, 169), (60, 170), (49, 169), (47, 160), (45, 150), (43, 134)],
    'fn': [(115, 106), (147, 106), (149, 125), (147, 140), (148, 155), (150, 165), (147, 172), (132, 174), (120, 171), (118, 160), (117, 145), (116, 128)],
    'ff': [(139, 106), (161, 106), (163, 125), (161, 140), (162, 152), (164, 162), (159, 169), (146, 170), (141, 160), (144, 150), (145, 135), (143, 120)],
}
M = {k: mask(v) for k, v in P.items()}
# 耳朵下沿：去掉混进来的深色脖子像素
dark = (mx < 115)
zone = np.zeros((H, W), bool); zone[60:H, 0:142] = True
M['ear'] = M['ear'] * ~(dark & zone)

# ---------- 4. 每层的像素和要补画的区域 ----------
layers = {}


def make(name, m, fill=None, known_extra=None):
    a = alpha * m
    col = rgb.copy()
    if fill is not None and fill.any():
        known = (m > .5) & fg & ~fill
        col = inpaint(rgb, fill, known)
        a = np.maximum(a, (fill & (m > .5)).astype(np.float32) * m)
    layers[name] = np.dstack([col, a * 255]).clip(0, 255).astype(np.uint8)


hard = {k: v > .5 for k, v in M.items()}
make('tail', M['tail'])
make('body', M['body'], fill=(hard['ear'] | hard['head']) & hard['body'])
make('head', M['head'], fill=hard['ear'] & hard['head'])
_ss = 4
_ol = Image.new('RGBA', (W * _ss, H * _ss), (0, 0, 0, 0))
_pts = [(146, 10), (139, 15), (134, 23), (132, 35), (133, 49), (136, 63), (141, 75), (147, 82)]
ImageDraw.Draw(_ol).line([(x * _ss, y * _ss) for x, y in _pts], fill=(140, 88, 52, 235), width=int(1.1 * _ss), joint='curve')
_ol = np.array(_ol.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
_hl = layers['head'].astype(np.float32) / 255
_a = _ol[..., 3:4] * (_hl[..., 3:4] > 0.05)
_hl[..., :3] = _ol[..., :3] * _a + _hl[..., :3] * (1 - _a)
layers['head'] = (_hl * 255).clip(0, 255).astype(np.uint8)
make('ear', M['ear'])
make('hn', M['hn'])
make('fn', M['fn'])
make('hf', M['hf'], fill=hard['hf'] & hard['hn'])
make('ff', M['ff'], fill=hard['ff'] & hard['fn'])

# ---------- 5. 检查：按层叠顺序拼回去，和原图对比，看有没有漏掉的地方 ----------
order = ['hf', 'ff', 'hn', 'fn', 'tail', 'body', 'head', 'ear']
comp = np.zeros((H, W, 4), np.float32)
for k in order:
    L = layers[k].astype(np.float32) / 255
    a = L[..., 3:4]
    comp[..., :3] = L[..., :3] * a + comp[..., :3] * (1 - a)
    comp[..., 3:4] = a + comp[..., 3:4] * (1 - a)
cover = comp[..., 3]
miss = fg & (cover < .5)
print('未覆盖的前景像素:', int(miss.sum()))
vis = np.array(crop).copy()
vis[miss] = [255, 0, 255, 255]
Image.fromarray(vis).resize((W * 3, H * 3), Image.NEAREST).save(f'{HERE}/coverage.png')
Image.fromarray((comp * 255).astype(np.uint8)).resize((W * 3, H * 3), Image.LANCZOS).save(f'{HERE}/recomposed.png')

# ---------- 6. 放大 3 倍、裁到包围盒、导出 ----------
S = 3
out = {'scale': S, 'parts': {}}
for k in order:
    im = Image.fromarray(layers[k], 'RGBA').convert('RGBa').resize((W * S, H * S), Image.LANCZOS).convert('RGBA')
    bb = im.getbbox()
    pad = 2
    bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W * S, bb[2] + pad), min(H * S, bb[3] + pad))
    part = im.crop(bb)
    part.save(f'{HERE}/part_{k}.png')
    buf = io.BytesIO(); part.save(buf, 'PNG', optimize=True)
    out['parts'][k] = {'x': bb[0], 'y': bb[1], 'w': part.width, 'h': part.height,
                       'src': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}
# 眼睛位置和眼皮颜色（裁剪图坐标）
lid = rgb[29:34, 165:169].reshape(-1, 3).mean(0)
out['eye'] = {'cx': 176, 'cy': 34, 'rx': 7.2, 'ry': 6.0, 'rot': -12, 'lid': [int(v) for v in lid]}
json.dump(out, open(f'{HERE}/parts.json', 'w'))
print({k: (v['w'], v['h']) for k, v in out['parts'].items()})
print('lid color', out['eye']['lid'])
