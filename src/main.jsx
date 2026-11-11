import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookmarkSimple, GithubLogo, NotePencil, PaintBrush, Heart, ChatCircle, ArrowUpRight, Cloud, Cat, ArrowBendUpRight, X, Copy, Check } from '@phosphor-icons/react';
import './styles.css';
import ContactStation from './ContactStation';

// Add or remove entries here. An omitted URL opens an honest, editable preview.
const sampleLinks = [
  { name: 'Vercel Projects', detail: 'Little ideas, brought to life.', icon: BookmarkSimple, color: 'sand', url: null },
  { name: 'GitHub', detail: 'Code, experiments & curiosities.', icon: GithubLogo, color: 'blue', url: null },
  { name: 'Writing', detail: 'Thoughts worth keeping.', icon: NotePencil, color: 'pink', url: null },
  { name: 'Illustration', detail: 'A little world in lines & color.', icon: PaintBrush, color: 'blue', url: null },
  { name: 'Social', detail: 'Small moments, shared.', icon: Heart, color: 'pink', url: null },
  { name: 'Contact', detail: 'A good conversation starts here.', icon: ChatCircle, color: 'sand', url: null },
];
const pages = {
  About: ['A little about this place', 'Personal Hub is a small home for the things I make, write, and love. A place to keep everything connected.', 'This is a design preview. Personal details and destinations are ready for you to make your own.'],
  Uses: ['The everyday toolkit', 'Built with React and Tailwind CSS. Icons by Phosphor, with an original illustrated portrait.', 'A quiet space for projects, notes, sketches, and whatever comes next.'],
  Colophon: ['Made with a little care', 'A paper-inspired interface, soft pastel marks, and just enough room to breathe.', 'The portrait is an original AI-assisted illustration. All decoration stays in the margins so the links can do their job.'],
  RSS: ['Keep in touch, quietly', 'An RSS feed can live here when your writing is ready.', 'No feed is connected in this preview. Add your feed URL alongside your personal links before publishing.'],
};
const STORAGE_KEY = 'personal-hub-links-v1';
const PAGE_SIZE = 6;
function readLinks() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.url === 'string' && /^https?:\/\//i.test(x.url)).map(x => ({ ...x, icon: BookmarkSimple })) : [];
  } catch { return []; }
}
function PetCat() {
  const [pets, setPets] = useState(0);
  const [awake, setAwake] = useState(false);
  const [reaction, setReaction] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  function pet(event) {
    const next = pets + 1;
    setPets(next); setAwake(true);
    setReaction(next % 5 === 0 ? '呼噜呼噜，喜欢你。' : ['喵，欢迎回来。', '今天也要好好休息。', '摸摸收到啦。', '陪你翻一页。'][(next - 1) % 4]);
    if (event.detail > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      event.currentTarget.animate([{ transform: 'rotate(6deg) translateY(0)' }, { transform: 'rotate(-5deg) translateY(-8px)' }, { transform: 'rotate(6deg) translateY(0)' }], { duration: 240 });
    }
    clearTimeout(timer.current); timer.current = setTimeout(() => { setReaction(''); setAwake(false); }, 3500);
  }
  return <div className="cat-companion"><span role="status" className={`cat-speech ${reaction ? 'visible' : ''}`}>{reaction}</span><button className="cat-sticker cat-button" onClick={pet} aria-label={`摸摸小猫，已经摸了 ${pets} 次`} title="摸摸我"><span className="cat-heart" aria-hidden="true">{awake ? '♡' : 'z z'}</span><Cat size={65} weight={awake ? 'duotone' : 'thin'} aria-hidden="true" /></button></div>;
}
function App() {
  const dialog = useRef(null);
  const editor = useRef(null);
  const [savedLinks, setSavedLinks] = useState(readLinks);
  const [page, setPage] = useState(1);
  const [showSamples, setShowSamples] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const links = showSamples ? sampleLinks : savedLinks;
  const pageCount = Math.max(1, Math.ceil(links.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleLinks = links.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  function persist(next) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.map(({ icon, ...link }) => link))); setSavedLinks(next); return true; }
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
    if (persist(savedLinks.filter(x => x.id !== id))) setNotice('链接已移除。');
  }
  const [content, setContent] = useState(null);
  const [copied, setCopied] = useState(false);
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
    <a href="#links" className="skip-link">Skip to links</a>
    <div className="composition relative w-full">
      <div className="decoration cloud" aria-hidden="true"><Cloud size={43} weight="thin" /></div>
      <div className="decoration top-heart" aria-hidden="true"><Heart size={25} weight="duotone" /></div>
      <div className="decoration top-arrow" aria-hidden="true"><ArrowBendUpRight size={65} weight="thin" /></div>
      <main className="paper-shell grid" aria-label="Personal Hub">
        <aside className="profile flex flex-col items-center text-center">
          <div className="portrait-wrap relative"><img className="portrait rounded-full object-cover" src={`${import.meta.env.BASE_URL}images/Create_one_original_delicate_a_2026-11-11T07-07-21.png`} alt="Original anime portrait of a silver-haired young woman" width="160" height="160" /><span className="portrait-spark spark-one" aria-hidden="true">✧</span><span className="portrait-spark spark-two" aria-hidden="true">✧</span></div>
          <h1>Personal Hub</h1>
          <p className="profile-tagline">Everything I do,<br className="mobile-break" /> linked here.</p>
          <div className="profile-flourish" aria-hidden="true"><ArrowBendUpRight size={47} weight="thin" /></div>
          <p className="welcome">Make yourself at home.</p>
          <a className="station-entry" href="#/chat" aria-label="进入站内联络站"><ChatCircle size={22} weight="light" aria-hidden="true" /><span><strong>联络站</strong><small>消息与文件，随手传</small></span><ArrowUpRight size={16} aria-hidden="true" /></a>
          <p className="station-caption">站内应用 · 设备间消息与文件同步</p>
        </aside>
        <section id="links" className="links-panel" aria-labelledby="links-title">
          <header className="flex items-center justify-between"><h2 id="links-title">All Links<span className="heading-period">.</span></h2><span className="tiny-note">a few places to find me</span></header>
          <div className="link-toolbar"><button className="small-control" onClick={() => { setFormError(''); editor.current.showModal(); }}>＋ 添加链接</button><button className="sample-toggle" onClick={() => { setShowSamples(!showSamples); setPage(1); }}>{showSamples ? '返回我的链接' : '查看示例样式'}</button></div>
          {showSamples && <p className="preview-note">示例预览，不会保存到你的链接中。</p>}
          <div className="link-wall grid">
            {visibleLinks.map(({ id, name, detail, icon: Icon, color, url }, index) => {
              const children = <><div className="card-top flex items-center justify-between"><Icon className={`card-icon ${color}`} size={25} weight="light" /><ArrowUpRight className="visit-arrow" size={17} weight="light" /></div><h3>{name}</h3><p>{detail}</p><span className={`marker ${color}`} aria-hidden="true" /></>;
              return <div className="note-wrap" key={id || name}>{url ? <a className={`link-note note-${index + 1}`} href={url} target="_blank" rel="noreferrer">{children}</a> : <button className={`link-note note-${index + 1}`} onClick={() => open(name)}>{children}</button>}{!showSamples && <button className="remove-link" aria-label={`移除 ${name}`} onClick={() => removeLink(id)}><X size={13} /></button>}</div>;
            })}
          </div>
          {!links.length && <div className="empty-links"><BookmarkSimple size={30} weight="thin" /><h3>从第一个链接开始。</h3><p>把作品、文章和喜欢的地方，慢慢收集在这里。</p><button className="small-control" onClick={() => { setFormError(''); editor.current.showModal(); }}>添加第一个链接</button></div>}
          {pageCount > 1 && <nav className="pagination" aria-label="链接分页"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} aria-label="上一页">←</button><span aria-live="polite">{currentPage} / {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} aria-label="下一页">→</button></nav>}
          <p className="link-notice" role="status">{notice}</p>
          <p className="panel-signoff">{!showSamples && savedLinks.length ? `${savedLinks.length} links, collected with care.` : 'A collection of things, always growing.'}<Heart size={13} weight="light" aria-hidden="true" /></p>
        </section>
      </main>
      <div className="decoration bottom-hearts" aria-hidden="true"><Heart size={28} weight="duotone" /><Heart size={21} weight="duotone" /></div>
      <PetCat />
      <footer className="footer flex flex-col items-center"><nav className="flex items-center justify-center" aria-label="Footer navigation">{Object.keys(pages).map(name => <button key={name} onClick={() => open(name)}>{name}</button>)}</nav><p>A small home on the internet.</p></footer>
    </div>
    <dialog ref={editor} className="detail-dialog editor-dialog" aria-labelledby="editor-title"><form className="dialog-inner" onSubmit={addLink}><div className="flex justify-between items-start gap-6"><h2 id="editor-title">添加一张便签</h2><button type="button" className="close-button" onClick={() => editor.current.close()} aria-label="关闭添加链接"><X size={20} /></button></div><p>每页放六张，更多链接会自动翻页。仅保存在当前浏览器，清除网站数据后会丢失。</p><label htmlFor="link-name">名称</label><input id="link-name" name="name" required maxLength={50} autoFocus placeholder="例如：我的作品集" /><label htmlFor="link-url">网址</label><input id="link-url" name="url" type="url" required placeholder="https://example.com" aria-describedby="form-error" /><label htmlFor="link-detail">一句介绍（选填）</label><input id="link-detail" name="detail" maxLength={100} placeholder="记录这个链接的小注释" /><label htmlFor="link-color">便签标记</label><select id="link-color" name="color"><option value="sand">浅米色</option><option value="pink">浅粉色</option><option value="blue">浅蓝色</option></select><p id="form-error" className="form-error" role="alert">{formError}</p><button className="copy-button" type="submit">保存链接</button></form></dialog>
    <dialog ref={dialog} className="detail-dialog" onClick={e => { if (e.target === e.currentTarget) dialog.current.close(); }}><div className="dialog-inner"><div className="flex justify-between items-start gap-6"><h2>{content?.title}</h2><button className="close-button" onClick={() => dialog.current.close()} aria-label="Close dialog"><X size={20} /></button></div><h3>{content?.paragraphs[0]}</h3>{content?.paragraphs.slice(1).map(p => <p key={p}>{p}</p>)}<button className="copy-button inline-flex items-center gap-2" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link copied' : 'Copy this page link'}</button><span className="sr-only" role="status">{copied ? 'Page link copied to clipboard' : ''}</span></div></dialog>
  </div>;
}
function Router() {
  const [route, setRoute] = useState(() => location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const callback = new URLSearchParams(location.search).has('provider');
  return /^\/chat\/?$/.test(location.pathname) || route === '#/chat' || callback ? <ContactStation /> : <App />;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Router /></React.StrictMode>);
