# 侧栏天气板块

- 日期：2026-11-12
- 位置：`.blog_aside` 侧栏，「人生倒计时」上方
- 默认状态：关闭

## 一、开启与配置

后台 → 站点设置 → 5iblog 主题设置：

| 设置项 | 默认值 | 说明 |
|---|---|---|
| 天气侧栏 | `off` | 开关；关闭时不渲染天气容器，也不请求接口 |
| 天气城市 / 地区代码 | `北京` | 中文/英文城市名，或 6 位 adcode（如 `110000`） |
| 天气预报天数 | `4` | 1–7 天，决定底部预报条数量 |
| 天气接口 URL | UApiPro | 支持 `{city}` / `{adcode}` 占位符，也可直接填完整 URL |
| 天气接口 API Key | 空 | 可选；配置后以 `Authorization: Bearer <key>` 发送 |

默认接口（免费、无需注册，中文返回）：

```
https://uapis.cn/api/v1/misc/weather?city={city}&lang=zh&extended=true&forecast=true
```

切换接口时，如果 URL 不含占位符，系统会自动追加
`city`（或 `adcode`）、`lang=zh`、`extended=true`、`forecast=true`。

## 二、自定义接口字段约定

服务端会把返回 JSON 标准化，推荐兼容以下字段（与 UApiPro 一致）：

```json
{
  "city": "北京",
  "weather": "晴",
  "temperature": 18.3,
  "temp_max": 15,
  "temp_min": 1,
  "humidity": 20,
  "wind_direction": "西南风",
  "wind_power": "微风",
  "report_time": "7 分钟前发布",
  "aqi_category": "良",
  "aqi": 56,
  "forecast": [
    {
      "date": "2026-11-12",
      "week": "星期四",
      "weather_day": "晴",
      "temp_max": 15,
      "temp_min": 1
    }
  ]
}
```

也兼容常见的 `weather.description`、`main.temp`、`condition.text` 结构。
天气描述如果是英文（Sunny / Cloudy / Light rain…），服务端会映射为中文；
星期支持「星期四 / Thursday / 2026-11-12」三种写法，统一输出「周四」。

## 三、缓存与失败策略

| 场景 | 行为 |
|---|---|
| 页面 SSR | 只渲染空容器，不请求第三方，不阻塞首屏 |
| 前端 | `fetch('/5iblog/api?routeType=weather')` 异步填充 |
| 成功缓存 | KV `weather:cache:v1`，10 分钟 |
| 失败缓存 | 60 秒内不重复请求 |
| 接口失败 | 前端移除整个天气块，不留空白 |
| 保存天气设置 | 自动清除天气缓存，立即生效 |

接口响应限制 64KB，请求超时 4.5 秒；只允许 `http(s)` 地址。

## 四、安全

- 天气接口 URL 与 Key 只保存在站点设置中，前端只请求本站 `/5iblog/api`，不会拿到 Key。
- URL 仅接受 `http/https`，避免 `file:`、`javascript:` 等协议。
- 接口返回只做字段提取与长度限制，不把原始 JSON 直接注入页面；前端渲染统一 `escapeHtml`。
- 免费接口有 4 QPS 限制；KV 缓存 + `/5iblog/api` 的 `Cache-Control: public, max-age=300` 已足够日常访问。

## 五、验证

```bash
node test-weather.mjs
npm run build
node test-bundle.mjs
```

覆盖：默认关闭、开启后容器、中文标准化、KV 缓存、自定义 URL/Key、失败回退、天数边界。