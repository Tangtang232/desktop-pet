# 把霞鹜文楷裁成常用字（GB2312 的全部字符 + ASCII + 常用标点），转成 woff2，并改名为 PetHand（OFL 保留字体名的要求）
import sys
from fontTools import subset
from fontTools.ttLib import TTFont

src, out = sys.argv[1], sys.argv[2]
chars = set(range(0x20, 0x7F))
for b1 in range(0xA1, 0xF8):
    for b2 in range(0xA1, 0xFF):
        try:
            chars.add(ord(bytes([b1, b2]).decode('gb2312')))
        except Exception:
            pass
chars |= set(map(ord, '～·—–…“”‘’「」『』〈〉《》【】〔〕￥€°×÷♥♡☆★→←↑↓✓✔'))
opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.name_languages = ['*']
opts.notdef_outline = True
opts.hinting = False
font = TTFont(src)
sub = subset.Subsetter(opts)
sub.populate(unicodes=chars)
sub.subset(font)
for rec in font['name'].names:
    if rec.nameID in (1, 4, 16, 18, 21):
        rec.string = 'PetHand'
    elif rec.nameID == 6:
        rec.string = 'PetHand-Regular'
    elif rec.nameID == 3:
        rec.string = 'PetHand-Regular;desktop-pet subset of LXGW WenKai 1.530'
font.save(out)
cmap = TTFont(out).getBestCmap()
print('glyphs', len(cmap), 'requested', len(chars))
