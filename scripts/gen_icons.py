"""生成 PWA 图标：纯图形（文档+折角+横线），不依赖中文字体。
品牌色 indigo-600 #4F46E5，白色文档，slate-200 横线。
"""
from PIL import Image, ImageDraw

BG = (79, 70, 229, 255)          # indigo-600
WHITE = (255, 255, 255, 255)
SOFT = (203, 213, 225, 255)      # slate-300 横线
INDIGO = (79, 70, 229, 255)


def rounded_rect(draw, box, r, fill):
    draw.rounded_rectangle(box, radius=r, fill=fill)


def make_icon(size, maskable):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    s = size / 512.0

    if maskable:
        # 安全区：内容限制在中心 80%
        x0, y0 = int(size * 0.12), int(size * 0.12)
        x1, y1 = int(size * 0.88), int(size * 0.88)
    else:
        x0, y0 = int(size * 0.20), int(size * 0.16)
        x1, y1 = int(size * 0.80), int(size * 0.84)

    doc_w = x1 - x0
    doc_h = y1 - y0

    # 白色文档底
    rounded_rect(d, [x0, y0, x1, y1], int(30 * s), WHITE)

    # 折角（右上）：在文档右上画一个 bg 色小三角，制造折角感
    fold = int(doc_w * 0.22)
    d.polygon(
        [(x1 - fold, y0), (x1, y0), (x1, y0 + fold)],
        fill=BG,
    )
    d.line([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=(226, 232, 240, 255), width=max(1, int(2 * s)))

    # 文档内横线
    pad = int(doc_w * 0.16)
    lx0 = x0 + pad
    lx1 = x1 - pad
    top = y0 + int(doc_h * 0.20)
    gap = int(doc_h * 0.17)

    # 标题行：indigo，较短
    d.rounded_rectangle(
        [lx0, top, lx0 + int((lx1 - lx0) * 0.5), top + int(12 * s)],
        radius=int(6 * s), fill=INDIGO,
    )
    # 正文行：slate
    for i in range(1, 4):
        y = top + gap * i
        if y > y1 - int(doc_h * 0.12):
            break
        end = lx1 if i < 3 else lx0 + int((lx1 - lx0) * 0.8)
        d.rounded_rectangle([lx0, y, end, y + int(9 * s)], radius=int(4 * s), fill=SOFT)

    return img


targets = {
    "public/icons/icon-192.png": (192, False),
    "public/icons/icon-512.png": (512, False),
    "public/icons/icon-maskable-512.png": (512, True),
}

for path, (sz, mask) in targets.items():
    make_icon(sz, mask).save(path)
    print("generated", path)
