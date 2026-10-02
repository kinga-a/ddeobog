/**
 * 插件系统 —— Typecho 插件机制的 JS 等价实现
 *
 * 与 Typecho 的对应关系：
 *   Typecho Helper::addAction('xx', 'Widget_Xx')  →  registerAction('xx', handler)
 *   Typecho 插件钩子 (Typecho_Plugin::factory)   →  registerHook('name', fn)
 *   Typecho 主题 functions.php themeInit          →  registerHook('themeInit', fn)
 *
 * 支持的钩子：
 *   themeInit(ctx)                 主题初始化（可修改 ctx.options）
 *   renderContent(text, {post})    渲染正文前，可改写 Markdown 源文本
 *   commentSubmit(data, ctx)       评论提交校验，返回 {reject, message} 可拦截
 *   commentPost({cid,...}, ctx)    评论入库后
 *   route(ctx)                     自定义路由（返回 Response 则短路）
 *   response(response, ctx)        输出前
 *
 * 插件目录：项目根 plugins/*.js，每个文件导出 register(api)。
 * 平台构建时需将 plugins 目录内容一并包含（见 README 部署说明）。
 */

const hooks = new Map(); // name -> [fn]
const actions = new Map(); // name -> handler

export const pluginApi = {
  registerHook(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
  registerAction(name, handler) {
    actions.set(name, handler);
  },
  getConfig: null, // 由 main.js 注入：async (pluginName) => options 里 plugins.<name> 配置
};

/** 执行钩子，返回（可被逐个改写的）结果 */
export async function runHooks(name, ...args) {
  const fns = hooks.get(name) || [];
  let result = args[0];
  for (const fn of fns) {
    try {
      result = (await fn(result, ...args.slice(1))) ?? result;
    } catch (e) {
      console.error(`[plugin] hook ${name} error:`, e);
    }
  }
  return result;
}

export async function runAction(name, ctx) {
  const handler = actions.get(name);
  if (!handler) return null;
  return await handler(ctx);
}

export function hasAction(name) {
  return actions.has(name);
}

/**
 * 从内置插件清单加载（打包进 bundle，保证边缘函数单文件可用）
 * 内置插件在 src/plugins-builtin/ 下定义
 */
export async function loadBuiltinPlugins() {
  // 动态 import 由打包器静态分析内联
  const mods = [
    await import('./plugins-builtin/hello-world.js'),
    await import('./plugins-builtin/links-cache.js'),
  ];
  for (const mod of mods) {
    if (typeof mod.register === 'function') await mod.register(pluginApi);
  }
}
