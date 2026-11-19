import React, { Suspense, lazy, startTransition, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookmarkSimple, GithubLogo, NotePencil, PaintBrush, Heart, ChatCircle, Coins, ArrowUpRight, Cloud, ArrowBendUpRight, X, Copy, Check, House, ArrowsClockwise } from '@phosphor-icons/react';
import './styles.css';
import './theme.css';   // 主题模块：令牌 + 各页面皮肤，必须在 styles.css 之后
import { useTheme } from './theme';
import ThemeToggle from './ThemeToggle';
import SplitWords from './SplitWords';
import { HandUnderline } from './PaperMarks';
import SiteEffects from './SiteEffects';
import { bump } from './counters';
import SiteNav from './SiteNav';

// 联络站按需加载：主页首屏不必下载云 SDK、二维码等代码。
const GuestContact = lazy(() => import('./GuestContact'));
const MusicPlayer = lazy(() => import('./MusicPlayer'));
const CommandPalette = lazy(() => import('./CommandPalette'));
const StationEntry = lazy(() => import('./StationEntry'));
const UsesPage = lazy(() => import('./UsesPage'));
const ArchivePage = lazy(() => import('./ArchivePage'));
const StatsPage = lazy(() => import('./StatsPage'));
const InfoPage = lazy(() => import('./InfoPage'));

// 示例只用于管理页预览；公开链接来自 public/links.json。
const sampleLinks = [
  { name: 'Vercel Projects', detail: 'Little ideas, brought to life.', icon: BookmarkSimple, color: 'sand', url: null },
  { name: 'GitHub', detail: 'Code, experiments & curiosities.', icon: GithubLogo, color: 'blue', url: null },
  { name: 'Writing', detail: 'Thoughts worth keeping.', icon: NotePencil, color: 'pink', url: null },
  { name: 'Illustration', detail: 'A little world in lines & color.', icon: PaintBrush, color: 'blue', url: null },
  { name: 'Social', detail: 'Small moments, shared.', icon: Heart, color: 'pink', url: null },
  { name: 'Contact', detail: 'A good conversation starts here.', icon: ChatCircle, color: 'sand', url: null },
];
// 五个独立页面：都是真地址，都能分享和后退
const PAGE_ROUTE = {
  '#/about': { Page: InfoPage, name: 'About' },
  '#/uses': { Page: UsesPage, name: 'Uses' },
  '#/archive': { Page: ArchivePage, name: 'Archive' },
  '#/stats': { Page: StatsPage, name: 'Stats' },
  '#/rss': { Page: InfoPage, name: 'RSS' },
};
const pages = {
  About: ['A little about this place', 'Linda is a small home for the things I make, write, and love. A place to keep everything connected.', 'This is a design preview. Personal details and destinations are ready for you to make your own.'],
  Uses: ['The everyday toolkit', 'Built with React and Tailwind CSS. Icons by Phosphor, with an original illustrated portrait.', 'A quiet space for projects, notes, sketches, and whatever comes next.'],
  Archive: ['Everything, in order', '写过的文章和这座站的改动，按月份排成一条线。', '完整年表在 #/archive。'],
  Stats: ['Some numbers', '访问、内容量，以及你在这台设备上留下的痕迹。', '一些数字在 #/stats。'],
  RSS: ['Keep in touch, quietly', '新写的文章先发在 gblog，首页「All Links」那张卡里的目录就是从它的 RSS 取的。', '订阅地址：https://gblog.kuilab.cn/index.xml 。只想翻文章，直接开 https://gblog.kuilab.cn/ 就好。'],
};
// 模块级缓存：同一次会话里离开首页再回来，直接用上一次的响应渲染，
// 不再经历「空列表 → 卡片铺开」那一下 —— 那正是页面高度抽搐的来源。
// 首次访问仍然会拉，这里只负责「回来时不闪」。
let linksCache = null;
let nowCache = null;
const blogCache = new Map();
const STORAGE_KEY = 'personal-hub-links-v1';
const PAGE_SIZE = 6;
// links.json 里可以用 "icon": "note" 之类的短名挑图标，写不认识的就退回书签
const CARD_ICONS = { note: NotePencil, github: GithubLogo, heart: Heart, chat: ChatCircle, brush: PaintBrush, coin: Coins };
function parseLinks(data) {
  if (!Array.isArray(data)) throw Error('链接数据格式错误');
  return data.map((link, index) => {
    if (!link || typeof link.name !== 'string' || !link.name.trim() || typeof link.url !== 'string') throw Error('链接数据格式错误');
    const url = new URL(link.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('链接网址格式错误');
    return { id: typeof link.id === 'string' ? link.id : `published-${index}`, name: link.name, url: url.href, detail: typeof link.detail === 'string' ? link.detail : '', color: ['sand', 'pink', 'blue'].includes(link.color) ? link.color : 'sand', icon: CARD_ICONS[link.icon] ?? BookmarkSimple, feed: link.feed === true };
  });
}
function readDraft() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data === null ? null : parseLinks(JSON.parse(data));
  } catch { return null; }
}
function serializeLinks(links) {
  return JSON.stringify(links.map(({ icon, ...link }) => link), null, 2);
}
import PetCat2D from './PetCat2D';

// 小猫说的每句话都从当下情境里挑：几点、摸了几次、在放什么歌。
// 不是随机句子库 —— 同一句话半夜和下午听到，感觉完全不同。
const LINES = {
  late: ['这个点还醒着？陪你把这首听完。', '夜里安静，适合慢慢翻两页。', '睡不着的话，我也不睡。'],
  dawn: ['早。今天也别太赶。', '早上光最好看，先坐一会儿。', '先喝一杯水再开工。'],
  noon: ['中午了，别空着肚子敲键盘。', '这个点最容易困，我趴一下。', '吃饭的时候别看屏幕。'],
  afternoon: ['下午三点，人最钝的时候。', '歇五分钟吧，看看窗外。', '要不要起来走两步。'],
  evening: ['天黑了，灯开小一点。', '今天收个尾，剩下的明天再说。', '晚饭吃了什么？'],
  music: ['这首我也在听。', '音量再大一点？', '换个安静点的？'],
  touched: ['呼噜呼噜，喜欢你。', '摸摸收到啦。', '陪你翻一页。'],
};

function PetCat() {
  const [speech, setSpeech] = useState(null);   // { text, silent }
  const [signal, setSignal] = useState(0);
  const timer = useRef(null);
  const count = useRef(0);
  const lastLine = useRef('');

  useEffect(() => () => clearTimeout(timer.current), []);

  function poolFor(n) {
    const hour = new Date().getHours();
    const playing = document.documentElement.dataset.playing === '1';
    const title = document.documentElement.dataset.track || '';
    if (n && n % 50 === 0) return ['五十次了。你是不是有点闲。'];
    if (n && n % 25 === 0) return ['二十五次，我记住你了。', '再摸要收小鱼干了。'];
    if (n === 10) return ['第十次了，你手真勤。'];
    // 正在放歌时，三分之一的概率把话题拐到音乐上；歌名太长就只说一句泛的
    if (playing && title && title.length <= 9 && Math.random() < 0.5) return [`在听《${title}》。`, '这首我也在听。'];
    if (playing && Math.random() < 0.3) return LINES.music;
    if (hour < 5) return LINES.late;
    if (hour < 11) return LINES.dawn;
    if (hour < 14) return LINES.noon;
    if (hour < 18) return LINES.afternoon;
    if (hour < 23) return LINES.evening;
    return LINES.late;
  }

  function say(pool, hold, silent) {
    const fresh = pool.filter(line => line !== lastLine.current);
    const list = fresh.length ? fresh : pool;
    const text = list[Math.floor(Math.random() * list.length)];
    lastLine.current = text;
    setSpeech({ text, silent: Boolean(silent) });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSpeech(null), hold);
  }

  function pet() {
    const n = count.current + 1;
    count.current = n;
    bump('pets');   // 只记在这台设备上
    setSignal(n);
    say(n % 5 === 0 ? LINES.touched : poolFor(n), n % 5 === 0 ? 2600 : 3800, false);
  }

  // 一个人待久了它会自己嘀咕一句：整页安静 55~85 秒才开口，一次会话最多两句。
  // 这种自言自语不进屏幕阅读器（role 只在真的被摸时才挂上）。
  useEffect(() => {
    let idle = 0;
    let used = 0;
    const arm = () => {
      clearTimeout(idle);
      if (used >= 2) return;
      idle = window.setTimeout(() => {
        if (document.hidden) return;
        used += 1;
        say(poolFor(0), 4800, true);
        arm();
      }, 55000 + Math.random() * 30000);
    };
    const wake = () => arm();
    arm();
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  return <div className="cat-companion is-2d">
    <span
      className={`cat-speech ${speech ? 'visible' : ''}`}
      role={speech && !speech.silent ? 'status' : undefined}
      aria-hidden={speech?.silent ? 'true' : undefined}
    >{speech?.text || ''}</span>
    <PetCat2D onPet={pet} petSignal={signal} />
  </div>;
}
// 顶部状态条：本地时间 + 主题开关，给页面一点“产品”的呼吸
function StatusRail({ theme, onToggleTheme }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 20000);
    return () => window.clearInterval(id);
  }, []);
  const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <div className="rail">
      <span className="rail-l"><i className="rail-dot" />OPEN TO COLLABORATION</span>
      <SiteNav className="rail-nav" />
      <span className="rail-r">
        <span className="rail-time">UTC+8 <b>{t}</b></span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </span>
    </div>
  );
}

// 跟随指针的两层光：
//   1) 页面上很大一团暖光（.spot）
//   2) 卡片表面一小块高光（写 --sx/--sy 给 .paper-shell），像玻璃反光跟着手走
// 只在有精确指针的设备上跑；rAF 节流，滚动/改尺寸时才重新量一次卡片位置。
function Spotlight() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return undefined;
    let raf = 0;
    let mx = 0;
    let my = 0;
    let shell = document.querySelector('.page .paper-shell');
    let box = shell ? shell.getBoundingClientRect() : null;
    const measure = () => {
      shell = document.querySelector('.page .paper-shell');
      box = shell ? shell.getBoundingClientRect() : null;
    };
    const move = event => {
      mx = event.clientX;
      my = event.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--mx', `${mx}px`);
        el.style.setProperty('--my', `${my}px`);
        if (shell && box) {
          const x = mx - box.left;
          const y = my - box.top;
          // 出了卡片就不动高光，免得贴边时忽然跳到角落
          if (x > -80 && y > -80 && x < box.width + 80 && y < box.height + 80) {
            shell.style.setProperty('--sx', `${x}px`);
            shell.style.setProperty('--sy', `${y}px`);
          }
          // 边缘光：离哪条边近就点亮哪一段，最远 160px 内渐隐到 0
          const near = Math.min(x, y, box.width - x, box.height - y);
          const inside = near > -1 && near < 160;
          shell.style.setProperty('--edge-glow', inside ? (1 - Math.max(near, 0) / 160).toFixed(3) : '0');
        }
      });
    };
    const leave = () => { shell?.style.setProperty('--edge-glow', '0'); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerleave', leave, { passive: true });
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerleave', leave);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return <div className="spot" ref={ref} aria-hidden="true" />;
}

function App({ managing }) {
  const { theme, toggle: toggleTheme } = useTheme();
  const dialog = useRef(null);
  const editor = useRef(null);
  const [publishedLinks, setPublishedLinks] = useState(() => linksCache ?? []);
  const [draft, setDraft] = useState(null);
  const [loadState, setLoadState] = useState(() => (linksCache ? 'ready' : 'loading'));
  useEffect(() => {
    setDraft(managing ? readDraft() : null);
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}links.json`, { signal: controller.signal });
        if (!response.ok) throw Error('无法读取公开链接');
        const published = parseLinks(await response.json());
        if (controller.signal.aborted) return;
        linksCache = published;
        setPublishedLinks(published);
        setLoadState('ready');
      } catch {
        if (controller.signal.aborted) return;
        // 手里有旧数据就继续用，别把已经铺好的页面打回错误态
        setLoadState(linksCache ? 'ready' : 'error');
      }
    }
    load();
    return () => controller.abort();
  }, [managing]);
  const savedLinks = managing ? (draft ?? publishedLinks) : publishedLinks;
  const [page, setPage] = useState(1);
  const [showSamples, setShowSamples] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  // 搜索即预览：⌘K 里敲字时，命中的卡片亮起来、其余淡下去
  const [search, setSearch] = useState('');
  // 键盘流：j/k 或 ↑↓ 选卡片，Enter 打开；一次只翻一张便签的背面
  const [keyIndex, setKeyIndex] = useState(-1);
  const [flipped, setFlipped] = useState(null);
  // 面板挪到 Router 外层之后，它不再直接拿到 setSearch；
  // 改为监听 hub:search —— 面板一个实例，首页/子页都能用。
  useEffect(() => {
    const onPaletteSearch = event => setSearch(String(event.detail || '').trim().toLowerCase());
    window.addEventListener('hub:search', onPaletteSearch);
    return () => window.removeEventListener('hub:search', onPaletteSearch);
  }, []);

  const links = showSamples ? sampleLinks : savedLinks;
  const pageCount = Math.max(1, Math.ceil(links.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleLinks = links.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // 键盘流：j / k（或 ↑↓）选卡片，Enter 或 o 打开，Esc 收起。
  // 输入框里打字、⌘K 面板或弹窗打开时完全不接管 —— 否则在搜索框里打 j 就会跳卡片。
  const rowsRef = useRef(visibleLinks);
  rowsRef.current = visibleLinks;
  const keyIndexRef = useRef(-1);
  keyIndexRef.current = keyIndex;
  useEffect(() => {
    function onKey(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '') || target?.isContentEditable) return;
      if (document.querySelector('dialog[open], .palette-scrim')) return;
      const rows = rowsRef.current;
      if (!rows.length) return;
      const key = event.key;
      if (key === 'j' || key === 'ArrowDown') {
        event.preventDefault();
        setKeyIndex(current => (current >= rows.length - 1 ? 0 : current + 1));
      } else if (key === 'k' || key === 'ArrowUp') {
        event.preventDefault();
        setKeyIndex(current => (current <= 0 ? rows.length - 1 : current - 1));
      } else if (key === 'Escape') {
        if (keyIndexRef.current >= 0) { setKeyIndex(-1); setFlipped(null); }
      } else if ((key === 'Enter' || key === 'o') && keyIndexRef.current >= 0) {
        const link = rows[keyIndexRef.current];
        if (!link) return;
        event.preventDefault();
        if (link.url) window.open(link.url, '_blank', 'noreferrer');
        else open(link.name);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 换页或一敲搜索词，键盘游标就归零，免得停在一个已经看不见的卡片上
  useEffect(() => { setKeyIndex(-1); }, [currentPage, search]);
  function persist(next) {
    try { localStorage.setItem(STORAGE_KEY, serializeLinks(next)); setDraft(next); setFormError(''); return true; }
    catch { setFormError('浏览器无法保存。请检查存储权限或可用空间。'); return false; }
  }
  function addLink(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = fields.get('name').trim();
    let url;
    try { url = new URL(fields.get('url').trim()); if (!['https:', 'http:'].includes(url.protocol)) throw Error(); }
    catch { setFormError('请输入完整的 http:// 或 https:// 网址。'); return; }
    if (!name) { setFormError('请填写链接名称。'); return; }
    const next = [...savedLinks, { id: crypto.randomUUID(), name, url: url.href, detail: fields.get('detail').trim(), color: fields.get('color'), icon: BookmarkSimple }];
    if (persist(next)) { setShowSamples(false); setPage(Math.ceil(next.length / PAGE_SIZE)); editor.current.close(); event.currentTarget.reset(); setNotice('链接已添加，并保存在当前浏览器。'); }
  }
  function removeLink(id) {
    if (persist(savedLinks.filter(x => x.id !== id))) setNotice('已从浏览器草稿移除，公开页未改变。');
  }
  function moveLink(id, direction) {
    const list = [...savedLinks];
    const from = list.findIndex(x => x.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    if (persist(list)) setNotice('顺序已调整。导出 links.json 并重新部署后，公开页才会同步。');
  }
  function exportLinks() {
    const url = URL.createObjectURL(new Blob([`${serializeLinks(savedLinks)}\n`], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'links.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('已导出 links.json。替换项目 public/links.json 并重新部署后，所有访客才会看到更新。');
  }
  const [portraitReady, setPortraitReady] = useState(false);
  // 左栏「现在」与右栏「最近」来自 public/now.json：改内容不用重新构建
  const [now, setNow] = useState(() => nowCache);
  // 第一次取回之前先用等高占位顶住：Now 和「最近」一出现，纸会突然长高 57px
  const [nowLoaded, setNowLoaded] = useState(() => Boolean(nowCache));
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}now.json`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data) { nowCache = data; setNow(data); } })
      .catch(() => { /* 读不到就沿用缓存，没有缓存就不显示这两块 */ })
      .finally(() => { if (!controller.signal.aborted) setNowLoaded(true); });
    return () => controller.abort();
  }, []);
  const [content, setContent] = useState(null);
  const [copied, setCopied] = useState(false);
  // 带 feed 标记的那条链接（现在是 gblog）会把博客最近几篇直接排进卡片。
  // 数据走 /api/blog：服务端抓 RSS + CDN 缓存，浏览器不用扛 1.3MB 的 XML，也不跨域。
  const feedUrl = publishedLinks.find(link => link.feed)?.url;
  // 目录也缓存：返回首页时直接是「最新 03 篇」，不会先闪三行骨架再变实
  const [blog, setBlog] = useState(() => (feedUrl ? blogCache.get(feedUrl) || null : null));
  const [feedState, setFeedState] = useState(() => (feedUrl && blogCache.has(feedUrl) ? 'ready' : 'idle'));
  useEffect(() => {
    if (!feedUrl) return undefined;
    const cached = blogCache.get(feedUrl);
    if (cached) { setBlog(cached); setFeedState('ready'); }
    const controller = new AbortController();
    if (!cached) setFeedState('loading');
    fetch('/api/blog', { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (controller.signal.aborted) return;
        if (data?.posts?.length) { blogCache.set(feedUrl, data); setBlog(data); setFeedState('ready'); }
        else if (!cached) setFeedState('failed');
      })
      .catch(() => { if (!controller.signal.aborted && !cached) setFeedState('failed'); });
    return () => controller.abort();
  }, [feedUrl]);
  function open(name) {
    setCopied(false);
    setContent(pages[name] ? { title: name, paragraphs: pages[name] } : { title: name, paragraphs: [name === 'Contact' ? 'Say hello' : 'Your corner of the internet', name === 'Contact' ? 'Add your email address or preferred contact page to connect this card.' : `This ${name} card is ready for your personal link.`, 'Destinations are not connected in this design preview. Update the links array in src/main.jsx with your own URLs.'] });
    dialog.current.showModal();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); }
    catch { setCopied(false); }
  }
  return <div className="page min-h-dvh flex flex-col items-center justify-center px-6 sm:px-10">
    <Spotlight />
    <a href="#links" className="skip-link" onClick={event => { event.preventDefault(); document.getElementById('links').focus(); }}>Skip to links</a>
    <StatusRail theme={theme} onToggleTheme={toggleTheme} />
    <div className="composition relative w-full">
      <div className="decoration cloud" aria-hidden="true"><Cloud size={43} weight="thin" /></div>
      <div className="decoration top-heart" aria-hidden="true"><Heart size={25} weight="duotone" /></div>
      <div className="decoration top-arrow" aria-hidden="true"><ArrowBendUpRight size={65} weight="thin" /></div>
      {managing && <div className="management-banner"><strong>链接管理 · 浏览器草稿</strong><a href="#/">退出管理，返回公开页 <ArrowUpRight size={16} aria-hidden="true" /></a></div>}
      <main className="paper-shell grid" aria-label={managing ? 'Linda 链接管理' : 'Linda'}>
        {/* 边缘光（移植自 react-bits BorderGlow）：只在指针靠近卡片边缘时亮起那一段边 */}
        <span className="shell-edge" aria-hidden="true" />
        <aside className="profile flex flex-col items-center text-center">
          <div className={`portrait-wrap relative ${portraitReady ? 'is-loaded' : ''}`}><img className="portrait rounded-full object-cover" src={`${import.meta.env.BASE_URL}images/portrait.webp`} alt="An anime-style portrait of a young man holding a telephone" decoding="async" fetchPriority="high" width="160" height="160" draggable={false} onLoad={() => setPortraitReady(true)} onError={() => setPortraitReady(true)} /><span className="portrait-spark spark-one" aria-hidden="true">✧</span><span className="portrait-spark spark-two" aria-hidden="true">✧</span></div>
          <h1 className="site-title"><SplitWords text="Linda" base={240} step={80} /></h1>
          <p className="profile-tagline">Everything I do,<br className="mobile-break" /> linked here.</p>
          {!now && !nowLoaded && <dl className="now now-skeleton" aria-hidden="true">
            <div className="now-head"><dt>Now</dt><dd><span className="ghost-bar" style={{ width: 42 }} /></dd></div>
            {[0, 1, 2].map(i => <div className="now-row" key={i}>
              <dt><span className="ghost-bar" style={{ width: 18 }} /></dt>
              <dd><span className="ghost-bar" style={{ width: `${64 - i * 12}%` }} /></dd>
            </div>)}
          </dl>}
          {now && <dl className="now">
            <div className="now-head"><dt>Now</dt><dd>{now.updated}</dd></div>
            {now.status && <div className="now-row"><dt>状态</dt><dd>{now.status}</dd></div>}
            {now.doing && <div className="now-row"><dt>在做</dt><dd>{now.doing}</dd></div>}
            {now.reading && <div className="now-row"><dt>在读</dt><dd>{now.reading}</dd></div>}
          </dl>}
          <Suspense fallback={<a className="station-entry" href="/hub#/chat" aria-label="进入站内联络站"><ChatCircle size={18} weight="light" aria-hidden="true" /><span className="station-entry-text"><span className="station-entry-line">联络站</span></span><ArrowUpRight size={15} aria-hidden="true" /></a>}><StationEntry /></Suspense>
        </aside>
        <section id="links" tabIndex={-1} className="links-panel" aria-labelledby="links-title">
          {/* 页头两行：上面一排「编号 + 说明」各占一端，下面才是标题。
              原来那句说明孤零零吊在标题右边 450px 外，看着像没对齐。 */}
          <header className="panel-head">
            <div className="head-top">
              <span className="head-kicker">02 — Index</span>
              <span className="head-note">a few places to find me</span>
            </div>
            <h2 id="links-title"><SplitWords text="All Links" accent="." base={320} step={80} /><HandUnderline /></h2>
          </header>
          {managing && <><p className="management-help">公开页只展示已部署的 links.json。这里的修改仅保存为当前浏览器草稿；导出后替换 public/links.json 并重新部署才能公开。此入口仅做界面隔离，不是身份认证。</p><div className="link-toolbar"><button className="small-control" disabled={loadState !== 'ready'} onClick={() => { setFormError(''); editor.current.showModal(); }}>＋ 添加链接</button><button className="small-control" disabled={loadState !== 'ready'} onClick={exportLinks}>导出 links.json</button><button className="sample-toggle" disabled={loadState !== 'ready'} onClick={() => { setShowSamples(!showSamples); setPage(1); }}>{showSamples ? '返回链接草稿' : '查看示例样式'}</button></div>{draft !== null && <p className="preview-note">正在预览此浏览器的草稿，公开页不受影响。</p>}{formError && <p className="form-error" role="alert">{formError}</p>}</>}
          {showSamples && <p className="preview-note">示例预览，不会保存到你的链接中。</p>}
          <div className={`link-wall grid ${search ? 'has-search' : ''}`} aria-busy={loadState === 'loading'}>
            {/* 还在取链接时先占住一行卡片的高度：不占的话，数据一到卡片撑开，
                整张纸会往上顶 57px（页面是垂直居中的），看着就是"抽一下" */}
            {loadState === 'loading' && !links.length && [0, 1, 2].map(i => (
              <div className="note-wrap is-ghost" key={`ghost-${i}`} aria-hidden="true">
                <div className="link-note ghost-note">
                  <span className="ghost-bar" style={{ width: '26%' }} />
                  <span className="ghost-bar" style={{ width: '72%' }} />
                  <span className="ghost-bar" style={{ width: '54%' }} />
                </div>
              </div>
            ))}
            {visibleLinks.map(({ id, name, detail, icon: Icon, color, url, feed }, index) => {
              const children = <><div className="card-top flex items-center justify-between"><Icon className={`card-icon ${color}`} size={25} weight="light" /><ArrowUpRight className="visit-arrow" size={17} weight="light" /></div><h3><span className="ink-name">{name}</span></h3><p>{detail}</p><span className={`marker ${color}`} aria-hidden="true" /></>;
              const at = savedLinks.findIndex(x => x.id === id);
              // 有订阅源的那张：横跨整行，左边身份、右边最近三篇。
              // 还没取回目录时先把三行骨架占住 —— 否则卡片会从「一张小卡」突然长成整行，页面跳一下。
              if (feed && url) {
                const posts = blog ? blog.posts.slice(0, 3) : [];
                const hot = search && `${name} ${detail || ''} ${url}`.toLowerCase().includes(search);
                return <div className={`note-wrap is-feature ${hot ? 'is-hit' : ''} ${keyIndex === index ? 'is-key' : ''}`} key={id || name}>
                  <article className="link-note feature-note" data-feed={feedState}>
                    <a className="feature-side" href={url} target="_blank" rel="noreferrer">
                      <span className="card-top flex items-center justify-between"><Icon className={`card-icon ${color}`} size={22} weight="light" /><ArrowUpRight className="visit-arrow" size={16} weight="light" /></span>
                      <h3><span className="ink-name">{name}</span></h3>
                      <p>{detail}</p>
                      <span className={`marker ${color}`} aria-hidden="true" />
                    </a>
                    <div className="feature-feed">
                      <div className="feed-head">
                        <span>{blog ? `最新 ${String(posts.length).padStart(2, '0')} 篇` : feedState === 'failed' ? '目录没取到' : '正在取回目录'}</span>
                        <a href={url} target="_blank" rel="noreferrer">{blog ? `全部 ${String(blog.total).padStart(2, '0')} 篇` : '去博客'} <ArrowUpRight size={12} weight="light" /></a>
                      </div>
                      {posts.length ? <ol className="feed-list">
                        {posts.map(post => <li key={post.url}>
                          <a href={post.url} target="_blank" rel="noreferrer">
                            <span className="feed-date">{post.date ? post.date.slice(5).replace('-', '.') : '··'}</span>
                            <span className="feed-title">{post.title}</span>
                            <ArrowUpRight className="feed-arrow" size={13} weight="light" />
                          </a>
                        </li>)}
                      </ol> : feedState === 'failed'
                        ? <p className="feed-empty">这篇目录暂时没取到，直接去博客翻翻。</p>
                        : <ol className="feed-list" aria-hidden="true">
                          {[74, 58, 66].map(width => <li className="feed-skeleton" key={width}>
                            <span className="skeleton-bar skeleton-date" />
                            <span className="skeleton-bar skeleton-title" style={{ width: `${width}%` }} />
                          </li>)}
                        </ol>}
                    </div>
                  </article>
                  {managing && !showSamples && <button className="remove-link" aria-label={`移除 ${name}`} onClick={() => removeLink(id)}><X size={13} /></button>}
                </div>;
              }
              const hot = search && `${name} ${detail || ''} ${url}`.toLowerCase().includes(search);
              // 背面：域名 + 一句更长的说明。没有 url 的卡片（示例/占位）不翻面。
              const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
              const isFlipped = flipped === id;
              const painted = <div className="note-inner">
                <div className="note-front">{children}</div>
                {url && <div className="note-back" aria-hidden="true">
                  <span className="nb-host">{host}</span>
                  <span className="nb-text">{detail || '这张便签没留下说明。'}</span>
                  <span className="nb-open">打开 <ArrowUpRight size={13} weight="light" /></span>
                </div>}
              </div>;
              return <div className={`note-wrap ${hot ? 'is-hit' : ''} ${keyIndex === index ? 'is-key' : ''}`} key={id || name}>{url
                ? <a className={`link-note note-${index + 1} ${isFlipped ? 'is-flipped' : ''}`} href={url} target="_blank" rel="noreferrer">{painted}</a>
                : <button className={`link-note note-${index + 1}`} onClick={() => open(name)}>{children}</button>}
                {url && !managing && <button type="button" className="note-fold" aria-pressed={isFlipped}
                  aria-label={isFlipped ? `把「${name}」翻回正面` : `翻到「${name}」背面`}
                  title="翻面"
                  onClick={() => setFlipped(current => (current === id ? null : id))}>
                  <ArrowsClockwise size={12} weight="light" aria-hidden="true" />
                </button>}
                {managing && !showSamples && <>
                <button className="remove-link" aria-label={`移除 ${name}`} onClick={() => removeLink(id)}><X size={13} /></button>
                {savedLinks.length > 1 && <div className="move-links">
                  <button className="move-link" aria-label={`上移 ${name}`} disabled={at <= 0} onClick={() => moveLink(id, -1)}>↑</button>
                  <button className="move-link" aria-label={`下移 ${name}`} disabled={at >= savedLinks.length - 1} onClick={() => moveLink(id, 1)}>↓</button>
                </div>}
              </>}</div>;
            })}
          </div>
          {/* 右栏只有三种"没有卡片"的状态：读取中 / 读取失败 / 确实还没有。
              三种都走同一张索引页，避免首屏几秒里只剩一行小字。 */}
          {(loadState === 'error' || (loadState === 'ready' && !links.length)) && <div
            className={`empty-links ${managing ? 'is-managing' : ''} ${now?.updates?.length ? 'is-compact' : ''}`}
            data-state={loadState === 'ready' ? 'empty' : loadState}
            role={loadState === 'ready' ? undefined : 'status'}
          >
            <div className="empty-head">
              <span className="empty-label">{loadState === 'ready' ? 'Index' : loadState === 'loading' ? 'Loading' : 'Offline'}</span>
              <span className="empty-value">{loadState === 'ready' ? '00' : '··'}</span>
            </div>
            <div className="empty-body">
              <span className="empty-mark" aria-hidden="true"><BookmarkSimple size={17} weight="thin" /></span>
              <h3>{loadState !== 'ready'
                ? (loadState === 'loading' ? '正在取回链接' : '链接没有读到')
                : (managing ? '从第一个链接开始' : '还没有公开的链接')}</h3>
              <p>{loadState !== 'ready'
                ? (loadState === 'loading' ? '稍等一下，列表马上到。' : '刷新页面重试，或稍后再来。')
                : (managing ? '添加链接到草稿，导出后发布。' : '作品、文章和喜欢的地方，会陆续放在这里。')}</p>
              {managing && loadState === 'ready' && <button className="small-control" onClick={() => { setFormError(''); editor.current.showModal(); }}>添加第一个链接</button>}
            </div>
            <div className="empty-foot" aria-hidden="true">
              <span>{loadState !== 'ready' ? (loadState === 'loading' ? 'Fetching' : 'Retry') : (managing ? 'Draft' : 'Soon')}</span>
              <i className="empty-rule" />
              <span>{loadState === 'loading' ? 'Reading index' : loadState === 'error' ? 'Unavailable' : 'This space is reserved'}</span>
            </div>
          </div>}

          {!nowLoaded && <ol className="recent recent-skeleton" aria-hidden="true">
            <li className="recent-head"><span>最近</span><span><span className="ghost-bar" style={{ width: 26 }} /></span></li>
            {[0, 1, 2].map(i => <li className="recent-item" key={i}>
              <span className="recent-date"><span className="ghost-bar" style={{ width: 26 }} /></span>
              <span className="recent-text"><span className="ghost-bar" style={{ width: `${72 - i * 14}%` }} /></span>
            </li>)}
          </ol>}
          {now?.updates?.length ? <ol className="recent">
            <li className="recent-head"><span>最近</span><span>{String(now.updates.length).padStart(2, '0')} 条</span></li>
            {now.updates.slice(0, 3).map(item => <li className="recent-item" key={`${item.date}-${item.text}`}>
              <span className="recent-date">{String(item.date || '').slice(5)}</span>
              <span className="recent-text">{item.text}</span>
              {item.tag && <span className="recent-tag">{item.tag}</span>}
            </li>)}
          </ol> : null}
          {pageCount > 1 && <nav className="pagination" aria-label="链接分页"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="上一页">←</button><span aria-live="polite">{currentPage} / {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} aria-label="下一页">→</button></nav>}
          <p className="link-notice" role="status">{notice}</p>
          {/* 底部这一条用 margin-top:auto 沉到底：右栏比左栏矮 51px 的缺口就是这么补上的 */}
          <div className="panel-foot">
            <p className="panel-signoff">{!showSamples && savedLinks.length ? `${savedLinks.length} links, collected with care.` : 'A collection of things, always growing.'}<Heart size={13} weight="light" aria-hidden="true" /></p>
            <div className="meta-grid" aria-hidden="true">
              <div className="meta-cell"><span>Links</span><b>{links.length ? String(links.length).padStart(2, '0') : '—'}</b></div>
              <div className="meta-cell"><span>Status</span><b>Open</b></div>
            </div>
          </div>
        </section>
      </main>
      <div className="decoration bottom-hearts" aria-hidden="true"><Heart size={28} weight="duotone" /><Heart size={21} weight="duotone" /></div>
      <PetCat />
      <Suspense fallback={null}><MusicPlayer /></Suspense>
      <footer className="footer flex flex-col items-center"><p>A small home on the internet.</p></footer>
    </div>
    {managing && <dialog ref={editor} className="detail-dialog editor-dialog" aria-labelledby="editor-title"><form className="dialog-inner" onSubmit={addLink}><div className="flex justify-between items-start gap-6"><h2 id="editor-title">添加一张便签</h2><button type="button" className="close-button" onClick={() => editor.current.close()} aria-label="关闭添加链接"><X size={20} /></button></div><p>每页放六张。保存到当前浏览器草稿，导出并重新部署后才会显示在公开页。</p><label htmlFor="link-name">名称</label><input id="link-name" name="name" required maxLength={50} autoFocus placeholder="例如：我的作品集" /><label htmlFor="link-url">网址</label><input id="link-url" name="url" type="url" required placeholder="https://example.com" aria-describedby="form-error" /><label htmlFor="link-detail">一句介绍（选填）</label><input id="link-detail" name="detail" maxLength={100} placeholder="记录这个链接的小注释" /><label htmlFor="link-color">便签标记</label><select id="link-color" name="color"><option value="sand">浅米色</option><option value="pink">浅粉色</option><option value="blue">浅蓝色</option></select><p id="form-error" className="form-error" role="alert">{formError}</p><button className="copy-button" type="submit">保存链接</button></form></dialog>}
    <dialog ref={dialog} className="detail-dialog" onClick={e => { if (e.target === e.currentTarget) dialog.current.close(); }}><div className="dialog-inner"><div className="flex justify-between items-start gap-6"><h2>{content?.title}</h2><button className="close-button" onClick={() => dialog.current.close()} aria-label="Close dialog"><X size={20} /></button></div><h3>{content?.paragraphs[0]}</h3>{content?.paragraphs.slice(1).map(p => <p key={p}>{p}</p>)}<button className="copy-button inline-flex items-center gap-2" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link copied' : 'Copy this page link'}</button><span className="sr-only" role="status">{copied ? 'Page link copied to clipboard' : ''}</span></div></dialog>
  </div>;
}
function NotFound() {
  return <div className="not-found">
    <div className="not-found-card">
      <span className="not-found-code" aria-hidden="true">404</span>
      <h1>这一页走丢了</h1>
      <p>可能是链接写错了，或者它已经被收进抽屉里。</p>
      <a className="not-found-home" href="/"><House size={16} weight="light" aria-hidden="true" />回到首页</a>
    </div>
  </div>;
}
// ⌘K 面板挂在 Router 外层，五张子页面也能唤出。
// 它自己取一份链接（有缓存就用缓存），不再依赖首页的 state。
function GlobalPalette() {
  const { toggle } = useTheme();
  const [links, setLinks] = useState(() => linksCache ?? []);
  useEffect(() => {
    if (linksCache) { setLinks(linksCache); return undefined; }
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}links.json`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!data || controller.signal.aborted) return;
        linksCache = parseLinks(data);
        setLinks(linksCache);
      })
      .catch(() => { /* 拿不到链接就只搜页面和动作 */ });
    return () => controller.abort();
  }, []);
  return (
    <Suspense fallback={null}>
      <CommandPalette pageNames={Object.keys(pages)} links={links} onToggleTheme={toggle} />
    </Suspense>
  );
}

function Router() {
  const [route, setRoute] = useState(() => location.hash);
  useEffect(() => {
    // 用 transition 更新：新页面的 chunk 还没到时，React 会先留着旧页面，
    // 而不是先卸掉、露出「正在打开…」再换上来 —— 那一闪就是这么来的
    const update = () => startTransition(() => setRoute(location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  // 首页稳定之后把三张内容页悄悄取回来，点导航就是瞬间的
  useEffect(() => {
    const id = window.setTimeout(() => {
      const warm = mod => import(mod).catch(() => { /* 预取失败不影响点进去时的正常加载 */ });
      warm('./UsesPage'); warm('./ArchivePage'); warm('./StatsPage'); warm('./InfoPage');
    }, 1500);
    return () => window.clearTimeout(id);
  }, []);
  // 每次会话只上报一次访问，用于作者后台看今日/近 7 天访问量；不采集 IP、UA 等个人信息。
  useEffect(() => {
    try {
      if (sessionStorage.getItem('ph-tracked')) return;
      sessionStorage.setItem('ph-tracked', '1');
    } catch { return; }
    const path = location.pathname.startsWith('/hub') || location.hash.startsWith('#/chat') ? '/hub' : '/';
    fetch('/api/station', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'track_visit', payload: { path } }),
      cache: 'no-store',
    }).catch(() => { /* 统计失败不影响页面 */ });
  }, []);
  const callback = new URLSearchParams(location.search).has('provider');
  // #/author 是给作者本人保存的低调书签：直接打开口令框，口令只由服务端校验。
  const authorEntry = route === '#/author';
  const path = location.pathname.replace(/\/+$/, '') || '/';
  // /hub/chat 这类深链也要能直接打开（历史书签、分享出去的地址），不让它掉到 404
  const isStationPath = /^\/(chat|hub)(\/.+)?$/.test(path);
  const station = isStationPath || route === '#/chat' || authorEntry || callback;

  // 关键：整站只用一个 Suspense 包住，而且放在最外层。
  // 以前每个分支各自包一层，切页时旧的那层被卸载、新的那层开始加载，
  // 中间必然露出一次 fallback（深色主题下那块还是写死的浅色底，闪得像白屏）。
  // 现在边界只有一层，加上 startTransition，React 会等新 chunk 到齐再整体替换。
  let view;
  if (!['/', '/index.html'].includes(path) && !isStationPath && !callback) {
    view = <><NotFound /><SiteEffects /></>;
  } else if (station) {
    view = <><GuestContact openAuthorLogin={authorEntry} /><SiteEffects /></>;
  } else if (PAGE_ROUTE[route]) {
    const { Page, name } = PAGE_ROUTE[route];
    view = <><Page name={name} /><SiteEffects /></>;
  } else {
    view = <><App key={route === '#/manage' ? 'manage' : 'public'} managing={route === '#/manage'} /><SiteEffects /></>;
  }

  return (
    <>
      <Suspense fallback={<div className="route-loading" role="status">正在打开…</div>}>
        {view}
      </Suspense>
      <GlobalPalette />
    </>
  );
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Router /></React.StrictMode>);

// 离线缓存：只在生产构建里注册，首屏渲染完再装，不跟首屏抢带宽。
// 开发环境不注册——否则改动会被缓存住，热更新看起来像没生效。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, { once: true });

  // 新版本接管后自动刷新一次，免得页面停在旧的 HTML/JS 上（浏览器缓存叠加 SW 时很容易）。
  // 首次安装时 controller 从无到有，也算一次 controllerchange —— 那种情况不用刷，
  // 否则每个新访客都要白刷一遍（慢网下就是多等一倍时间）。
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (sessionStorage.getItem('hub-sw-reloaded') === '1') return;
    sessionStorage.setItem('hub-sw-reloaded', '1');
    window.location.reload();
  });
}
