# 把 tools/docs/shots.mjs 截下来的逐帧图拼成 README 用的动图。
# 用法：python tools/docs/make_gifs.py <逐帧目录> <出图目录>
# 每个场景一个子目录（000.png、001.png……）；缩小一点、共用一套调色板，免得颜色一帧一帧闪。
import sys
from pathlib import Path
from PIL import Image

# 场景：缩放、每帧毫秒（截帧是每 1/15 或 1/10 秒一张）、末帧多停一会儿
SCENES = {
    'walk': (0.5, 66, 600),
    'wake': (0.6, 100, 900),
    'petting': (0.6, 66, 500),
    'eat': (0.5, 66, 700),
    'courier': (0.5, 66, 300),
}


def build(src: Path, out: Path, scale: float, ms: int, tail: int) -> None:
    files = sorted(src.glob('*.png'))
    if not files:
        raise SystemExit(f'{src} 里没有帧')
    frames = []
    for f in files:
        im = Image.open(f).convert('RGB')
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
        frames.append(im)
    # 用中间几帧拼一张图来定调色板，所有帧共用
    w, h = frames[0].size
    probe = Image.new('RGB', (w, h * 4))
    for i, k in enumerate(range(0, len(frames), max(1, len(frames) // 4))):
        if i < 4:
            probe.paste(frames[k], (0, h * i))
    pal = probe.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    durations = [ms] * len(q)
    durations[-1] = tail
    q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(f'[docs] {out.name}: {len(q)} frames {w}x{h} {out.stat().st_size // 1024} KB')


# 静态图（总图、横幅、窗口截图）无损重压一遍。不转 256 色：渐变和窗口阴影会出色带
def shrink_png(f: Path) -> None:
    before = f.stat().st_size
    Image.open(f).save(f, optimize=True, compress_level=9)
    print(f'[docs] {f.name}: {before // 1024} KB -> {f.stat().st_size // 1024} KB')


def main() -> None:
    frames_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    for name, (scale, ms, tail) in SCENES.items():
        d = frames_dir / name
        if d.is_dir():
            build(d, out_dir / f'{name}.gif', scale, ms, tail)
    for f in sorted(out_dir.glob('*.png')):
        shrink_png(f)


if __name__ == '__main__':
    main()
