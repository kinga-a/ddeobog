var Be=Object.defineProperty;var Y=(s,t,a)=>()=>{if(a)throw a[0];try{return s&&(t=s(s=0)),t}catch(e){throw a=[e],e}};var lt=(s,t)=>{for(var a in t)Be(s,a,{get:t[a],enumerable:!0})};var M,Q=Y(()=>{M={KV_BINDING:"BLOG_KV",BLOB_STORE:"typecho-uploads",SESSION_COOKIE:"te_sess",REMEMBER_COOKIE:"te_remember",SESSION_TTL:604800,PAGE_SIZE:10,COMMENT_PAGE_SIZE:10,DEFAULT_THEME:"joe",VERSION:"1.0.0"}});var Ht={};lt(Ht,{KV:()=>wt,getKV:()=>ke});function ke(s){let t=M.KV_BINDING,a=null;if(s&&(a=s[t]||s[t.toLowerCase()]||null),!a&&typeof globalThis<"u"&&(a=globalThis[t]||null),!a)throw new Error(`[TypechoEdge] \u672A\u627E\u5230 KV \u7ED1\u5B9A "${t}"\u3002\u8BF7\u5728 EdgeOne \u63A7\u5236\u53F0\u521B\u5EFA KV \u547D\u540D\u7A7A\u95F4\u5E76\u4EE5\u53D8\u91CF\u540D "${t}" \u7ED1\u5B9A\u5230\u672C\u9879\u76EE\u3002`);return new wt(a)}var wt,Bt=Y(()=>{Q();wt=class{constructor(t){this.binding=t}async get(t,a="text"){return await this.binding.get(t,{type:a})}async getJSON(t){return await this.binding.get(t,{type:"json"})}async put(t,a){await this.binding.put(t,a)}async putJSON(t,a){await this.binding.put(t,JSON.stringify(a))}async delete(t){await this.binding.delete(t)}async listKeys(t="",a=1e4){let e=[],n,o=!1;for(;!o&&e.length<a;){let i=await this.binding.list({prefix:t,cursor:n,limit:256});if(!i)break;for(let r of i.keys||[])e.push(r.key);if(o=i.complete!==!1,n=i.cursor,o||!n)break}return e}}});var ct={};lt(ct,{hashPassword:()=>Se,randomHex:()=>Yt,verifyPassword:()=>bt});function Yt(s=16){let t=new Uint8Array(s);return crypto.getRandomValues(t),Array.from(t).map(a=>a.toString(16).padStart(2,"0")).join("")}function qt(s){let t=new Uint8Array(s),a="";for(let e=0;e<t.length;e+=32768)a+=String.fromCharCode.apply(null,t.subarray(e,e+32768));return btoa(a)}async function Kt(s,t,a){let e=new TextEncoder,n=await crypto.subtle.importKey("raw",e.encode(s),"PBKDF2",!1,["deriveBits"]);return await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:e.encode(t),iterations:a},n,256)}async function Se(s){let t=Yt(16),a=await Kt(s,t,1e5);return`pbkdf2$100000$${t}$${qt(a)}`}async function bt(s,t){if(!t||typeof t!="string")return!1;let a=t.split("$");if(a[0]!=="pbkdf2"||a.length!==4)return!1;let e=parseInt(a[1],10),n=a[2],o=a[3],i=qt(await Kt(s,n,e));if(i.length!==o.length)return!1;let r=0;for(let l=0;l<i.length;l++)r|=i.charCodeAt(l)^o.charCodeAt(l);return r===0}var X=Y(()=>{});function p(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function q(s,t=100){let a=s.indexOf("<!--more-->"),e=a>=0?s.slice(0,a):s;return e=e.replace(/```[\s\S]*?```/g," ").replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/[#>*_~`\-]+/g," ").replace(/\s+/g," ").trim(),e.length>t?e.slice(0,t)+"...":e}function Qt(s){if(!s)return"";let t=String(s).replace(/\r\n?/g,`
`).split(`
`),a=[],e=0,n=!1,o=()=>{n&&(a.push("</blockquote>"),n=!1)};for(;e<t.length;){let i=t[e],r=i.match(/^```(\w*)\s*$/);if(r){o();let d=r[1],m=[];for(e++;e<t.length&&!/^```\s*$/.test(t[e]);)m.push(t[e]),e++;e++,a.push(`<pre><code class="language-${p(d)}">${p(m.join(`
`))}</code></pre>`);continue}if(!i.trim()){o(),e++;continue}let l=i.match(/^(#{1,6})\s+(.*)$/);if(l){o();let d=l[1].length;a.push(`<h${d} id="${Ie(l[2])}">${tt(l[2])}</h${d}>`),e++;continue}if(/^(\*{3,}|-{3,}|_{3,})\s*$/.test(i)){o(),a.push("<hr>"),e++;continue}if(/^>\s?/.test(i)){n||(a.push("<blockquote>"),n=!0),a.push(`<p>${tt(i.replace(/^>\s?/,""))}</p>`),e++;continue}if(o(),/^[-*+]\s+/.test(i)){let d=[];for(;e<t.length&&/^[-*+]\s+/.test(t[e]);)d.push(`<li>${tt(t[e].replace(/^[-*+]\s+/,""))}</li>`),e++;a.push(`<ul>${d.join("")}</ul>`);continue}if(/^\d+[.)]\s+/.test(i)){let d=[];for(;e<t.length&&/^\d+[.)]\s+/.test(t[e]);)d.push(`<li>${tt(t[e].replace(/^\d+[.)]\s+/,""))}</li>`),e++;a.push(`<ol>${d.join("")}</ol>`);continue}if(i.includes("|")&&e+1<t.length&&/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(t[e+1])){o();let d=Zt(i);e+=2;let m=[];for(;e<t.length&&t[e].includes("|")&&t[e].trim();)m.push(Zt(t[e])),e++;let g="<table><thead><tr>";for(let y of d)g+=`<th>${tt(y)}</th>`;g+="</tr></thead><tbody>";for(let y of m){g+="<tr>";for(let x of y)g+=`<td>${tt(x)}</td>`;g+="</tr>"}g+="</tbody></table>",a.push(g);continue}let c=i.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);if(c){let d=c[2].split(/\s+/)[0];a.push(`<img src="${p(d)}" alt="${p(c[1])}" class="joe_detail__article-image" loading="lazy" />`),e++;continue}let w=[i];for(e++;e<t.length&&t[e].trim()&&!/^(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(t[e])&&!/^(\*{3,}|-{3,}|_{3,})\s*$/.test(t[e]);)w.push(t[e]),e++;a.push(`<p>${tt(w.join(`
`)).replace(/\n/g,"<br>")}</p>`)}return o(),a.join(`
`)}function Zt(s){return s.trim().replace(/^\||\|$/g,"").split("|").map(t=>t.trim())}function Ie(s){return p(String(s).trim().toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g,"-").replace(/^-|-$/g,"")||"h")}function tt(s){let t=p(s);return t=t.replace(/`([^`]+)`/g,(a,e)=>`${e}`),t=t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,(a,e,n)=>`<img src="${n}" alt="${e}" loading="lazy" />`),t=t.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,(a,e,n)=>`<a href="${n}" target="_blank" rel="noopener noreferrer">${e}</a>`),t=t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,(a,e,n)=>`${e}<a href="${n}" target="_blank" rel="noopener noreferrer">${n}</a>`),t=t.replace(/\*\*\*([^*]+)\*\*\*/g,"<strong><em>$1</em></strong>"),t=t.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>"),t=t.replace(/\*([^*\n]+)\*/g,"<em>$1</em>"),t=t.replace(/~~([^~]+)~~/g,"<del>$1</del>"),t=t.replace(/\u0001([^\u0002]*)\u0002/g,"<code>$1</code>"),t}var at=Y(()=>{});function jt(s,t,a,e=2){if(t<=1)return"";let n=(c,w,d="")=>{let m=c===1?a:`${a}${a.includes("?")?"&":"?"}page=${c}`;return`<li class="${d}"><a href="${m}" title="\u7B2C ${c} \u9875">${w}</a></li>`},o='<ul class="joe_pagination">';s>1&&(o+=n(s-1,"&laquo;","prev"));let i=new Set([1,t,s]);for(let c=1;c<=e;c++)s-c>=1&&i.add(s-c),s+c<=t&&i.add(s+c);let r=[...i].sort((c,w)=>c-w),l=0;for(let c of r)c-l>1&&(o+='<li class="gap"><a>...</a></li>'),o+=n(c,String(c),c===s?"active":""),l=c;return s<t&&(o+=n(s+1,"&raquo;","next")),o+="</ul>",o}function pt(s,t=100){let a=String(s||"").trim().toLowerCase();return a?`https://weavatar.com/avatar/${encodeURIComponent(a)}?default=mp&size=${t}`:"https://cravatar.cn/avatar/?d=mp&s="+t}function L(s,t="Y-m-d"){let a=new Date(s*1e3),e=n=>String(n).padStart(2,"0");return t.replace(/Y/g,a.getFullYear()).replace(/m/g,e(a.getMonth()+1)).replace(/d/g,e(a.getDate())).replace(/H/g,e(a.getHours())).replace(/i/g,e(a.getMinutes())).replace(/s/g,e(a.getSeconds()))}function yt(s,t){let a=s.fields||{};if(a.thumb)return a.thumb;let e=(s.text||"").match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/);if(e)return e[1];let n=s.cid%42+1;return`${t}/thumb/${n}.jpg`}var It=Y(()=>{at()});var Jt={};lt(Jt,{JOE_DEFAULTS:()=>st,THEME_NAME:()=>Me,assetsUrl:()=>P,contentMetas:()=>Xt,permalink:()=>K,render404:()=>Pt,renderArchive:()=>Lt,renderIndex:()=>Tt,renderPost:()=>Nt,setOwoMap:()=>Rt,setThemeContext:()=>Dt});function P(s,t){return`${s.themeAssetsBase||"/usr/themes/joe"}/${t}`}function Oe(s,t={}){let{options:a}=s,e=n=>P(a,n);return`<script>
  localStorage.getItem("data-night") && document.querySelector("html").setAttribute("data-night", "night");
  window.Joe = {
    THEME_URL: \`${e("")}\`,
    BASE_API: \`/joe/api\`,
    DYNAMIC_BACKGROUND: \`\`,
    WALLPAPER_BACKGROUND_PC: \`\`,
    IS_MOBILE: /windows phone|iphone|android/gi.test(window.navigator.userAgent),
    BAIDU_PUSH: false,
    DOCUMENT_TITLE: \`${p(a.joe.JDocumentTitle||"")}\`,
    LAZY_LOAD: \`${e("assets/img/lazyload.jpg")}\`,
    BIRTHDAY: \`${p(a.joe.JBirthDay||"")}\`,
    MOTTO: \`${p(a.joe.JAside_Author_Motto||"")}\`,
    PAGE_SIZE: ${s.pageSize||10}
  }
<\/script>
<style>
  body { font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '\u5FAE\u8F6F\u96C5\u9ED1', Arial, sans-serif; }
</style>`}function Te(s,t=[]){let a=n=>P(s.options,n);return[a("assets/css/joe.mode.min.css"),a("assets/css/joe.normalize.min.css"),a("assets/css/joe.global.min.css"),a("assets/css/joe.responsive.min.css"),a("assets/lib/qmsg/qmsg.min.css"),a("assets/lib/fancybox@3.5.7/fancybox.min.css"),a("assets/lib/animate.css@4.1.1/animate.min.css"),a("assets/lib/font-awesome@4.7.0/font-awesome.min.css"),a("assets/lib/APlayer@1.10.1/APlayer.min.css"),...t].map(n=>`<link href="${n}" rel="stylesheet" />`).join(`
`)}function Ne(s,t=[]){let a=n=>P(s.options,n);return[a("assets/lib/jquery@3.6.1/jquery.min.js"),a("assets/lib/scroll/scroll.min.js"),a("assets/lib/lazysizes@5.3.2/lazysizes.min.js"),a("assets/lib/APlayer@1.10.1/APlayer.min.js"),a("assets/lib/sketchpad/sketchpad.min.js"),a("assets/lib/fancybox@3.5.7/fancybox.min.js"),a("assets/lib/extend/extend.min.js"),a("assets/lib/qmsg/qmsg.min.js"),a("assets/js/joe.global.min.js"),a("assets/js/joe.short.min.js"),...t].map(n=>`<script src="${n}"><\/script>`).join(`
`)}function De(s){let{options:t,pages:a,path:e}=s,n=parseInt(t.joe.JNavMaxNum||"6",10),o=a.slice(0,n),i=a.slice(n),r=e==="/";return`<header class="joe_header${s.isPost?" current":""}">
  <div class="joe_header__above">
    <div class="joe_container">
      <svg class="joe_header__above-slideicon" viewBox="0 0 1152 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M76.032 872a59.968 59.968 0 1 0 0 120h999.936a59.968 59.968 0 1 0 0-120H76.032zm16-420.032a59.968 59.968 0 1 0 0 120h599.936a59.968 59.968 0 0 0 0-119.936H92.032zM76.032 32a59.968 59.968 0 1 0 0 120h999.936a60.032 60.032 0 0 0 0-120H76.032z"/></svg>
      <a title="${p(t.title)}" class="joe_header__above-logo" href="/">
        <img class="lazyload" src="${U}" data-src="${p(t.joe.JLogo)}" alt="${p(t.title)}" />
      </a>
      <nav class="joe_header__above-nav">
        <a class="item${r?" active":""}" href="/" title="\u9996\u9875">\u9996\u9875</a>
        ${o.map(l=>`<a class="item${e===l.permalink?" active":""}" href="${l.permalink}" title="${p(l.title)}">${p(l.title)}</a>`).join("")}
        ${i.length?`<div class="joe_dropdown" trigger="hover" placement="60px" style="margin-right: 15px;">
          <div class="joe_dropdown__link"><a href="#" rel="nofollow">\u66F4\u591A</a></div>
          <nav class="joe_dropdown__menu">${i.map(l=>`<a href="${l.permalink}">${p(l.title)}</a>`).join("")}</nav>
        </div>`:""}
      </nav>
      <div class="joe_header__above-search">
        <svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M1004.257 874.846 768.898 639.488a385.526 385.526 0 0 0 44.851-178.637C813.749 259.91 654.353 100.513 457.287 100.513S100.825 259.91 100.825 456.977c0 197.066 159.396 356.462 356.462 356.462 64.819 0 125.602-17.36 178.637-44.851l235.358 235.358a35.607 35.607 0 0 0 50.397 0l42.578-42.578a35.607 35.607 0 0 0 0-50.397zM457.287 723.833c-147.386 0-266.856-119.47-266.856-266.856s119.47-266.856 266.856-266.856 266.856 119.47 266.856 266.856-119.47 266.856-266.856 266.856z"/></svg>
        <input type="text" class="input search-input" placeholder="\u641C\u7D22\u5185\u5BB9..." autocomplete="off" />
        <div class="result"></div>
      </div>
      <svg class="joe_header__above-searchicon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M1004.257 874.846 768.898 639.488a385.526 385.526 0 0 0 44.851-178.637C813.749 259.91 654.353 100.513 457.287 100.513S100.825 259.91 100.825 456.977c0 197.066 159.396 356.462 356.462 356.462 64.819 0 125.602-17.36 178.637-44.851l235.358 235.358a35.607 35.607 0 0 0 50.397 0l42.578-42.578a35.607 35.607 0 0 0 0-50.397zM457.287 723.833c-147.386 0-266.856-119.47-266.856-266.856s119.47-266.856 266.856-266.856 266.856 119.47 266.856 266.856-119.47 266.856-266.856 266.856z"/></svg>
    </div>
  </div>
  <div class="joe_header__slideout">
    <div class="joe_header__slideout-wrap">
      <nav class="joe_header__slideout-menu">
        <a class="item${r?" current":""}" href="/">\u9996\u9875</a>
        ${a.map(l=>`<a class="item${e===l.permalink?" current":""}" href="${l.permalink}">${p(l.title)}</a>`).join("")}
      </nav>
    </div>
  </div>
  <div class="joe_header__searchout">
    <div class="joe_container">
      <div class="joe_header__searchout-inner">
        <input type="text" class="input search-input" placeholder="\u641C\u7D22\u5185\u5BB9..." autocomplete="off" />
        <button class="submit search-btn">\u641C\u7D22</button>
      </div>
    </div>
  </div>
  <div class="joe_header__mask"></div>
</header>`}async function Ot(s){let{options:t,db:a,user:e}=s,n=g=>P(t,g),o=(await a.listUsers()).find(g=>g.group==="administrator")||{},r={posts:(await a.listContents({type:"post",pageSize:1})).total,comments:(await a.listAllComments({status:"approved",pageSize:1})).total},l=await a.listContents({type:"post",pageSize:parseInt(t.joe.JAside_Hot_Num||"5",10)||5,order:"views"}),c=await Promise.all(l.items.map(async g=>({...g,views:await a.getStat(g.cid,"views")}))),w=await a.recentComments(5),d=await a.listMetas("tag"),m=`<aside class="joe_aside">
  <section class="joe_aside__item author">
    <img width="100%" height="120" class="image lazyload" src="${U}" data-src="${p(t.joe.JAside_Author_Image)}" alt="\u535A\u4E3B\u680F\u58C1\u7EB8" />
    <div class="user">
      <img width="75" height="75" class="avatar lazyload" src="${U}" data-src="${p(t.joe.JAside_Author_Avatar||pt(o.mail))}" alt="\u535A\u4E3B\u5934\u50CF" />
      <a class="link" href="${p(t.joe.JAside_Author_Link)}" target="_blank" rel="noopener noreferrer nofollow">${p(t.joe.JAside_Author_Nick||o.screenName||"\u535A\u4E3B")}</a>
      <p class="motto joe_motto"></p>
    </div>
    <div class="count">
      <div class="item" title="\u7D2F\u8BA1\u6587\u7AE0\u6570"><span class="num">${r.posts}</span><span>\u6587\u7AE0\u6570</span></div>
      <div class="item" title="\u7D2F\u8BA1\u8BC4\u8BBA\u6570"><span class="num">${r.comments}</span><span>\u8BC4\u8BBA\u91CF</span></div>
    </div>
  </section>`;return t.joe.JAside_Timelife_Status==="on"&&(m+=`<section class="joe_aside__item timelife">
      <div class="joe_aside__item-title"><span class="text">\u4EBA\u751F\u5012\u8BA1\u65F6</span><span class="line"></span></div>
      <div class="joe_aside__item-contain"></div>
    </section>`),c.length&&(m+=`<section class="joe_aside__item hot">
      <div class="joe_aside__item-title"><span class="text">\u70ED\u95E8\u6587\u7AE0</span><span class="line"></span></div>
      <ol class="joe_aside__item-contain">
        ${c.map((g,y)=>`<li class="item">
          <a class="link" href="${K(g)}" title="${p(g.title)}">
            <i class="sort">${y+1}</i>
            <img width="100%" height="130" class="image lazyload" src="${U}" data-src="${p(yt(g,n("assets")))}" alt="${p(g.title)}" />
            <div class="describe"><h6>${p(g.title)}</h6><span>${g.views} \u9605\u8BFB - ${L(g.created,"m/d")}</span></div>
          </a>
        </li>`).join("")}
      </ol>
    </section>`),t.joe.JAside_Newreply_Status==="on"&&w.length&&(m+=`<section class="joe_aside__item newreply">
      <div class="joe_aside__item-title"><span class="text">\u6700\u65B0\u56DE\u590D</span><span class="line"></span></div>
      <ul class="joe_aside__item-contain">
        ${w.map(g=>`<li class="item">
          <div class="user">
            <img width="40" height="40" class="avatar lazyload" src="${U}" data-src="${pt(g.mail)}" alt="${p(g.author)}" />
            <div class="info"><div class="author">${p(g.author)}</div><span class="date">${L(g.created,"Y-m-d")}</span></div>
          </div>
          <div class="reply"><a class="link" href="${Re(a,g)}">${p(q(g.text,40))}</a></div>
        </li>`).join("")}
      </ul>
    </section>`),t.joe.JAside_3DTag==="on"&&d.length&&(m+=`<section class="joe_aside__item tags">
      <div class="joe_aside__item-title"><span class="text">\u6807\u7B7E\u4E91</span><span class="line"></span></div>
      <div class="joe_aside__item-contain">
        <div class="tag"></div>
        <ul class="list" style="display: none;">
          ${d.map(g=>`<li data-url="/tag/${encodeURIComponent(g.slug)}/" data-label="${p(g.name)}"></li>`).join("")}
        </ul>
      </div>
    </section>`),t.joe.JAside_Flatterer==="on"&&(m+=`<section class="joe_aside__item flatterer">
      <div class="joe_aside__item-title"><span class="text">\u8214\u72D7\u65E5\u8BB0</span><span class="line"></span></div>
      <div class="joe_aside__item-contain"><div class="content"></div><div class="change">\u6362\u4E00\u7BC7</div></div>
    </section>`),m+="</aside>",m}function Re(s,t){return`/archives/${t.cid}/#comment-${t.coid}`}function Le(s){let{options:t}=s;return`<footer class="joe_footer">
  <div class="joe_container">
    <div class="joe_footer__above">
      <div class="joe_footer__above-item">
        <a href="/" title="${p(t.title)}">${p(t.title)}</a>
        <em>|</em>
        <span>Powered by <a href="https://github.com/typecho/typecho" target="_blank" rel="noopener noreferrer">Typecho</a> . Theme by <a href="https://78.al" target="_blank" rel="noopener noreferrer">Joe</a> . Hosted on <a href="https://edgeone.ai" target="_blank" rel="noopener noreferrer">EdgeOne</a></span>
      </div>
      <div class="joe_footer__above-item">
        ${t.joe.JICP?`<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${p(t.joe.JICP)}</a>`:""}
        ${t.joe.JFooter_Custom||""}
      </div>
    </div>
    <div class="joe_footer__below">
      <div class="joe_footer__below-item run">
        <span class="text">\u5DF2\u8FD0\u884C</span>
        <span class="joe_run__day">0</span><span class="text">\u5929</span>
        <span class="joe_run__hour">0</span><span class="text">\u5C0F\u65F6</span>
        <span class="joe_run__minute">0</span><span class="text">\u5206</span>
        <span class="joe_run__second">0</span><span class="text">\u79D2</span>
      </div>
      <div class="joe_footer__below-item">
        <span>\xA9 ${new Date().getFullYear()} ${p(t.title)} \xB7 ${p(t.description||"")}</span>
      </div>
    </div>
  </div>
</footer>
<div class="joe_action">
  <div class="joe_action_item mode">
    <svg class="icon-1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M948.8 576L768 768v64h-64L512 1024l-64-64-256 64 64-256-64-64 192-192v-64h64l192-192 64 64 256-64-64 256 64 64-64 64-128 128h64z"/></svg>
    <svg class="icon-2" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M512 64a448 448 0 1 0 448 448A448 448 0 0 0 512 64zm0 832a384 384 0 0 1-32-765.76V896a381.44 381.44 0 0 1-32 0z"/></svg>
  </div>
  <div class="joe_action_item scroll">
    <svg class="icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><path d="M512 64a448 448 0 1 0 448 448A448 448 0 0 0 512 64zm0 832a384 384 0 0 1-32-765.76V896a381.44 381.44 0 0 1-32 0z"/></svg>
  </div>
</div>`}function _t(s,{title:t,meta:a="",css:e=[],js:n=[],bodyClass:o=""}){let{options:i}=s;return`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="renderer" content="webkit" />
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, shrink-to-fit=no, viewport-fit=cover">
  <link rel="shortcut icon" href="${p(i.joe.JFavicon)}" />
  <title>${t}</title>
  ${a}
  ${Te(s,e)}
  ${Oe(s)}
  ${Ne(s,n)}
</head>
<body${o?` class="${o}"`:""}>
  <div id="Joe">
    ${De(s)}
    ${s.contentBody||""}
    ${Le(s)}
  </div>
</body>
</html>`}function K(s){return s.type==="page"?`/${s.slug}/`:s.type==="attachment"?`/attachment/${s.cid}/`:`/archives/${s.cid}/`}async function Xt(s,t){let a=[],e=[];for(let n of t.categories||[]){let o=await s.getMeta(n);o&&a.push({...o,permalink:`/category/${encodeURIComponent(o.slug)}/`})}for(let n of t.tags||[]){let o=await s.getMeta(n);o&&e.push({...o,permalink:`/tag/${encodeURIComponent(o.slug)}/`})}return{cats:a,tags:e}}async function Tt(s){let t=o=>P(s.options,o),{list:a,page:e}=s,n=a.items.map(o=>te(s,o)).join("");return s.contentBody=`<div class="joe_container">
    <div class="joe_main">
      <div class="joe_index">
        <div class="joe_index__title">
          <ul class="joe_index__title-title">
            <li class="item" data-type="created">\u6700\u65B0\u6587\u7AE0</li>
            <li class="item" data-type="views">\u70ED\u95E8\u6587\u7AE0</li>
            <li class="item" data-type="commentsNum">\u8BC4\u8BBA\u6700\u591A</li>
            <li class="item" data-type="agree">\u70B9\u8D5E\u6700\u591A</li>
            <li class="line"></li>
          </ul>
        </div>
        <div class="joe_index__list" data-wow="off">
          <ul class="joe_list">${n}</ul>
          <ul class="joe_list__loading" style="display:none"></ul>
        </div>
        ${jt(e,a.pages,"/")}
        <div class="joe_load" style="display:none">\u67E5\u770B\u66F4\u591A</div>
      </div>
    </div>
    ${await Ot(s)}
  </div>`,_t(s,{title:`${p(s.options.title)} - ${p(s.options.description||"")}`,css:[t("assets/lib/swiper@5.4.5/swiper.min.css"),t("assets/css/joe.index.min.css")],js:[t("assets/lib/swiper@5.4.5/swiper.min.js"),t("assets/lib/wowjs@1.1.3/wow.min.js"),t("assets/js/joe.index.min.js")]})}function te(s,t){let a=e=>P(s.options,e);return`<li class="joe_list__item default">
  <div class="line"></div>
  <a href="${K(t)}" class="thumbnail" title="${p(t.title)}" target="_blank" rel="noopener noreferrer">
    <img width="100%" height="100%" class="lazyload" src="${U}" data-src="${p(yt(t,a("assets")))}" alt="${p(t.title)}" />
    <time datetime="${L(t.created,"Y-m-d")}">${L(t.created,"Y-m-d")}</time>
  </a>
  <div class="information">
    <a href="${K(t)}" class="title" title="${p(t.title)}" target="_blank" rel="noopener noreferrer">${p(t.title)}</a>
    <a class="abstract" href="${K(t)}" title="\u6587\u7AE0\u6458\u8981" target="_blank" rel="noopener noreferrer">${p(t.fields?.abstract||q(t.text,90))}</a>
    <div class="meta">
      <ul class="items">
        <li>${L(t.created,"Y-m-d")}</li>
        <li>${t.views??0} \u9605\u8BFB</li>
        <li>${t.commentsNum||0} \u8BC4\u8BBA</li>
        <li>${t.agree??0} \u70B9\u8D5E</li>
      </ul>
    </div>
  </div>
</li>`}async function Nt(s){let t=y=>P(s.options,y),{post:a,db:e}=s,{cats:n,tags:o}=await Xt(e,a),i=await e.getUser(a.authorId)||{screenName:"\u535A\u4E3B",mail:""},{prev:r,next:l}=await e.prevNext(a.cid,a.type),c=await e.getStat(a.cid,"views"),w=await e.getStat(a.cid,"agree"),d=(await e.listContents({type:"post",pageSize:4,tagMid:a.tags?.[0]})).items.filter(y=>y.cid!==a.cid).slice(0,3),m=n.length?`<div class="joe_detail__category">${n.slice(0,5).map((y,x)=>`<a href="${y.permalink}" class="item item-${x}" title="${p(y.name)}">${p(y.name)}</a>`).join("")}</div>`:"";s.contentBody=`<div class="joe_container joe_bread">
    <ul class="joe_bread__bread">
      <li class="item"><a href="/" class="link" title="\u9996\u9875">\u9996\u9875</a></li>
      ${n.length?`<li class="line">/</li><li class="item"><a class="link" href="${n[0].permalink}" title="${p(n[0].name)}">${p(n[0].name)}</a></li><li class="line">/</li>`:'<li class="line">/</li>'}
      <li class="item">\u6B63\u6587</li>
    </ul>
  </div>
  <div class="joe_container">
    <div class="joe_main joe_post">
      <div class="joe_detail" data-cid="${a.cid}">
        ${m}
        <h1 class="joe_detail__title">${p(a.title)}</h1>
        <div class="joe_detail__count">
          <div class="joe_detail__count-information">
            <img width="35" height="35" class="avatar lazyload" src="${U}" data-src="${pt(i.mail)}" alt="${p(i.screenName)}" />
            <div class="meta">
              <div class="author"><a class="link" href="/author/${a.authorId}/" title="${p(i.screenName)}">${p(i.screenName)}</a></div>
              <div class="item">
                <span class="text">${L(a.created,"Y-m-d")}</span>
                <span class="line">/</span>
                <span class="text">${a.commentsNum||0} \u8BC4\u8BBA</span>
                <span class="line">/</span>
                <span class="text" id="Joe_Article_Views">${c} \u9605\u8BFB</span>
              </div>
            </div>
          </div>
          <time class="joe_detail__count-created" datetime="${L(a.created,"m/d")}">${L(a.created,"m/d")}</time>
        </div>
        <article class="joe_detail__article">
          ${Qt(a.text)}
        </article>
        ${o.length?`<div class="joe_detail__tags">${o.map(y=>`<a href="${y.permalink}" title="${p(y.name)}">${p(y.name)}</a>`).join("")}</div>`:""}
        <div class="joe_detail__agree">
          <div class="agree">
            <div class="icon">
              <svg class="icon-1" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M736 128c-65.952 0-128.576 25.024-176.384 70.464-4.576 4.32-28.672 28.736-47.328 47.68L464.96 199.04C417.12 153.216 354.272 128 288 128 146.848 128 32 242.848 32 384c0 82.432 41.184 144.288 76.48 182.496l316.896 320.128C450.464 911.68 478.304 928 512 928s61.568-16.32 86.752-41.504l316.736-320 2.208-2.464C955.904 516.384 992 471.392 992 384c0-141.152-114.848-256-256-256z" fill="#fff"/></svg>
              <svg class="icon-2" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M512 928c-28.928 0-57.92-12.672-86.624-41.376L106.272 564C68.064 516.352 32 471.328 32 384c0-141.152 114.848-256 256-256 53.088 0 104 16.096 147.296 46.592 14.432 10.176 17.92 30.144 7.712 44.608-10.176 14.432-30.08 17.92-44.608 7.712C366.016 204.064 327.808 192 288 192c-105.888 0-192 86.112-192 192 0 61.408 20.288 90.112 59.168 138.688l315.584 318.816C486.72 857.472 499.616 863.808 512 864c12.704.192 24.928-6.176 41.376-22.624l316.672-319.904C896.064 493.28 928 445.696 928 384c0-105.888-86.112-192-192-192-48.064 0-94.08 17.856-129.536 50.272l-134.08 134.112c-12.512 12.512-32.736 12.512-45.248 0s-12.512-32.736 0-45.248L562.24 196c48.32-44.192 109.664-68 173.76-68 141.152 0 256 114.848 256 256 0 82.368-41.152 144.288-75.68 181.696l-317.568 320.8C569.952 915.328 540.96 928 512 928z" fill="#fff"/></svg>
            </div>
            <span class="text">${w}</span>
          </div>
        </div>
        ${d.length?`<div class="joe_detail__related">
          <div class="joe_detail__related-title">\u76F8\u5173\u63A8\u8350</div>
          <div class="joe_detail__related-content">
            ${d.map(y=>`<a class="item" href="${K(y)}" title="${p(y.title)}">
              <img width="100%" height="120" class="lazyload" src="${U}" data-src="${p(yt(y,t("assets")))}" alt="${p(y.title)}" />
              <div class="title">${p(y.title)}</div>
            </a>`).join("")}
          </div>
        </div>`:""}
        <ul class="joe_post__pagination">
          ${r?`<li class="joe_post__pagination-item prev"><a href="${K(r)}" title="${p(r.title)}">${p(r.title)}</a></li>`:""}
          ${l?`<li class="joe_post__pagination-item next"><a href="${K(l)}" title="${p(l.title)}">${p(l.title)}</a></li>`:""}
        </ul>
        ${await Pe(s,a)}
      </div>
      ${await Ot(s)}
    </div>
  </div>`;let g=a.fields?.description||q(a.text,120);return _t(s,{title:`${p(a.title)} - ${p(s.options.title)}`,meta:`<meta name="description" content="${p(g)}" />${a.fields?.keywords||o.length?`<meta name="keywords" content="${p(a.fields?.keywords||o.map(y=>y.name).join(","))}" />`:""}`,css:[t("assets/lib/prism/prism.min.css"),t("assets/css/joe.post.min.css")],js:[t("assets/lib/clipboard@2.0.11/clipboard.min.js"),t("assets/lib/prism/prism.min.js"),t("assets/js/joe.post_page.min.js")]})}async function Pe(s,t){if(!t.allowComment||s.options.joe.JCommentStatus==="off")return'<div class="joe_comment"><h3 class="joe_comment__title">\u8BC4\u8BBA</h3><div class="joe_comment__close"><span>\u535A\u4E3B\u5173\u95ED\u4E86\u8BC4\u8BBA</span></div></div>';let{db:a,csrfToken:e,user:n}=s,o=await a.listComments(t.cid),i=new Map;for(let c of o)i.has(c.parent)||i.set(c.parent,[]),i.get(c.parent).push(c);let r=(c,w=0)=>{let d=i.get(c.coid)||[];return`<li class="comment-list__item">
      <div class="comment-list__item-contain" id="comment-${c.coid}">
        <div class="term">
          <img width="48" height="48" class="avatar lazyload" src="${U}" data-src="${pt(c.mail)}" alt="\u5934\u50CF" />
          <div class="content">
            <div class="user">
              <span class="author">${p(c.author)}</span>
              ${c.authorId&&c.authorId===t.authorId?'<i class="owner">\u4F5C\u8005</i>':""}
              <div class="agent">${Ue(c.agent)} \xB7 ${ze(c.agent)}</div>
            </div>
            <div class="substance">${Je(c.text)}</div>
            <div class="handle">
              <time class="date" datetime="${L(c.created,"Y-m-d")}">${L(c.created,"Y-m-d")}</time>
              <span class="reply joe_comment__reply" data-id="comment-${c.coid}" data-coid="${c.coid}">
                <i class="icon fa fa-pencil" aria-hidden="true"></i>\u56DE\u590D
              </span>
            </div>
          </div>
        </div>
      </div>
      ${d.length?`<div class="comment-list__item-children"><ul class="comment-list">${d.map(m=>r(m,w+1)).join("")}</ul></div>`:""}
    </li>`},l=i.get(0)||[];return`<div class="joe_comment">
  <h3 class="joe_comment__title">\u8BC4\u8BBA (${t.commentsNum||0})</h3>
  <div id="respond" class="joe_comment__respond">
    <div class="joe_comment__respond-type">
      <button class="item" data-type="draw">\u753B\u56FE\u6A21\u5F0F</button>
      <button class="item active" data-type="text">\u6587\u672C\u6A21\u5F0F</button>
    </div>
    <form method="post" class="joe_comment__respond-form" action="/comment/${t.cid}" data-type="text">
      <input type="hidden" name="_" value="${e}" />
      <div class="head">
        <div class="list"><input type="text" value="${p(n?.screenName||"")}" autocomplete="off" name="author" maxlength="16" placeholder="\u8BF7\u8F93\u5165\u6635\u79F0..." /></div>
        <div class="list"><input type="text" value="${p(n?.mail||"")}" autocomplete="off" name="mail" placeholder="\u8BF7\u8F93\u5165\u90AE\u7BB1..." /></div>
        <div class="list"><input type="text" autocomplete="off" name="url" placeholder="\u8BF7\u8F93\u5165\u7F51\u5740\uFF08\u975E\u5FC5\u586B\uFF09..." /></div>
      </div>
      <div class="body">
        <textarea class="text joe_owo__target" name="text" autocomplete="new-password" placeholder="\u8BF4\u70B9\u4EC0\u4E48\u5427\uFF0C\u70B9\u51FB\u53F3\u4E0A\u65B9\u5207\u6362\u6210\u753B\u56FE\u8BD5\u8BD5\uFF1F"></textarea>
        <div class="draw" style="display: none;">
          <ul class="line"><li data-line="3">\u7EC6</li><li data-line="5" class="active">\u4E2D</li><li data-line="8">\u7C97</li></ul>
          <ul class="color"><li data-color="#303133" class="active"></li><li data-color="#67c23a"></li><li data-color="#e6a23c"></li><li data-color="#f56c6c"></li></ul>
          <canvas id="joe_comment_draw" height="300"></canvas>
        </div>
      </div>
      <div class="foot">
        <div class="owo joe_owo__contain"></div>
        <div class="submit"><span class="cancle joe_comment__cancle">\u53D6\u6D88</span><button type="submit">\u53D1\u9001\u8BC4\u8BBA</button></div>
      </div>
    </form>
  </div>
  ${l.length?`<ul class="comment-list">${l.map(c=>r(c)).join("")}</ul>`:""}
</div>`}function Je(s){let t=ee.options.themeAssetsBase||"/usr/themes/joe",a=p(s||"");return a=a.replace(/\{!\{(.+?)\}!\}/g,(e,n)=>`<img class="owo_image" src="${n}" alt="\u753B\u56FE\u8BC4\u8BBA" />`),a=a.replace(/::\((.+?)\)/g,(e,n)=>{for(let o of Object.keys(Mt)){let i=Mt[o].find(r=>r.data===e);if(i)return i.icon.includes(".png")?`<img class="owo_image" src="${t}/${i.icon}" alt="${n}" />`:i.icon}return e}),a.replace(/\n/g,"<br>")}function Dt(s){ee=s}function Rt(s){Mt=s}function Ue(s){let t=s||"";return/windows/i.test(t)?"Windows":/android/i.test(t)?"Android":/iphone|ipad/i.test(t)?"iOS":/mac os/i.test(t)?"MacOS":/linux/i.test(t)?"Linux":"\u5176\u4ED6"}function ze(s){let t=s||"";return/edg\//i.test(t)?"Edge":/chrome/i.test(t)?"Chrome":/firefox/i.test(t)?"Firefox":/safari/i.test(t)?"Safari":"\u5176\u4ED6"}async function Lt(s){let t=i=>P(s.options,i),{list:a,page:e,archiveTitle:n}=s,o=a.items.map(i=>te(s,i)).join("");return s.contentBody=`<div class="joe_container joe_bread">
    <ul class="joe_bread__bread">
      <li class="item"><a href="/" class="link" title="\u9996\u9875">\u9996\u9875</a></li>
      <li class="line">/</li>
      <li class="item">${p(n)}</li>
    </ul>
  </div>
  <div class="joe_container">
    <div class="joe_main joe_archive">
      <div class="joe_archive__title">${p(n)}</div>
      <div class="joe_archive__list">
        <ul class="joe_list">${o||'<li class="empty">\u6682\u65E0\u5185\u5BB9</li>'}</ul>
      </div>
      ${jt(e,a.pages,s.archiveBaseUrl)}
    </div>
    ${await Ot(s)}
  </div>`,_t(s,{title:`${p(n)} - ${p(s.options.title)}`,css:[t("assets/css/joe.archive.min.css")]})}async function Pt(s){let t=a=>P(s.options,a);return s.contentBody=`<div class="joe_container">
    <div class="joe_main">
      <div class="joe_404">
        <h1>404</h1>
        <p>\u62B1\u6B49\uFF0C\u60A8\u8BBF\u95EE\u7684\u9875\u9762\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u5220\u9664</p>
        <a class="home" href="/">\u8FD4\u56DE\u9996\u9875</a>
      </div>
    </div>
  </div>`,_t(s,{title:`\u9875\u9762\u4E0D\u5B58\u5728 - ${p(s.options.title)}`,css:[t("assets/css/joe.global.min.css")]})}var Me,U,st,ee,Mt,ut=Y(()=>{at();It();Me="joe",U="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",st={JFavicon:"/usr/themes/joe/assets/img/link.png",JLogo:"/usr/themes/joe/assets/img/aside_author_image.jpg",JBirthDay:"",JDocumentTitle:"",JAside_Author_Image:"/usr/themes/joe/assets/img/aside_author_image.jpg",JAside_Author_Avatar:"",JAside_Author_Nick:"",JAside_Author_Link:"#",JAside_Author_Motto:"\u6709\u94B1\u7EC8\u6210\u7737\u5C5E\uFF0C\u6CA1\u94B1\u4EB2\u773C\u76EE\u7779",JAside_Author_Nav:"on",JAside_Hot_Num:"5",JAside_Newreply_Status:"on",JAside_Timelife_Status:"on",JAside_3DTag:"off",JAside_Flatterer:"on",JCommentStatus:"on",JIndex_Hot:"off",JIndex_Carousel:"",JIndex_Recommend:"",JIndex_Ad:"",JIndex_Notice:"",JList_Animate:"off",JOverdue:"off",JNavMaxNum:"6",JFooter_Custom:"",JICP:"",JAssetsURL:""};ee={options:{themeAssetsBase:"/usr/themes/joe"}};Mt={}});var ge={};lt(ge,{meta:()=>ya,register:()=>ba});function ba(s){s.registerHook("commentSubmit",t=>(t&&t.text&&(t.text=t.text.replace(/\bhello\b/gi,"Hello World")),t)),s.registerAction("hello",async t=>new Response(JSON.stringify({code:1,data:{message:"Hello World from TypechoEdge plugin!"}}),{headers:{"Content-Type":"application/json; charset=utf-8"}}))}var ya,he=Y(()=>{ya={title:"HelloWorld",desc:"\u793A\u4F8B\u63D2\u4EF6\uFF1A\u8BC4\u8BBA hello \u66FF\u6362 + /action/hello \u63A5\u53E3",author:"TypechoEdge",version:"1.0.0"}});var we={};lt(we,{meta:()=>xa,register:()=>_a});function _a(s){s.registerHook("renderContent",async(t,{post:a})=>a?.fields?.mode==="links"?`<div class="joe_links">
  <ul class="joe_links__list">
    ${String(t).split(`
`).map(o=>o.trim()).filter(Boolean).map(o=>o.split("||").map(i=>i.trim())).filter(o=>o.length>=2).map(([o,i,r])=>({name:o,url:i,avatar:r||""})).map(o=>`<li class="item">
      <a class="link" href="${o.url}" target="_blank" rel="noopener noreferrer">
        <img class="avatar" src="${o.avatar||`https://weavatar.com/avatar/${encodeURIComponent(o.name)}?default=mp&size=100`}" alt="${o.name}" loading="lazy" />
        <div class="info"><div class="name">${o.name}</div><div class="url">${o.url}</div></div>
      </a>
    </li>`).join("")}
  </ul>
</div>
<style>.joe_links__list{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:15px;list-style:none;padding:0}.joe_links__list .item .link{display:flex;align-items:center;padding:15px;border:1px solid var(--classB);border-radius:8px;text-decoration:none;color:var(--routine)}.joe_links__list .item .avatar{width:48px;height:48px;border-radius:50%;margin-right:12px}.joe_links__list .item .name{font-weight:600}.joe_links__list .item .url{font-size:12px;opacity:.6;word-break:break-all}</style>`:t)}var xa,ve=Y(()=>{xa={title:"LinksCache",desc:'\u53CB\u94FE\u9875\u9762\u6E32\u67D3\uFF1A\u6B63\u6587\u6BCF\u884C "\u540D\u79F0||URL||\u5934\u50CF"\uFF0C\u5B57\u6BB5 mode \u8BBE\u4E3A links \u751F\u6548',author:"TypechoEdge",version:"1.0.0"}});Q();Bt();Q();var kt=null;async function Ce(){return kt||(kt=(async()=>{try{let s=await import("@edgeone/pages-blob"),t=s.getStore||s.default?.getStore;if(t)return t(M.BLOB_STORE)}catch{}return null})()),kt}var vt=class{constructor(t){this.kv=t,this.mode="init"}async init(){let t=await Ce();return t?(this.store=t,this.mode="blob"):this.mode="kv",this.mode}async set(t,a,e){if(this.mode==="blob")return await this.store.set(t,a),{key:t,mode:"blob"};let n;if(typeof a=="string")n=btoa(unescape(encodeURIComponent(a)));else if(a instanceof ArrayBuffer){let o=new Uint8Array(a),i="";for(let r=0;r<o.length;r+=32768)i+=String.fromCharCode.apply(null,o.subarray(r,r+32768));n=btoa(i)}else throw new Error("unsupported data type");return await this.kv.putJSON(`file:data:${t}`,{b64:n,contentType:e||"application/octet-stream"}),{key:t,mode:"kv"}}async get(t){if(this.mode==="blob")try{let o=await this.store.getWithHeaders(t);return o?{body:await new Response(o.body).arrayBuffer(),contentType:o.headers["content-type"]||"application/octet-stream"}:null}catch{return null}let a=await this.kv.getJSON(`file:data:${t}`);if(!a)return null;let e=atob(a.b64),n=new Uint8Array(e.length);for(let o=0;o<e.length;o++)n[o]=e.charCodeAt(o);return{body:n.buffer,contentType:a.contentType}}async delete(t){this.mode==="blob"?await this.store.delete(t):await this.kv.delete(`file:data:${t}`)}};var Ct=class{constructor(t,a){this.kv=t,this.blob=a}static async create(t){throw new Error("use createDatabase(env)")}async nextId(t){let a=`seq:${t}`,n=parseInt(await this.kv.get(a)||"0",10)+1;return await this.kv.put(a,String(n)),n}async getOption(t,a=null){let e=await this.kv.get(`opt:${t}`,"json");return e??a}async setOption(t,a){await this.kv.putJSON(`opt:${t}`,a)}async getOptions(){let t=await this.kv.listKeys("opt:"),a={};for(let e of t){let n=e.slice(4);a[n]=await this.kv.get(e,"json")}return a}async isInstalled(){return await this.getOption("installed")===1}async getUser(t){return await this.kv.getJSON(`user:${t}`)}async getUserByName(t){let a=await this.kv.get(`usern:${encodeURIComponent(t)}`);return a?await this.getUser(a):null}async getUserByMail(t){let a=await this.kv.get(`userm:${encodeURIComponent(t)}`);return a?await this.getUser(a):null}async createUser({name:t,mail:a,password:e,screenName:n,url:o="",group:i="administrator"}){let{hashPassword:r}=await Promise.resolve().then(()=>(X(),ct)),l=await this.nextId("uid"),c={uid:l,name:t,mail:a||"",url:o||"",screenName:n||t,created:Math.floor(Date.now()/1e3),activated:0,logged:0,group:i,passwordHash:await r(e),totpEnabled:!1,totpSecret:null};return await this.kv.putJSON(`user:${l}`,c),await this.kv.put(`usern:${encodeURIComponent(t)}`,String(l)),a&&await this.kv.put(`userm:${encodeURIComponent(a)}`,String(l)),c}async updateUser(t,a){let e=await this.getUser(t);return e?(Object.assign(e,a),await this.kv.putJSON(`user:${t}`,e),e):null}async listUsers(){let t=await this.kv.listKeys("user:"),a=[];for(let e of t){if(e.startsWith("usern:")||e.startsWith("userm:"))continue;let n=await this.kv.getJSON(e);n&&a.push(n)}return a.sort((e,n)=>e.uid-n.uid),a}async#t(){return await this.kv.getJSON("idx:posts")||[]}async#s(t){await this.kv.putJSON("idx:posts",t)}async createContent(t){let a=await this.nextId("cid"),e=Math.floor(Date.now()/1e3),n={cid:a,title:t.title||"",slug:t.slug||String(a),created:t.created||e,modified:e,text:t.text||"",order:t.order||0,authorId:t.authorId||1,template:t.template||null,type:t.type||"post",status:t.status||"publish",password:t.password||"",commentsNum:0,allowComment:t.allowComment!==void 0?t.allowComment:!0,allowPing:t.allowPing!==void 0?t.allowPing:!0,allowFeed:t.allowFeed!==void 0?t.allowFeed:!0,parent:t.parent||0,fields:t.fields||{},categories:t.categories||[],tags:t.tags||[]};await this.kv.putJSON(`post:${a}`,n);let o=await this.#t();return o.unshift(this.#i(n)),await this.#s(o),await this.#n(n.categories,n.tags),n}#i(t){return{cid:t.cid,title:t.title,slug:t.slug,created:t.created,modified:t.modified,type:t.type,status:t.status,commentsNum:t.commentsNum,authorId:t.authorId,categories:t.categories,tags:t.tags,hasPassword:!!t.password,allowComment:!!t.allowComment}}async getContent(t){return await this.kv.getJSON(`post:${t}`)}async getContentBySlug(t,a="page"){let n=(await this.#t()).find(o=>o.slug===t&&o.type===a);return n?await this.getContent(n.cid):null}async updateContent(t,a){let e=await this.getContent(t);if(!e)return null;let n=e.categories,o=e.tags;Object.assign(e,a),e.modified=Math.floor(Date.now()/1e3),await this.kv.putJSON(`post:${t}`,e);let i=await this.#t(),r=i.findIndex(l=>l.cid===t);return r>=0&&(i[r]=this.#i(e),i.sort((l,c)=>c.created-l.created),await this.#s(i)),await this.#n(e.categories,e.tags,n,o),e}async deleteContent(t){let a=await this.getContent(t);if(!a)return!1;await this.kv.delete(`post:${t}`);let e=await this.#t(),n=e.findIndex(r=>r.cid===t);n>=0&&(e.splice(n,1),await this.#s(e));let o=await this.#e(),i=[];for(let r of o)r.cid===t?await this.kv.delete(`cmt:${r.coid}`):i.push(r);return await this.kv.putJSON("idx:cmts",i),await this.#n([],[],a.categories,a.tags),!0}async listContents(t={}){let{type:a="post",status:e="publish",page:n=1,pageSize:o=10,categoryMid:i,tagMid:r,keywords:l,order:c="created",year:w,month:d,authorId:m,allStatus:g=!1}=t,x=(await this.#t()).filter(B=>B.type===a&&(g||B.status===e));if(i&&(x=x.filter(B=>B.categories.includes(i))),r&&(x=x.filter(B=>B.tags.includes(r))),m&&(x=x.filter(B=>B.authorId===m)),w&&(x=x.filter(B=>new Date(B.created*1e3).getFullYear()===w)),d&&(x=x.filter(B=>new Date(B.created*1e3).getMonth()+1===d)),l){let B=String(l).toLowerCase(),T=[];for(let D of x){if(D.title.toLowerCase().includes(B)){T.push(D);continue}let ht=await this.getContent(D.cid);ht&&ht.text.toLowerCase().includes(B)&&T.push(D)}x=T}if(c==="views"||c==="agree"){let B=await this.kv.getJSON(`stat:${c==="views"?"views":"agree"}`);x=[...x].sort((T,D)=>(B?.[D.cid]||0)-(B?.[T.cid]||0)||D.created-T.created)}else c==="commentsNum"?x=[...x].sort((B,T)=>(T.commentsNum||0)-(B.commentsNum||0)||T.created-B.created):x=[...x].sort((B,T)=>T.created-B.created);let A=x.length,j=(n-1)*o,O=[];for(let B of x.slice(j,j+o)){let T=await this.getContent(B.cid);T&&O.push(T)}return{items:O,total:A,page:n,pageSize:o,pages:Math.max(1,Math.ceil(A/o))}}async prevNext(t,a="post"){let e=(await this.#t()).filter(o=>o.type===a&&o.status==="publish"&&!o.hasPassword).sort((o,i)=>i.created-o.created),n=e.findIndex(o=>o.cid===t);return{prev:n>0?e[n-1]:null,next:n>=0&&n<e.length-1?e[n+1]:null}}async#a(){return await this.kv.getJSON("idx:metas")||[]}async listMetas(t){let a=await this.#a(),e=[];for(let n of a)t&&n.type!==t||e.push(await this.kv.getJSON(`meta:${n.mid}`));return e.sort((n,o)=>(n.order||0)-(o.order||0)),e.filter(Boolean)}async getMeta(t){return await this.kv.getJSON(`meta:${t}`)}async getMetaBySlug(t,a){let n=(await this.#a()).find(o=>o.slug===t&&o.type===a);return n?await this.getMeta(n.mid):null}async createMeta({name:t,slug:a,type:e,description:n=""}){let o=await this.nextId("mid"),i={mid:o,name:t,slug:a||t,type:e,description:n,count:0,order:0,parent:0};await this.kv.putJSON(`meta:${o}`,i);let r=await this.#a();return r.push({mid:o,type:e,slug:i.slug}),await this.kv.putJSON("idx:metas",r),i}async updateMeta(t,a){let e=await this.getMeta(t);if(!e)return null;Object.assign(e,a),await this.kv.putJSON(`meta:${t}`,e);let n=await this.#a(),o=n.findIndex(i=>i.mid===t);return o>=0&&(n[o]={mid:t,type:e.type,slug:e.slug},await this.kv.putJSON("idx:metas",n)),e}async deleteMeta(t){let a=await this.getMeta(t);if(!a)return!1;await this.kv.delete(`meta:${t}`);let e=await this.#a(),n=e.findIndex(i=>i.mid===t);n>=0&&(e.splice(n,1),await this.kv.putJSON("idx:metas",e));let o=await this.#t();for(let i of o){let r=a.type==="category"?"categories":"tags";if(i[r]?.includes(t)){let l=await this.getContent(i.cid);l&&(l[r]=l[r].filter(c=>c!==t),await this.kv.putJSON(`post:${l.cid}`,l))}}return!0}async#n(t=[],a=[],e=[],n=[]){let o=new Set([...t,...a,...e,...n]);if(!o.size)return;let i=await this.#t(),r={};for(let l of i)if(l.status==="publish"){for(let c of l.categories||[])r[`c${c}`]=(r[`c${c}`]||0)+1;for(let c of l.tags||[])r[`t${c}`]=(r[`t${c}`]||0)+1}for(let l of o){let c=await this.getMeta(l);c&&(c.count=r[`${c.type==="category"?"c":"t"}${l}`]||0,await this.kv.putJSON(`meta:${l}`,c))}}async#e(){return await this.kv.getJSON("idx:cmts")||[]}async createComment({cid:t,author:a,authorId:e=0,ownerId:n=0,mail:o,url:i,ip:r,agent:l,text:c,parent:w=0,status:d="approved"}){let m=await this.nextId("coid"),g=Math.floor(Date.now()/1e3),y={coid:m,cid:t,created:g,author:a,authorId:e,ownerId:n,mail:o||"",url:i||"",ip:r||"",agent:l||"",text:c||"",type:"comment",status:d,parent:w};await this.kv.putJSON(`cmt:${m}`,y);let x=await this.#e();return x.push({coid:m,cid:t,created:g,status:d}),await this.kv.putJSON("idx:cmts",x),d==="approved"&&await this.#o(t,1),y}async#o(t,a){let e=await this.getContent(t);if(!e)return;e.commentsNum=Math.max(0,(e.commentsNum||0)+a),await this.kv.putJSON(`post:${t}`,e);let n=await this.#t(),o=n.findIndex(i=>i.cid===t);o>=0&&(n[o].commentsNum=e.commentsNum,await this.kv.putJSON("idx:posts",n))}async updateComment(t,a){let e=await this.kv.getJSON(`cmt:${t}`);if(!e)return null;let n=e.status;Object.assign(e,a),await this.kv.putJSON(`cmt:${t}`,e);let o=await this.#e(),i=o.findIndex(r=>r.coid===t);return i>=0&&(o[i].status=e.status,await this.kv.putJSON("idx:cmts",o)),n!==e.status&&await this.#o(e.cid,e.status==="approved"?1:-1),e}async deleteComment(t){let a=await this.kv.getJSON(`cmt:${t}`);if(!a)return!1;await this.kv.delete(`cmt:${t}`);let e=await this.#e(),n=e.findIndex(o=>o.coid===t);return n>=0&&(e.splice(n,1),await this.kv.putJSON("idx:cmts",e)),a.status==="approved"&&await this.#o(a.cid,-1),!0}async listComments(t){let a=await this.#e(),e=[];for(let n of a)if(n.cid===t&&n.status==="approved"){let o=await this.kv.getJSON(`cmt:${n.coid}`);o&&e.push(o)}return e.sort((n,o)=>n.created-o.created),e}async listAllComments({status:t,page:a=1,pageSize:e=20}){let o=[...await this.#e()].sort((l,c)=>c.created-l.created);t&&(o=o.filter(l=>l.status===t));let i=o.length,r=[];for(let l of o.slice((a-1)*e,a*e)){let c=await this.kv.getJSON(`cmt:${l.coid}`);c&&r.push(c)}return{items:r,total:i,page:a,pageSize:e}}async recentComments(t=5){let e=[...await this.#e()].sort((o,i)=>i.created-o.created).slice(0,t),n=[];for(let o of e){let i=await this.kv.getJSON(`cmt:${o.coid}`);i&&i.status==="approved"&&n.push(i)}return n}async incrStat(t,a){let e=`stat:${a}`,n=await this.kv.getJSON(e)||{};return n[t]=(n[t]||0)+1,await this.kv.putJSON(e,n),n[t]}async getStat(t,a){return(await this.kv.getJSON(`stat:${a}`)||{})[t]||0}async createSession(t,a){let{randomHex:e}=await Promise.resolve().then(()=>(X(),ct)),n=e(32);return await this.kv.putJSON(`sess:${n}`,{uid:t,exp:Date.now()+a*1e3}),n}async getSession(t){if(!t)return null;let a=await this.kv.getJSON(`sess:${t}`);return a?a.exp<Date.now()?(await this.kv.delete(`sess:${t}`),null):a:null}async deleteSession(t){await this.kv.delete(`sess:${t}`)}};async function Gt(s){let{getKV:t}=await Promise.resolve().then(()=>(Bt(),Ht)),a=t(s),e=new vt(a);return await e.init(),new Ct(a,e)}Q();function je(s){let t=s.headers.get("Cookie")||"",a={};for(let e of t.split(";")){let n=e.indexOf("=");if(n>0){let o=e.slice(0,n).trim(),i=e.slice(n+1).trim();try{a[o]=decodeURIComponent(i)}catch{a[o]=i}}}return a}function St(s,t=M.SESSION_TTL){return`${M.SESSION_COOKIE}=${encodeURIComponent(s)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${t}; Secure`}function Vt(){return`${M.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`}async function dt(s,t){let e=je(t)[M.SESSION_COOKIE],n=await s.getSession(e);if(!n)return null;let o=await s.getUser(n.uid);return o?{user:o,token:e}:null}function Wt(s){let t=s.headers.get("Origin");if(!t)return!0;let a=s.headers.get("Host");try{return new URL(t).host===a}catch{return!1}}X();at();async function ae(s){let{db:t,request:a,path:e}=s;return e.startsWith("/install")?a.method==="POST"?await Fe(s):nt(s):null}function nt(s,t=""){let a=`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>\u5B89\u88C5 - TypechoEdge</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f4f5f7; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,.08); max-width: 460px; width: 100%; padding: 40px; }
  h1 { font-size: 22px; color: #24292f; margin-bottom: 6px; }
  .sub { color: #57606a; font-size: 13px; margin-bottom: 28px; line-height: 1.6; }
  .item { margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: #24292f; margin-bottom: 6px; font-weight: 600; }
  input, select { width: 100%; padding: 10px 12px; border: 1px solid #d0d7de; border-radius: 6px; font-size: 14px; outline: none; }
  input:focus { border-color: #0969da; box-shadow: 0 0 0 3px rgba(9,105,218,.15); }
  button { width: 100%; padding: 12px; background: #1a1f24; color: #fff; border: 0; border-radius: 6px; font-size: 15px; cursor: pointer; margin-top: 8px; }
  button:hover { background: #30363d; }
  .err { background: #ffebe9; color: #cf222e; border: 1px solid #ffcecb; border-radius: 6px; padding: 10px 12px; font-size: 13px; margin-bottom: 16px; }
  .tip { font-size: 12px; color: #8b949e; margin-top: 16px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="card">
    <h1>\u6B22\u8FCE\u4F7F\u7528 TypechoEdge</h1>
    <div class="sub">\u8FD0\u884C\u5728\u817E\u8BAF EdgeOne \u8FB9\u7F18\u51FD\u6570\u4E0A\u7684 Typecho \u517C\u5BB9\u535A\u5BA2\u3002<br>\u9996\u6B21\u4F7F\u7528\u8BF7\u521B\u5EFA\u7BA1\u7406\u5458\u8D26\u53F7\uFF0C\u6570\u636E\u5C06\u4FDD\u5B58\u5230 KV \u5B58\u50A8\u4E0E Blob \u5B58\u50A8\u3002</div>
    ${t?`<div class="err">${p(t)}</div>`:""}
    <form method="post" action="/install">
      <div class="item">
        <label>\u7AD9\u70B9\u540D\u79F0</label>
        <input type="text" name="title" value="\u6211\u7684\u535A\u5BA2" required>
      </div>
      <div class="item">
        <label>\u7AD9\u70B9\u63CF\u8FF0</label>
        <input type="text" name="description" value="\u4E00\u4E2A\u8FD0\u884C\u5728\u8FB9\u7F18\u7684\u535A\u5BA2">
      </div>
      <div class="item">
        <label>\u7BA1\u7406\u5458\u7528\u6237\u540D</label>
        <input type="text" name="name" placeholder="admin" required pattern="[A-Za-z0-9_@.-]{3,32}">
      </div>
      <div class="item">
        <label>\u90AE\u7BB1</label>
        <input type="email" name="mail" placeholder="admin@example.com" required>
      </div>
      <div class="item">
        <label>\u5BC6\u7801\uFF08\u81F3\u5C11 8 \u4F4D\uFF09</label>
        <input type="password" name="password" required minlength="8">
      </div>
      <div class="item">
        <label>\u786E\u8BA4\u5BC6\u7801</label>
        <input type="password" name="password2" required minlength="8">
      </div>
      <button type="submit">\u521B\u5EFA\u8D26\u53F7\u5E76\u5B8C\u6210\u5B89\u88C5</button>
    </form>
    <div class="tip">\u5B89\u88C5\u540E\u53EF\u5728\u540E\u53F0\u300C\u5B89\u5168\u8BBE\u7F6E\u300D\u4E2D\u5F00\u542F TOTP \u4E24\u6B65\u9A8C\u8BC1\uFF08Google Authenticator / \u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u300C\u817E\u8BAF\u8EAB\u4EFD\u9A8C\u8BC1\u5668\u300D\u7B49\u5747\u517C\u5BB9\uFF09\u3002</div>
  </div>
</body>
</html>`;return new Response(a,{headers:{"Content-Type":"text/html; charset=utf-8"}})}async function Fe(s){let{db:t,request:a,url:e}=s,n=await a.formData(),o=String(n.get("title")||"\u6211\u7684\u535A\u5BA2").trim(),i=String(n.get("description")||"").trim(),r=String(n.get("name")||"").trim(),l=String(n.get("mail")||"").trim().toLowerCase(),c=String(n.get("password")||""),w=String(n.get("password2")||"");if(!/^[A-Za-z0-9_@.\-]{3,32}$/.test(r))return nt(s,"\u7528\u6237\u540D\u683C\u5F0F\u4E0D\u6B63\u786E\uFF083-32\u4F4D\u5B57\u6BCD\u6570\u5B57 @ . _ -\uFF09");if(!/^\S+@\S+\.\S+$/.test(l))return nt(s,"\u90AE\u7BB1\u683C\u5F0F\u4E0D\u6B63\u786E");if(c.length<8)return nt(s,"\u5BC6\u7801\u81F3\u5C11 8 \u4F4D");if(c!==w)return nt(s,"\u4E24\u6B21\u8F93\u5165\u7684\u5BC6\u7801\u4E0D\u4E00\u81F4");if(await t.getUserByName(r))return nt(s,"\u7528\u6237\u540D\u5DF2\u5B58\u5728");await t.createUser({name:r,mail:l,password:c,screenName:r,group:"administrator"});let d={title:o,description:i,keywords:"",timezone:"8",installed:1,pageSize:10,theme:"joe",commentsRequireMail:!0,commentsRequireURL:!1,commentsThreaded:!0,commentsMaxNestingLevels:999,commentStatus:"approved",siteCreated:Math.floor(Date.now()/1e3)};for(let[g,y]of Object.entries(d))await t.setOption(g,y);let{JOE_DEFAULTS:m}=await Promise.resolve().then(()=>(ut(),Jt));return await t.setOption("theme:joe",m),await t.createContent({title:"Hello TypechoEdge",slug:"hello",text:`\u6B22\u8FCE\u4F7F\u7528 **TypechoEdge**\uFF01

\u8FD9\u662F\u4E00\u4E2A\u8FD0\u884C\u5728 \`\u817E\u8BAF EdgeOne\` \u8FB9\u7F18\u51FD\u6570\u4E0A\u7684\u535A\u5BA2\u7CFB\u7EDF\uFF0C\u5B8C\u5168\u517C\u5BB9 Typecho \u6570\u636E\u6A21\u578B\u4E0E Joe \u4E3B\u9898\u3002

## \u7279\u6027

- \u6570\u636E\u5B58\u50A8\u5728 **KV \u5B58\u50A8**\uFF08\u7ED3\u6784\u5316\u6570\u636E\uFF09\u4E0E **Blob \u5B58\u50A8**\uFF08\u9644\u4EF6\uFF09
- \u652F\u6301 **Markdown** \u5199\u4F5C\uFF08\u6807\u9898\u3001\u4EE3\u7801\u5757\u3001\u8868\u683C\u3001\u56FE\u7247\u2026\u2026\uFF09
- \u9996\u6B21\u8BBF\u95EE\u4E00\u952E\u5B89\u88C5\uFF0C\u8D26\u53F7\u6570\u636E\u5B58\u653E\u5728 KV \u7A7A\u95F4
- \u767B\u5F55\u652F\u6301 **TOTP \u4E24\u6B65\u9A8C\u8BC1**\uFF08RFC 6238\uFF0C\u517C\u5BB9\u5404\u7C7B\u9A8C\u8BC1\u5668 App\uFF09
- \u517C\u5BB9 Typecho \u8DEF\u7531\uFF1A\`/archives/1/\`\u3001\`/category/xx/\`\u3001\`/tag/xx/\`
- \u63D2\u4EF6\u7CFB\u7EDF\uFF1AJS \u94A9\u5B50\u673A\u5236\u5BF9\u5E94 Typecho \u63D2\u4EF6\u63A5\u53E3

<!--more-->

## \u5F00\u59CB\u5199\u4F5C

\u767B\u5F55 \`/admin\` \u540E\u53F0\uFF0C\u65B0\u5EFA\u4F60\u7684\u7B2C\u4E00\u7BC7\u6587\u7AE0\u5427\uFF01

\`\`\`js
console.log('Hello from EdgeOne Edge Functions!');
\`\`\`

> \u6570\u636E\u5168\u90E8\u4FDD\u5B58\u5728\u4F60\u7ED1\u5B9A\u7684 KV \u547D\u540D\u7A7A\u95F4\u4E2D\uFF0C\u53EF\u968F\u65F6\u5728\u63A7\u5236\u53F0\u67E5\u770B\u3002`,authorId:1,type:"post",fields:{thumb:"",abstract:"\u6B22\u8FCE\u4F7F\u7528 TypechoEdge \u2014\u2014 EdgeOne \u8FB9\u7F18\u51FD\u6570\u4E0A\u7684 Typecho \u517C\u5BB9\u535A\u5BA2"}}),await t.createMeta({name:"\u9ED8\u8BA4\u5206\u7C7B",slug:"default",type:"category",description:"\u9ED8\u8BA4\u5206\u7C7B"}),new Response(null,{status:302,headers:{Location:"/admin?installed=1"}})}X();Q();at();var ot=function(s,t){let n=s,o=mt[t],i=null,r=0,l=null,c=[],w={},d=function(f,b){r=n*4+17,i=(function(u){let v=new Array(u);for(let h=0;h<u;h+=1){v[h]=new Array(u);for(let _=0;_<u;_+=1)v[h][_]=null}return v})(r),m(0,0),m(r-7,0),m(0,r-7),x(),y(),j(f,b),n>=7&&A(f),l==null&&(l=T(n,o,c)),O(l,b)},m=function(f,b){for(let u=-1;u<=7;u+=1)if(!(f+u<=-1||r<=f+u))for(let v=-1;v<=7;v+=1)b+v<=-1||r<=b+v||(0<=u&&u<=6&&(v==0||v==6)||0<=v&&v<=6&&(u==0||u==6)||2<=u&&u<=4&&2<=v&&v<=4?i[f+u][b+v]=!0:i[f+u][b+v]=!1)},g=function(){let f=0,b=0;for(let u=0;u<8;u+=1){d(!0,u);let v=V.getLostPoint(w);(u==0||f>v)&&(f=v,b=u)}return b},y=function(){for(let f=8;f<r-8;f+=1)i[f][6]==null&&(i[f][6]=f%2==0);for(let f=8;f<r-8;f+=1)i[6][f]==null&&(i[6][f]=f%2==0)},x=function(){let f=V.getPatternPosition(n);for(let b=0;b<f.length;b+=1)for(let u=0;u<f.length;u+=1){let v=f[b],h=f[u];if(i[v][h]==null)for(let _=-2;_<=2;_+=1)for(let $=-2;$<=2;$+=1)_==-2||_==2||$==-2||$==2||_==0&&$==0?i[v+_][h+$]=!0:i[v+_][h+$]=!1}},A=function(f){let b=V.getBCHTypeNumber(n);for(let u=0;u<18;u+=1){let v=!f&&(b>>u&1)==1;i[Math.floor(u/3)][u%3+r-8-3]=v}for(let u=0;u<18;u+=1){let v=!f&&(b>>u&1)==1;i[u%3+r-8-3][Math.floor(u/3)]=v}},j=function(f,b){let u=o<<3|b,v=V.getBCHTypeInfo(u);for(let h=0;h<15;h+=1){let _=!f&&(v>>h&1)==1;h<6?i[h][8]=_:h<8?i[h+1][8]=_:i[r-15+h][8]=_}for(let h=0;h<15;h+=1){let _=!f&&(v>>h&1)==1;h<8?i[8][r-h-1]=_:h<9?i[8][15-h-1+1]=_:i[8][15-h-1]=_}i[r-8][8]=!f},O=function(f,b){let u=-1,v=r-1,h=7,_=0,$=V.getMaskFunction(b);for(let k=r-1;k>0;k-=2)for(k==6&&(k-=1);;){for(let C=0;C<2;C+=1)if(i[v][k-C]==null){let I=!1;_<f.length&&(I=(f[_]>>>h&1)==1),$(v,k-C)&&(I=!I),i[v][k-C]=I,h-=1,h==-1&&(_+=1,h=7)}if(v+=u,v<0||r<=v){v-=u,u=-u;break}}},B=function(f,b){let u=0,v=0,h=0,_=new Array(b.length),$=new Array(b.length);for(let E=0;E<b.length;E+=1){let S=b[E].dataCount,R=b[E].totalCount-S;v=Math.max(v,S),h=Math.max(h,R),_[E]=new Array(S);for(let J=0;J<_[E].length;J+=1)_[E][J]=255&f.getBuffer()[J+u];u+=S;let At=V.getErrorCorrectPolynomial(R),zt=ft(_[E],At.getLength()-1).mod(At);$[E]=new Array(At.getLength()-1);for(let J=0;J<$[E].length;J+=1){let Ft=J+zt.getLength()-$[E].length;$[E][J]=Ft>=0?zt.getAt(Ft):0}}let k=0;for(let E=0;E<b.length;E+=1)k+=b[E].totalCount;let C=new Array(k),I=0;for(let E=0;E<v;E+=1)for(let S=0;S<b.length;S+=1)E<_[S].length&&(C[I]=_[S][E],I+=1);for(let E=0;E<h;E+=1)for(let S=0;S<b.length;S+=1)E<$[S].length&&(C[I]=$[S][E],I+=1);return C},T=function(f,b,u){let v=se.getRSBlocks(f,b),h=ne();for(let $=0;$<u.length;$+=1){let k=u[$];h.put(k.getMode(),4),h.put(k.getLength(),V.getLengthInBits(k.getMode(),f)),k.write(h)}let _=0;for(let $=0;$<v.length;$+=1)_+=v[$].dataCount;if(h.getLengthInBits()>_*8)throw"code length overflow. ("+h.getLengthInBits()+">"+_*8+")";for(h.getLengthInBits()+4<=_*8&&h.put(0,4);h.getLengthInBits()%8!=0;)h.putBit(!1);for(;!(h.getLengthInBits()>=_*8||(h.put(236,8),h.getLengthInBits()>=_*8));)h.put(17,8);return B(h,v)};w.addData=function(f,b){b=b||"Byte";let u=null;switch(b){case"Numeric":u=He(f);break;case"Alphanumeric":u=Ye(f);break;case"Byte":u=qe(f);break;case"Kanji":u=Ke(f);break;default:throw"mode:"+b}c.push(u),l=null},w.isDark=function(f,b){if(f<0||r<=f||b<0||r<=b)throw f+","+b;return i[f][b]},w.getModuleCount=function(){return r},w.make=function(){if(n<1){let f=1;for(;f<40;f++){let b=se.getRSBlocks(f,o),u=ne();for(let h=0;h<c.length;h++){let _=c[h];u.put(_.getMode(),4),u.put(_.getLength(),V.getLengthInBits(_.getMode(),f)),_.write(u)}let v=0;for(let h=0;h<b.length;h++)v+=b[h].dataCount;if(u.getLengthInBits()<=v*8)break}n=f}d(!1,g())},w.createTableTag=function(f,b){f=f||2,b=typeof b>"u"?f*4:b;let u="";u+='<table style="',u+=" border-width: 0px; border-style: none;",u+=" border-collapse: collapse;",u+=" padding: 0px; margin: "+b+"px;",u+='">',u+="<tbody>";for(let v=0;v<w.getModuleCount();v+=1){u+="<tr>";for(let h=0;h<w.getModuleCount();h+=1)u+='<td style="',u+=" border-width: 0px; border-style: none;",u+=" border-collapse: collapse;",u+=" padding: 0px; margin: 0px;",u+=" width: "+f+"px;",u+=" height: "+f+"px;",u+=" background-color: ",u+=w.isDark(v,h)?"#000000":"#ffffff",u+=";",u+='"/>';u+="</tr>"}return u+="</tbody>",u+="</table>",u},w.createSvgTag=function(f,b,u,v){let h={};typeof arguments[0]=="object"&&(h=arguments[0],f=h.cellSize,b=h.margin,u=h.alt,v=h.title),f=f||2,b=typeof b>"u"?f*4:b,u=typeof u=="string"?{text:u}:u||{},u.text=u.text||null,u.id=u.text?u.id||"qrcode-description":null,v=typeof v=="string"?{text:v}:v||{},v.text=v.text||null,v.id=v.text?v.id||"qrcode-title":null;let _=w.getModuleCount()*f+b*2,$,k,C,I,E="",S;for(S="l"+f+",0 0,"+f+" -"+f+",0 0,-"+f+"z ",E+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',E+=h.scalable?"":' width="'+_+'px" height="'+_+'px"',E+=' viewBox="0 0 '+_+" "+_+'" ',E+=' preserveAspectRatio="xMinYMin meet"',E+=v.text||u.text?' role="img" aria-labelledby="'+D([v.id,u.id].join(" ").trim())+'"':"",E+=">",E+=v.text?'<title id="'+D(v.id)+'">'+D(v.text)+"</title>":"",E+=u.text?'<description id="'+D(u.id)+'">'+D(u.text)+"</description>":"",E+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',E+='<path d="',C=0;C<w.getModuleCount();C+=1)for(I=C*f+b,$=0;$<w.getModuleCount();$+=1)w.isDark(C,$)&&(k=$*f+b,E+="M"+k+","+I+S);return E+='" stroke="transparent" fill="black"/>',E+="</svg>",E},w.createDataURL=function(f,b){f=f||2,b=typeof b>"u"?f*4:b;let u=w.getModuleCount()*f+b*2,v=b,h=u-b;return Ze(u,u,function(_,$){if(v<=_&&_<h&&v<=$&&$<h){let k=Math.floor((_-v)/f),C=Math.floor(($-v)/f);return w.isDark(C,k)?0:1}else return 1})},w.createImgTag=function(f,b,u){f=f||2,b=typeof b>"u"?f*4:b;let v=w.getModuleCount()*f+b*2,h="";return h+="<img",h+=' src="',h+=w.createDataURL(f,b),h+='"',h+=' width="',h+=v,h+='"',h+=' height="',h+=v,h+='"',u&&(h+=' alt="',h+=D(u),h+='"'),h+="/>",h};let D=function(f){let b="";for(let u=0;u<f.length;u+=1){let v=f.charAt(u);switch(v){case"<":b+="&lt;";break;case">":b+="&gt;";break;case"&":b+="&amp;";break;case'"':b+="&quot;";break;default:b+=v;break}}return b},ht=function(f){f=typeof f>"u"?2:f;let u=w.getModuleCount()*1+f*2,v=f,h=u-f,_,$,k,C,I,E={"\u2588\u2588":"\u2588","\u2588 ":"\u2580"," \u2588":"\u2584","  ":" "},S={"\u2588\u2588":"\u2580","\u2588 ":"\u2580"," \u2588":" ","  ":" "},R="";for(_=0;_<u;_+=2){for(k=Math.floor((_-v)/1),C=Math.floor((_+1-v)/1),$=0;$<u;$+=1)I="\u2588",v<=$&&$<h&&v<=_&&_<h&&w.isDark(k,Math.floor(($-v)/1))&&(I=" "),v<=$&&$<h&&v<=_+1&&_+1<h&&w.isDark(C,Math.floor(($-v)/1))?I+=" ":I+="\u2588",R+=f<1&&_+1>=h?S[I]:E[I];R+=`
`}return u%2&&f>0?R.substring(0,R.length-u-1)+Array(u+1).join("\u2580"):R.substring(0,R.length-1)};return w.createASCII=function(f,b){if(f=f||1,f<2)return ht(b);f-=1,b=typeof b>"u"?f*2:b;let u=w.getModuleCount()*f+b*2,v=b,h=u-b,_,$,k,C,I=Array(f+1).join("\u2588\u2588"),E=Array(f+1).join("  "),S="",R="";for(_=0;_<u;_+=1){for(k=Math.floor((_-v)/f),R="",$=0;$<u;$+=1)C=1,v<=$&&$<h&&v<=_&&_<h&&w.isDark(k,Math.floor(($-v)/f))&&(C=0),R+=C?I:E;for(k=0;k<f;k+=1)S+=R+`
`}return S.substring(0,S.length-1)},w.renderTo2dContext=function(f,b){b=b||2;let u=w.getModuleCount();for(let v=0;v<u;v++)for(let h=0;h<u;h++)f.fillStyle=w.isDark(v,h)?"black":"white",f.fillRect(h*b,v*b,b,b)},w};ot.stringToBytes=function(s){let t=[];for(let a=0;a<s.length;a+=1){let e=s.charCodeAt(a);t.push(e&255)}return t};ot.createStringToBytes=function(s,t){let a=(function(){let n=Ve(s),o=function(){let l=n.read();if(l==-1)throw"eof";return l},i=0,r={};for(;;){let l=n.read();if(l==-1)break;let c=o(),w=o(),d=o(),m=String.fromCharCode(l<<8|c),g=w<<8|d;r[m]=g,i+=1}if(i!=t)throw i+" != "+t;return r})(),e=63;return function(n){let o=[];for(let i=0;i<n.length;i+=1){let r=n.charCodeAt(i);if(r<128)o.push(r);else{let l=a[n.charAt(i)];typeof l=="number"?(l&255)==l?o.push(l):(o.push(l>>>8),o.push(l&255)):o.push(e)}}return o}};var N={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8},mt={L:1,M:0,Q:3,H:2},G={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7},V=(function(){let s=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],t=1335,a=7973,e=21522,n={},o=function(i){let r=0;for(;i!=0;)r+=1,i>>>=1;return r};return n.getBCHTypeInfo=function(i){let r=i<<10;for(;o(r)-o(t)>=0;)r^=t<<o(r)-o(t);return(i<<10|r)^e},n.getBCHTypeNumber=function(i){let r=i<<12;for(;o(r)-o(a)>=0;)r^=a<<o(r)-o(a);return i<<12|r},n.getPatternPosition=function(i){return s[i-1]},n.getMaskFunction=function(i){switch(i){case G.PATTERN000:return function(r,l){return(r+l)%2==0};case G.PATTERN001:return function(r,l){return r%2==0};case G.PATTERN010:return function(r,l){return l%3==0};case G.PATTERN011:return function(r,l){return(r+l)%3==0};case G.PATTERN100:return function(r,l){return(Math.floor(r/2)+Math.floor(l/3))%2==0};case G.PATTERN101:return function(r,l){return r*l%2+r*l%3==0};case G.PATTERN110:return function(r,l){return(r*l%2+r*l%3)%2==0};case G.PATTERN111:return function(r,l){return(r*l%3+(r+l)%2)%2==0};default:throw"bad maskPattern:"+i}},n.getErrorCorrectPolynomial=function(i){let r=ft([1],0);for(let l=0;l<i;l+=1)r=r.multiply(ft([1,W.gexp(l)],0));return r},n.getLengthInBits=function(i,r){if(1<=r&&r<10)switch(i){case N.MODE_NUMBER:return 10;case N.MODE_ALPHA_NUM:return 9;case N.MODE_8BIT_BYTE:return 8;case N.MODE_KANJI:return 8;default:throw"mode:"+i}else if(r<27)switch(i){case N.MODE_NUMBER:return 12;case N.MODE_ALPHA_NUM:return 11;case N.MODE_8BIT_BYTE:return 16;case N.MODE_KANJI:return 10;default:throw"mode:"+i}else if(r<41)switch(i){case N.MODE_NUMBER:return 14;case N.MODE_ALPHA_NUM:return 13;case N.MODE_8BIT_BYTE:return 16;case N.MODE_KANJI:return 12;default:throw"mode:"+i}else throw"type:"+r},n.getLostPoint=function(i){let r=i.getModuleCount(),l=0;for(let d=0;d<r;d+=1)for(let m=0;m<r;m+=1){let g=0,y=i.isDark(d,m);for(let x=-1;x<=1;x+=1)if(!(d+x<0||r<=d+x))for(let A=-1;A<=1;A+=1)m+A<0||r<=m+A||x==0&&A==0||y==i.isDark(d+x,m+A)&&(g+=1);g>5&&(l+=3+g-5)}for(let d=0;d<r-1;d+=1)for(let m=0;m<r-1;m+=1){let g=0;i.isDark(d,m)&&(g+=1),i.isDark(d+1,m)&&(g+=1),i.isDark(d,m+1)&&(g+=1),i.isDark(d+1,m+1)&&(g+=1),(g==0||g==4)&&(l+=3)}for(let d=0;d<r;d+=1)for(let m=0;m<r-6;m+=1)i.isDark(d,m)&&!i.isDark(d,m+1)&&i.isDark(d,m+2)&&i.isDark(d,m+3)&&i.isDark(d,m+4)&&!i.isDark(d,m+5)&&i.isDark(d,m+6)&&(l+=40);for(let d=0;d<r;d+=1)for(let m=0;m<r-6;m+=1)i.isDark(m,d)&&!i.isDark(m+1,d)&&i.isDark(m+2,d)&&i.isDark(m+3,d)&&i.isDark(m+4,d)&&!i.isDark(m+5,d)&&i.isDark(m+6,d)&&(l+=40);let c=0;for(let d=0;d<r;d+=1)for(let m=0;m<r;m+=1)i.isDark(m,d)&&(c+=1);let w=Math.abs(100*c/r/r-50)/5;return l+=w*10,l},n})(),W=(function(){let s=new Array(256),t=new Array(256);for(let e=0;e<8;e+=1)s[e]=1<<e;for(let e=8;e<256;e+=1)s[e]=s[e-4]^s[e-5]^s[e-6]^s[e-8];for(let e=0;e<255;e+=1)t[s[e]]=e;let a={};return a.glog=function(e){if(e<1)throw"glog("+e+")";return t[e]},a.gexp=function(e){for(;e<0;)e+=255;for(;e>=256;)e-=255;return s[e]},a})(),ft=function(s,t){if(typeof s.length>"u")throw s.length+"/"+t;let a=(function(){let n=0;for(;n<s.length&&s[n]==0;)n+=1;let o=new Array(s.length-n+t);for(let i=0;i<s.length-n;i+=1)o[i]=s[i+n];return o})(),e={};return e.getAt=function(n){return a[n]},e.getLength=function(){return a.length},e.multiply=function(n){let o=new Array(e.getLength()+n.getLength()-1);for(let i=0;i<e.getLength();i+=1)for(let r=0;r<n.getLength();r+=1)o[i+r]^=W.gexp(W.glog(e.getAt(i))+W.glog(n.getAt(r)));return ft(o,0)},e.mod=function(n){if(e.getLength()-n.getLength()<0)return e;let o=W.glog(e.getAt(0))-W.glog(n.getAt(0)),i=new Array(e.getLength());for(let r=0;r<e.getLength();r+=1)i[r]=e.getAt(r);for(let r=0;r<n.getLength();r+=1)i[r]^=W.gexp(W.glog(n.getAt(r))+o);return ft(i,0).mod(n)},e},se=(function(){let s=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],t=function(n,o){let i={};return i.totalCount=n,i.dataCount=o,i},a={},e=function(n,o){switch(o){case mt.L:return s[(n-1)*4+0];case mt.M:return s[(n-1)*4+1];case mt.Q:return s[(n-1)*4+2];case mt.H:return s[(n-1)*4+3];default:return}};return a.getRSBlocks=function(n,o){let i=e(n,o);if(typeof i>"u")throw"bad rs block @ typeNumber:"+n+"/errorCorrectionLevel:"+o;let r=i.length/3,l=[];for(let c=0;c<r;c+=1){let w=i[c*3+0],d=i[c*3+1],m=i[c*3+2];for(let g=0;g<w;g+=1)l.push(t(d,m))}return l},a})(),ne=function(){let s=[],t=0,a={};return a.getBuffer=function(){return s},a.getAt=function(e){let n=Math.floor(e/8);return(s[n]>>>7-e%8&1)==1},a.put=function(e,n){for(let o=0;o<n;o+=1)a.putBit((e>>>n-o-1&1)==1)},a.getLengthInBits=function(){return t},a.putBit=function(e){let n=Math.floor(t/8);s.length<=n&&s.push(0),e&&(s[n]|=128>>>t%8),t+=1},a},He=function(s){let t=N.MODE_NUMBER,a=s,e={};e.getMode=function(){return t},e.getLength=function(i){return a.length},e.write=function(i){let r=a,l=0;for(;l+2<r.length;)i.put(n(r.substring(l,l+3)),10),l+=3;l<r.length&&(r.length-l==1?i.put(n(r.substring(l,l+1)),4):r.length-l==2&&i.put(n(r.substring(l,l+2)),7))};let n=function(i){let r=0;for(let l=0;l<i.length;l+=1)r=r*10+o(i.charAt(l));return r},o=function(i){if("0"<=i&&i<="9")return i.charCodeAt(0)-48;throw"illegal char :"+i};return e},Ye=function(s){let t=N.MODE_ALPHA_NUM,a=s,e={};e.getMode=function(){return t},e.getLength=function(o){return a.length},e.write=function(o){let i=a,r=0;for(;r+1<i.length;)o.put(n(i.charAt(r))*45+n(i.charAt(r+1)),11),r+=2;r<i.length&&o.put(n(i.charAt(r)),6)};let n=function(o){if("0"<=o&&o<="9")return o.charCodeAt(0)-48;if("A"<=o&&o<="Z")return o.charCodeAt(0)-65+10;switch(o){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+o}};return e},qe=function(s){let t=N.MODE_8BIT_BYTE,a=s,e=ot.stringToBytes(s),n={};return n.getMode=function(){return t},n.getLength=function(o){return e.length},n.write=function(o){for(let i=0;i<e.length;i+=1)o.put(e[i],8)},n},Ke=function(s){let t=N.MODE_KANJI,a=s,e=ot.stringToBytes;(function(i,r){let l=e(i);if(l.length!=2||(l[0]<<8|l[1])!=r)throw"sjis not supported."})("\u53CB",38726);let n=e(s),o={};return o.getMode=function(){return t},o.getLength=function(i){return~~(n.length/2)},o.write=function(i){let r=n,l=0;for(;l+1<r.length;){let c=(255&r[l])<<8|255&r[l+1];if(33088<=c&&c<=40956)c-=33088;else if(57408<=c&&c<=60351)c-=49472;else throw"illegal char at "+(l+1)+"/"+c;c=(c>>>8&255)*192+(c&255),i.put(c,13),l+=2}if(l<r.length)throw"illegal char at "+(l+1)},o},oe=function(){let s=[],t={};return t.writeByte=function(a){s.push(a&255)},t.writeShort=function(a){t.writeByte(a),t.writeByte(a>>>8)},t.writeBytes=function(a,e,n){e=e||0,n=n||a.length;for(let o=0;o<n;o+=1)t.writeByte(a[o+e])},t.writeString=function(a){for(let e=0;e<a.length;e+=1)t.writeByte(a.charCodeAt(e))},t.toByteArray=function(){return s},t.toString=function(){let a="";a+="[";for(let e=0;e<s.length;e+=1)e>0&&(a+=","),a+=s[e];return a+="]",a},t},Ge=function(){let s=0,t=0,a=0,e="",n={},o=function(r){e+=String.fromCharCode(i(r&63))},i=function(r){if(r<0)throw"n:"+r;if(r<26)return 65+r;if(r<52)return 97+(r-26);if(r<62)return 48+(r-52);if(r==62)return 43;if(r==63)return 47;throw"n:"+r};return n.writeByte=function(r){for(s=s<<8|r&255,t+=8,a+=1;t>=6;)o(s>>>t-6),t-=6},n.flush=function(){if(t>0&&(o(s<<6-t),s=0,t=0),a%3!=0){let r=3-a%3;for(let l=0;l<r;l+=1)e+="="}},n.toString=function(){return e},n},Ve=function(s){let t=s,a=0,e=0,n=0,o={};o.read=function(){for(;n<8;){if(a>=t.length){if(n==0)return-1;throw"unexpected end of file./"+n}let l=t.charAt(a);if(a+=1,l=="=")return n=0,-1;if(l.match(/^\s$/))continue;e=e<<6|i(l.charCodeAt(0)),n+=6}let r=e>>>n-8&255;return n-=8,r};let i=function(r){if(65<=r&&r<=90)return r-65;if(97<=r&&r<=122)return r-97+26;if(48<=r&&r<=57)return r-48+52;if(r==43)return 62;if(r==47)return 63;throw"c:"+r};return o},We=function(s,t){let a=s,e=t,n=new Array(s*t),o={};o.setPixel=function(c,w,d){n[w*a+c]=d},o.write=function(c){c.writeString("GIF87a"),c.writeShort(a),c.writeShort(e),c.writeByte(128),c.writeByte(0),c.writeByte(0),c.writeByte(0),c.writeByte(0),c.writeByte(0),c.writeByte(255),c.writeByte(255),c.writeByte(255),c.writeString(","),c.writeShort(0),c.writeShort(0),c.writeShort(a),c.writeShort(e),c.writeByte(0);let w=2,d=r(w);c.writeByte(w);let m=0;for(;d.length-m>255;)c.writeByte(255),c.writeBytes(d,m,255),m+=255;c.writeByte(d.length-m),c.writeBytes(d,m,d.length-m),c.writeByte(0),c.writeString(";")};let i=function(c){let w=c,d=0,m=0,g={};return g.write=function(y,x){if(y>>>x)throw"length over";for(;d+x>=8;)w.writeByte(255&(y<<d|m)),x-=8-d,y>>>=8-d,m=0,d=0;m=y<<d|m,d=d+x},g.flush=function(){d>0&&w.writeByte(m)},g},r=function(c){let w=1<<c,d=(1<<c)+1,m=c+1,g=l();for(let O=0;O<w;O+=1)g.add(String.fromCharCode(O));g.add(String.fromCharCode(w)),g.add(String.fromCharCode(d));let y=oe(),x=i(y);x.write(w,m);let A=0,j=String.fromCharCode(n[A]);for(A+=1;A<n.length;){let O=String.fromCharCode(n[A]);A+=1,g.contains(j+O)?j=j+O:(x.write(g.indexOf(j),m),g.size()<4095&&(g.size()==1<<m&&(m+=1),g.add(j+O)),j=O)}return x.write(g.indexOf(j),m),x.write(d,m),x.flush(),y.toByteArray()},l=function(){let c={},w=0,d={};return d.add=function(m){if(d.contains(m))throw"dup key:"+m;c[m]=w,w+=1},d.size=function(){return w},d.indexOf=function(m){return c[m]},d.contains=function(m){return typeof c[m]<"u"},d};return o},Ze=function(s,t,a){let e=We(s,t);for(let r=0;r<t;r+=1)for(let l=0;l<s;l+=1)e.setPixel(l,r,a(l,r));let n=oe();e.write(n);let o=Ge(),i=n.toByteArray();for(let r=0;r<i.length;r+=1)o.writeByte(i[r]);return o.flush(),"data:image/gif;base64,"+o},ie=ot,Qa=ot.stringToBytes;var re="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";function le(){let s=new Uint8Array(20);crypto.getRandomValues(s);let t="";for(let e of s)t+=e.toString(2).padStart(8,"0");let a="";for(let e=0;e+5<=t.length;e+=5)a+=re[parseInt(t.slice(e,e+5),2)];return a}function Qe(s){let t="";for(let e of s.toUpperCase().replace(/=+$/,"")){let n=re.indexOf(e);n!==-1&&(t+=n.toString(2).padStart(5,"0"))}let a=[];for(let e=0;e+8<=t.length;e+=8)a.push(parseInt(t.slice(e,e+8),2));return new Uint8Array(a)}async function Xe(s,t){let a=await crypto.subtle.importKey("raw",s,{name:"HMAC",hash:"SHA-1"},!1,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",a,t))}async function ta(s,t){let a=Qe(s),e=new Uint8Array(8),n=t;for(let l=7;l>=0;l--)e[l]=n&255,n=Math.floor(n/256);let o=await Xe(a,e),i=o[o.length-1]&15,r=(o[i]&127)<<24|(o[i+1]&255)<<16|(o[i+2]&255)<<8|o[i+3]&255;return String(r%1e6).padStart(6,"0")}async function xt(s,t){if(!s||!t||!/^\d{6}$/.test(String(t)))return!1;let a=Math.floor(Date.now()/1e3/30);for(let e of[-1,0,1])if(await ta(s,a+e)===String(t))return!0;return!1}function ce(s,t,a){return`otpauth://totp/${encodeURIComponent(a)}:${encodeURIComponent(t)}?secret=${s}&issuer=${encodeURIComponent(a)}&algorithm=SHA1&digits=6&period=30`}function de(s){let t=ie(0,"M");t.addData(s),t.make();let a=t.getModuleCount(),e=4,n=(a+8)*e,o="";for(let i=0;i<a;i++)for(let r=0;r<a;r++)t.isDark(i,r)&&(o+=`<rect x="${(r+4)*e}" y="${(i+4)*e}" width="${e}" height="${e}"/>`);return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${o}</g></svg>`}ut();async function ue(s){let{db:t,request:a,url:e,path:n}=s,o=n.slice(6).replace(/^\/+|\/+$/g,"")||"";if(!await t.isInstalled())return Response.redirect(new URL("/install",e).href,302);if(o==="login"||o==="login/")return a.method==="POST"?ea(s):it(s);if(o==="logout"){let l=await dt(t,a);return l&&await t.deleteSession(l.token),new Response(null,{status:302,headers:{Location:"/admin/login","Set-Cookie":Vt()}})}let i=await dt(t,a);if(!i)return Response.redirect(new URL("/admin/login",e).href,302);let r=i.user;if(s.user=r,a.method==="POST"){if(!Wt(a))return aa({ok:0,msg:"\u975E\u6CD5\u6765\u6E90"},403);if(o==="post"||o==="post/")return ia(s);if(o==="delete")return ra(s);if(o==="meta")return ca(s);if(o==="meta-delete")return da(s);if(o==="comment")return ua(s);if(o==="upload")return fa(s);if(o==="settings")return ha(s);if(o==="security")return va(s)}switch(!0){case o==="":return sa(s);case o==="posts":return na(s);case o==="post":return pe(s,"post");case o==="pages":return oa(s);case o==="page":return pe(s,"page");case o==="metas":return la(s);case o==="comments":return pa(s);case o==="uploads":return ma(s);case o==="settings":return ga(s);case o==="security":return wa(s);default:return Response.redirect(new URL("/admin",e).href,302)}}function it(s,{error:t="",totp:a=!1,pendingToken:e="",name:n=""}={}){let o=`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\u767B\u5F55 - ${p(s.options.title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f4f5f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;box-shadow:0 2px 20px rgba(0,0,0,.08);max-width:400px;width:100%;padding:40px}
    h1{font-size:20px;color:#24292f;margin-bottom:24px;text-align:center}
    .item{margin-bottom:14px}
    label{display:block;font-size:13px;color:#24292f;margin-bottom:6px;font-weight:600}
    input{width:100%;padding:10px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;outline:none}
    input:focus{border-color:#0969da;box-shadow:0 0 0 3px rgba(9,105,218,.15)}
    button{width:100%;padding:12px;background:#1a1f24;color:#fff;border:0;border-radius:6px;font-size:15px;cursor:pointer;margin-top:8px}
    button:hover{background:#30363d}
    .err{background:#ffebe9;color:#cf222e;border:1px solid #ffcecb;border-radius:6px;padding:10px 12px;font-size:13px;margin-bottom:16px}
    .tip{font-size:12px;color:#8b949e;margin-top:14px;text-align:center}
  </style></head><body>
  <div class="card">
    <h1>${p(s.options.title)}</h1>
    ${t?`<div class="err">${p(t)}</div>`:""}
    ${a?`<form method="post" action="/admin/login">
      <input type="hidden" name="pending" value="${p(e)}">
      <div class="item"><label>\u4E24\u6B65\u9A8C\u8BC1\u7801\uFF08TOTP\uFF09</label>
      <input type="text" name="totp" placeholder="6 \u4F4D\u52A8\u6001\u7801" autocomplete="one-time-code" autofocus required pattern="\\d{6}"></div>
      <button type="submit" name="step" value="totp">\u9A8C\u8BC1</button>
    </form>`:`<form method="post" action="/admin/login">
      <div class="item"><label>\u7528\u6237\u540D</label><input type="text" name="name" value="${p(n)}" required autofocus></div>
      <div class="item"><label>\u5BC6\u7801</label><input type="password" name="password" required></div>
      <button type="submit" name="step" value="password">\u767B\u5F55</button>
    </form>`}
    <div class="tip">TypechoEdge on EdgeOne \xB7 \u5B89\u5168\u767B\u5F55</div>
  </div></body></html>`;return new Response(o,{headers:{"Content-Type":"text/html; charset=utf-8"}})}async function ea(s){let{db:t,request:a,url:e}=s,n=await a.formData();if(n.get("step")==="totp"){let w=String(n.get("pending")||""),d=String(n.get("totp")||""),m=await t.kv.getJSON(`pending:${w}`);if(!m||m.exp<Date.now())return it(s,{error:"\u4F1A\u8BDD\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55"});let g=await t.getUser(m.uid);if(!g||!g.totpEnabled)return it(s,{error:"\u4E24\u6B65\u9A8C\u8BC1\u672A\u542F\u7528"});if(!await xt(g.totpSecret,d))return it(s,{error:"\u9A8C\u8BC1\u7801\u9519\u8BEF\uFF0C\u8BF7\u91CD\u8BD5",totp:!0,pendingToken:w});await t.kv.delete(`pending:${w}`);let y=await t.createSession(g.uid,M.SESSION_TTL);return await t.updateUser(g.uid,{logged:Math.floor(Date.now()/1e3)}),new Response(null,{status:302,headers:{Location:"/admin","Set-Cookie":St(y)}})}let i=String(n.get("name")||"").trim(),r=String(n.get("password")||""),l=await t.getUserByName(i)||await t.getUserByMail(i);if(!l||!await bt(r,l.passwordHash))return it(s,{error:"\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF",name:i});if(l.totpEnabled&&l.totpSecret){let{randomHex:w}=await Promise.resolve().then(()=>(X(),ct)),d=w(24);return await t.kv.putJSON(`pending:${d}`,{uid:l.uid,exp:Date.now()+300*1e3}),it(s,{totp:!0,pendingToken:d})}let c=await t.createSession(l.uid,M.SESSION_TTL);return await t.updateUser(l.uid,{logged:Math.floor(Date.now()/1e3)}),new Response(null,{status:302,headers:{Location:"/admin","Set-Cookie":St(c)}})}function z(s,{title:t,active:a="",body:e=""}){let o=[["","\u4EEA\u8868\u76D8","fa-home"],["posts","\u7BA1\u7406\u6587\u7AE0","fa-file-text"],["post?type=post","\u64B0\u5199\u6587\u7AE0","fa-pencil"],["pages","\u7BA1\u7406\u9875\u9762","fa-files-o"],["page","\u521B\u5EFA\u9875\u9762","fa-plus"],["metas","\u5206\u7C7B/\u6807\u7B7E","fa-folder"],["comments","\u8BC4\u8BBA\u7BA1\u7406","fa-comments"],["uploads","\u9644\u4EF6\u7BA1\u7406","fa-image"],["settings","\u7AD9\u70B9\u8BBE\u7F6E","fa-cog"],["security","\u5B89\u5168\u8BBE\u7F6E","fa-shield"],["login","\u67E5\u770B\u7AD9\u70B9","fa-external-link"],["logout","\u9000\u51FA\u767B\u5F55","fa-sign-out"]].map(([i,r,l])=>{let c=i==="login"?"/":`/admin/${i}`;return`<a${a===i?' class="active"':""} href="${c}"><i class="fa ${l}" aria-hidden="true"></i>${r}</a>`}).join("");return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t} - ${p(s.options.title)}</title>
  <link rel="stylesheet" href="/usr/themes/joe/assets/lib/font-awesome@4.7.0/font-awesome.min.css">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'PingFang SC','Microsoft YaHei',sans-serif;background:#f4f5f7;color:#24292f}
    .layout{display:flex;min-height:100vh}
    .side{width:220px;background:#1a1f24;color:#c9d1d9;padding:20px 0;flex-shrink:0}
    .side .brand{padding:0 20px 20px;font-size:16px;font-weight:700;color:#fff;border-bottom:1px solid #30363d;margin-bottom:12px}
    .side .brand small{display:block;font-size:11px;color:#8b949e;font-weight:400;margin-top:4px}
    .side a{display:block;padding:11px 20px;color:#c9d1d9;text-decoration:none;font-size:14px}
    .side a:hover{background:#30363d;color:#fff}
    .side a.active{background:#0969da;color:#fff}
    .side a i{width:22px;margin-right:8px}
    .main{flex:1;padding:28px 36px;max-width:1200px}
    h2{font-size:20px;margin-bottom:20px}
    .card{background:#fff;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.06);padding:24px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th{text-align:left;padding:10px 12px;border-bottom:2px solid #eaeef2;color:#57606a;font-size:13px}
    td{padding:10px 12px;border-bottom:1px solid #eaeef2}
    tr:hover td{background:#f6f8fa}
    .btn{display:inline-block;padding:8px 16px;background:#1a1f24;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;border:0;cursor:pointer}
    .btn:hover{background:#30363d}
    .btn.primary{background:#0969da}.btn.primary:hover{background:#0860c4}
    .btn.danger{background:#cf222e}.btn.danger:hover{background:#a40e26}
    .btn.sm{padding:4px 10px;font-size:12px}
    .item{margin-bottom:16px}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
    input[type=text],input[type=password],input[type=email],input[type=number],input[type=file],select,textarea{width:100%;max-width:520px;padding:9px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;outline:none;font-family:inherit}
    textarea{min-height:120px;resize:vertical}
    input:focus,textarea:focus,select:focus{border-color:#0969da;box-shadow:0 0 0 3px rgba(9,105,218,.12)}
    .row{display:flex;gap:14px;flex-wrap:wrap}
    .row .item{flex:1;min-width:220px}
    .hint{font-size:12px;color:#8b949e;margin-top:6px}
    .msg{padding:12px 16px;border-radius:6px;margin-bottom:18px;font-size:14px}
    .msg.ok{background:#dafbe1;color:#116329;border:1px solid #4ac26b}
    .msg.err{background:#ffebe9;color:#cf222e;border:1px solid #ffcecb}
    .stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:20px}
    .stat{background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    .stat .num{font-size:26px;font-weight:700}
    .stat .label{font-size:12px;color:#57606a;margin-top:4px}
    .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:#eaeef2;color:#57606a}
    .badge.green{background:#dafbe1;color:#116329}.badge.yellow{background:#fff8c5;color:#4d2d00}
    a{color:#0969da}
  </style></head><body>
  <div class="layout">
    <nav class="side">
      <div class="brand">${p(s.options.title)}<small>TypechoEdge v${M.VERSION}</small></div>
      ${o}
    </nav>
    <main class="main">${e}</main>
  </div></body></html>`}function aa(s,t=200){return new Response(JSON.stringify(s),{status:t,headers:{"Content-Type":"application/json; charset=utf-8"}})}var F=s=>{let t=s.url.searchParams.get("msg");return t==="ok"?'<div class="msg ok">\u64CD\u4F5C\u6210\u529F</div>':t==="err"?'<div class="msg err">\u64CD\u4F5C\u5931\u8D25</div>':t==="saved"?'<div class="msg ok">\u5DF2\u4FDD\u5B58</div>':""};async function sa(s){let{db:t,user:a}=s,e=await t.listContents({type:"post",pageSize:1,allStatus:!0}),n=await t.listContents({type:"page",pageSize:1,allStatus:!0}),o=await t.listAllComments({pageSize:1}),i=await t.listAllComments({status:"waiting",pageSize:1}),r=await t.listMetas("category"),l=await t.listMetas("tag"),c=`${F(s)}
  <h2>\u4EEA\u8868\u76D8</h2>
  <div class="stats">
    <div class="stat"><div class="num">${e.total}</div><div class="label">\u6587\u7AE0</div></div>
    <div class="stat"><div class="num">${n.total}</div><div class="label">\u9875\u9762</div></div>
    <div class="stat"><div class="num">${o.total}</div><div class="label">\u8BC4\u8BBA</div></div>
    <div class="stat"><div class="num">${i.total}</div><div class="label">\u5F85\u5BA1\u8BC4\u8BBA</div></div>
    <div class="stat"><div class="num">${r.length}</div><div class="label">\u5206\u7C7B</div></div>
    <div class="stat"><div class="num">${l.length}</div><div class="label">\u6807\u7B7E</div></div>
  </div>
  <div class="card">
    <h2 style="font-size:16px;margin-bottom:14px">\u5FEB\u6377\u64CD\u4F5C</h2>
    <p style="font-size:14px;line-height:2.2">
      <a class="btn primary" href="/admin/post?type=post">\u64B0\u5199\u65B0\u6587\u7AE0</a>
      <a class="btn" href="/admin/page">\u521B\u5EFA\u65B0\u9875\u9762</a>
      <a class="btn" href="/admin/uploads">\u4E0A\u4F20\u9644\u4EF6</a>
      <a class="btn" href="/admin/settings">\u7AD9\u70B9\u8BBE\u7F6E</a>
      <a class="btn" href="/admin/security">\u4E24\u6B65\u9A8C\u8BC1 ${a.totpEnabled?'<span class="badge green">\u5DF2\u5F00\u542F</span>':'<span class="badge yellow">\u672A\u5F00\u542F</span>'}</a>
      <a class="btn" href="/" target="_blank">\u67E5\u770B\u7AD9\u70B9</a>
    </p>
  </div>`;return H(z(s,{title:"\u4EEA\u8868\u76D8",active:"",body:c}))}async function na(s){let{db:t,url:a}=s,e=parseInt(a.searchParams.get("page")||"1",10),n=await t.listContents({type:"post",page:e,pageSize:20,allStatus:!0}),o=n.items.map(l=>`<tr>
    <td>${l.cid}</td>
    <td><a href="/archives/${l.cid}/" target="_blank">${p(l.title)}</a></td>
    <td><span class="badge ${l.status==="publish"?"green":l.status==="hidden"?"yellow":""}">${l.status==="publish"?"\u516C\u5F00":l.status==="hidden"?"\u9690\u85CF":l.status}</span></td>
    <td>${l.commentsNum||0}</td>
    <td>${new Date(l.created*1e3).toLocaleString("zh-CN")}</td>
    <td>
      <a class="btn sm" href="/admin/post?cid=${l.cid}">\u7F16\u8F91</a>
      <form method="post" action="/admin/delete" style="display:inline" onsubmit="return confirm('\u786E\u5B9A\u5220\u9664\u8BE5\u6587\u7AE0\uFF1F')">
        <input type="hidden" name="cid" value="${l.cid}">
        <button class="btn sm danger" type="submit">\u5220\u9664</button>
      </form>
    </td>
  </tr>`).join(""),i=n.pages>1?`<p class="hint">\u7B2C ${n.page} / ${n.pages} \u9875
      ${n.page>1?`<a href="?page=${n.page-1}">\u4E0A\u4E00\u9875</a>`:""}
      ${n.page<n.pages?`<a href="?page=${n.page+1}">\u4E0B\u4E00\u9875</a>`:""}</p>`:"",r=`${F(s)}
  <h2>\u7BA1\u7406\u6587\u7AE0\uFF08${n.total}\uFF09</h2>
  <div class="card">
    <table><thead><tr><th>ID</th><th>\u6807\u9898</th><th>\u72B6\u6001</th><th>\u8BC4\u8BBA</th><th>\u53D1\u5E03\u65F6\u95F4</th><th>\u64CD\u4F5C</th></tr></thead>
    <tbody>${o||'<tr><td colspan="6">\u6682\u65E0\u6587\u7AE0</td></tr>'}</tbody></table>
    ${i}
  </div>`;return H(z(s,{title:"\u7BA1\u7406\u6587\u7AE0",active:"posts",body:r}))}async function oa(s){let{db:t}=s,a=await t.listContents({type:"page",pageSize:100,allStatus:!0}),e=a.items.map(o=>`<tr>
    <td>${o.cid}</td>
    <td><a href="/${o.slug}/" target="_blank">${p(o.title)}</a></td>
    <td><code>/${o.slug}/</code></td>
    <td><span class="badge ${o.status==="publish"?"green":""}">${o.status==="publish"?"\u516C\u5F00":o.status}</span></td>
    <td>
      <a class="btn sm" href="/admin/page?cid=${o.cid}">\u7F16\u8F91</a>
      <form method="post" action="/admin/delete" style="display:inline" onsubmit="return confirm('\u786E\u5B9A\u5220\u9664\u8BE5\u9875\u9762\uFF1F')">
        <input type="hidden" name="cid" value="${o.cid}">
        <button class="btn sm danger" type="submit">\u5220\u9664</button>
      </form>
    </td>
  </tr>`).join(""),n=`${F(s)}
  <h2>\u7BA1\u7406\u9875\u9762\uFF08${a.total}\uFF09</h2>
  <div class="card">
    <table><thead><tr><th>ID</th><th>\u6807\u9898</th><th>\u8DEF\u5F84</th><th>\u72B6\u6001</th><th>\u64CD\u4F5C</th></tr></thead>
    <tbody>${e||'<tr><td colspan="5">\u6682\u65E0\u9875\u9762</td></tr>'}</tbody></table>
  </div>`;return H(z(s,{title:"\u7BA1\u7406\u9875\u9762",active:"pages",body:n}))}async function pe(s,t){let{db:a,url:e,user:n}=s,o=parseInt(e.searchParams.get("cid")||"0",10),i=null;o&&(i=await a.getContent(o));let r=!i,l=t==="page"||i?.type==="page",c=await a.listMetas("category"),w=await a.listMetas("tag"),d=i?await Promise.all((i.tags||[]).map(async y=>(await a.getMeta(y))?.name).filter(Boolean)).then(y=>y.join(",")):"",m=c.map(y=>`<label style="font-weight:400;display:inline-flex;align-items:center;margin-right:14px;gap:4px">
      <input type="checkbox" name="categories" value="${y.mid}" ${i?.categories?.includes(y.mid)?"checked":""}> ${p(y.name)}</label>`).join(""),g=`${F(s)}
  <h2>${r?l?"\u521B\u5EFA\u9875\u9762":"\u64B0\u5199\u6587\u7AE0":`\u7F16\u8F91\uFF1A${p(i.title)}`}</h2>
  <div class="card">
  <form method="post" action="/admin/post">
    ${o?`<input type="hidden" name="cid" value="${o}">`:""}
    <input type="hidden" name="type" value="${l?"page":"post"}">
    <div class="item"><label>\u6807\u9898</label><input type="text" name="title" value="${p(i?.title||"")}" required></div>
    ${l?`<div class="item"><label>\u7F29\u7565\u540D\uFF08URL \u8DEF\u5F84\uFF09</label><input type="text" name="slug" value="${p(i?.slug||"")}" placeholder="about" pattern="[a-zA-Z0-9_-]+"><div class="hint">\u8BBF\u95EE\u8DEF\u5F84 /\u7F29\u7565\u540D/\uFF0C\u7559\u7A7A\u81EA\u52A8\u751F\u6210</div></div>`:""}
    <div class="item"><label>\u5185\u5BB9\uFF08\u652F\u6301 Markdown\uFF0C<!--more--> \u4E4B\u524D\u4E3A\u6458\u8981\uFF09</label>
      <textarea name="text" style="min-height:320px;font-family:Consolas,monospace">${p(i?.text||"")}</textarea></div>
    <div class="row">
      <div class="item"><label>\u72B6\u6001</label>
        <select name="status">
          <option value="publish" ${i?.status!=="hidden"?"selected":""}>\u516C\u5F00</option>
          <option value="hidden" ${i?.status==="hidden"?"selected":""}>\u9690\u85CF</option>
        </select></div>
      ${l?"":`<div class="item"><label>\u8BBF\u95EE\u5BC6\u7801\uFF08\u53EF\u9009\uFF09</label><input type="text" name="password" value="${p(i?.password||"")}" placeholder="\u7559\u7A7A\u4E0D\u52A0\u5BC6"></div>`}
      <div class="item"><label>\u5141\u8BB8\u8BC4\u8BBA</label>
        <select name="allowComment">
          <option value="1" ${i?.allowComment!==!1?"selected":""}>\u5141\u8BB8</option>
          <option value="0" ${i?.allowComment===!1?"selected":""}>\u7981\u6B62</option>
        </select></div>
    </div>
    ${l?"":`<div class="item"><label>\u6240\u5C5E\u5206\u7C7B</label><div>${m||'<span class="hint">\u6682\u65E0\u5206\u7C7B\uFF0C\u53EF\u5148\u5728\u300C\u5206\u7C7B/\u6807\u7B7E\u300D\u4E2D\u521B\u5EFA</span>'}</div></div>
    <div class="item"><label>\u6807\u7B7E\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u81EA\u52A8\u521B\u5EFA\uFF09</label><input type="text" name="tags" value="${p(d)}" placeholder="\u751F\u6D3B, \u6280\u672F"></div>`}
    <div class="item"><label>\u81EA\u5B9A\u4E49\u5B57\u6BB5</label>
      <div class="row">
        <div class="item"><input type="text" name="field_thumb" value="${p(i?.fields?.thumb||"")}" placeholder="\u7F29\u7565\u56FE URL\uFF08thumb\uFF09"></div>
        <div class="item"><input type="text" name="field_abstract" value="${p(i?.fields?.abstract||"")}" placeholder="\u6458\u8981\uFF08abstract\uFF09"></div>
        <div class="item"><input type="text" name="field_mode" value="${p(i?.fields?.mode||"")}" placeholder="\u7279\u6B8A\u6A21\u5F0F\uFF08mode\uFF0C\u5982 links\uFF09"></div>
      </div>
      <div class="hint">Joe \u4E3B\u9898\u6269\u5C55\u5B57\u6BB5\uFF1Athumb=\u5C01\u9762\u56FE\u3001abstract=\u5217\u8868\u6458\u8981\u3001keywords/description=SEO\u3001mode=links \u65F6\u6B63\u6587\u6E32\u67D3\u4E3A\u53CB\u94FE\u9875</div>
    </div>
    <button class="btn primary" type="submit">${r?"\u53D1\u5E03":"\u4FDD\u5B58\u4FEE\u6539"}</button>
    <a class="btn" href="/admin/${l?"pages":"posts"}">\u8FD4\u56DE\u5217\u8868</a>
  </form>
  </div>`;return H(z(s,{title:r?"\u64B0\u5199":"\u7F16\u8F91",active:l?"page":"post",body:g}))}async function ia(s){let{db:t,user:a,url:e}=s,n=await s.request.formData(),o=parseInt(n.get("cid")||"0",10),i=n.get("type")==="page"?"page":"post",r=String(n.get("title")||"").trim()||"\u672A\u547D\u540D",l=String(n.get("text")||""),c=String(n.get("slug")||"").trim();i==="page"&&!c&&(c="page-"+Date.now().toString(36));let w=n.getAll("categories").map(Number).filter(Boolean),d=[];for(let y of String(n.get("tags")||"").split(/[,，]/)){let x=y.trim();if(!x)continue;let A=(await t.listMetas("tag")).find(j=>j.name===x);A||(A=await t.createMeta({name:x,slug:x,type:"tag"})),d.push(A.mid)}let m={...o?(await t.getContent(o))?.fields||{}:{}};for(let y of["thumb","abstract","mode"]){let x=String(n.get("field_"+y)||"").trim();x?m[y]=x:delete m[y]}let g={title:r,slug:c,text:l,type:i,status:n.get("status")==="hidden"?"hidden":"publish",password:String(n.get("password")||""),allowComment:n.get("allowComment")==="1",categories:w,tags:d,fields:m,authorId:a.uid};return o?await t.updateContent(o,g):await t.createContent(g),Response.redirect(new URL(`/admin/${i==="page"?"pages":"posts"}?msg=saved`,e).href,302)}async function ra(s){let{db:t,url:a}=s,e=await s.request.formData(),n=parseInt(e.get("cid")||"0",10);return n&&await t.deleteContent(n),Response.redirect(new URL("/admin/posts?msg=ok",a).href,302)}async function la(s){let{db:t}=s,a=await t.listMetas("category"),e=await t.listMetas("tag"),n=(i,r)=>`<table><thead><tr><th>\u540D\u79F0</th><th>\u7F29\u7565\u540D</th><th>\u6587\u7AE0\u6570</th><th>\u64CD\u4F5C</th></tr></thead><tbody>
    ${i.map(l=>`<tr>
      <td>${p(l.name)}</td><td><code>${p(l.slug)}</code></td><td>${l.count}</td>
      <td>
        <form method="post" action="/admin/meta" style="display:flex;gap:6px">
          <input type="hidden" name="mid" value="${l.mid}">
          <input type="hidden" name="type" value="${r}">
          <input type="text" name="name" value="${p(l.name)}" style="max-width:140px;padding:5px 8px">
          <button class="btn sm" type="submit">\u6539\u540D</button>
        </form>
        <form method="post" action="/admin/meta-delete" style="display:inline;margin-top:4px" onsubmit="return confirm('\u786E\u5B9A\u5220\u9664\uFF1F\u6587\u7AE0\u5C06\u89E3\u9664\u5173\u8054')">
          <input type="hidden" name="mid" value="${l.mid}">
          <button class="btn sm danger" type="submit">\u5220\u9664</button>
        </form>
      </td>
    </tr>`).join("")||'<tr><td colspan="4">\u6682\u65E0</td></tr>'}
  </tbody></table>`,o=`${F(s)}
  <h2>\u5206\u7C7B / \u6807\u7B7E</h2>
  <div class="row">
    <div class="card" style="flex:1;min-width:340px">
      <h2 style="font-size:16px;margin-bottom:14px">\u65B0\u5EFA</h2>
      <form method="post" action="/admin/meta">
        <div class="row">
          <div class="item"><label>\u7C7B\u578B</label><select name="type"><option value="category">\u5206\u7C7B</option><option value="tag">\u6807\u7B7E</option></select></div>
          <div class="item"><label>\u540D\u79F0</label><input type="text" name="name" required></div>
          <div class="item"><label>\u7F29\u7565\u540D\uFF08\u53EF\u9009\uFF09</label><input type="text" name="slug"></div>
        </div>
        <button class="btn primary" type="submit">\u521B\u5EFA</button>
      </form>
    </div>
    <div class="card" style="flex:1;min-width:340px">
      <h2 style="font-size:16px;margin-bottom:14px">\u5206\u7C7B\uFF08${a.length}\uFF09</h2>
      ${n(a,"category")}
    </div>
    <div class="card" style="flex:1;min-width:340px">
      <h2 style="font-size:16px;margin-bottom:14px">\u6807\u7B7E\uFF08${e.length}\uFF09</h2>
      ${n(e,"tag")}
    </div>
  </div>`;return H(z(s,{title:"\u5206\u7C7B\u6807\u7B7E",active:"metas",body:o}))}async function ca(s){let{db:t,url:a}=s,e=await s.request.formData(),n=parseInt(e.get("mid")||"0",10),o=String(e.get("name")||"").trim(),i=e.get("type")==="tag"?"tag":"category";if(!o)return Response.redirect(new URL("/admin/metas?msg=err",a).href,302);if(n)await t.updateMeta(n,{name:o});else{let r=String(e.get("slug")||"").trim()||o;await t.createMeta({name:o,slug:r,type:i})}return Response.redirect(new URL("/admin/metas?msg=saved",a).href,302)}async function da(s){let{db:t,url:a}=s,e=await s.request.formData(),n=parseInt(e.get("mid")||"0",10);return n&&await t.deleteMeta(n),Response.redirect(new URL("/admin/metas?msg=ok",a).href,302)}async function pa(s){let{db:t,url:a}=s,e=a.searchParams.get("status")||"",n=parseInt(a.searchParams.get("page")||"1",10),o=await t.listAllComments({status:e||void 0,page:n,pageSize:30}),i=`<p style="margin-bottom:14px;font-size:14px">
    <a href="/admin/comments" ${e?"":'style="font-weight:700"'}>\u5168\u90E8</a> \xB7
    <a href="/admin/comments?status=approved" ${e==="approved"?'style="font-weight:700"':""}>\u5DF2\u901A\u8FC7</a> \xB7
    <a href="/admin/comments?status=waiting" ${e==="waiting"?'style="font-weight:700"':""}>\u5F85\u5BA1\u6838</a></p>`,r=o.items.map(c=>`<tr>
    <td>${c.coid}</td>
    <td>${p(c.author)}<br><span class="hint">${p(c.mail)}</span></td>
    <td style="max-width:420px">${p(q(c.text,80))}</td>
    <td><a href="/archives/${c.cid}/#comment-${c.coid}" target="_blank">#${c.cid}</a></td>
    <td><span class="badge ${c.status==="approved"?"green":"yellow"}">${c.status==="approved"?"\u5DF2\u901A\u8FC7":"\u5F85\u5BA1\u6838"}</span></td>
    <td>${new Date(c.created*1e3).toLocaleString("zh-CN")}</td>
    <td>
      ${c.status==="waiting"?`<form method="post" action="/admin/comment" style="display:inline"><input type="hidden" name="coid" value="${c.coid}"><input type="hidden" name="op" value="approve"><button class="btn sm" type="submit">\u901A\u8FC7</button></form>`:`<form method="post" action="/admin/comment" style="display:inline"><input type="hidden" name="coid" value="${c.coid}"><input type="hidden" name="op" value="waiting"><button class="btn sm" type="submit">\u8F6C\u4E3A\u5F85\u5BA1</button></form>`}
      <form method="post" action="/admin/comment" style="display:inline" onsubmit="return confirm('\u786E\u5B9A\u5220\u9664\u8BE5\u8BC4\u8BBA\uFF1F')"><input type="hidden" name="coid" value="${c.coid}"><input type="hidden" name="op" value="delete"><button class="btn sm danger" type="submit">\u5220\u9664</button></form>
    </td>
  </tr>`).join(""),l=`${F(s)}
  <h2>\u8BC4\u8BBA\u7BA1\u7406\uFF08${o.total}\uFF09</h2>
  <div class="card">${i}
    <table><thead><tr><th>ID</th><th>\u4F5C\u8005</th><th>\u5185\u5BB9</th><th>\u6587\u7AE0</th><th>\u72B6\u6001</th><th>\u65F6\u95F4</th><th>\u64CD\u4F5C</th></tr></thead>
    <tbody>${r||'<tr><td colspan="7">\u6682\u65E0\u8BC4\u8BBA</td></tr>'}</tbody></table>
  </div>`;return H(z(s,{title:"\u8BC4\u8BBA\u7BA1\u7406",active:"comments",body:l}))}async function ua(s){let{db:t,url:a}=s,e=await s.request.formData(),n=parseInt(e.get("coid")||"0",10),o=e.get("op");return n?(o==="approve"?await t.updateComment(n,{status:"approved"}):o==="waiting"?await t.updateComment(n,{status:"waiting"}):o==="delete"&&await t.deleteComment(n),Response.redirect(new URL("/admin/comments?msg=ok",a).href,302)):Response.redirect(new URL("/admin/comments?msg=err",a).href,302)}async function ma(s){let{db:t}=s,a=(await t.listContents({type:"attachment",pageSize:200,allStatus:!0})).items,e=a.map(o=>`<tr>
    <td>${o.cid}</td>
    <td>${o.fields?.contentType||"file"}</td>
    <td><a href="/upload/${encodeURIComponent(o.slug)}" target="_blank">${p(o.slug)}</a></td>
    <td>${(o.fields?.size/1024||0).toFixed(1)} KB</td>
    <td>${new Date(o.created*1e3).toLocaleString("zh-CN")}</td>
    <td><code>/upload/${p(o.slug)}</code></td>
    <td>
      <form method="post" action="/admin/delete" onsubmit="return confirm('\u5220\u9664\u9644\u4EF6\uFF1F')">
        <input type="hidden" name="cid" value="${o.cid}">
        <button class="btn sm danger" type="submit">\u5220\u9664</button>
      </form>
    </td>
  </tr>`).join(""),n=`${F(s)}
  <h2>\u9644\u4EF6\u7BA1\u7406\uFF08${a.length}\uFF09</h2>
  <div class="card">
    <form method="post" action="/admin/upload" enctype="multipart/form-data" style="display:flex;gap:12px;align-items:flex-end;margin-bottom:18px">
      <div class="item" style="flex:1"><label>\u4E0A\u4F20\u6587\u4EF6\uFF08\u5B58\u5165 Blob \u5B58\u50A8\uFF09</label><input type="file" name="file" required></div>
      <button class="btn primary" type="submit">\u4E0A\u4F20</button>
    </form>
    <table><thead><tr><th>ID</th><th>\u7C7B\u578B</th><th>\u6587\u4EF6\u540D</th><th>\u5927\u5C0F</th><th>\u65F6\u95F4</th><th>\u5F15\u7528\u5730\u5740</th><th>\u64CD\u4F5C</th></tr></thead>
    <tbody>${e||'<tr><td colspan="7">\u6682\u65E0\u9644\u4EF6</td></tr>'}</tbody></table>
    <p class="hint">Markdown \u4E2D\u5F15\u7528\uFF1A\`![\u56FE\u7247](/upload/xxx.png)\`</p>
  </div>`;return H(z(s,{title:"\u9644\u4EF6\u7BA1\u7406",active:"uploads",body:n}))}async function fa(s){let{db:t,url:a}=s,n=(await s.request.formData()).get("file");if(!n||typeof n=="string")return Response.redirect(new URL("/admin/uploads?msg=err",a).href,302);let o=`${Date.now().toString(36)}-${n.name.replace(/[^\w.\-]+/g,"_")}`,i=await n.arrayBuffer();if(i.byteLength>5*1024*1024)return Response.redirect(new URL("/admin/uploads?msg=err",a).href,302);await t.blob.set(o,i,n.type);let r=await t.createContent({title:n.name,slug:o,type:"attachment",text:"",authorId:s.user.uid,fields:{contentType:n.type,size:i.byteLength}});return Response.redirect(new URL("/admin/uploads?msg=ok",a).href,302)}async function ga(s){let{db:t}=s,a=s.options,e=a.joe||st,n=`${F(s)}
  <h2>\u7AD9\u70B9\u8BBE\u7F6E</h2>
  <div class="card">
  <form method="post" action="/admin/settings">
    <div class="row">
      <div class="item"><label>\u7AD9\u70B9\u540D\u79F0</label><input type="text" name="title" value="${p(a.title||"")}"></div>
      <div class="item"><label>\u7AD9\u70B9\u63CF\u8FF0</label><input type="text" name="description" value="${p(a.description||"")}"></div>
      <div class="item"><label>SEO \u5173\u952E\u8BCD</label><input type="text" name="keywords" value="${p(a.keywords||"")}"></div>
    </div>
    <div class="row">
      <div class="item"><label>\u6BCF\u9875\u6587\u7AE0\u6570</label><input type="number" name="pageSize" value="${a.pageSize||10}" min="1" max="50"></div>
      <div class="item"><label>\u8BC4\u8BBA\u9ED8\u8BA4\u72B6\u6001</label><select name="commentStatus">
        <option value="approved" ${a.commentStatus!=="waiting"?"selected":""}>\u76F4\u63A5\u53D1\u5E03</option>
        <option value="waiting" ${a.commentStatus==="waiting"?"selected":""}>\u5148\u5BA1\u6838\u540E\u53D1\u5E03</option>
      </select></div>
    </div>
    <h2 style="font-size:16px;margin:10px 0 14px">Joe \u4E3B\u9898\u8BBE\u7F6E</h2>
    <div class="row">
      <div class="item"><label>Logo \u56FE\u7247 URL</label><input type="text" name="j_JLogo" value="${p(e.JLogo||"")}"></div>
      <div class="item"><label>Favicon URL</label><input type="text" name="j_JFavicon" value="${p(e.JFavicon||"")}"></div>
      <div class="item"><label>\u5EFA\u7AD9\u65E5\u671F\uFF08\u8FD0\u884C\u65F6\u95F4\uFF09</label><input type="text" name="j_JBirthDay" value="${p(e.JBirthDay||"")}" placeholder="2024/01/01 00:00:00"></div>
    </div>
    <div class="row">
      <div class="item"><label>\u4FA7\u680F\u535A\u4E3B\u6635\u79F0</label><input type="text" name="j_JAside_Author_Nick" value="${p(e.JAside_Author_Nick||"")}"></div>
      <div class="item"><label>\u4FA7\u680F\u535A\u4E3B\u5934\u50CF URL</label><input type="text" name="j_JAside_Author_Avatar" value="${p(e.JAside_Author_Avatar||"")}"></div>
      <div class="item"><label>\u4FA7\u680F\u535A\u4E3B\u94FE\u63A5</label><input type="text" name="j_JAside_Author_Link" value="${p(e.JAside_Author_Link||"")}"></div>
    </div>
    <div class="row">
      <div class="item"><label>\u535A\u4E3B\u680F\u80CC\u666F\u56FE URL</label><input type="text" name="j_JAside_Author_Image" value="${p(e.JAside_Author_Image||"")}"></div>
      <div class="item"><label>\u535A\u4E3B\u683C\u8A00\uFF08Motto\uFF09</label><input type="text" name="j_JAside_Author_Motto" value="${p(e.JAside_Author_Motto||"")}"></div>
      <div class="item"><label>\u70ED\u95E8\u6587\u7AE0\u4FA7\u680F\u6570\u91CF</label><input type="number" name="j_JAside_Hot_Num" value="${p(e.JAside_Hot_Num||"5")}" min="0" max="10"></div>
    </div>
    <div class="row">
      <div class="item"><label>\u6700\u65B0\u56DE\u590D\u4FA7\u680F</label><select name="j_JAside_Newreply_Status"><option value="on" ${e.JAside_Newreply_Status!=="off"?"selected":""}>\u5F00\u542F</option><option value="off" ${e.JAside_Newreply_Status==="off"?"selected":""}>\u5173\u95ED</option></select></div>
      <div class="item"><label>\u4EBA\u751F\u5012\u8BA1\u65F6\u4FA7\u680F</label><select name="j_JAside_Timelife_Status"><option value="on" ${e.JAside_Timelife_Status!=="off"?"selected":""}>\u5F00\u542F</option><option value="off" ${e.JAside_Timelife_Status==="off"?"selected":""}>\u5173\u95ED</option></select></div>
      <div class="item"><label>\u8BC4\u8BBA\u529F\u80FD</label><select name="j_JCommentStatus"><option value="on" ${e.JCommentStatus!=="off"?"selected":""}>\u5F00\u542F</option><option value="off" ${e.JCommentStatus==="off"?"selected":""}>\u5173\u95ED</option></select></div>
    </div>
    <div class="row">
      <div class="item"><label>\u5BFC\u822A\u6700\u591A\u663E\u793A\u9875\u9762\u6570</label><input type="number" name="j_JNavMaxNum" value="${p(e.JNavMaxNum||"6")}" min="1" max="20"></div>
      <div class="item"><label>ICP \u5907\u6848\u53F7</label><input type="text" name="j_JICP" value="${p(e.JICP||"")}"></div>
      <div class="item"><label>\u9875\u811A\u81EA\u5B9A\u4E49\u5185\u5BB9</label><input type="text" name="j_JFooter_Custom" value="${p(e.JFooter_Custom||"")}"></div>
    </div>
    <button class="btn primary" type="submit">\u4FDD\u5B58\u8BBE\u7F6E</button>
  </form>
  </div>`;return H(z(s,{title:"\u7AD9\u70B9\u8BBE\u7F6E",active:"settings",body:n}))}async function ha(s){let{db:t,url:a}=s,e=await s.request.formData(),n=["title","description","keywords","commentStatus"];for(let i of n)e.has(i)&&await t.setOption(i,String(e.get(i)));e.has("pageSize")&&await t.setOption("pageSize",Math.max(1,parseInt(e.get("pageSize"),10)||10));let o={...await t.getOption("theme:joe")||st};for(let[i,r]of e.entries())i.startsWith("j_")&&(o[i.slice(2)]=String(r));return await t.setOption("theme:joe",o),Response.redirect(new URL("/admin/settings?msg=saved",a).href,302)}async function wa(s){let{db:t,user:a,url:e}=s,n=e.searchParams.get("step"),o;if(a.totpEnabled)o=`<div class="msg ok">\u4E24\u6B65\u9A8C\u8BC1\u5DF2\u5F00\u542F</div>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="disable">
      <div class="item"><label>\u8F93\u5165\u5F53\u524D\u52A8\u6001\u7801\u4EE5\u5173\u95ED\u4E24\u6B65\u9A8C\u8BC1</label><input type="text" name="totp" pattern="\\d{6}" required></div>
      <button class="btn danger" type="submit">\u5173\u95ED\u4E24\u6B65\u9A8C\u8BC1</button>
    </form>`;else if(n==="bind"){let r=le();await t.setOption(`totpPending:${a.uid}`,r);let l=ce(r,a.mail||a.name,s.options.title||"TypechoEdge");o=`<h2 style="font-size:16px;margin-bottom:14px">\u7B2C\u4E00\u6B65\uFF1A\u626B\u63CF\u4E8C\u7EF4\u7801</h2>
    <div style="text-align:center;margin-bottom:18px"><div style="display:inline-block;background:#fff;padding:12px;border-radius:8px">${de(l).replace("<svg",'<svg width="220" height="220"')}</div>
    <p class="hint" style="margin-top:10px">\u4F7F\u7528 Google Authenticator / Microsoft Authenticator / \u5FAE\u4FE1\u5C0F\u7A0B\u5E8F\u300C\u817E\u8BAF\u8EAB\u4EFD\u9A8C\u8BC1\u5668\u300D\u7B49\u626B\u63CF</p>
    <p class="hint">\u65E0\u6CD5\u626B\u7801\uFF1F\u624B\u52A8\u8F93\u5165\u5BC6\u94A5\uFF1A<code style="user-select:all;font-size:15px">${r}</code></p></div>
    <h2 style="font-size:16px;margin-bottom:14px">\u7B2C\u4E8C\u6B65\uFF1A\u8F93\u5165\u52A8\u6001\u7801\u786E\u8BA4\u7ED1\u5B9A</h2>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="enable">
      <div class="item"><label>6 \u4F4D\u52A8\u6001\u7801</label><input type="text" name="totp" pattern="\\d{6}" required autofocus autocomplete="one-time-code"></div>
      <button class="btn primary" type="submit">\u786E\u8BA4\u5F00\u542F</button>
    </form>`}else o=`<p style="font-size:14px;color:#57606a;line-height:1.8;margin-bottom:16px">
      \u5F00\u542F\u540E\uFF0C\u767B\u5F55\u65F6\u9664\u5BC6\u7801\u5916\u8FD8\u9700\u8F93\u5165\u52A8\u6001\u9A8C\u8BC1\u7801\uFF08TOTP\uFF0CRFC 6238\uFF09\uFF0C<br>\u5373\u4F7F\u5BC6\u7801\u6CC4\u9732\u4E5F\u65E0\u6CD5\u767B\u5F55\u540E\u53F0\u3002</p>
    <a class="btn primary" href="/admin/security?step=bind">\u5F00\u542F\u4E24\u6B65\u9A8C\u8BC1</a>`;let i=`${F(s)}
  <h2>\u5B89\u5168\u8BBE\u7F6E</h2>
  <div class="card">
    ${o}
  </div>
  <div class="card">
    <h2 style="font-size:16px;margin-bottom:14px">\u4FEE\u6539\u5BC6\u7801</h2>
    <form method="post" action="/admin/security">
      <input type="hidden" name="op" value="password">
      <div class="row">
        <div class="item"><label>\u5F53\u524D\u5BC6\u7801</label><input type="password" name="old" required></div>
        <div class="item"><label>\u65B0\u5BC6\u7801\uFF08\u81F3\u5C11 8 \u4F4D\uFF09</label><input type="password" name="password" required minlength="8"></div>
        <div class="item"><label>\u786E\u8BA4\u65B0\u5BC6\u7801</label><input type="password" name="password2" required minlength="8"></div>
      </div>
      <button class="btn" type="submit">\u4FEE\u6539\u5BC6\u7801</button>
    </form>
  </div>`;return H(z(s,{title:"\u5B89\u5168\u8BBE\u7F6E",active:"security",body:i}))}async function va(s){let{db:t,url:a,user:e}=s,n=await s.request.formData(),o=n.get("op");if(o==="enable"){let i=await t.getOption(`totpPending:${e.uid}`),r=String(n.get("totp")||"");return!i||!await xt(i,r)?Response.redirect(new URL("/admin/security?step=bind&msg=err",a).href,302):(await t.updateUser(e.uid,{totpEnabled:!0,totpSecret:i}),await t.setOption(`totpPending:${e.uid}`,null),Response.redirect(new URL("/admin/security?msg=saved",a).href,302))}if(o==="disable"){let i=String(n.get("totp")||"");return await xt(e.totpSecret,i)?(await t.updateUser(e.uid,{totpEnabled:!1,totpSecret:null}),Response.redirect(new URL("/admin/security?msg=ok",a).href,302)):Response.redirect(new URL("/admin/security?msg=err",a).href,302)}if(o==="password"){let i=String(n.get("old")||""),r=String(n.get("password")||""),l=String(n.get("password2")||"");if(!await bt(i,e.passwordHash)||r.length<8||r!==l)return Response.redirect(new URL("/admin/security?msg=err",a).href,302);let{hashPassword:c}=await Promise.resolve().then(()=>(X(),ct));return await t.updateUser(e.uid,{passwordHash:await c(r)}),Response.redirect(new URL("/admin/security?msg=saved",a).href,302)}return Response.redirect(new URL("/admin/security",a).href,302)}function H(s,t={}){return new Response(s,{...t,headers:{"Content-Type":"text/html; charset=utf-8",...t.headers||{}}})}Q();ut();at();It();async function fe({db:s,request:t,url:a}){let e=await t.formData().catch(()=>new URLSearchParams(a.search)),n=r=>e.get(r)||a.searchParams.get(r)||"",o=n("routeType"),i=(r,l=1)=>new Response(JSON.stringify({code:l,data:r}),{headers:{"Content-Type":"application/json; charset=utf-8"}});switch(o){case"publish_list":{let r=parseInt(n("page")||"1",10),l=Math.min(parseInt(n("pageSize")||"10",10),50),c=n("type")||"created",w={created:"created",views:"views",commentsNum:"commentsNum",agree:"agree"},{items:d}=await s.listContents({type:"post",page:r,pageSize:l,order:w[c]||"created"}),m=await Promise.all(d.map(async g=>{let y=[];for(let A of g.categories||[]){let j=await s.getMeta(A);j&&y.push({name:j.name,permalink:`/category/${encodeURIComponent(j.slug)}/`})}let x=(g.text||"").match(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/);return{cid:g.cid,title:g.title,permalink:`/archives/${g.cid}/`,abstract:g.fields?.abstract||"",created:me(g.created),views:await s.getStat(g.cid,"views"),commentsNum:g.commentsNum||0,agree:await s.getStat(g.cid,"agree"),category:y,type:g.status==="sticky"?"sticky":g.type,image:[g.fields?.thumb||(x?x[1]:"")].filter(Boolean),lazyload:"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",time:me(g.created,"YYYY-MM-DD"),mode:"default"}}));return i(m)}case"handle_views":{let r=parseInt(n("cid"),10);if(!r)return i(null,0);let l=await s.incrStat(r,"views");return i({views:l})}case"handle_agree":{let r=parseInt(n("cid"),10),l=n("type")==="disagree"?-1:1;if(!r)return i(null,0);let c=await s.kv.getJSON("stat:agree")||{};return c[r]=Math.max(0,(c[r]||0)+l),await s.kv.putJSON("stat:agree",c),i({agree:c[r]})}case"baidu_record":case"baidu_push":return i({record:!1,push:!1});default:return i(null,0)}}function me(s,t="YYYY-MM-DD HH:mm:ss"){let a=new Date(s*1e3),e=n=>String(n).padStart(2,"0");return t.replace("YYYY",a.getFullYear()).replace("MM",e(a.getMonth()+1)).replace("DD",e(a.getDate())).replace("HH",e(a.getHours())).replace("mm",e(a.getMinutes())).replace("ss",e(a.getSeconds()))}var $t=new Map,Ut=new Map,$a={registerHook(s,t){$t.has(s)||$t.set(s,[]),$t.get(s).push(t)},registerAction(s,t){Ut.set(s,t)},getConfig:null};async function et(s,...t){let a=$t.get(s)||[],e=t[0];for(let n of a)try{e=await n(e,...t.slice(1))??e}catch(o){console.error(`[plugin] hook ${s} error:`,o)}return e}async function be(s,t){let a=Ut.get(s);return a?await a(t):null}function ye(s){return Ut.has(s)}async function _e(){let s=[await Promise.resolve().then(()=>(he(),ge)),await Promise.resolve().then(()=>(ve(),we))];for(let t of s)typeof t.register=="function"&&await t.register($a)}async function $e(s){let{db:t,request:a,url:e,path:n}=s,o=a.method;if(n==="/joe/api")return fe(s);if(n.startsWith("/comment/"))return ka(s);if(n==="/feed"||n==="/feed/"||n==="/feed/atom"||n==="/feed/rss")return Ca(s);if(n==="/search"&&o==="GET"&&e.searchParams.get("s"))return Response.redirect(new URL(`/search/${encodeURIComponent(e.searchParams.get("s"))}/`,e).href,302);let i=m=>n.match(m),r=1,l=i(/^\/page\/(\d+)\/?$/),c="/";if(l)r=parseInt(l[1],10);else if(n!=="/")return await Ea(s);let w=await t.listContents({type:"post",page:r,pageSize:s.options.pageSize||M.PAGE_SIZE}),d=await Promise.all(w.items.map(async m=>({...m,views:await t.getStat(m.cid,"views"),agree:await t.getStat(m.cid,"agree")})));return Object.assign(s,{list:w,page:r,pageSize:s.options.pageSize||M.PAGE_SIZE}),gt(await Tt(s),{"Cache-Control":"public, max-age=60"})}async function Ea(s){let{db:t,path:a,url:e}=s,n;if(n=a.match(/^\/archives\/(\d+)\/?$/)){let o=await t.getContent(parseInt(n[1],10));return o&&o.type==="post"&&o.status==="publish"?xe(s,o):rt(s)}if(n=a.match(/^\/attachment\/(\d+)\/?$/)){let o=await t.getContent(parseInt(n[1],10));if(o&&o.type==="attachment"){let i=await s.db.blob.get(o.slug);if(i)return new Response(i.body,{headers:{"Content-Type":i.contentType,"Cache-Control":"public, max-age=86400"}})}return rt(s)}if(n=a.match(/^\/category\/([^/]+?)(?:\/(\d+))?\/?$/))return Et(s,{type:"category",slug:decodeURIComponent(n[1]),page:parseInt(n[2]||"1",10),titleFor:o=>`\u5206\u7C7B ${o.name} \u4E0B\u7684\u6587\u7AE0`,baseUrlFor:o=>`/category/${encodeURIComponent(o.slug)}/`});if(n=a.match(/^\/tag\/([^/]+?)(?:\/(\d+))?\/?$/))return Et(s,{type:"tag",slug:decodeURIComponent(n[1]),page:parseInt(n[2]||"1",10),titleFor:o=>`\u6807\u7B7E ${o.name} \u4E0B\u7684\u6587\u7AE0`,baseUrlFor:o=>`/tag/${encodeURIComponent(o.slug)}/`});if(n=a.match(/^\/author\/(\d+)(?:\/(\d+))?\/?$/)){let o=parseInt(n[1],10),i=await t.getUser(o);return i?Et(s,{type:"author",authorId:o,page:parseInt(n[2]||"1",10),titleFor:()=>`${i.screenName} \u53D1\u5E03\u7684\u6587\u7AE0`,baseUrlFor:()=>`/author/${o}/`}):rt(s)}if(n=a.match(/^\/search\/([^/]+?)(?:\/(\d+))?\/?$/)){let o=decodeURIComponent(n[1]);return Et(s,{type:"search",keywords:o,page:parseInt(n[2]||"1",10),titleFor:()=>`\u5305\u542B\u5173\u952E\u5B57 ${o} \u7684\u6587\u7AE0`,baseUrlFor:()=>`/search/${encodeURIComponent(o)}/`})}if(n=a.match(/^\/upload\/(.+)$/)){let o=await s.db.blob.get(decodeURIComponent(n[1]));return o?new Response(o.body,{headers:{"Content-Type":o.contentType,"Cache-Control":"public, max-age=86400"}}):rt(s)}if((n=a.match(/^\/([a-zA-Z0-9_-]+)\/?$/))&&a!=="/admin"){let o=await t.getContentBySlug(n[1],"page");if(o&&o.status==="publish")return xe(s,o)}return rt(s)}async function xe(s,t){let{db:a}=s;return t.password&&s.url.searchParams.get("password")!==t.password?Aa(s,t):(s.post=t,s.isPost=t.type==="post",t.text=await et("renderContent",t.text,{post:t,ctx:s}),gt(await Nt(s)))}function Aa(s,t){return s.contentBody=`<div class="joe_container"><div class="joe_main joe_post"><div class="joe_detail">
    <h1 class="joe_detail__title">${p(t.title)}</h1>
    <form class="joe_detail__article-protected" method="get" action="/archives/${t.cid}/">
      <div class="contain">
        <input class="password" type="password" name="password" placeholder="\u8BF7\u8F93\u5165\u8BBF\u95EE\u5BC6\u7801..." />
        <button class="submit" type="submit">\u786E\u5B9A</button>
      </div>
    </form>
  </div></div></div>`,gt(Ba(s,`\u5BC6\u7801\u4FDD\u62A4 - ${s.options.title}`))}function Ba(s,t){let a=e=>`/usr/themes/joe/${e}`;return`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t}</title>
  <link href="${a("assets/css/joe.mode.min.css")}" rel="stylesheet"><link href="${a("assets/css/joe.normalize.min.css")}" rel="stylesheet"><link href="${a("assets/css/joe.global.min.css")}" rel="stylesheet"><link href="${a("assets/css/joe.post.min.css")}" rel="stylesheet">
  </head><body><div id="Joe">${s.contentBody}</div></body></html>`}async function Et(s,{type:t,slug:a,page:e,titleFor:n,baseUrlFor:o,authorId:i,keywords:r}){let{db:l}=s,c=null;if(a&&(c=await l.getMetaBySlug(a,t==="tag"?"tag":"category"),!c))return rt(s);let w={type:"post",page:e,pageSize:s.options.pageSize||M.PAGE_SIZE};c&&(w[t==="tag"?"tagMid":"categoryMid"]=c.mid),i&&(w.authorId=i),r&&(w.keywords=r);let d=await l.listContents(w);return Object.assign(s,{list:d,page:e,archiveTitle:n(c),archiveBaseUrl:o(c)}),gt(await Lt(s))}async function rt(s){return gt(await Pt(s),{status:404})}function gt(s,t={}){return new Response(s,{...t,headers:{"Content-Type":"text/html; charset=utf-8",...t.headers||{}}})}async function ka(s){let{db:t,request:a,url:e,path:n}=s,o=parseInt(n.split("/")[2],10),i=await t.getContent(o);if(!i||!i.allowComment)return Z("\u5F53\u524D\u9875\u9762\u4E0D\u53EF\u8BC4\u8BBA");let r=await a.formData().catch(()=>null);if(!r)return Z("\u8BF7\u6C42\u683C\u5F0F\u9519\u8BEF");let l=String(r.get("author")||"").trim(),c=String(r.get("mail")||"").trim(),w=String(r.get("url")||"").trim(),d=String(r.get("text")||"").trim(),m=parseInt(String(r.get("parent")||r.get("coid")||"0"),10)||0;if(!l||l.length>32)return Z("\u6635\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u4E0D\u80FD\u8D85\u8FC732\u5B57\u7B26");if(!/^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/.test(c))return Z("\u8BF7\u8F93\u5165\u6B63\u786E\u7684\u90AE\u7BB1\u5730\u5740");if(!d)return Z("\u8BF7\u8F93\u5165\u8BC4\u8BBA\u5185\u5BB9");if(d.length>2e3||d.length>2e3&&!/^\{!\{/.test(d))return Z("\u8BC4\u8BBA\u5185\u5BB9\u8FC7\u957F");let g=await et("commentSubmit",{author:l,mail:c,url:w,text:d,parent:m},s);if(g&&g.reject)return Z(g.message||"\u8BC4\u8BBA\u88AB\u62D2\u7EDD");let y=a.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()||"",x=a.headers.get("User-Agent")||"",A=s.user;return await t.createComment({cid:o,author:A?A.screenName:l,authorId:A?A.uid:0,ownerId:i.authorId,mail:A?A.mail:c,url:w,ip:y,agent:x,text:d,parent:m,status:"approved"}),await et("commentPost",{cid:o,author:l,text:d},s),new Response('<!DOCTYPE html><html><body><div id="Joe">ok</div></body></html>',{headers:{"Content-Type":"text/html; charset=utf-8"}})}function Z(s){return new Response(`<!DOCTYPE html><html><body><div class="container">${p(s)}</div></body></html>`,{status:403,headers:{"Content-Type":"text/html; charset=utf-8"}})}async function Ca(s){let{db:t,url:a}=s,e=s.siteUrl,{items:n}=await t.listContents({type:"post",pageSize:20}),o=`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${p(s.options.title)}</title>
  <subtitle>${p(s.options.description||"")}</subtitle>
  <id>${e}/feed/</id>
  <updated>${new Date().toISOString()}</updated>
  <link rel="alternate" href="${e}/" />
  <link rel="self" href="${e}/feed/" />
${n.map(i=>`  <entry>
    <title>${p(i.title)}</title>
    <id>${e}/archives/${i.cid}/</id>
    <link rel="alternate" href="${e}/archives/${i.cid}/" />
    <published>${new Date(i.created*1e3).toISOString()}</published>
    <updated>${new Date(i.modified*1e3).toISOString()}</updated>
    <summary>${p(q(i.text,200))}</summary>
  </entry>`).join(`
`)}
</feed>`;return new Response(o,{headers:{"Content-Type":"application/atom+xml; charset=utf-8"}})}ut();var Ee={\u6CE1\u6CE1:[{icon:"assets/owo/paopao/E591B5E591B5_2x.png",data:"::(\u5475\u5475)"},{icon:"assets/owo/paopao/E59388E59388_2x.png",data:"::(\u54C8\u54C8)"},{icon:"assets/owo/paopao/E59090E8888C_2x.png",data:"::(\u5410\u820C)"},{icon:"assets/owo/paopao/E5A4AAE5BC80E5BF83_2x.png",data:"::(\u592A\u5F00\u5FC3)"},{icon:"assets/owo/paopao/E7AC91E79CBC_2x.png",data:"::(\u7B11\u773C)"},{icon:"assets/owo/paopao/E88AB1E5BF83_2x.png",data:"::(\u82B1\u5FC3)"},{icon:"assets/owo/paopao/E5B08FE4B996_2x.png",data:"::(\u5C0F\u4E56)"},{icon:"assets/owo/paopao/E4B996_2x.png",data:"::(\u4E56)"},{icon:"assets/owo/paopao/E68D82E598B4E7AC91_2x.png",data:"::(\u6342\u5634\u7B11)"},{icon:"assets/owo/paopao/E6BB91E7A8BD_2x.png",data:"::(\u6ED1\u7A3D)"},{icon:"assets/owo/paopao/E4BDA0E68782E79A84_2x.png",data:"::(\u4F60\u61C2\u7684)"},{icon:"assets/owo/paopao/E4B88DE9AB98E585B4_2x.png",data:"::(\u4E0D\u9AD8\u5174)"},{icon:"assets/owo/paopao/E68092_2x.png",data:"::(\u6012)"},{icon:"assets/owo/paopao/E6B197_2x.png",data:"::(\u6C57)"},{icon:"assets/owo/paopao/E9BB91E7BABF_2x.png",data:"::(\u9ED1\u7EBF)"},{icon:"assets/owo/paopao/E6B3AA_2x.png",data:"::(\u6CEA)"},{icon:"assets/owo/paopao/E79C9FE6A392_2x.png",data:"::(\u771F\u68D2)"},{icon:"assets/owo/paopao/E596B7_2x.png",data:"::(\u55B7)"},{icon:"assets/owo/paopao/E6838AE593AD_2x.png",data:"::(\u60CA\u54ED)"},{icon:"assets/owo/paopao/E998B4E999A9_2x.png",data:"::(\u9634\u9669)"},{icon:"assets/owo/paopao/E98499E8A786_2x.png",data:"::(\u9119\u89C6)"},{icon:"assets/owo/paopao/E985B7_2x.png",data:"::(\u9177)"},{icon:"assets/owo/paopao/E5958A_2x.png",data:"::(\u554A)"},{icon:"assets/owo/paopao/E78B82E6B197_2x.png",data:"::(\u72C2\u6C57)"},{icon:"assets/owo/paopao/what_2x.png",data:"::(what)"},{icon:"assets/owo/paopao/E79691E997AE_2x.png",data:"::(\u7591\u95EE)"},{icon:"assets/owo/paopao/E985B8E788BD_2x.png",data:"::(\u9178\u723D)"},{icon:"assets/owo/paopao/E59180E592A9E788B9_2x.png",data:"::(\u5440\u54A9\u7239)"},{icon:"assets/owo/paopao/E5A794E5B188_2x.png",data:"::(\u59D4\u5C48)"},{icon:"assets/owo/paopao/E6838AE8AEB6_2x.png",data:"::(\u60CA\u8BB6)"},{icon:"assets/owo/paopao/E79DA1E8A789_2x.png",data:"::(\u7761\u89C9)"},{icon:"assets/owo/paopao/E7AC91E5B0BF_2x.png",data:"::(\u7B11\u5C3F)"},{icon:"assets/owo/paopao/E68C96E9BCBB_2x.png",data:"::(\u6316\u9F3B)"},{icon:"assets/owo/paopao/E59090_2x.png",data:"::(\u5410)"},{icon:"assets/owo/paopao/E78A80E588A9_2x.png",data:"::(\u7280\u5229)"},{icon:"assets/owo/paopao/E5B08FE7BAA2E884B8_2x.png",data:"::(\u5C0F\u7EA2\u8138)"},{icon:"assets/owo/paopao/E68792E5BE97E79086_2x.png",data:"::(\u61D2\u5F97\u7406)"},{icon:"assets/owo/paopao/E58B89E5BCBA_2x.png",data:"::(\u52C9\u5F3A)"},{icon:"assets/owo/paopao/E788B1E5BF83_2x.png",data:"::(\u7231\u5FC3)"},{icon:"assets/owo/paopao/E5BF83E7A28E_2x.png",data:"::(\u5FC3\u788E)"},{icon:"assets/owo/paopao/E78EABE791B0_2x.png",data:"::(\u73AB\u7470)"},{icon:"assets/owo/paopao/E7A4BCE789A9_2x.png",data:"::(\u793C\u7269)"},{icon:"assets/owo/paopao/E5BDA9E899B9_2x.png",data:"::(\u5F69\u8679)"},{icon:"assets/owo/paopao/E5A4AAE998B3_2x.png",data:"::(\u592A\u9633)"},{icon:"assets/owo/paopao/E6989FE6989FE69C88E4BAAE_2x.png",data:"::(\u661F\u661F\u6708\u4EAE)"},{icon:"assets/owo/paopao/E992B1E5B881_2x.png",data:"::(\u94B1\u5E01)"},{icon:"assets/owo/paopao/E88CB6E69DAF_2x.png",data:"::(\u8336\u676F)"},{icon:"assets/owo/paopao/E89B8BE7B395_2x.png",data:"::(\u86CB\u7CD5)"},{icon:"assets/owo/paopao/E5A4A7E68B87E68C87_2x.png",data:"::(\u5927\u62C7\u6307)"},{icon:"assets/owo/paopao/E8839CE588A9_2x.png",data:"::(\u80DC\u5229)"},{icon:"assets/owo/paopao/haha_2x.png",data:"::(haha)"},{icon:"assets/owo/paopao/OK_2x.png",data:"::(OK)"},{icon:"assets/owo/paopao/E6B299E58F91_2x.png",data:"::(\u6C99\u53D1)"},{icon:"assets/owo/paopao/E6898BE7BAB8_2x.png",data:"::(\u624B\u7EB8)"},{icon:"assets/owo/paopao/E9A699E89589_2x.png",data:"::(\u9999\u8549)"},{icon:"assets/owo/paopao/E4BEBFE4BEBF_2x.png",data:"::(\u4FBF\u4FBF)"},{icon:"assets/owo/paopao/E88DAFE4B8B8_2x.png",data:"::(\u836F\u4E38)"},{icon:"assets/owo/paopao/E7BAA2E9A286E5B7BE_2x.png",data:"::(\u7EA2\u9886\u5DFE)"},{icon:"assets/owo/paopao/E89CA1E7839B_2x.png",data:"::(\u8721\u70DB)"},{icon:"assets/owo/paopao/E99FB3E4B990_2x.png",data:"::(\u97F3\u4E50)"},{icon:"assets/owo/paopao/E781AFE6B3A1_2x.png",data:"::(\u706F\u6CE1)"},{icon:"assets/owo/paopao/E5BC80E5BF83_2x.png",data:"::(\u5F00\u5FC3)"},{icon:"assets/owo/paopao/E992B1_2x.png",data:"::(\u94B1)"},{icon:"assets/owo/paopao/E592A6_2x.png",data:"::(\u54A6)"},{icon:"assets/owo/paopao/E591BC_2x.png",data:"::(\u547C)"},{icon:"assets/owo/paopao/E586B7_2x.png",data:"::(\u51B7)"},{icon:"assets/owo/paopao/E7949FE6B094_2x.png",data:"::(\u751F\u6C14)"},{icon:"assets/owo/paopao/E5BCB1_2x.png",data:"::(\u5F31)"},{icon:"assets/owo/paopao/E78B97E5A4B4_2x.png",data:"::(\u72D7\u5934)"}],\u963F\u9C81:[{icon:"assets/owo/aru/E9AB98E585B4_2x.png",data:":@(\u9AD8\u5174)"},{icon:"assets/owo/aru/E5B08FE68092_2x.png",data:":@(\u5C0F\u6012)"},{icon:"assets/owo/aru/E884B8E7BAA2_2x.png",data:":@(\u8138\u7EA2)"},{icon:"assets/owo/aru/E58685E4BCA4_2x.png",data:":@(\u5185\u4F24)"},{icon:"assets/owo/aru/E8A385E5A4A7E6ACBE_2x.png",data:":@(\u88C5\u5927\u6B3E)"},{icon:"assets/owo/aru/E8B59EE4B880E4B8AA_2x.png",data:":@(\u8D5E\u4E00\u4E2A)"},{icon:"assets/owo/aru/E5AEB3E7BE9E_2x.png",data:":@(\u5BB3\u7F9E)"},{icon:"assets/owo/aru/E6B197_2x.png",data:":@(\u6C57)"},{icon:"assets/owo/aru/E59090E8A180E58092E59CB0_2x.png",data:":@(\u5410\u8840\u5012\u5730)"},{icon:"assets/owo/aru/E6B7B1E6809D_2x.png",data:":@(\u6DF1\u601D)"},{icon:"assets/owo/aru/E4B88DE9AB98E585B4_2x.png",data:":@(\u4E0D\u9AD8\u5174)"},{icon:"assets/owo/aru/E697A0E8AFAD_2x.png",data:":@(\u65E0\u8BED)"},{icon:"assets/owo/aru/E4BAB2E4BAB2_2x.png",data:":@(\u4EB2\u4EB2)"},{icon:"assets/owo/aru/E58FA3E6B0B4_2x.png",data:":@(\u53E3\u6C34)"},{icon:"assets/owo/aru/E5B0B4E5B0AC_2x.png",data:":@(\u5C34\u5C2C)"},{icon:"assets/owo/aru/E4B8ADE68C87_2x.png",data:":@(\u4E2D\u6307)"},{icon:"assets/owo/aru/E683B3E4B880E683B3_2x.png",data:":@(\u60F3\u4E00\u60F3)"},{icon:"assets/owo/aru/E593ADE6B3A3_2x.png",data:":@(\u54ED\u6CE3)"},{icon:"assets/owo/aru/E4BEBFE4BEBF_2x.png",data:":@(\u4FBF\u4FBF)"},{icon:"assets/owo/aru/E78CAEE88AB1_2x.png",data:":@(\u732E\u82B1)"},{icon:"assets/owo/aru/E79AB1E79C89_2x.png",data:":@(\u76B1\u7709)"},{icon:"assets/owo/aru/E582BBE7AC91_2x.png",data:":@(\u50BB\u7B11)"},{icon:"assets/owo/aru/E78B82E6B197_2x.png",data:":@(\u72C2\u6C57)"},{icon:"assets/owo/aru/E59090_2x.png",data:":@(\u5410)"},{icon:"assets/owo/aru/E596B7E6B0B4_2x.png",data:":@(\u55B7\u6C34)"},{icon:"assets/owo/aru/E79C8BE4B88DE8A781_2x.png",data:":@(\u770B\u4E0D\u89C1)"},{icon:"assets/owo/aru/E9BC93E68E8C_2x.png",data:":@(\u9F13\u638C)"},{icon:"assets/owo/aru/E998B4E69A97_2x.png",data:":@(\u9634\u6697)"},{icon:"assets/owo/aru/E995BFE88D89_2x.png",data:":@(\u957F\u8349)"},{icon:"assets/owo/aru/E78CAEE9BB84E7939C_2x.png",data:":@(\u732E\u9EC4\u74DC)"},{icon:"assets/owo/aru/E982AAE681B6_2x.png",data:":@(\u90AA\u6076)"},{icon:"assets/owo/aru/E69C9FE5BE85_2x.png",data:":@(\u671F\u5F85)"},{icon:"assets/owo/aru/E5BE97E6848F_2x.png",data:":@(\u5F97\u610F)"},{icon:"assets/owo/aru/E59090E8888C_2x.png",data:":@(\u5410\u820C)"},{icon:"assets/owo/aru/E596B7E8A180_2x.png",data:":@(\u55B7\u8840)"},{icon:"assets/owo/aru/E697A0E68980E8B093_2x.png",data:":@(\u65E0\u6240\u8C13)"},{icon:"assets/owo/aru/E8A782E5AF9F_2x.png",data:":@(\u89C2\u5BDF)",text:"\u89C2\u5BDF"},{icon:"assets/owo/aru/E69A97E59CB0E8A782E5AF9F_2x.png",data:":@(\u6697\u5730\u89C2\u5BDF)"},{icon:"assets/owo/aru/E882BFE58C85_2x.png",data:":@(\u80BF\u5305)"},{icon:"assets/owo/aru/E4B8ADE69EAA_2x.png",data:":@(\u4E2D\u67AA)"},{icon:"assets/owo/aru/E5A4A7E59BA7_2x.png",data:":@(\u5927\u56E7)"},{icon:"assets/owo/aru/E591B2E78999_2x.png",data:":@(\u5472\u7259)"},{icon:"assets/owo/aru/E68AA0E9BCBB_2x.png",data:":@(\u62A0\u9F3B)"},{icon:"assets/owo/aru/E4B88DE8AFB4E8AF9D_2x.png",data:":@(\u4E0D\u8BF4\u8BDD)"},{icon:"assets/owo/aru/E592BDE6B094_2x.png",data:":@(\u54BD\u6C14)"},{icon:"assets/owo/aru/E6ACA2E591BC_2x.png",data:":@(\u6B22\u547C)"},{icon:"assets/owo/aru/E99481E79C89_2x.png",data:":@(\u9501\u7709)"},{icon:"assets/owo/aru/E89CA1E7839B_2x.png",data:":@(\u8721\u70DB)"},{icon:"assets/owo/aru/E59D90E7AD89_2x.png",data:":@(\u5750\u7B49)"},{icon:"assets/owo/aru/E587BBE68E8C_2x.png",data:":@(\u51FB\u638C)"},{icon:"assets/owo/aru/E6838AE5969C_2x.png",data:":@(\u60CA\u559C)"},{icon:"assets/owo/aru/E5969CE69E81E8808CE6B3A3_2x.png",data:":@(\u559C\u6781\u800C\u6CE3)"},{icon:"assets/owo/aru/E68ABDE7839F_2x.png",data:":@(\u62BD\u70DF)"},{icon:"assets/owo/aru/E4B88DE587BAE68980E69699_2x.png",data:":@(\u4E0D\u51FA\u6240\u6599)"},{icon:"assets/owo/aru/E684A4E68092_2x.png",data:":@(\u6124\u6012)"},{icon:"assets/owo/aru/E697A0E5A588_2x.png",data:":@(\u65E0\u5948)"},{icon:"assets/owo/aru/E9BB91E7BABF_2x.png",data:":@(\u9ED1\u7EBF)"},{icon:"assets/owo/aru/E68A95E9998D_2x.png",data:":@(\u6295\u964D)"},{icon:"assets/owo/aru/E79C8BE783ADE997B9_2x.png",data:":@(\u770B\u70ED\u95F9)"},{icon:"assets/owo/aru/E68987E880B3E58589_2x.png",data:":@(\u6247\u8033\u5149)"},{icon:"assets/owo/aru/E5B08FE79CBCE79D9B_2x.png",data:":@(\u5C0F\u773C\u775B)"},{icon:"assets/owo/aru/E4B8ADE58880_2x.png",data:":@(\u4E2D\u5200)"}],\u989C\u6587\u5B57:[{icon:"|\xB4\u30FB\u03C9\u30FB)\u30CE",data:"|\xB4\u30FB\u03C9\u30FB)\u30CE"},{icon:"\u30FE(\u2267\u2207\u2266*)\u309D",data:"\u30FE(\u2267\u2207\u2266*)\u309D"},{icon:"(\u2606\u03C9\u2606)",data:"(\u2606\u03C9\u2606)"},{icon:"\uFF08\u256F\u2035\u25A1\u2032\uFF09\u256F\uFE35\u2534\u2500\u2534",data:"\uFF08\u256F\u2035\u25A1\u2032\uFF09\u256F\uFE35\u2534\u2500\u2534"},{icon:"\uFFE3\uFE43\uFFE3",data:"\uFFE3\uFE43\uFFE3"},{icon:"(/\u03C9\uFF3C)",data:"(/\u03C9\uFF3C)"},{icon:"\u2220( \u141B \u300D\u2220)\uFF3F",data:"\u2220( \u141B \u300D\u2220)\uFF3F"},{icon:"(\u0E51\u2022\u0300\u3141\u2022\u0301\u0E05)",data:"(\u0E51\u2022\u0300\u3141\u2022\u0301\u0E05)"},{icon:"\u2192_\u2192",data:"\u2192_\u2192"},{icon:"\u0B67(\u0E51\u2022\u0300\u2304\u2022\u0301\u0E51)\u0AED",data:"\u0B67(\u0E51\u2022\u0300\u2304\u2022\u0301\u0E51)\u0AED"},{icon:"\u0669(\u02CA\u15DC\u02CB*)\u0648",data:"\u0669(\u02CA\u15DC\u02CB*)\u0648"},{icon:"(\u30CE\xB0\u03BF\xB0)\u30CE",data:"(\u30CE\xB0\u03BF\xB0)\u30CE"},{icon:"(\xB4\u0B87\u76BF\u0B87\uFF40)",data:"(\xB4\u0B87\u76BF\u0B87\uFF40)"},{icon:"\u2307\u25CF\uFE4F\u25CF\u2307",data:"\u2307\u25CF\uFE4F\u25CF\u2307"},{icon:"(\u0E05\xB4\u03C9`\u0E05)",data:"(\u0E05\xB4\u03C9`\u0E05)"},{icon:"(\u256F\xB0A\xB0)\u256F\uFE35\u25CB\u25CB\u25CB",data:"(\u256F\xB0A\xB0)\u256F\uFE35\u25CB\u25CB\u25CB"},{icon:"\u03C6(\uFFE3\u2207\uFFE3o)",data:"\u03C6(\uFFE3\u2207\uFFE3o)"},{icon:'\u30FE(\xB4\uFF65 \uFF65\uFF40\uFF61)\u30CE"',data:'\u30FE(\xB4\uFF65 \uFF65\uFF40\uFF61)\u30CE"'},{icon:"( \u0E07 \u1D52\u030C\u76BF\u1D52\u030C)\u0E07\u207C\xB3\u208C\u2083",data:"( \u0E07 \u1D52\u030C\u76BF\u1D52\u030C)\u0E07\u207C\xB3\u208C\u2083"},{icon:"(\xF3\uFE4F\xF2\uFF61)",data:"(\xF3\uFE4F\xF2\uFF61)"},{icon:"\u03A3(\u3063 \xB0\u0414 \xB0;)\u3063",data:"\u03A3(\u3063 \xB0\u0414 \xB0;)\u3063"},{icon:'( ,,\xB4\uFF65\u03C9\uFF65)\uFF89"(\xB4\u3063\u03C9\uFF65\uFF40\uFF61)',data:'( ,,\xB4\uFF65\u03C9\uFF65)\uFF89"(\xB4\u3063\u03C9\uFF65\uFF40\uFF61)'},{icon:"\u256E(\u256F\u25BD\u2570)\u256D ",data:"\u256E(\u256F\u25BD\u2570)\u256D "},{icon:"o(*////\u25BD////*)q ",data:"o(*////\u25BD////*)q "},{icon:"\uFF1E\uFE4F\uFF1C",data:"\uFF1E\uFE4F\uFF1C"},{icon:'( \u0E51\xB4\u2022\u03C9\u2022) "(\u3186\u1D17\u3186)',data:'( \u0E51\xB4\u2022\u03C9\u2022) "(\u3186\u1D17\u3186)'},{icon:"(\uFF61\u2022\u02C7\u2038\u02C7\u2022\uFF61)",data:"(\uFF61\u2022\u02C7\u2038\u02C7\u2022\uFF61)"}]};var Ae=!1;async function Sa(s){let{request:t,env:a,waitUntil:e}=s,n=new URL(t.url),o=n.pathname;try{Ae||(await _e(),Ae=!0);let i=await Gt(a);if(!await i.isInstalled()&&!o.startsWith("/install")&&!o.startsWith("/usr/"))return Response.redirect(new URL("/install",n).href,302);if(o.startsWith("/install"))return await ae({db:i,request:t,url:n,path:o})||new Response("Not Found",{status:404});let l=await i.getOptions(),c={title:l.title||"\u6211\u7684\u535A\u5BA2",description:l.description||"",keywords:l.keywords||"",pageSize:l.pageSize||M.PAGE_SIZE,commentStatus:l.commentStatus||"approved",theme:l.theme||M.DEFAULT_THEME,themeAssetsBase:"/usr/themes/joe",joe:{...st,...l["theme:joe"]||{}}},w=await dt(i,t),d=w?.user||null,g=(await i.listContents({type:"page",pageSize:50})).items.map(B=>({cid:B.cid,title:B.title,slug:B.slug,permalink:`/${B.slug}/`})),y={db:i,request:t,url:n,path:o,env:a,options:c,user:d,pages:g,siteUrl:`${n.protocol}//${n.host}`,pageSize:c.pageSize,csrfToken:w?.token?w.token.slice(0,16):""};Rt(Ee),Dt(y);let x=await et("route",null,y);if(x instanceof Response)return x;let A=o.match(/^\/action\/([a-zA-Z0-9_-]+)\/?$/);if(A)return ye(A[1])?await be(A[1],y):new Response("Action Not Found",{status:404});if(o==="/admin"||o.startsWith("/admin/"))return await ue(y);let j=await $e(y),O=await et("response",j,y);return O instanceof Response?O:j}catch(i){return console.error("[TypechoEdge]",i),new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>\u670D\u52A1\u5F02\u5E38</title></head>
       <body style="font-family:sans-serif;padding:40px;color:#333">
       <h2>500 \u670D\u52A1\u5F02\u5E38</h2>
       <pre style="background:#f6f8fa;padding:16px;border-radius:8px;white-space:pre-wrap">${String(i?.message||i)}</pre>
       <p>\u5982\u679C\u63D0\u793A\u672A\u627E\u5230 KV \u7ED1\u5B9A\uFF0C\u8BF7\u5728 EdgeOne \u63A7\u5236\u53F0\u5C06 KV \u547D\u540D\u7A7A\u95F4\u4EE5\u53D8\u91CF\u540D <code>BLOG_KV</code> \u7ED1\u5B9A\u5230\u672C\u9879\u76EE\u540E\u91CD\u8BD5\u3002</p>
       </body></html>`,{status:500,headers:{"Content-Type":"text/html; charset=utf-8"}})}}export{Sa as default};
