/**
 * 侧栏天气回归：
 * - 默认关闭 / 开启后页面出现容器
 * - /5iblog/api?routeType=weather 标准化中文字段、KV 缓存、自定义 URL 与 Key
 * - 接口失败回退、英文天气与星期映射、URL 模板
 * 运行：node test-weather.mjs
 */
import assert from 'node:assert';
import { normalizeWeather, buildWeatherUrl, weatherConfig, getWeather, WEATHER_CACHE_KEY } from './src/weather.js';

process.env.LOG_LEVEL ||= 'off';

class MockKV {
  constructor() { this.map = new Map(); }
  async get(key, opts) {
    const v = this.map.get(key);
    if (v === undefined) return null;
    const type = typeof opts === 'string' ? opts : opts?.type || 'text';
    if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key, value) { this.map.set(key, String(value)); }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = '', limit = 256 } = {}) {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
    return { keys: keys.slice(0, limit).map((key) => ({ key })), complete: true, cursor: null };
  }
}
globalThis.BLOG_KV = new MockKV();

const sample = {
  province: '北京市',
  city: '北京',
  weather: '雾',
  weather_icon: '500',
  temperature: 5,
  wind_direction: '东风',
  wind_power: '1级',
  humidity: 91,
  report_time: '7 分钟前发布',
  temp_max: 15,
  temp_min: 1,
  forecast: [
    { date: '2026-11-12', week: '星期四', temp_max: 15, temp_min: 1, weather_day: '晴' },
    { date: '2026-11-13', week: '星期五', temp_max: 15, temp_min: 3, weather_day: '多云' },
    { date: '2026-11-14', week: '星期六', temp_max: 14, temp_min: 5, weather_day: '阴' },
    { date: '2026-11-15', week: '星期日', temp_max: 12, temp_min: 1, weather_day: '小雨' },
    { date: '2026-11-16', week: '星期一', temp_max: 9, temp_min: 1, weather_day: '晴' },
  ],
};

const { default: onRequest } = await import('./src/main.js');
let cookie = '';
const fetchCalls = [];
let fetchMode = 'ok';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), headers: init.headers || {} });
  if (fetchMode === 'fail') throw new Error('network down');
  return new Response(JSON.stringify(sample), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

async function call(method, path, { form, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (cookie) headers.Cookie = cookie;
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await onRequest({
    request: new Request(`https://blog.example.com${path}`, { method, headers, body, redirect: 'manual' }),
    env: {}, params: {}, waitUntil: () => {},
  });
  const sc = res.headers.get('Set-Cookie');
  if (sc && sc.split(';')[0] !== cookie) cookie = sc.split(';')[0];
  return res;
}

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (e) { results.push(`✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};

const install = await call('POST', '/install', {
  form: { title: 'T', description: 'd', name: 'admin', mail: 'admin@test.com', password: 'password123', password2: 'password123' },
});
assert.equal(install.status, 302, '安装应成功');
const login = await call('POST', '/admin/login', { form: { name: 'admin', password: 'password123', step: 'password' } });
assert.equal(login.status, 302, '管理员登录应成功');

const saveTheme = (fields) => call('POST', '/admin/settings', { form: { ...fields } });

await test('纯函数：英文天气/星期映射与 URL 模板', async () => {
  const cfg = { city: '北京', days: 3 };
  const data = normalizeWeather({
    city: '北京', weather: 'Sunny', temperature: 18.6, temp_max: 20, temp_min: 10,
    forecast: [{ date: '2026-11-12', week: 'Thursday', weather_day: 'Cloudy', temp_max: 22, temp_min: 11 }],
  }, cfg);
  assert.equal(data.weather, '晴');
  assert.equal(data.temperature, 19);
  assert.equal(data.days.length, 1);
  assert.equal(data.days[0].weather, '多云');
  assert.equal(data.days[0].week, '周四');
  assert.equal(data.tempMax, 20);

  const c1 = { api: 'https://example.com/weather?city={city}&lang=zh', city: '北京' };
  assert.ok(buildWeatherUrl(c1).includes('city=%E5%8C%97%E4%BA%AC'));
  const c2 = { api: 'https://example.com/weather', city: '110000' };
  const u2 = new URL(buildWeatherUrl(c2));
  assert.equal(u2.searchParams.get('adcode'), '110000');
  assert.equal(u2.searchParams.get('lang'), 'zh');
});

await test('默认关闭：页面无天气容器，API 返回 code 0', async () => {
  const page = await (await call('GET', '/')).text();
  assert.ok(!page.includes('id="blog-weather"'), '默认不应渲染天气容器');
  const res = await call('GET', '/5iblog/api?routeType=weather');
  const payload = await res.json();
  assert.equal(payload.code, 0);
  assert.equal(payload.data, null);
});

await test('开启后：页面出现容器，API 返回中文数据并缓存', async () => {
  await saveTheme({
    j_JWeather_Status: 'on',
    j_JWeather_City: '北京',
    j_JWeather_Api: 'https://uapis.cn/api/v1/misc/weather?city={city}&lang=zh&extended=true&forecast=true',
    j_JWeather_Days: '4',
  });
  const page = await (await call('GET', '/')).text();
  assert.ok(page.includes('id="blog-weather"'), '开启后应渲染天气容器');
  assert.ok(page.includes('data-days="4"'));
  assert.ok(page.includes('blog_weather_aside'), '天气容器应使用独立类名');
  assert.ok(!page.includes('blog_aside__item weather'), '不能复用主题原版 .weather 类，否则会触发和风天气脚本');

  fetchCalls.length = 0;
  const res = await call('GET', '/5iblog/api?routeType=weather');
  const payload = await res.json();
  assert.equal(payload.code, 1);
  assert.equal(payload.data.city, '北京');
  assert.equal(payload.data.weather, '雾');
  assert.equal(payload.data.temperature, 5);
  assert.equal(payload.data.days.length, 4);
  assert.equal(payload.data.days[0].week, '周四');
  assert.equal(payload.data.days[0].weather, '晴');
  assert.equal(fetchCalls.length, 1);
  assert.ok(fetchCalls[0].url.includes('city=%E5%8C%97%E4%BA%AC'));

  const again = await (await call('GET', '/5iblog/api?routeType=weather')).json();
  assert.equal(again.code, 1);
  assert.equal(fetchCalls.length, 1, '第二次应命中 KV 缓存，不再请求接口');
});

await test('自定义接口：{city} 替换与 Bearer Key', async () => {
  await saveTheme({
    j_JWeather_Api: 'https://example.com/weather?place={city}&lang=zh',
    j_JWeather_Key: 'secret-key',
  });
  fetchCalls.length = 0;
  const res = await call('GET', '/5iblog/api?routeType=weather');
  const payload = await res.json();
  assert.equal(payload.code, 1);
  assert.ok(fetchCalls[0].url.startsWith('https://example.com/weather?place=%E5%8C%97%E4%BA%AC'));
  assert.equal(fetchCalls[0].headers.Authorization, 'Bearer secret-key');
});

await test('接口失败：返回 code 0，60 秒内不重复请求', async () => {
  await saveTheme({ j_JWeather_Api: 'https://example.com/failing' });
  fetchMode = 'fail';
  fetchCalls.length = 0;
  const first = await (await call('GET', '/5iblog/api?routeType=weather')).json();
  assert.equal(first.code, 0);
  assert.equal(fetchCalls.length, 1);
  const second = await (await call('GET', '/5iblog/api?routeType=weather')).json();
  assert.equal(second.code, 0);
  assert.equal(fetchCalls.length, 1, '失败缓存 60 秒内不应再次请求');
  fetchMode = 'ok';
});

await test('关闭天气：页面不再渲染容器', async () => {
  await saveTheme({ j_JWeather_Status: 'off' });
  const page = await (await call('GET', '/')).text();
  assert.ok(!page.includes('id="blog-weather"'));
  const payload = await (await call('GET', '/5iblog/api?routeType=weather')).json();
  assert.equal(payload.code, 0);
});

await test('缓存键与配置边界', async () => {
  assert.equal(weatherConfig({ blog: { JWeather_Status: 'on', JWeather_Days: '99' } }).days, 7);
  assert.equal(weatherConfig({ blog: { JWeather_Status: 'on', JWeather_Days: '0' } }).days, 1);
  assert.equal(WEATHER_CACHE_KEY, 'weather:cache:v1');
  await globalThis.BLOG_KV.put(WEATHER_CACHE_KEY, JSON.stringify({ at: Date.now(), data: { weather: '晴' } }));
  const cached = await getWeather({
    db: { kv: { getJSON: async () => ({ at: Date.now(), data: { weather: '晴' } }), putJSON: async () => {} } },
    options: { blog: { JWeather_Status: 'on', JWeather_City: '北京' } },
  });
  assert.equal(cached.weather, '晴');
});

globalThis.fetch = realFetch;
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} / ${results.length} 通过`);