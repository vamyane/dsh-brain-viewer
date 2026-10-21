#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_graph.py — 扫描 vault/ 里的 Markdown 双链笔记，生成关系图谱数据与可视化页面。

用法：
    python build_graph.py                # 生成 graph.json + brain.html
    python build_graph.py --open         # 生成后用默认浏览器打开 brain.html

产物：
    graph.json   节点/连线/坐标（可给自己写别的可视化用）
    brain.html   自包含单页（数据已内嵌，双击即可打开，不需要服务器）
"""

import argparse
import datetime as dt
import json
import math
import pathlib
import random
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
VAULT = ROOT / "vault"
TEMPLATE = ROOT / "viewer_template.html"
OUT_JSON = ROOT / "graph.json"
OUT_HTML = ROOT / "brain.html"
SHAPE_FILE = ROOT / "brain_shape.json"

LINK_RE = re.compile(r"\[\[([^\[\]]+?)\]\]")
GOLDEN = 2.399963229728653

# 这些类型算「核心节点」，其余（episode / source）是挂在核心节点上的叶子
HUB_KINDS = {"project", "concept", "tool", "person", "decision", "preference", "skill"}


# ---------------------------------------------------------------- 解析
def split_front(text: str):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    raw = text[3:end].strip("\n")
    body = text[end + 4:]
    meta = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        meta[k.strip()] = v.strip()
    return meta, body


def parse_tags(v: str):
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    return [x.strip().strip('"').strip("'") for x in v.split(",") if x.strip()]


def excerpt_of(body: str, limit=110):
    for line in body.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith("**关联**") or s.startswith("关联："):
            continue
        s = s.lstrip("#> ").strip()
        s = s.replace("**", "").replace("`", "")
        if len(s) > limit:
            s = s[:limit] + "…"
        return s
    return ""


def load_notes():
    notes = []
    for path in sorted(VAULT.rglob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="ignore")
        meta, body = split_front(text)
        title = path.stem
        kind = meta.get("type", "episode").strip() or "episode"
        links = [m.split("|")[0].strip() for m in LINK_RE.findall(body)]
        notes.append({
            "title": title,
            "kind": kind,
            "tags": parse_tags(meta.get("tags", "")),
            "date": meta.get("date", meta.get("updated", "")),
            "orig": meta.get("orig", "").strip(),
            "body": body,
            "links": links,
            "path": (path.relative_to(ROOT).as_posix() if str(path).startswith(str(ROOT)) else "vault/" + path.relative_to(VAULT).as_posix()),
        })
    return notes


# ---------------------------------------------------------------- 布局
def separate(pos, radii, gap=120.0, iters=260):
    n = len(pos)
    for _ in range(iters):
        moved = False
        for i in range(n):
            for j in range(i + 1, n):
                dx = pos[j][0] - pos[i][0]
                dy = pos[j][1] - pos[i][1]
                d = math.sqrt(dx * dx + dy * dy) or 0.01
                need = radii[i] + radii[j] + gap
                if d < need:
                    push = (need - d) * 0.52
                    ux, uy = dx / d, dy / d
                    pos[i][0] -= ux * push
                    pos[i][1] -= uy * push
                    pos[j][0] += ux * push
                    pos[j][1] += uy * push
                    moved = True
        if not moved:
            break
    return pos


def load_shape():
    if not SHAPE_FILE.exists():
        return None
    try:
        return json.loads(SHAPE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def remap_brain(world, shape):
    """把已经算好的星团布局，按极角「压」进大脑剪影里。"""
    radii = [math.hypot(x, y) for x, y in shape["boundary"]]
    n = len(radii)
    xs = [p[0] for p in world.values()]
    ys = [p[1] for p in world.values()]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    maxr = max(math.hypot(p[0] - cx, p[1] - cy) for p in world.values()) or 1.0
    out = {}
    for i, (x, y) in world.items():
        dx, dy = x - cx, y - cy
        r = math.hypot(dx, dy)
        u = min(1.0, r / maxr)
        th = math.atan2(dy, dx)
        pos = ((th + math.pi * 2) % (math.pi * 2)) / (math.pi * 2) * n
        i0 = int(pos) % n
        i1 = (i0 + 1) % n
        f = pos - int(pos)
        B = radii[i0] * (1 - f) + radii[i1] * f
        nr = u * B * 0.94
        out[i] = [nr * math.cos(th), nr * math.sin(th)]
    return out


def shape_boundary(shape):
    radii = [math.hypot(x, y) for x, y in shape["boundary"]]
    n = len(radii)

    def B(th):
        pos = ((th + math.pi * 2) % (math.pi * 2)) / (math.pi * 2) * n
        i0 = int(pos) % n
        i1 = (i0 + 1) % n
        f = pos - int(pos)
        return radii[i0] * (1 - f) + radii[i1] * f

    return B


def shape_area(shape):
    pts = shape["boundary"]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def layout_in_shape(notes, hub_ids, cluster_ids, sat_ids, children, neighbors, shape, rng):
    """把簇中心当成「圆盘」塞进脑形里，叶子再围绕簇中心铺开，保证整张图填满脑形。"""
    B = shape_boundary(shape)
    sw, sh = shape["size"]
    hub_set = set(hub_ids)

    def clear(x, y, r, margin=0.985):
        return math.hypot(x, y) + r <= B(math.atan2(y, x)) * margin

    # 候选网格
    step = 13
    grid = []
    gy = -sh / 2 + step
    while gy < sh / 2 - step:
        gx = -sw / 2 + step
        while gx < sw / 2 - step:
            if clear(gx, gy, 0, 0.99):
                grid.append((gx, gy))
            gx += step
        gy += step
    rng.shuffle(grid)

    world = {}
    placed = []  # (x, y, r)

    def find_spot(r, margin=0.985):
        best, best_d = None, -1e9
        for (x, y) in grid:
            if not clear(x, y, r, margin):
                continue
            dmin = 1e9
            for (px, py, pr) in placed:
                d = math.hypot(x - px, y - py) - pr
                if d < dmin:
                    dmin = d
            if dmin >= r * 0.2 + 2:
                return x, y
            if dmin > best_d:
                best_d, best = dmin, (x, y)
        return best or (0.0, 0.0)

    # 1) 簇中心：按「脑形面积 / 叶子数」自动算密度，大簇优先
    area = shape_area(shape)
    leaf_total = sum(len(children[idx]) for idx in cluster_ids) or 1
    spacing = max(4.5, math.sqrt(0.86 * area / leaf_total))
    radii = {idx: max(spacing * 3.2, spacing * math.sqrt((len(children[idx]) + 1) / math.pi))
             for idx in cluster_ids}
    for idx in sorted(cluster_ids, key=lambda i: -radii[i]):
        x, y = find_spot(radii[idx])
        world[idx] = [x, y]
        placed.append((x, y, radii[idx]))

    # 2) 卫星概念：优先贴着它连接最多的簇
    cluster_set = set(cluster_ids)
    sat_sorted = sorted(sat_ids, key=lambda i: -len(neighbors[i]))
    sr = spacing * 2.1
    for idx in sat_sorted:
        nbs = [j for j in neighbors[idx] if j in cluster_set and j in world]
        nbs.sort(key=lambda j: -len(neighbors[j]))
        ok = False
        if nbs:
            for _ in range(80):
                base = nbs[0] if rng.random() < 0.7 else nbs[rng.randrange(len(nbs))]
                bx, by = world[base]
                ang = rng.uniform(0, 2 * math.pi)
                dist = radii[base] + sr + 6 + rng.uniform(0, 26)
                x, y = bx + dist * math.cos(ang), by + dist * math.sin(ang)
                if not clear(x, y, sr, 0.96):
                    continue
                if any(math.hypot(x - px, y - py) < sr + pr + 1 for (px, py, pr) in placed):
                    continue
                world[idx] = [x, y]
                placed.append((x, y, sr))
                ok = True
                break
        if not ok:
            x, y = find_spot(sr, 0.96)
            world[idx] = [x, y]
            placed.append((x, y, sr))

    # 3) 叶子：围绕簇中心的向日葵，越界的收回来
    for idx in cluster_ids:
        px, py = world[idx]
        kids = children[idx]
        C = len(kids)
        if C == 0:
            continue
        R = radii[idx] * 0.93
        ang0 = rng.uniform(0, 2 * math.pi)
        for k, child in enumerate(kids):
            rr = R * math.sqrt((k + 0.55) / C)
            th = ang0 + k * GOLDEN
            x = px + rr * math.cos(th)
            y = py + rr * math.sin(th)
            others = [j for j in neighbors[child] if j in hub_set and j != idx]
            if others:
                ox = sum(world[j][0] for j in others) / len(others)
                oy = sum(world[j][1] for j in others) / len(others)
                pull = 0.10 if len(others) == 1 else 0.07
                x = x * (1 - pull) + ox * pull
                y = y * (1 - pull) + oy * pull
            if not clear(x, y, 2.0):
                for t in (0.82, 0.64, 0.46, 0.28, 0.12):
                    xx = px + (x - px) * t
                    yy = py + (y - py) * t
                    if clear(xx, yy, 2.0):
                        x, y = xx, yy
                        break
                else:
                    x, y = px, py
            world[child] = [x + rng.uniform(-3, 3), y + rng.uniform(-3, 3)]

    for i in range(len(notes)):
        world.setdefault(i, [0.0, 0.0])

    scale = min(1500.0 / max(sw, 1), 950.0 / max(sh, 1)) * 0.97
    out = {i: [round(x * scale, 1), round(y * scale, 1)] for i, (x, y) in world.items()}
    rect = [-sw / 2 * scale, -sh / 2 * scale, sw * scale, sh * scale]
    return out, rect


def compute_layout(notes, edges, idx_of, rng, shape=None):
    hub_ids = [i for i, n in enumerate(notes) if n["kind"] in HUB_KINDS]
    hub_set = set(hub_ids)

    neighbors = {i: set() for i in range(len(notes))}
    for a, b in edges:
        neighbors[a].add(b)
        neighbors[b].add(a)

    # 每个核心节点的子节点（会话记忆）；优先挂到「项目」上，避免一个工具节点吸走所有点
    children = {idx: [] for idx in hub_ids}
    for i, n in enumerate(notes):
        if n["kind"] in HUB_KINDS:
            continue
        core_nb = [j for j in neighbors[i] if j in hub_set]
        if not core_nb:
            continue
        projects = [j for j in core_nb if notes[j]["kind"] == "project"]
        pool = projects or core_nb
        primary = max(pool, key=lambda j: len(neighbors[j]))
        children[primary].append(i)

    # 把核心节点分成两类：有叶子的「簇中心」和没有叶子的「卫星概念」
    cluster_ids = [i for i in hub_ids if len(children[i]) >= 8]
    cluster_set = set(cluster_ids)
    sat_ids = [i for i in hub_ids if i not in cluster_set]

    if shape:
        return layout_in_shape(notes, hub_ids, cluster_ids, sat_ids, children, neighbors, shape, rng)

    # 簇中心：面积螺旋 + 推挤，铺成一个圆盘
    radii = {idx: max(70.0, 14.0 * math.sqrt(len(children[idx]) + 1)) for idx in cluster_ids}
    order = sorted(cluster_ids, key=lambda i: -radii[i])
    world = {}
    A = 0.0
    for k, idx in enumerate(order):
        r_i = radii[idx]
        rpos = 0.0 if k == 0 else math.sqrt(A / math.pi) + rng.uniform(-6, 6)
        th = k * GOLDEN + rng.uniform(-0.12, 0.12)
        world[idx] = [rpos * math.cos(th), rpos * math.sin(th)]
        A += math.pi * (r_i * 1.06) ** 2

    pos_list = [world[i] for i in order]
    rad_list = [radii[i] for i in order]
    pos_list = separate(pos_list, rad_list, gap=150.0)
    for i, p in zip(order, pos_list):
        world[i] = p

    # 卫星概念：挂到它连接最多的簇旁边；连着两个簇就落在中间当桥
    sat_sorted = sorted(sat_ids, key=lambda i: -len(neighbors[i]))
    for si, sat in enumerate(sat_sorted):
        nbs = [j for j in neighbors[sat] if j in cluster_set and j in world]
        nbs.sort(key=lambda j: -len(neighbors[j]))
        if nbs:
            mx, my = world[nbs[0]]
            ang = si * GOLDEN + rng.uniform(-0.2, 0.2)
            dist = radii[nbs[0]] + 55 + rng.uniform(0, 40)
            x = mx + dist * math.cos(ang)
            y = my + dist * math.sin(ang)
            if len(nbs) > 1:
                ox = sum(world[j][0] for j in nbs[1:]) / (len(nbs) - 1)
                oy = sum(world[j][1] for j in nbs[1:]) / (len(nbs) - 1)
                x = x * 0.55 + ox * 0.45
                y = y * 0.55 + oy * 0.45
        else:
            near = [j for j in neighbors[sat] if j in world]
            if near:
                mx, my = world[near[0]]
                ang = si * GOLDEN
                x = mx + 60 * math.cos(ang)
                y = my + 60 * math.sin(ang)
            else:
                ang = si * GOLDEN
                r0 = math.sqrt(A / math.pi) * 1.05
                x = r0 * math.cos(ang)
                y = r0 * math.sin(ang)
        world[sat] = [x, y]

    # 卫星互相推开一点，避免叠在簇边缘
    sat_world = [world[i] for i in sat_sorted]
    if sat_world:
        sat_sep = separate(sat_world, [55.0] * len(sat_sorted), gap=20.0, iters=80)
        for i, p in zip(sat_sorted, sat_sep):
            world[i] = p

    # 叶子（会话记忆 / 导入资料）：围绕主节点做向日葵式分布
    for idx in hub_ids:
        px, py = world[idx]
        kids = children[idx]
        C = len(kids)
        if C == 0:
            continue
        R = (radii[idx] if idx in radii else 80.0) * 0.93
        ang0 = rng.uniform(0, 2 * math.pi)
        for order_i, child in enumerate(kids):
            rr = R * math.sqrt((order_i + 0.55) / C)
            th = ang0 + order_i * GOLDEN
            x = px + rr * math.cos(th)
            y = py + rr * math.sin(th)
            others = [j for j in neighbors[child] if j in hub_set and j != idx]
            if others:
                ox = sum(world[j][0] for j in others) / len(others)
                oy = sum(world[j][1] for j in others) / len(others)
                pull = 0.12 if len(others) == 1 else 0.08
                x = x * (1 - pull) + ox * pull
                y = y * (1 - pull) + oy * pull
            world[child] = [x + rng.uniform(-4, 4), y + rng.uniform(-4, 4)]

    # 孤立节点兜底
    for i in range(len(notes)):
        if i not in world:
            a = i * GOLDEN
            world[i] = [math.cos(a) * 300, math.sin(a) * 300]

    # 归一化到画面
    # 无形状：横竖各自拉满，保证铺满视口（有机图形轻微拉伸看不出来）
    xs = [p[0] for p in world.values()]
    ys = [p[1] for p in world.values()]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    sx = 1500.0 / max(maxx - minx, 1)
    sy = 950.0 / max(maxy - miny, 1)
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    out = {}
    for i, (x, y) in world.items():
        out[i] = [round((x - cx) * sx, 1), round((y - cy) * sy, 1)]
    return out, None


# ---------------------------------------------------------------- 主流程
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true", help="生成后用默认浏览器打开")
    ap.add_argument("--vault", default="", help="外部 vault 目录（默认用脚本旁边的 vault/）")
    ap.add_argument("--shape", default="brain", choices=["brain", "free"],
                    help="布局形状：brain=大脑轮廓（默认），free=原始星团")
    args = ap.parse_args()
    global VAULT
    if args.vault:
        VAULT = pathlib.Path(args.vault).expanduser().resolve()

    if not VAULT.exists():
        print(f"vault 不存在：{VAULT}\n先跑 python seed_brain.py")
        return 1
    if not TEMPLATE.exists():
        print(f"缺少模板：{TEMPLATE}")
        return 1

    rng = random.Random(7)
    notes = load_notes()
    if not notes:
        print("vault 里没有 md 文件")
        return 1

    shape = load_shape() if args.shape == "brain" else None
    if args.shape == "brain" and shape is None:
        print("没找到 brain_shape.json，退回自由布局（先跑 make_brain_shape.py）")

    idx_of = {}
    for i, n in enumerate(notes):
        idx_of.setdefault(n["title"], i)

    edges = set()
    missing = {}
    for i, n in enumerate(notes):
        for l in n["links"]:
            j = idx_of.get(l)
            if j is None:
                missing[l] = missing.get(l, 0) + 1
                continue
            if j == i:
                continue
            edges.add((min(i, j), max(i, j)))
    edges = sorted(edges)

    deg = [0] * len(notes)
    for a, b in edges:
        deg[a] += 1
        deg[b] += 1

    layout, shape_rect = compute_layout(notes, edges, idx_of, rng, shape)

    nodes = []
    for i, n in enumerate(notes):
        nodes.append({
            "t": n["title"],
            "k": n["kind"],
            "g": n["tags"],
            "d": deg[i],
            "x": layout[i][0],
            "y": layout[i][1],
            "p": n["path"],
            "o": n["orig"],
            "e": excerpt_of(n["body"]),
        })

    stats = {}
    for n in notes:
        stats[n["kind"]] = stats.get(n["kind"], 0) + 1

    data = {
        "generated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "stats": stats,
        "nodes": nodes,
        "edges": [[a, b] for a, b in edges],
        "shape": ({"light": shape["light"], "dark": shape["dark"], "rect": shape_rect}
                  if shape_rect and shape else None),
    }

    OUT_JSON.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )

    tpl = TEMPLATE.read_text(encoding="utf-8")
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    html = tpl.replace("/*__BRAIN_DATA__*/", blob)
    OUT_HTML.write_text(html, encoding="utf-8")

    print(f"节点 {len(nodes)} · 连线 {len(edges)} · 类型 {stats}"
          + (" · 脑形布局" if shape_rect else " · 自由布局"))
    if missing:
        top = sorted(missing.items(), key=lambda kv: -kv[1])[:5]
        print(f"未解析链接 {len(missing)} 种（示例 {top}）")
    print(f"-> {OUT_JSON}")
    print(f"-> {OUT_HTML}")

    if args.open:
        import webbrowser
        webbrowser.open(OUT_HTML.as_uri())
    return 0


if __name__ == "__main__":
    sys.exit(main())
