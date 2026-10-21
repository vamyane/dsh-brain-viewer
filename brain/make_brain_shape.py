#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_brain_shape.py — 从系统 emoji 字体里提取真实大脑剪影，生成图谱用的「脑形模板」。

流程：
  渲染 🧠 → 找到外轮廓 → 自动识别并抹掉 emoji 下面的「脑干小尾巴」
  → 打平滑成一条完整的大脑轮廓 → 输出轮廓 + 亮/暗两套水印

产物 brain_shape.json：
  boundary  [[x,y], ...]  720 个极角对应的脑形轮廓（像素坐标，以图片中心为原点）
  size      [w, h]
  light/dark data:image/png 水印
  outline   [[x,y], ...]  同上，供画轮廓线
"""

import base64
import io
import json
import math
import pathlib
import statistics
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
OUT_JSON = ROOT / "brain_shape.json"
FONT = r"C:\Windows\Fonts\seguiemj.ttf"
CANVAS = (1400, 1200)
FONT_SIZE = 900
ANGLES = 720


def render_emoji() -> Image.Image:
    if not pathlib.Path(FONT).exists():
        raise SystemExit(f"找不到字体：{FONT}")
    font = ImageFont.truetype(FONT, FONT_SIZE)
    img = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((100, 80), "\U0001F9E0", font=font, embedded_color=True)
    bbox = img.getbbox()
    if not bbox:
        raise SystemExit("emoji 没渲染出来")
    return img.crop(bbox)


def raw_radii(img: Image.Image):
    w, h = img.size
    alpha = img.getchannel("A").load()
    cx, cy = w / 2.0, h / 2.0
    maxr = math.hypot(w, h) / 2.0
    radii = []
    for i in range(ANGLES):
        th = 2 * math.pi * i / ANGLES
        ct, st = math.cos(th), math.sin(th)
        hit = maxr * 0.8
        r = 2.0
        while r < maxr:
            x = int(round(cx + ct * r))
            y = int(round(cy + st * r))
            if x < 0 or y < 0 or x >= w or y >= h:
                hit = r
                break
            if alpha[x, y] < 128:
                hit = r
                break
            r += 1.5
        radii.append(hit)
    return radii


def drop_stem(radii):
    """emoji 右下方有一截「脑干小尾巴」，会把轮廓拉出一个尖。按角度区间削平它。"""
    n = len(radii)
    # 这段角度是这枚 emoji 的脑干区间（42°–68°，y 轴朝下）
    a0, a1 = int(42 / 360 * n), int(68 / 360 * n)
    out = list(radii)
    left = radii[(a0 - 1) % n]
    right = radii[(a1 + 1) % n]
    span = (a1 - a0) % n
    for k in range(span + 1):
        f = (k + 1) / (span + 2)
        out[(a0 + k) % n] = left * (1 - f) + right * f
    return out, list(range(a0, a0 + span + 1))


def smooth(radii, k=9, passes=2):
    n = len(radii)
    cur = list(radii)
    for _ in range(passes):
        nxt = []
        for i in range(n):
            acc = 0.0
            for j in range(-k, k + 1):
                acc += cur[(i + j) % n]
            nxt.append(acc / (2 * k + 1))
        cur = nxt
    return cur


def polygon(img_size, radii):
    w, h = img_size
    pts = []
    for i, r in enumerate(radii):
        th = 2 * math.pi * i / ANGLES
        pts.append((w / 2 + r * math.cos(th), h / 2 + r * math.sin(th)))
    return pts


def watermark(img: Image.Image, poly, fill, fill_op, fold_col, fold_op, line_col, line_op) -> str:
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    fold = mask_of(img)
    # 脑沟只取「边」：粗块变成细线，更像沟回
    fold_edge = ImageChops.subtract(fold, fold.filter(ImageFilter.MinFilter(11)))
    fold_edge = fold_edge.filter(ImageFilter.MaxFilter(3))

    fill_layer = Image.new("RGBA", (w, h), tuple(fill) + (255,))
    fill_layer.putalpha(mask.point(lambda v: int(v * fill_op)))

    fold_layer = Image.new("RGBA", (w, h), tuple(fold_col) + (255,))
    fold_layer.putalpha(ImageChops.multiply(fold_edge, mask).point(lambda v: int(v * fold_op)))

    line_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(line_layer)
    ld.line(list(poly) + [poly[0]], fill=tuple(line_col) + (int(255 * line_op),), width=3, joint="curve")

    out = Image.alpha_composite(fill_layer, fold_layer)
    out = Image.alpha_composite(out, line_layer)
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def mask_of(img: Image.Image):
    r, g, b, a = img.split()
    rm = r.point(lambda v: 255 if v > 200 else 0)
    gm = g.point(lambda v: 255 if v < 90 else 0)
    bm = b.point(lambda v: 255 if v > 100 else 0)
    return ImageChops.multiply(ImageChops.multiply(rm, gm), bm)


def main() -> int:
    img = render_emoji()
    w, h = img.size
    print(f"emoji bbox: {w}x{h}")

    radii = raw_radii(img)
    radii, cut = drop_stem(radii)
    radii = smooth(radii, k=11, passes=3)
    if cut:
        print(f"抹平脑干尾巴：{len(cut)} 个角度")
    poly = polygon((w, h), radii)

    light = watermark(img, poly, (203, 213, 229), 0.17, (152, 167, 192), 0.30, (108, 124, 148), 0.8)
    dark = watermark(img, poly, (30, 44, 68), 0.3, (86, 108, 145), 0.32, (120, 142, 178), 0.8)

    # 世界坐标里以图片中心为原点
    cx, cy = w / 2.0, h / 2.0
    boundary = [[round(x - cx, 1), round(y - cy, 1)] for x, y in poly]

    data = {
        "size": [w, h],
        "boundary": boundary,
        "light": light,
        "dark": dark,
    }
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {OUT_JSON} ({OUT_JSON.stat().st_size/1024:.0f} KB)")

    # 预览：白底 + 水印 + 轮廓
    prev = Image.new("RGBA", (w, h), (246, 248, 252, 255))
    prev = Image.alpha_composite(prev, Image.open(io.BytesIO(base64.b64decode(light.split(",", 1)[1]))).convert("RGBA"))
    d = ImageDraw.Draw(prev)
    d.line(list(poly) + [poly[0]], fill=(90, 105, 130), width=2)
    prev.convert("RGB").save(ROOT / "brain-shape-preview.png")
    print("-> brain-shape-preview.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
