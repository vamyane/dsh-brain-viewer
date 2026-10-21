/**
 * dsh-brain 宿主半边。
 *
 * 关系图谱完全跑在浏览器半边（lib/client.js）：打开面板时把内嵌的
 * brain.html 塞进 Blob URL 的 iframe 里，所以宿主侧不需要任何服务。
 */

/** 稳定插件名（组合行按 id 引用，name 供运行时标识）。 */
export const name = "dsh-brain-viewer";

/** 没有硬依赖。 */
export const inject = [];

/**
 * 空实现，保留给以后可能的宿主能力（例如从磁盘热读 brain.html）。
 * @param {import("@deepseek-ai/cordis").Context} ctx - 插件上下文。
 */
export function apply(ctx) {
  void ctx;
}
