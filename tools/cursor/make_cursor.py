"""把 tools/cursor/*.svg 变成内嵌 CSS 的 32×32 光标。

两步（SVG 要用浏览器才渲得干净）：
  1) node ../link-station/render-cursor-svg.mjs   → cat-256.png / paw-256.png（透明底）
  2) python make_cursor.py                        → cat-white.png / paw-white.png + 重写 CSS 光标块

为什么不在 SVG 里直接当 cursor：浏览器对 SVG 光标的缩放和抗锯齿各家不一，
32×32 PNG 是都能吃下的稳妥形态；PNG 是从 256 的矢量渲染缩下来的，边缘依然干净。

热点不是拍脑袋：脚本自己量鼻尖（粉色像素最低一行）和掌垫重心，再写进 CSS。
"""
from __future__ import annotations

import base64
import pathlib

from PIL import Image

HERE = pathlib.Path(__file__).parent
CSS = HERE / "../../src/styles.css"
N = 32


def fit_square(img: Image.Image, pad: float = 0.05) -> Image.Image:
    """裁到内容边界，补成正方形（留一点边），保证 32px 里图形不贴边。"""
    img = img.crop(img.getbbox())
    side = int(max(img.size) * (1 + pad * 2))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return out


def downscale(path: pathlib.Path) -> Image.Image:
    return fit_square(Image.open(path).convert("RGBA")).resize((N, N), Image.LANCZOS)


def cat_hotspot(img: Image.Image) -> tuple[int, int]:
    """鼻尖：粉色像素的最低一行，横向取中点。"""
    pinks = [
        (x, y)
        for y in range(N)
        for x in range(N)
        if (lambda p: p[3] > 90 and p[0] > 150 and p[0] - p[1] > 30 and p[2] > p[1])(img.getpixel((x, y)))
    ]
    if not pinks:
        return (16, 21)
    tip_y = max(y for _, y in pinks)
    # 脸是左右对称的，横坐标直接取画布中心——重心法会被投影带偏 1px
    return (N // 2, tip_y)


def paw_hotspot(img: Image.Image) -> tuple[int, int]:
    """掌垫重心：下半部分的白色像素。"""
    pts = [
        (x, y)
        for y in range(N // 2, N)
        for x in range(N)
        if (lambda p: p[3] > 120 and p[0] > 200 and p[1] > 195)(img.getpixel((x, y)))
    ]
    if not pts:
        return (N // 2, 22)
    return (N // 2, round(sum(y for _, y in pts) / len(pts)))


def data_uri(path: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode()


def main() -> None:
    for name in ("cat-256.png", "paw-256.png"):
        if not (HERE / name).exists():
            raise SystemExit(f"缺 {name}：先跑 node ../link-station/render-cursor-svg.mjs")

    cat = downscale(HERE / "cat-256.png")
    paw = downscale(HERE / "paw-256.png")
    cat.save(HERE / "cat-white.png")
    paw.save(HERE / "paw-white.png")

    cat_hot = cat_hotspot(cat)
    paw_hot = paw_hotspot(paw)

    css = f"""
/* ---- 小猫光标（白猫）：默认是白猫脸，指向可点的地方换成白爪印 ----
   图形在 tools/cursor/cat.svg / paw.svg（矢量），用 Chromium 渲成 256 再缩到 32×32，
   渐变、腮红、投影都烘在 PNG 里；不用 emoji 字形，因为各系统字体渲染完全不一样。
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
    print(f"cat hotspot {cat_hot} | paw hotspot {paw_hot} | cat uri bytes {len(data_uri(HERE / 'cat-white.png'))}")


if __name__ == "__main__":
    main()
