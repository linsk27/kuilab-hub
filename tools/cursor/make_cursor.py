"""生成站内小猫光标（白猫脸 / 白爪印）。

要点：
1. 8 倍超采样画，再 LANCZOS 缩到 32×32 —— 浏览器光标的安全上限就是 32。
2. 白猫在纸色底上会糊，所以烘焙一层很淡的投影（暗色底上几乎看不见）。
3. 热点写进 CSS：猫脸对准鼻尖、爪印对准掌垫中心，位置由本脚本测量后输出。

用法：python make_cursor.py   （会同时重写 src/styles.css 末尾的光标块）
"""
from __future__ import annotations

import base64
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 8                      # 超采样倍数
N = 32                     # 输出边长（CSS px）
OUT = (54, 47, 40, 255)    # 暖黑描边
FUR = (253, 251, 248, 255)
SHADE = (230, 219, 207, 255)
PINK = (238, 156, 170, 255)
PINK_SOFT = (247, 205, 210, 120)
EYE = (110, 180, 217, 255)
EYE_LINE = (44, 62, 74, 255)
MOUTH = (126, 113, 100, 255)

HERE = pathlib.Path(__file__).parent
CSS = HERE / "../../src/styles.css"


def sc(*vals: float) -> tuple[int, ...]:
    return tuple(round(v * S) for v in vals)


def w(px: float) -> int:
    return max(1, round(px * S))


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (N * S, N * S), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def face() -> Image.Image:
    img, d = canvas()

    # 耳朵：三角压在头顶两角，根部被头盖住
    d.polygon([sc(7.0, 11.8), sc(7.4, 4.2), sc(13.6, 8.4)], fill=FUR, outline=OUT, width=w(1.0))
    d.polygon([sc(25.0, 11.8), sc(24.6, 4.2), sc(18.4, 8.4)], fill=FUR, outline=OUT, width=w(1.0))
    d.polygon([sc(8.9, 10.3), sc(9.1, 6.8), sc(12.2, 8.9)], fill=PINK)
    d.polygon([sc(23.1, 10.3), sc(22.9, 6.8), sc(19.8, 8.9)], fill=PINK)

    # 头
    d.ellipse(sc(6.6, 9.2, 25.4, 28.4), fill=FUR, outline=OUT, width=w(1.25))
    # 下巴的淡阴影，让白脸不是一块平色
    d.ellipse(sc(10.2, 22.4, 21.8, 28.0), fill=SHADE)
    d.ellipse(sc(6.9, 9.6, 25.1, 27.2), fill=FUR)

    # 眼睛：天蓝 + 细描边 + 白高光（32px 下不塞深色瞳孔，否则糊成黑点）
    for cx in (12.5, 19.5):
        d.ellipse(sc(cx - 1.5, 17.0, cx + 1.5, 21.0), fill=EYE, outline=EYE_LINE, width=w(0.7))
        d.ellipse(sc(cx - 1.0, 17.6, cx - 0.15, 18.5), fill=(255, 255, 255, 255))

    # 腮红
    d.ellipse(sc(8.8, 20.4, 11.6, 22.2), fill=PINK_SOFT)
    d.ellipse(sc(20.4, 20.4, 23.2, 22.2), fill=PINK_SOFT)

    # 鼻子（不带描边，带描边会糊成一个黑点）+ 两撇很淡的嘴
    d.polygon([sc(14.8, 20.5), sc(17.2, 20.5), sc(16.0, 21.6)], fill=PINK)
    d.line([sc(16.0, 21.6), sc(15.2, 22.5)], fill=MOUTH, width=w(0.7))
    d.line([sc(16.0, 21.6), sc(16.8, 22.5)], fill=MOUTH, width=w(0.7))

    return img


def paw() -> Image.Image:
    img, d = canvas()
    d.ellipse(sc(11.2, 17.6, 20.8, 26.8), fill=FUR, outline=OUT, width=w(1.15))
    for cx, cy, r in [(10.0, 13.4, 2.5), (13.9, 10.6, 2.4), (18.1, 10.6, 2.4), (22.0, 13.4, 2.5)]:
        d.ellipse(sc(cx - r, cy - r, cx + r, cy + r), fill=FUR, outline=OUT, width=w(1.15))
    return img


def with_shadow(img: Image.Image) -> Image.Image:
    """用 alpha 通道做一层极淡的投影：纸色底上把白猫托出来，墨色底上几乎看不见。"""
    alpha = img.getchannel("A")
    shadow = Image.new("RGBA", img.size, (58, 48, 38, 0))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(S * 0.9)).point(lambda a: int(a * 0.42)))
    shadow = ImageChops.offset(shadow, 0, round(S * 1.1))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(img)
    return out


def measurements(face_img: Image.Image) -> dict[str, tuple[int, int]]:
    """把热点量出来，别拍脑袋：猫脸取鼻尖，爪印取掌垫中心。"""
    pink_rows = [
        y
        for y in range(14, 28)
        for x in range(13, 20)
        if (lambda p: p[3] > 80 and p[0] > 150 and p[0] - p[1] > 25 and p[2] < p[0])(face_img.getpixel((x, y)))
    ]
    return {"cat": (16, max(pink_rows))}


def data_uri(path: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> None:
    face_out = with_shadow(face()).resize((N, N), Image.LANCZOS)
    paw_out = with_shadow(paw()).resize((N, N), Image.LANCZOS)
    face_out.save(HERE / "cat-white.png")
    paw_out.save(HERE / "paw-white.png")

    # 热点：猫脸 = 鼻尖那一行；爪印 = 掌垫中心
    cat_hot = measurements(face().resize((N, N), Image.LANCZOS))["cat"]
    paw_hot = (16, 22)

    css = f"""
/* ---- 小猫光标（白猫）：默认是白猫脸，指向可点的地方换成白爪印 ----
   图片由 tools/cursor/make_cursor.py 生成：8 倍超采样画好再缩到 32×32（浏览器光标的安全上限），
   描边+极淡投影，纸色 / 墨色两套主题下都立得住；不用 emoji 字形，因为各系统字体渲染完全不一样。
   热点：猫脸对准鼻尖（{cat_hot[0]} {cat_hot[1]}）、爪印对准掌垫中心（{paw_hot[0]} {paw_hot[1]}）—— 猫鼻子指哪儿就点哪儿。 */
:root{{
  --cursor-cat:url("{data_uri(HERE / 'cat-white.png')}") {cat_hot[0]} {cat_hot[1]}, auto;
  --cursor-paw:url("{data_uri(HERE / 'paw-white.png')}") {paw_hot[0]} {paw_hot[1]}, pointer;
}}
html, body{{cursor:var(--cursor-cat)}}
a, button, [role="button"], summary, select{{cursor:var(--cursor-paw)}}
input, textarea, [contenteditable="true"]{{cursor:text}}
"""

    src = CSS.read_text(encoding="utf-8")
    marker = "/* ---- 小猫光标"
    if marker in src:
        src = src[: src.index(marker)].rstrip() + "\n"
    CSS.write_text(src + css, encoding="utf-8")
    print("cat hotspot", cat_hot, "| paw hotspot", paw_hot)


if __name__ == "__main__":
    main()
