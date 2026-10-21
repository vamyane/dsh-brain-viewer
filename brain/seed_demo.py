#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""seed_demo.py — 生成演示用知识库（公开、通用内容，不含任何私人资料）。

用法：python seed_demo.py [--episodes 420]
产物：<插件>/brain/vault/ 下的 Markdown 双链笔记。
"""

import argparse
import datetime as dt
import pathlib
import random
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent
VAULT = ROOT / "vault"
FOLDERS = {
    "project": "projects", "concept": "concepts", "tool": "tools",
    "person": "people", "decision": "decisions", "preference": "preferences",
    "episode": "episodes",
}
BAD = re.compile(r'[\\/:*?"<>|]')

CORE = [
    dict(t="知识库建设项目", ty="project", tags=["demo", "知识库"],
         body="演示项目：把散落的笔记编译成可检索、可维护的知识库。",
         links=["知识编译", "元数据规范", "关系图谱"]),
    dict(t="内容工厂", ty="project", tags=["demo", "内容"],
         body="演示项目：选题 → 脚本 → 成片 → 复盘的内容流水线。",
         links=["自动化工作流", "内容选题库"]),
    dict(t="自动化工作流", ty="project", tags=["demo", "自动化"],
         body="演示项目：把重复操作固化成可重跑的脚本与定时任务。",
         links=["自动化工作流", "增量索引", "备份策略"]),
    dict(t="数据看板", ty="project", tags=["demo", "数据"],
         body="演示项目：把关键指标放进一个每天都会看一眼的页面。",
         links=["SQLite", "数据看板"]),
    dict(t="个人网站", ty="project", tags=["demo", "网站"],
         body="演示项目：作品集 + 文章 + 项目说明的静态站点。",
         links=["GitHub", "个人网站"]),
    dict(t="关系图谱", ty="concept", tags=["obsidian", "可视化"],
         body="节点=一篇笔记，边=双链；上万节点时像一张神经网络。",
         links=["双链笔记", "Obsidian"]),
    dict(t="知识图谱", ty="concept", tags=["memory"],
         body="节点+关系组成的知识网络；检索时先沿边扩散再读内容。",
         links=["关系图谱", "知识单元"]),
    dict(t="内容选题库", ty="concept", tags=["内容"],
         body="把选题、角度、素材挂在一起，避免每次从零想。",
         links=["内容工厂", "可视化"]),
    dict(t="双链笔记", ty="concept", tags=["obsidian"],
         body="双链让笔记之间互相知道，反链就是上下文。",
         links=["关系图谱", "知识单元"]),
    dict(t="第二大脑", ty="concept", tags=["memory"],
         body="外置记忆：人负责输入与判断，AI 负责整理、链接、体检。",
         links=["知识图谱", "LLM Wiki"]),
    dict(t="知识编译", ty="concept", tags=["memory"],
         body="读一次材料就更新所有相关页：综述、矛盾标注、交叉引用。",
         links=["LLM Wiki", "知识单元"]),
    dict(t="LLM Wiki", ty="concept", tags=["memory"],
         body="把笔记当源码、LLM 当编译器：Raw 层不可变，Schema 定规矩，Wiki 由 AI 维护。",
         links=["知识编译", "RAG 的局限", "关系图谱"]),
    dict(t="RAG 的局限", ty="concept", tags=["memory"],
         body="只做局部检索：看得到片段，看不到全局；新旧结论冲突时容易自相矛盾。",
         links=["LLM Wiki", "语义检索"]),
    dict(t="记忆压缩", ty="concept", tags=["memory"],
         body="会话太长会丢细节；把一段对话压成几条可检索的记忆更稳。",
         links=["上下文工程", "知识单元"]),
    dict(t="遗忘曲线", ty="concept", tags=["memory"],
         body="久不用的记忆降权但不删除；重要节点靠反复引用保鲜。",
         links=["记忆压缩", "知识图谱"]),
    dict(t="上下文工程", ty="concept", tags=["agent"],
         body="不是写更长的 prompt，而是决定此刻加载什么、丢掉什么。",
         links=["记忆压缩", "语义检索"]),
    dict(t="语义检索", ty="concept", tags=["retrieval"],
         body="按意思找而不是按字面找；向量召回 + 关键词召回混合更稳。",
         links=["嵌入向量", "RAG 的局限"]),
    dict(t="嵌入向量", ty="concept", tags=["retrieval"],
         body="把文本压成向量，距离近代表语义近；适合粗筛，不适合直接当答案。",
         links=["语义检索"]),
    dict(t="知识单元", ty="concept", tags=["memory"],
         body="一条记忆只讲一件事，标题能独立看懂，正文第一行是结论。",
         links=["记忆压缩", "元数据规范"]),
    dict(t="元数据规范", ty="concept", tags=["memory"],
         body="frontmatter 统一字段：type、tags、date、来源；字段不统一后面全乱。",
         links=["知识单元", "版本控制"]),
    dict(t="增量索引", ty="concept", tags=["工程"],
         body="只处理新增/变化的文件，别每次全量重建。",
         links=["自动化工作流", "版本控制"]),
    dict(t="备份策略", ty="concept", tags=["工程"],
         body="本地 + 远端 + 定期快照；先能恢复，再谈高可用。",
         links=["版本控制", "隐私边界"]),
    dict(t="隐私边界", ty="concept", tags=["安全"],
         body="哪些内容永远不进模型、不进公开仓库、不出本机，先划清楚。",
         links=["本地优先", "备份策略"]),
    dict(t="本地优先", ty="concept", tags=["安全"],
         body="数据默认留在本机，云能力按需开关。",
         links=["隐私边界", "SQLite"]),
    dict(t="图数据库", ty="concept", tags=["存储"],
         body="节点+关系天然适合知识网络；小规模用 JSON/SQLite 就够。",
         links=["关系图谱", "SQLite"]),
    dict(t="版本控制", ty="concept", tags=["工程"],
         body="知识库也要能看 diff、能回滚；Markdown 天然适合 git。",
         links=["备份策略", "GitHub"]),
    dict(t="可视化", ty="concept", tags=["可视化"],
         body="把结构画出来，问题会自己冒出来：孤立点、重复簇、断裂的桥。",
         links=["关系图谱", "数据看板"]),
    dict(t="Obsidian", ty="tool", tags=["obsidian"],
         body="本地 Markdown 编辑器，关系图谱是招牌功能。",
         links=["关系图谱", "双链笔记"]),
    dict(t="Claude Code", ty="tool", tags=["agent"],
         body="终端里的 coding agent，能批量读写 Markdown。",
         links=["LLM Wiki", "Codex CLI"]),
    dict(t="Codex CLI", ty="tool", tags=["agent"],
         body="另一款终端 agent，同样能跑 MCP、读写文件。",
         links=["Claude Code", "MCP 协议"]),
    dict(t="MCP 协议", ty="tool", tags=["agent"],
         body="让 agent 连外部工具和数据的标准接口。",
         links=["Claude Code", "自动化工作流"]),
    dict(t="n8n", ty="tool", tags=["自动化"],
         body="可视化工作流编排，适合把 API 串成定时任务。",
         links=["自动化工作流", "增量索引"]),
    dict(t="GitHub", ty="tool", tags=["工程"],
         body="代码与知识库的远端备份、协作与发布入口。",
         links=["版本控制", "个人网站"]),
    dict(t="SQLite", ty="tool", tags=["存储"],
         body="单文件数据库，本地工具和看板的好搭档。",
         links=["数据看板", "本地优先"]),
    dict(t="Python", ty="tool", tags=["工程"],
         body="脚本与数据处理的默认语言，粘合各类工具。",
         links=["自动化工作流", "数据看板"]),
    dict(t="我", ty="person", tags=["people"],
         body="演示用：一人公司，做知识管理、内容与自动化。",
         links=["知识库建设项目", "内容工厂", "自动化工作流"]),
    dict(t="先本地后云端", ty="decision", tags=["决策"],
         body="演示决策：数据先在本机跑通，再考虑云端协作。",
         links=["本地优先", "隐私边界"]),
    dict(t="演示数据与真实数据分离", ty="decision", tags=["决策"],
         body="演示数据单独生成、可随时重建；真实资料不随包分发。",
         links=["隐私边界", "备份策略"]),
    dict(t="交付要能打开", ty="preference", tags=["偏好"],
         body="交付物要能直接双击/预览看到效果，别只给描述。",
         links=["我"]),
    dict(t="中文直给", ty="preference", tags=["偏好"],
         body="中文回答，少客套，先结论再细节。",
         links=["我"]),
]

TASKS = {
    "知识库建设项目": ["把一批 md 按 ## 小节拆成记忆单元", "给笔记补 frontmatter 元数据",
                       "合并重复概念页", "给孤立笔记补双链", "统计各类型记忆数量"],
    "内容工厂": ["排下周的选题日历", "把一篇长文改写成 60 秒口播", "复盘一条内容的完播率", "统一片头结构"],
    "自动化工作流": ["把重复操作写成一键脚本", "加失败重试与日志", "给定时任务加超时保护", "清理临时文件"],
    "数据看板": ["补三个核心指标", "把今日数据写进看板", "加环比计算", "修一个口径不一致"],
    "个人网站": ["更新作品集页面", "部署静态站点", "补项目说明", "检查移动端布局"],
}
OUTCOMES = ["已完成，跑通样例", "先做出最小版本，等反馈", "定位到字段不统一", "记录到备忘，下次复用",
            "这版先冻结", "卡在权限，明天继续"]
CONCEPTS = {
    "知识库建设项目": ["知识编译", "元数据规范", "知识单元", "关系图谱"],
    "内容工厂": ["知识单元", "可视化"],
    "自动化工作流": ["增量索引", "备份策略", "自动化工作流"],
    "数据看板": ["可视化", "SQLite"],
    "个人网站": ["版本控制", "GitHub"],
}
TOOLS = ["Obsidian", "Claude Code", "Codex CLI", "MCP 协议", "n8n", "SQLite", "Python", "GitHub"]


def safe(s):
    return BAD.sub("-", s).strip()


def write(path, meta, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("---\n" + "\n".join(meta) + "\n---\n\n" + body.strip() + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", type=int, default=420)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    if VAULT.exists():
        shutil.rmtree(VAULT)
    VAULT.mkdir(parents=True)

    start, end = dt.date(2025, 9, 1), dt.date(2026, 10, 21)
    span = (end - start).days

    for c in CORE:
        created = start + dt.timedelta(days=rng.randint(0, span - 30))
        updated = min(end, created + dt.timedelta(days=rng.randint(1, 45)))
        body = c["body"] + "\n\n**关联**：" + "、".join(f"[[{x}]]" for x in c["links"])
        write(
            VAULT / FOLDERS[c["ty"]] / (safe(c["t"]) + ".md"),
            [f"type: {c['ty']}", "tags: [" + ", ".join(c["tags"]) + "]",
             f"created: {created.isoformat()}", f"updated: {updated.isoformat()}"],
            body,
        )

    projects = list(TASKS)
    used = set()
    for i in range(args.episodes):
        p = rng.choice(projects)
        task = rng.choice(TASKS[p])
        day = end - dt.timedelta(days=int(span * rng.random() ** 2))
        extra = rng.sample(CONCEPTS[p], k=min(2, len(CONCEPTS[p])))
        tool = rng.choice(TOOLS)
        links = [p] + extra + [tool]
        body = f"在【{p}】上推进：{task}。\n结论：{rng.choice(OUTCOMES)}。\n\n**关联**：" + "、".join(f"[[{x}]]" for x in links)
        meta = ["type: episode", f"project: {p}", f"date: {day.isoformat()}",
                "tags: [日志, demo]", "demo: true"]
        fname = safe(f"{day.isoformat()} · {task}")
        path = VAULT / "episodes" / day.strftime("%Y-%m") / (fname + ".md")
        n = 2
        while path.name in used or path.exists():
            path = VAULT / "episodes" / day.strftime("%Y-%m") / f"{fname} ({n}).md"
            n += 1
        used.add(path.name)
        write(path, meta, body)

    print(f"OK 核心 {len(CORE)} 条 + 会话 {args.episodes} 条 -> {VAULT}")


if __name__ == "__main__":
    sys.exit(main())
