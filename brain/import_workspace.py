#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""import_workspace.py — 把工作区里真实的 md / docx / xlsx 编译成「AI 大脑」的记忆节点。

做的事：
  1. 扫描工作区（默认 ai-brain 的上一级）里的 Markdown：opc-suite / workbuddy-skills /
     skillhub-experts / cad-kb / food-label-auditor / market-research / 科普系列 / 根目录
  2. 根目录下的交付型 .docx / .xlsx 抽取摘要
  3. 每篇生成一个 vault/sources/ 下的记忆节点，自动双链到对应的核心记忆
  4. 原文件路径写进 frontmatter 的 orig 字段，图谱里点开能看到

用法：
    python import_workspace.py --dry-run     # 只统计，不写文件
    python import_workspace.py               # 导入（会清掉上一次导入的 sources）
    python import_workspace.py --prune       # 同上，显式清空
"""

import argparse
import datetime as dt
import pathlib
import re
import shutil
import sys

BRAIN = pathlib.Path(__file__).resolve().parent
VAULT = BRAIN / "vault"
WS = BRAIN.parent / "demo-workspace"
OUT = VAULT / "sources"

TODAY = dt.date.today().isoformat()

TOP_DIRS = [
    "opc-suite",
    "skillhub-experts",
    "cad-kb",
    "workbuddy-skills",
    "food-label-auditor",
    "market-research",
    "科普系列",
]
SKIP_PARTS = {"node_modules", ".git", ".venv", "__pycache__", "dist", ".obsidian", "ai-brain"}
MAX_BYTES = 300_000

DIR_LINK = {
    "opc-suite": "OPC 专家套件",
    "skillhub-experts": "SkillHub 存档",
    "cad-kb": "CAD 知识库",
    "workbuddy-skills": "OPC 技能矩阵",
    "food-label-auditor": "食品标签审核",
    "market-research": "市场调研",
    "科普系列": "科普系列短视频",
}

ROOT_LINK = [
    ("项目交接文档", "DeepSeek Harness 工作台"),
    ("技能矩阵规划", "OPC 技能矩阵"),
    ("技能候选清单", "OPC 技能矩阵"),
    ("高质量路线图", "OPC 技能矩阵"),
    ("给WorkBuddy的确认回复", "WorkBuddy 开放平台"),
    ("云函数部署说明", "DeepSeek Harness 工作台"),
    ("steam-密保邮箱", "我"),
    ("biaoshu-competitor-research", "市场调研"),
]

# (路径/文件名里出现的关键词, 连到哪个核心记忆)
KEYWORD_LINK = [
    (("alipay", "aipay", "skillpay", "支付宝"), "支付宝 AI 付接入"),
    (("xyq", "小云雀"), "小云雀 AI 创作"),
    (("story", "网文"), "网文写作工具集"),
    (("srt", "whiteboard", "白板"), "SRT 白板动画"),
    (("theme", "oppo", "yewang", "主题"), "OPPO 主题包"),
    (("口播", "数字人"), "AI 分身口播"),
    (("工银", "安盛", "保险"), "工银安盛短视频获客"),
    (("expert", "专家"), "OPC 专家套件"),
    (("cad", "图纸"), "CAD 知识库"),
    (("food", "食品", "标签"), "食品标签审核"),
    (("market", "调研"), "市场调研"),
]

# 额外连的概念（最多取 2 个）
CONCEPT_LINK = [
    (("review_gate", "review", "审核", "驳回"), "专家包审核标准"),
    (("sandbox", "demo", "沙箱"), "沙箱评测"),
    (("frontmatter", "yaml", "字段"), "硬字段约束"),
    (("memory", "记忆", "brain"), "记忆压缩"),
    (("mcp", "protocol"), "MCP 协议"),
    (("obsidian", "双链", "graph"), "双链笔记"),
]


def strip_front(text: str) -> str:
    if text.startswith("---"):
        i = text.find("\n---", 3)
        if i >= 0:
            return text[i + 4:]
    return text


def summarize_md(text: str, limit: int = 200) -> str:
    text = strip_front(text)
    out = []
    in_code = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_code = not in_code
            continue
        if in_code or not s:
            continue
        s = re.sub(r"^#{1,6}\s*", "", s)
        s = re.sub(r"^[-*+]\s+", "", s)
        s = re.sub(r"^>\s*", "", s)
        s = s.replace("**", "").replace("`", "").replace("|", " ")
        s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
        if s.startswith("---") or s.startswith("```"):
            continue
        out.append(s)
        if len(" ".join(out)) >= limit:
            break
    return (" ".join(out)).strip()[:limit]


H2_RE = re.compile(r"(?m)^##\s+(.+?)\s*$")


def split_md(text: str, max_sections: int = 10, min_len: int = 80):
    """把一篇 md 按 ## 小标题切成若干段记忆；没有小标题就整篇算一段。"""
    text = strip_front(text)
    matches = list(H2_RE.finditer(text))
    if len(matches) < 2:
        s = summarize_md(text)
        return [("", s)] if s else []
    segs = []
    pre = text[:matches[0].start()].strip()
    if len(pre) >= min_len:
        s = summarize_md(pre)
        if s:
            segs.append(("", s))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chunk = text[start:end].strip()
        if len(chunk) < min_len:
            continue
        s = summarize_md(chunk)
        if s:
            segs.append((m.group(1).strip()[:40], s))
    segs = segs[:max_sections]
    return segs or [("", summarize_md(text))]


def summarize_docx(path: pathlib.Path, limit: int = 200) -> str:
    try:
        from docx import Document  # type: ignore
    except Exception:
        return ""
    try:
        doc = Document(str(path))
    except Exception:
        return ""
    buf = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            buf.append(t)
        if len(" ".join(buf)) >= limit:
            break
    return (" ".join(buf)).strip()[:limit]


def summarize_xlsx(path: pathlib.Path, limit: int = 200) -> str:
    try:
        import openpyxl  # type: ignore
    except Exception:
        return ""
    try:
        wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    except Exception:
        return ""
    buf = ["工作表：" + "、".join(wb.sheetnames)]
    try:
        ws = wb[wb.sheetnames[0]]
        n = 0
        for row in ws.iter_rows(values_only=True):
            for v in row:
                if v is not None and str(v).strip():
                    buf.append(str(v).strip())
                    n += 1
                    break
            if n >= 8:
                break
    finally:
        try:
            wb.close()
        except Exception:
            pass
    return (" ".join(buf)).strip()[:limit]


def core_titles() -> set:
    titles = set()
    for p in VAULT.rglob("*.md"):
        if "sources" in p.parts:
            continue
        titles.add(p.stem)
    return titles


def link_for(rel: pathlib.Path) -> tuple:
    """返回 (主链接, [额外概念链接])"""
    parts = rel.parts
    lower = str(rel).lower()
    primary = None
    if len(parts) == 1:
        for key, target in ROOT_LINK:
            if key.lower() in rel.stem.lower():
                primary = target
                break
    if primary is None and parts[0] in DIR_LINK:
        primary = DIR_LINK[parts[0]]
    if primary is None:
        for keys, target in KEYWORD_LINK:
            if any(k.lower() in lower for k in keys):
                primary = target
                break
    extra = []
    for keys, target in CONCEPT_LINK:
        if target == primary:
            continue
        if any(k.lower() in lower for k in keys):
            extra.append(target)
        if len(extra) >= 2:
            break
    return primary, extra


def safe_name(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|]', "-", s).strip().rstrip(".")
    return s[:80] or "untitled"


def collect_files(dry: bool):
    files = []  # (path, rel, kind)
    for top in TOP_DIRS:
        base = WS / top
        if not base.exists():
            continue
        for p in sorted(base.rglob("*.md")):
            rel = p.relative_to(WS)
            if any(part in SKIP_PARTS for part in rel.parts):
                continue
            try:
                if p.stat().st_size > MAX_BYTES or p.stat().st_size < 40:
                    continue
            except OSError:
                continue
            files.append((p, rel, "md"))
    for p in sorted(WS.glob("*.md")):
        try:
            if p.stat().st_size > MAX_BYTES or p.stat().st_size < 40:
                continue
        except OSError:
            continue
        files.append((p, p.relative_to(WS), "md"))
    for p in sorted(WS.glob("*.docx")):
        if p.stat().st_size > 5_000_000:
            continue
        files.append((p, p.relative_to(WS), "docx"))
    for p in sorted(WS.glob("*.xlsx")):
        files.append((p, p.relative_to(WS), "xlsx"))
    return files


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--prune", action="store_true", help="先清空 vault/sources")
    ap.add_argument("--workspace", default="", help="要扫描的工作区根目录（默认插件同级目录）")
    ap.add_argument("--no-split", dest="split_sections", action="store_false",
                    help="不按 ## 小节拆分，一篇文档一个节点")
    ap.add_argument("--max-sections", type=int, default=10, help="每篇最多拆几段（默认 10）")
    ap.set_defaults(split_sections=True)
    args = ap.parse_args()
    global WS
    if args.workspace:
        WS = pathlib.Path(args.workspace).expanduser().resolve()
        if not WS.is_dir():
            print(f"工作区不存在：{WS}")
            return 1

    if not VAULT.exists():
        print(f"vault 不存在：{VAULT}\n先跑 python seed_brain.py")
        return 1

    files = collect_files(args.dry_run)
    titles = core_titles()
    if not args.dry_run and (args.prune or OUT.exists()):
        shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    used = set(titles)
    stats = {"md": 0, "docx": 0, "xlsx": 0, "skipped": 0, "unmatched": 0}
    by_dir = {}
    planned = []

    for path, rel, kind in files:
        segments = []
        try:
            if kind == "md":
                text = path.read_text(encoding="utf-8", errors="ignore")
                if args.split_sections:
                    segments = split_md(text, args.max_sections)
                else:
                    segments = [("", summarize_md(text))]
            elif kind == "docx":
                segments = [("", summarize_docx(path))]
            else:
                segments = [("", summarize_xlsx(path))]
        except Exception:
            stats["skipped"] += 1
            continue
        segments = [(t, s) for (t, s) in segments if s]
        if not segments:
            stats["skipped"] += 1
            continue

        primary, extra = link_for(rel)
        if primary is None:
            primary = "我"
            stats["unmatched"] += 1
        links = [primary] + [x for x in extra if x != primary]
        links = [x for x in links if x in titles]
        if not links:
            links = ["我"] if "我" in titles else []
        if not links:
            stats["skipped"] += 1
            continue

        top = rel.parts[0] if len(rel.parts) > 1 else "根目录"
        tag = "工作区" if top == "根目录" else top
        mtime = dt.date.fromtimestamp(path.stat().st_mtime).isoformat()

        for si, (sec_title, summary) in enumerate(segments):
            if sec_title:
                base_raw = f"{path.stem} · {sec_title}"
            elif len(segments) > 1:
                base_raw = f"{path.stem} · {si + 1}"
            else:
                base_raw = path.stem
            base = safe_name(base_raw)
            if base in used:
                base = safe_name(f"{base} · {rel.parent.name}") if rel.parent.name else base
            candidate, n = base, 2
            while candidate in used:
                candidate = f"{base} ({n})"
                n += 1
            used.add(candidate)

            body = summary + "\n\n**关联**：" + "、".join(f"[[{x}]]" for x in links)
            meta = [
                "type: source",
                f"imported: {TODAY}",
                f"date: {mtime}",
                f"orig: {rel.as_posix()}",
                "tags: [资料, " + tag + "]",
            ]
            target = OUT / safe_name(tag) / (candidate + ".md")
            stats[kind] += 1
            by_dir[top] = by_dir.get(top, 0) + 1
            planned.append((target, meta, body, links))

    if args.dry_run:
        print(f"[dry-run] 将导入 {len(planned)} 篇：{stats}")
        for k, v in sorted(by_dir.items(), key=lambda kv: -kv[1]):
            print(f"  {v:5d}  {k}")
        return 0

    for target, meta, body, links in planned:
        target.parent.mkdir(parents=True, exist_ok=True)
        text = "---\n" + "\n".join(meta) + "\n---\n\n" + body + "\n"
        target.write_text(text, encoding="utf-8")

    print(f"导入 {len(planned)} 个资料节点（md {stats['md']} / docx {stats['docx']} / xlsx {stats['xlsx']}；"
          f"跳过 {stats['skipped']}，无项目匹配 {stats['unmatched']}）")
    for k, v in sorted(by_dir.items(), key=lambda kv: -kv[1]):
        print(f"  {v:5d}  {k}")
    print(f"-> {OUT}")
    print("接着跑：python build_graph.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
