"""把 hd-library 里的高清分层素材打包成程序直接用的数据文件。

做的事：
  1. 读 ages/<age>/layered/<pose>/rig.json、face/placement.json、props/props.json、review/puppy-note/composition.json
  2. 每张图按预乘透明度缩到运行尺寸（默认 0.5），避免缩小时边缘发黑或发白
  3. 编成 WebP（颜色有损 q90、透明通道无损）的 data URL，写进一个 JS 文件，页面用 <script> 直接加载
     （不用 fetch 读本地文件，也不会因为跨源把画布弄脏）

用法：python tools/build_hd.py [--age puppy] [--scale 0.5]
输出：assets/beagle/<age>/rig-data.js  ->  window.BEAGLE_HD
"""
import argparse
import base64
import io
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'assets', 'beagle', 'hd-library')
POSES = ['stand', 'sit', 'prone', 'sleep']
# turn（正面转身）不打包：2026-11-25 试过，转身时出现正脸看着怪，改回原地翻面
TRANSITIONS = ['crouch', 'lie-down', 'curl']
POINT_KEYS = ['pivot', 'joint', 'foot', 'tip', 'chest', 'hip', 'belly', 'neckBase']


def load_rgba(path):
    im = Image.open(path)
    return im.convert('RGBA')


def shrink(im, scale):
    """预乘透明度后再缩放，缩完再还原，边缘颜色才干净。"""
    if abs(scale - 1) < 1e-6:
        return im
    w = max(1, round(im.width * scale))
    h = max(1, round(im.height * scale))
    return im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')


def data_url(im):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=90, alpha_quality=100, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


def alpha_bbox(im, x, y):
    box = im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
    if not box:
        return None
    return [x + box[0], y + box[1], x + box[2], y + box[3]]


def pt(p):
    return [p['x'], p['y']] if p else None


def build(age, scale):
    base = os.path.join(LIB, 'ages', age)
    face_dir = os.path.join(base, 'face')
    placement = json.load(open(os.path.join(face_dir, 'placement.json'), encoding='utf-8'))
    total = 0
    out = {'version': 1, 'age': age, 'texScale': scale, 'poses': {}, 'face': None, 'props': {}, 'note': None}

    available_transitions = [pose for pose in TRANSITIONS
                             if os.path.isdir(os.path.join(base, 'layered', pose))]
    for pose in POSES + available_transitions:
        pdir = os.path.join(base, 'layered', pose)
        rig = json.load(open(os.path.join(pdir, 'rig.json'), encoding='utf-8'))
        layers = []
        union = None
        for L in rig['layers']:
            src_path = os.path.normpath(os.path.join(pdir, L['file']))
            im = load_rgba(src_path)
            if im.size != (L['width'], L['height']):
                print(f'  ! {pose}/{L["id"]} 图片尺寸 {im.size} 和 rig 写的 {L["width"]}x{L["height"]} 不一致', file=sys.stderr)
            shared_head = L['id'] == 'head' and 'face' in L['file'].replace('\\', '/').split('/')
            item = {
                'id': L['id'], 'parent': L.get('parent'),
                'x': L['x'], 'y': L['y'], 'w': L['width'], 'h': L['height'],
                'rotation': L.get('rotation', 0) or 0,
            }
            for k in POINT_KEYS:
                if k in L:
                    item[k] = pt(L[k])
            if 'chain' in L:
                item['chain'] = [pt(p) for p in L['chain']]
            if shared_head:
                item['shared'] = True          # 用 face.head，再叠眼睛和嘴
            else:
                url = data_url(shrink(im, scale))
                total += len(url)
                item['src'] = url
            layers.append(item)
            if L['id'] != 'head' or not item['rotation']:
                bb = alpha_bbox(im, L['x'], L['y'])
            else:
                bb = [L['x'], L['y'], L['x'] + L['width'], L['y'] + L['height']]
            if bb:
                union = bb if union is None else [min(union[0], bb[0]), min(union[1], bb[1]), max(union[2], bb[2]), max(union[3], bb[3])]
        out['poses'][pose] = {
            'canvas': [rig['canvas']['width'], rig['canvas']['height']],
            'ground': rig['ground'],
            'bbox': union,
            'face': (rig.get('face') or {}).get('default'),
            'layers': layers,
        }
        if 'facePoints' in rig:
            out['poses'][pose]['facePoints'] = {name: pt(p) for name, p in rig['facePoints'].items()}
        print(f'  {pose}: {len(layers)} 层，范围 {union}，地面 {rig["ground"]}')

    def face_img(rel):
        nonlocal total
        url = data_url(shrink(load_rgba(os.path.join(face_dir, rel)), scale))
        total += len(url)
        return url

    face = {
        'w': placement['canvas']['width'], 'h': placement['canvas']['height'],
        'head': face_img(placement['head']),
        'eyes': {}, 'mouths': {},
        'points': {k: pt(v) for k, v in placement['points'].items()},
    }
    for group in ('eyes', 'mouths'):
        for name, e in placement[group].items():
            face[group][name] = {'x': e['x'], 'y': e['y'], 'w': e['width'], 'h': e['height'], 'src': face_img(e['file'])}
    out['face'] = face

    props_dir = os.path.join(LIB, 'props')
    props = json.load(open(os.path.join(props_dir, 'props.json'), encoding='utf-8'))
    for name, p in props['items'].items():
        im = load_rgba(os.path.join(props_dir, p['file']))
        s = 0.25
        url = data_url(shrink(im, s))
        total += len(url)
        out['props'][name] = {'w': p['width'], 'h': p['height'], 'anchors': {k: pt(v) for k, v in p.get('anchors', {}).items()}, 'src': url}

    comp_path = os.path.join(LIB, 'review', 'puppy-note', 'composition.json')
    if os.path.exists(comp_path):
        comp = json.load(open(comp_path, encoding='utf-8'))
        pt_ = comp['propTransform']
        out['note'] = {
            'width': pt_['width'], 'grip': pt(pt_['grip']), 'rotation': pt_.get('rotation', 0),
            'dx': pt_.get('dx', 0), 'dy': pt_.get('dy', 0), 'lipClip': pt_.get('upperLipClip'),
            'eyes': comp.get('eyes'), 'mouth': comp.get('mouth'),
        }
        out['earRange'] = comp.get('earRangeDegrees', [-12, 12])

    dst_dir = os.path.join(ROOT, 'assets', 'beagle', age)
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, 'rig-data.js')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('// 由 tools/build_hd.py 生成，别手改。源素材在 assets/beagle/hd-library。\n')
        f.write('window.BEAGLE_HD = ')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'写出 {os.path.relpath(dst, ROOT)}，图片数据 {total / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--age', default='puppy')
    ap.add_argument('--scale', type=float, default=0.5)
    a = ap.parse_args()
    build(a.age, a.scale)
