/**
 * 内置示例插件：HelloWorld —— 对应 Typecho 官方示例插件
 * 钩子在评论提交时把 "hello" 替换为 "hello world"
 */
export function register(api) {
  api.registerHook('commentSubmit', (data) => {
    if (data && data.text) data.text = data.text.replace(/\bhello\b/gi, 'Hello World');
    return data;
  });

  // 注册一个自定义 action：/action/hello
  api.registerAction('hello', async (ctx) => {
    return new Response(
      JSON.stringify({ code: 1, data: { message: 'Hello World from TypechoEdge plugin!' } }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  });
}

export const meta = {
  title: 'HelloWorld',
  desc: '示例插件：评论 hello 替换 + /action/hello 接口',
  author: 'TypechoEdge',
  version: '1.0.0',
};
