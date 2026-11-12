import React, { useEffect, useRef, useState } from 'react';
import { ChatCircle } from '@phosphor-icons/react';
import { rpc, rpcErrorText } from './station-rpc';

const GUEST_KEY = 'personal-hub-guest-v1';
const AUTHOR_KEY = 'personal-hub-author-v1';
const DRAFT_KEY = 'personal-hub-drafts-v1';
const MAX_BODY = 4000;
const MAX_TITLE = 60;

// 草稿按「会话 id」分别存放：切走再切回来，输入框里的字还在。
// 结构与数据分两层，避免把作者草稿和访客草稿混到一起。
function readDrafts() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object') {
      return {
        author: value.author && typeof value.author === 'object' ? value.author : {},
        guest: value.guest && typeof value.guest === 'object' ? value.guest : {},
      };
    }
  } catch { /* 草稿损坏按空处理 */ }
  return { author: {}, guest: {} };
}

function readGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value && typeof value.space === 'string' && value.space && typeof value.secret === 'string' && value.secret) {
      return { space: value.space, secret: value.secret, title: typeof value.title === 'string' ? value.title : '访客联络' };
    }
  } catch { /* 凭据损坏按未发起联络处理 */ }
  return null;
}
function readAuthorToken() {
  try {
    const raw = localStorage.getItem(AUTHOR_KEY);
    if (!raw) return '';
    try { const value = JSON.parse(raw); return typeof value?.token === 'string' ? value.token : ''; }
    catch { return raw; }
  } catch { return ''; }
}
function clearAuthorToken() { try { localStorage.removeItem(AUTHOR_KEY); } catch { /* 忽略存储限制 */ } }
function newClientId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}
// 两个 UUID 去掉连字符共 64 个十六进制字符，满足后端 32~128 字符随机串要求。
function makeSecret() {
  const raw = `${crypto.randomUUID?.() ?? ''}${crypto.randomUUID?.() ?? ''}`.replace(/-/g, '');
  if (raw.length >= 64) return raw.slice(0, 64);
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
// 邀请链接跟随当前入口路径（/ 或 /hub），避免落到可能被缓存的旧地址。
function inviteBaseUrl() {
  try {
    const base = location.pathname.replace(/\/+$/, '');
    return `${location.origin}${base}/`;
  } catch { return `${location.origin}/`; }
}
function cmpId(a, b) {
  try { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; }
  catch { return String(a).localeCompare(String(b), 'en', { numeric: true }); }
}
function mergeMessages(previous, incoming) {
  if (!Array.isArray(incoming)) return previous;
  const map = new Map(previous.map(item => [String(item.id), item]));
  incoming.forEach(item => { if (item && item.id != null) map.set(String(item.id), item); });
  return [...map.values()].sort((a, b) => cmpId(a.id, b.id));
}
function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function Bubble({ message, mine }) {
  const who = message.sender === 'author' ? '作者' : '访客';
  return <article className={`station-message ${mine ? 'mine' : ''}`}>
    <div className="station-message-meta">{who} · {formatTime(message.created_at)}</div>
    <p>{message.body}</p>
  </article>;
}
function StatusPill({ tone, label }) {
  return <span className={`gc-status gc-status-${tone}`} role="status"><span className="gc-status-dot" aria-hidden="true" />{label}</span>;
}
// 受控原生 dialog：open 由父级 state 驱动，配合 dialog.open 守卫避免 StrictMode 下重复 showModal。
function Dialog({ open, onClose, className = 'detail-dialog', labelledBy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); onClose?.(); }}>
    {children}
  </dialog>;
}

function redeemErrorText(e) {
  if (e?.business === 'invalid_invite') return '邀请码无效、已过期或次数已用完，请向对方索取新的邀请。';
  return rpcErrorText(e);
}
// 邀请二维码按需加载 qrcode，只在打开邀请面板时才下载这段代码。
function InviteQr({ link, alt }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!link) { setSrc(''); return undefined; }
    (async () => {
      try {
        const { default: QRCode } = await import('qrcode');
        const url = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#4a3f35', light: '#fffdf9' } });
        if (alive) setSrc(url);
      } catch { if (alive) setSrc(''); }
    })();
    return () => { alive = false; };
  }, [link]);
  if (!src) return null;
  return <div className="gc-qr"><img src={src} alt={alt} width="168" height="168" /></div>;
}

export default function GuestContact({ openAuthorLogin = false }) {
  const [view, setView] = useState('guest');           // 'guest' | 'author'
  // 作者本人自测用：暂时忽略本机作者令牌、停掉心跳，以真正的访客视角看页面。
  const [previewAsGuest, setPreviewAsGuest] = useState(false);
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);     // 刷新后 author_check 恢复中
  const [notice, setNotice] = useState('');            // 跨视图提示（会话失效、恢复失败等）
  const [online, setOnline] = useState(null);          // presence
  const [presenceError, setPresenceError] = useState('');

  const [guest, setGuest] = useState(() => readGuest());
  const [guestMessages, setGuestMessages] = useState([]);
  const [guestText, setGuestText] = useState('');
  const [guestError, setGuestError] = useState('');
  const [guestBusy, setGuestBusy] = useState('');

  const [authorSpaces, setAuthorSpaces] = useState([]);
  const [selectedSpace, setSelectedSpace] = useState('');
  const [authorMessages, setAuthorMessages] = useState([]);
  const [authorText, setAuthorText] = useState('');
  const [authorError, setAuthorError] = useState('');
  const [authorBusy, setAuthorBusy] = useState('');
  const [stats, setStats] = useState(null);            // 访问统计（仅作者可见）
  const [seen, setSeen] = useState({});                // 各会话已读消息数基准

  // 作者书签 #/author 直接打开登录框；已保存令牌时不弹，交给自动恢复进入工作台。
  const [loginOpen, setLoginOpen] = useState(() => Boolean(openAuthorLogin) && !readAuthorToken());
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // 创建空间（B）
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  // 作者主动创建邀请空间（作者创建链接）
  const [authorInviteOpen, setAuthorInviteOpen] = useState(false);
  const [authorInviteTitle, setAuthorInviteTitle] = useState('');
  const [authorInviteBusy, setAuthorInviteBusy] = useState(false);
  const [authorInviteData, setAuthorInviteData] = useState(null);
  const [authorInviteError, setAuthorInviteError] = useState('');
  const [authorInviteCopied, setAuthorInviteCopied] = useState(false);

  // 邀请面板（C）
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteData, setInviteData] = useState(null);   // { code, expires_at, uses_left }，仅来自服务端
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  // 手动输入邀请码加入（C）
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState('');

  // URL 邀请 ?invite=<CODE>#/chat（C）
  const [pendingInvite, setPendingInvite] = useState(() => {
    try { return new URLSearchParams(location.search).get('invite') || ''; }
    catch { return ''; }
  });
  const [inviteJoinBusy, setInviteJoinBusy] = useState(false);
  const [inviteJoinError, setInviteJoinError] = useState('');

  const loginDialog = useRef(null);
  const guestPending = useRef(null);
  const authorPending = useRef(null);
  const drafts = useRef(null);
  if (!drafts.current) drafts.current = readDrafts();
  const selectedSpaceRef = useRef('');
  const guestListRef = useRef(null);
  const authorListRef = useRef(null);
  const guestInputRef = useRef(null);
  const authorInputRef = useRef(null);
  const guestStick = useRef(true);
  const authorStick = useRef(true);
  // ---- 草稿：按会话 id 存档，切换会话或刷新页面都能接上 ----
  function loadDraft(kind, space) {
    if (!space) return '';
    return drafts.current[kind]?.[space] || '';
  }
  function saveDraft(kind, space, text) {
    if (!space) return;
    const bucket = drafts.current[kind] || (drafts.current[kind] = {});
    if (text) bucket[space] = text;
    else delete bucket[space];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts.current)); }
    catch { /* 存不下也不影响当前输入 */ }
  }
  // 手机端输入框随内容自动增高，最多两行半，避免挤占消息区。
  function growComposer(event) {
    const el = event.currentTarget;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    if (!el.value) { el.style.height = ''; return; }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }
  useEffect(() => { if (guestInputRef.current && !guestText) guestInputRef.current.style.height = ''; }, [guestText]);
  useEffect(() => { if (authorInputRef.current && !authorText) authorInputRef.current.style.height = ''; }, [authorText]);
  // 进入 / 切换访客联络：把上次没发出去的内容放回输入框
  useEffect(() => { setGuestText(loadDraft('guest', guest?.space)); }, [guest?.space]);
  useEffect(() => { selectedSpaceRef.current = selectedSpace; }, [selectedSpace]);
  // 新消息到达时贴到底部；用户手动上翻查看历史时不打扰。
  useEffect(() => { const el = guestListRef.current; if (el && guestStick.current) el.scrollTop = el.scrollHeight; }, [guestMessages.length]);
  useEffect(() => { const el = authorListRef.current; if (el && authorStick.current) el.scrollTop = el.scrollHeight; }, [authorMessages.length, selectedSpace]);
  function trackStick(event, ref) {
    const el = event.currentTarget;
    ref.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // 刷新页面自动恢复作者登录，无需再次输入口令 —— 这就是服务自启动。
  useEffect(() => {
    let alive = true;
    const saved = readAuthorToken();
    if (!saved) return;
    setChecking(true);
    (async () => {
      try {
        await rpc('author_check', { token: saved });
        if (!alive) return;
        setToken(saved);
        setView('author');
        setNotice('');
      } catch (e) {
        if (!alive) return;
        if (e?.business === 'unauthorized' || e?.business === 'invalid_pass') {
          clearAuthorToken();
          setNotice('作者会话已失效，请重新登录。');
        } else {
          setNotice(`${rpcErrorText(e)} 可点击底部「作者登录」重试。`);
        }
      } finally { if (alive) setChecking(false); }
    })();
    return () => { alive = false; };
  }, []);

  // 登录弹窗用原生 dialog，交给 effect 控制 showModal / close，避免 StrictMode 重复调用。
  useEffect(() => {
    const dialog = loginDialog.current;
    if (!dialog) return;
    if (loginOpen && !dialog.open) dialog.showModal();
    else if (!loginOpen && dialog.open) dialog.close();
  }, [loginOpen]);

  // 已打开的访客页里把地址改成 #/author（或点书签同页跳转）也要弹出口令框。
  // 只监听 hashchange，不监听 view，避免「退出作者登录」后被立刻重新弹窗。
  useEffect(() => {
    function onHashChange() {
      if (location.hash === '#/author' && !readAuthorToken() && view === 'guest') setLoginOpen(true);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [view]);

  // 访客视图：每 10 秒刷新作者在线状态。hidden 时跳过，visibilitychange 回来补一次。
  useEffect(() => {
    if (view !== 'guest') return;
    let alive = true, running = false;
    async function poll() {
      if (running || document.hidden) return;
      running = true;
      try {
        const data = await rpc('presence', {});
        if (!alive) return;
        setOnline(Boolean(data.online));
        setPresenceError('');
      } catch (e) {
        if (alive) { setOnline(null); setPresenceError(rpcErrorText(e)); }
      } finally { running = false; }
    }
    poll();
    const timer = setInterval(poll, 10000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [view]);

  // 访客视图：3 秒轮询消息；visibilitychange 触发；hidden 跳过。
  useEffect(() => {
    if (view !== 'guest' || !guest) return;
    let alive = true, running = false;
    async function poll() {
      if (running || document.hidden) return;
      running = true;
      try {
        const data = await rpc('guest_read', { space: guest.space, secret: guest.secret });
        if (!alive) return;
        setGuestMessages(previous => mergeMessages(previous, data.messages));
        setGuestError('');
      } catch (e) { if (alive) setGuestError(rpcErrorText(e)); }
      finally { running = false; }
    }
    poll();
    const timer = setInterval(poll, 3000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [view, guest?.space, guest?.secret]);

  // 作者视图：挂载后立刻心跳 + 拉取，随后 20 秒心跳、5 秒 inbox/read 自动刷新，无需手动上线。
  useEffect(() => {
    if (view !== 'author' || !token) return;
    let alive = true, running = false;
    function fail(e) {
      if (!alive) return;
      if (e?.business === 'unauthorized' || e?.business === 'invalid_pass') {
        clearAuthorToken(); setToken(''); setView('guest');
        setAuthorSpaces([]); setAuthorMessages([]); setSelectedSpace(''); selectedSpaceRef.current = '';
        setNotice('作者会话已失效，请重新登录。');
        return;
      }
      setAuthorError(rpcErrorText(e));
    }
    async function poll() {
      if (running || document.hidden) return;
      running = true;
      try {
        const inbox = await rpc('author_inbox', { token });
        if (!alive) return;
        const list = Array.isArray(inbox.spaces) ? inbox.spaces : [];
        setAuthorSpaces(list);
        const nextSpace = list.some(item => item.space === selectedSpaceRef.current) ? selectedSpaceRef.current : (list[0]?.space || '');
        if (nextSpace !== selectedSpaceRef.current) {
          selectedSpaceRef.current = nextSpace;
          setSelectedSpace(nextSpace);
          setAuthorMessages([]);
          setAuthorText(loadDraft('author', nextSpace));
        }
        if (nextSpace) {
          const read = await rpc('author_read', { token, space: nextSpace });
          if (!alive || selectedSpaceRef.current !== nextSpace) return;
          setAuthorMessages(previous => mergeMessages(previous, read.messages));
          const current = list.find(item => item.space === nextSpace);
          if (current) setSeen(previous => ({ ...previous, [nextSpace]: Number(current.count) || 0 }));
        } else if (alive) setAuthorMessages([]);
        if (alive) setAuthorError('');
      } catch (e) { fail(e); }
      finally { running = false; }
    }
    async function beat() {
      if (document.hidden) return;
      try { await rpc('author_heartbeat', { token }); }
      catch (e) { fail(e); }
    }
    beat();
    poll();
    const readTimer = setInterval(poll, 5000);
    const beatTimer = setInterval(beat, 20000);
    const onVisible = () => { if (!document.hidden) { beat(); poll(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(readTimer); clearInterval(beatTimer); document.removeEventListener('visibilitychange', onVisible); };
  }, [view, token]);

  // 作者进入工作台后取一次访问统计（今日 / 近 7 天）。
  useEffect(() => {
    if (view !== 'author' || !token) return undefined;
    let alive = true;
    rpc('author_stats', { token })
      .then(data => { if (alive) setStats(data); })
      .catch(() => { /* 统计失败不影响使用 */ });
    return () => { alive = false; };
  }, [view, token]);

  function persistGuest(next) {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(next)); } catch { /* 仍可在本次会话内使用 */ }
    setGuest(next); setGuestMessages([]); setGuestError(''); guestPending.current = null;
    setGuestText(loadDraft('guest', next?.space));
  }
  function defaultTitle() {
    return `访客联络 · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  }
  // 清掉 URL 里的 invite 参数，但保留 hash（#/chat 仍由路由识别）。
  function cleanInviteParam() {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('invite');
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch { /* 忽略地址改写失败 */ }
  }

  // 创建空间：点击大按钮后先弹表单，名称即「创建时的编辑」。
  function openCreate() {
    setCreateTitle(defaultTitle()); setCreateError(''); setCreateOpen(true);
  }
  function closeCreate() { if (!createBusy) setCreateOpen(false); }
  async function submitCreate(event) {
    event.preventDefault();
    const title = createTitle.trim();
    if (!title || createBusy) return;
    if (title.length > MAX_TITLE) { setCreateError(`空间名称最多 ${MAX_TITLE} 字。`); return; }
    setCreateBusy(true); setCreateError('');
    try {
      const secret = makeSecret();
      const data = await rpc('guest_open', { secret, title });
      if (!data.space) { const err = new Error('服务未返回联络空间'); err.code = 'bad_response'; throw err; }
      persistGuest({ space: data.space, secret, title });
      setCreateOpen(false);
      setPendingInvite(null);
    } catch (e) { setCreateError(rpcErrorText(e)); }
    finally { setCreateBusy(false); }
  }

  function endGuest() {
    try { localStorage.removeItem(GUEST_KEY); } catch { /* 忽略存储限制 */ }
    if (guest?.space) saveDraft('guest', guest.space, '');
    setGuest(null); setGuestMessages([]); setGuestText(''); setGuestError(''); guestPending.current = null;
    setCreateOpen(false); setInviteOpen(false); setInviteData(null);
    setJoinOpen(false); setJoinCode(''); setInviteError('');
  }

  // 作者主动创建邀请空间：作者生成链接发给对方，对方加入后即可互通。
  const authorInviteLink = authorInviteData?.code ? `${inviteBaseUrl()}?invite=${authorInviteData.code}#/chat` : '';
  function openAuthorInvite() {
    setAuthorInviteTitle(`作者邀请 · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
    setAuthorInviteData(null); setAuthorInviteError(''); setAuthorInviteCopied(false); setAuthorInviteOpen(true);
  }
  function closeAuthorInvite() { if (!authorInviteBusy) setAuthorInviteOpen(false); }
  async function submitAuthorInvite(event) {
    event.preventDefault();
    const title = authorInviteTitle.trim();
    if (!title || authorInviteBusy || !token) return;
    if (title.length > MAX_TITLE) { setAuthorInviteError(`空间名称最多 ${MAX_TITLE} 字。`); return; }
    setAuthorInviteBusy(true); setAuthorInviteError('');
    try {
      const data = await rpc('author_space_create', { token, title });
      if (!data || typeof data.code !== 'string' || !data.code) {
        const err = new Error('服务未返回邀请码'); err.code = 'bad_response'; throw err;
      }
      setAuthorInviteData({ code: data.code, space: data.space, title: data.title || title, expires_at: data.expires_at || '', uses_left: data.uses_left });
    } catch (e) {
      if (e?.business === 'unauthorized' || e?.business === 'invalid_pass') {
        clearAuthorToken(); setToken(''); setView('guest'); setAuthorInviteOpen(false);
        setNotice('作者会话已失效，请重新登录。'); return;
      }
      setAuthorInviteError(rpcErrorText(e));
    } finally { setAuthorInviteBusy(false); }
  }
  async function copyAuthorInvite() {
    if (!authorInviteLink) return;
    try { await navigator.clipboard.writeText(authorInviteLink); setAuthorInviteCopied(true); setAuthorInviteError(''); }
    catch { setAuthorInviteCopied(false); setAuthorInviteError('自动复制失败，请手动选中链接复制。'); }
  }

  // 邀请：邀请码只来自 guest_invite_create 返回值。
  const inviteLink = inviteData?.code ? `${inviteBaseUrl()}?invite=${inviteData.code}#/chat` : '';
  function closeInvite() { setInviteOpen(false); setInviteError(''); setCopied(false); }
  async function createInvite() {
    if (!guest || inviteBusy) return;
    setInviteBusy(true); setInviteError(''); setCopied(false);
    try {
      const data = await rpc('guest_invite_create', { space: guest.space, secret: guest.secret });
      if (!data || typeof data.code !== 'string' || !data.code) {
        const err = new Error('服务未返回邀请码'); err.code = 'bad_response'; throw err;
      }
      setInviteData({ code: data.code, expires_at: data.expires_at || '', uses_left: data.uses_left });
    } catch (e) { setInviteError(rpcErrorText(e)); }
    finally { setInviteBusy(false); }
  }
  function openInvite() {
    if (!guest) return;
    setInviteData(null); setInviteError(''); setCopied(false); setInviteOpen(true);
    createInvite();
  }
  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true); setInviteError('');
    } catch {
      setCopied(false);
      setInviteError('自动复制失败，请手动选中上方链接复制。');
    }
  }

  // 手动输入邀请码加入。
  function toggleJoin() { setJoinOpen(previous => !previous); setJoinError(''); }
  async function submitJoin(event) {
    event.preventDefault();
    const code = joinCode.trim();
    if (!code || joinBusy) return;
    setJoinBusy(true); setJoinError('');
    try {
      const secret = makeSecret();
      const data = await rpc('guest_invite_redeem', { code, secret });
      if (!data.space) { const err = new Error('服务未返回联络空间'); err.code = 'bad_response'; throw err; }
      persistGuest({ space: data.space, secret, title: data.title || '访客联络' });
      setJoinOpen(false); setJoinCode('');
      cleanInviteParam(); setPendingInvite(null);
    } catch (e) { setJoinError(redeemErrorText(e)); }
    finally { setJoinBusy(false); }
  }

  // URL 邀请：用自己的高熵 secret 兑换并切换空间。
  function dismissInvite() { setPendingInvite(null); setInviteJoinError(''); }
  async function redeemFromUrl() {
    if (inviteJoinBusy || !pendingInvite) return;
    setInviteJoinBusy(true); setInviteJoinError('');
    try {
      const secret = makeSecret();
      const data = await rpc('guest_invite_redeem', { code: pendingInvite, secret });
      if (!data.space) { const err = new Error('服务未返回联络空间'); err.code = 'bad_response'; throw err; }
      persistGuest({ space: data.space, secret, title: data.title || '访客联络' });
      cleanInviteParam(); setPendingInvite(null);
    } catch (e) { setInviteJoinError(redeemErrorText(e)); }
    finally { setInviteJoinBusy(false); }
  }

  async function sendGuest(event) {
    event.preventDefault();
    const body = guestText.trim();
    if (!body || !guest || guestBusy) return;
    if (body.length > MAX_BODY) { setGuestError(`留言最多 ${MAX_BODY} 字。`); return; }
    let pending = guestPending.current;
    if (!pending || pending.body !== body) {
      pending = { client_id: newClientId(), body };
      guestPending.current = pending;
    }
    setGuestBusy('send'); setGuestError('');
    try {
      const data = await rpc('guest_post', { space: guest.space, secret: guest.secret, client_id: pending.client_id, body: pending.body });
      setGuestMessages(previous => mergeMessages(previous, [{
        id: data.id, client_id: pending.client_id, sender: 'guest', body: pending.body, created_at: new Date().toISOString(),
      }]));
      guestPending.current = null; saveDraft('guest', guest.space, ''); setGuestText('');
    } catch (e) { setGuestError(rpcErrorText(e)); }
    finally { setGuestBusy(''); }
  }

  // 预览期间不清除本机作者令牌：刷新页面仍会回到作者工作台，避免误把自己踢下线。
  function previewGuest() {
    setPreviewAsGuest(true); setView('guest');
    setNotice(''); setGuestError(''); setPresenceError(''); setLoginOpen(false);
  }
  function exitPreview() {
    setPreviewAsGuest(false); setView('author'); setLoginOpen(false); setNotice('');
  }
  function openLogin() {
    if (previewAsGuest && token) { exitPreview(); return; }
    setLoginPass(''); setLoginError(''); setLoginOpen(true);
  }
  async function submitLogin(event) {
    event.preventDefault();
    if (!loginPass || loginBusy) return;
    setLoginBusy(true); setLoginError('');
    try {
      const data = await rpc('author_login', { pass: loginPass });
      if (!data.ok || !data.token) { const err = new Error('服务未返回登录令牌'); err.code = 'bad_response'; throw err; }
      try { localStorage.setItem(AUTHOR_KEY, JSON.stringify({ token: data.token })); } catch { /* 仍可在本次会话内使用 */ }
      setToken(data.token); setView('author');
      setLoginOpen(false); setLoginPass(''); setNotice('');
    } catch (e) { setLoginError(rpcErrorText(e)); }
    finally { setLoginBusy(false); }
  }
  async function logout() {
    if (authorBusy) return;
    setAuthorBusy('logout');
    try { await rpc('author_logout', { token }); }
    catch (e) { setNotice(`已退出登录，但云端注销未完成：${rpcErrorText(e)}`); }
    finally {
      clearAuthorToken(); setToken(''); setView('guest'); setPreviewAsGuest(false);
      setAuthorSpaces([]); setAuthorMessages([]); setSelectedSpace(''); selectedSpaceRef.current = '';
      setAuthorText(''); setAuthorError(''); setAuthorBusy('');
    }
  }
  async function refreshConversation(space) {
    try {
      const data = await rpc('author_read', { token, space });
      if (selectedSpaceRef.current !== space) return;
      setAuthorMessages(previous => mergeMessages(previous, data.messages));
      setAuthorError('');
    } catch (e) {
      if (e?.business === 'unauthorized' || e?.business === 'invalid_pass') {
        clearAuthorToken(); setToken(''); setView('guest'); setNotice('作者会话已失效，请重新登录。'); return;
      }
      setAuthorError(rpcErrorText(e));
    }
  }
  function chooseSpace(space) {
    if (selectedSpaceRef.current && selectedSpaceRef.current !== space) {
      // 离开前把当前输入框里的字存到原会话名下
      saveDraft('author', selectedSpaceRef.current, authorText);
    }
    selectedSpaceRef.current = space;
    setSelectedSpace(space); setAuthorMessages([]);
    setAuthorText(loadDraft('author', space));
    const item = authorSpaces.find(row => row.space === space);
    if (item) setSeen(previous => ({ ...previous, [space]: Number(item.count) || 0 }));
    refreshConversation(space);
  }
  async function sendAuthor(event) {
    event.preventDefault();
    const body = authorText.trim();
    if (!body || !selectedSpace || authorBusy) return;
    if (body.length > MAX_BODY) { setAuthorError(`回复最多 ${MAX_BODY} 字。`); return; }
    let pending = authorPending.current;
    if (!pending || pending.body !== body || pending.space !== selectedSpace) {
      pending = { client_id: newClientId(), body, space: selectedSpace };
      authorPending.current = pending;
    }
    setAuthorBusy('reply'); setAuthorError('');
    try {
      const data = await rpc('author_reply', { token, space: pending.space, client_id: pending.client_id, body: pending.body });
      if (selectedSpaceRef.current === pending.space) {
        setAuthorMessages(previous => mergeMessages(previous, [{
          id: data.id, client_id: pending.client_id, sender: 'author', body: pending.body, created_at: new Date().toISOString(),
        }]));
      }
      authorPending.current = null; saveDraft('author', pending.space, '');
      if (selectedSpaceRef.current === pending.space) setAuthorText('');
    } catch (e) {
      if (e?.business === 'unauthorized' || e?.business === 'invalid_pass') {
        clearAuthorToken(); setToken(''); setView('guest'); setNotice('作者会话已失效，请重新登录。'); return;
      }
      setAuthorError(rpcErrorText(e));
    } finally { setAuthorBusy(''); }
  }

  const unread = {};
  authorSpaces.forEach(item => {
    const base = seen[item.space] ?? 0;
    const count = Number(item.count) || 0;
    if (item.space !== selectedSpace && count > base) unread[item.space] = count - base;
  });
  const currentSpaceTitle = authorSpaces.find(item => item.space === selectedSpace)?.title || '';
  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0);
  // 作者在别的标签页时，用标题上的数字提醒有新留言。
  useEffect(() => {
    const base = '个人中转站';
    document.title = view === 'author' && totalUnread > 0 ? `(${totalUnread}) 联络站` : base;
    return () => { document.title = base; };
  }, [view, totalUnread]);
  // 页脚显示当前实际加载的构建资源哈希，方便一眼确认浏览器拿到的是哪一版。
  const buildTag = (() => {
    try {
      const script = document.querySelector('script[type="module"][src]');
      return script?.src.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1]?.slice(0, 7) || '';
    } catch { return ''; }
  })();

  return <div className="station-page min-h-dvh" data-view={view}>
    <header className="station-header">
      <a href="./">← Personal Hub</a>
      <span className="gc-header-right">
        <span className={`gc-identity ${view === 'author' ? 'gc-identity-author' : previewAsGuest ? 'gc-identity-preview' : ''}`}>
          {view === 'author' ? '作者身份 · 已验证' : previewAsGuest ? '访客预览中' : '访客视角'}
        </span>
        {view === 'author' ? null : <StatusPill
          tone={online === true ? 'on' : online === false ? 'off' : 'unknown'}
          label={online === true ? '作者现在在线' : online === false ? '作者暂时离开' : '正在确认作者状态…'} />}
        <span className="gc-header-title">联络站</span>
      </span>
    </header>

    {(notice || checking) && <p className="gc-notice" role="status">{checking ? '正在恢复作者会话…' : notice}</p>}
    {previewAsGuest && <p className="gc-preview-bar" role="status">
      <span>访客预览中，刷新可回到作者工作台</span>
      <button type="button" onClick={exitPreview}>返回作者工作台 →</button>
    </p>}

    {view === 'guest' ? (
      <>
        {pendingInvite && <div className="gc-invite-banner" role="region" aria-label="加入邀请">
          <div className="gc-invite-banner-text">
            <strong>有人邀请你加入联络空间</strong>
            {guest && <p>你当前已有一个联络空间，加入后会切换到对方的空间。</p>}
          </div>
          <div className="gc-invite-banner-actions">
            <button type="button" className="gc-primary" disabled={inviteJoinBusy} onClick={redeemFromUrl}>
              {inviteJoinBusy ? '加入中…' : '加入'}
            </button>
            <button type="button" className="gc-text-link" onClick={dismissInvite}>忽略</button>
          </div>
          {inviteJoinError && <p role="alert" className="form-error">{inviteJoinError}</p>}
        </div>}

        <main className="station-workspace gc-guest-workspace">
          <aside className="station-sidebar">
            <ChatCircle size={30} weight="light" />
            <h1>联络站</h1>
            <p>留一句话，等作者回来。</p>
          </aside>
          <section className="station-conversation" aria-label="访客联络">
            <div className="station-conversation-heading gc-heading">
              <div className="gc-heading-main">
                <h2>{guest ? guest.title : '给作者留句话'}</h2>
              </div>
              {guest && <div className="gc-heading-actions">
                <button type="button" className="small-control gc-text-button" onClick={openInvite}>邀请</button>
                <button type="button" className="small-control gc-text-button" onClick={endGuest}>结束</button>
              </div>}
            </div>
            {!guest ? (
              <div className="station-connection-state gc-create-state">
                <button type="button" className="gc-primary-large" onClick={openCreate}>＋ 创建联络空间</button>
                <p className="gc-create-hint">无需注册 · 留言云端可见</p>
                <div className="gc-join-entry">
                  {!joinOpen ? (
                    <button type="button" className="gc-text-link" onClick={toggleJoin}>输入邀请码加入</button>
                  ) : (
                    <form className="gc-join-form" onSubmit={submitJoin}>
                      <label htmlFor="gc-join-code">邀请码</label>
                      <input id="gc-join-code" className="gc-input" value={joinCode} maxLength={128}
                        placeholder="粘贴 64 位邀请码" autoComplete="off"
                        onChange={event => { setJoinCode(event.target.value); setJoinError(''); }} />
                      <div className="gc-dialog-actions">
                        <button type="button" className="gc-text-link" onClick={toggleJoin}>取消</button>
                        <button type="submit" className="small-control gc-primary" disabled={joinBusy || !joinCode.trim()}>
                          {joinBusy ? '加入中…' : '加入'}
                        </button>
                      </div>
                    </form>
                  )}
                  {joinError && <p role="alert" className="form-error">{joinError}</p>}
                </div>
              </div>
            ) : (
              <div className="station-messages" aria-label="消息记录" aria-live="polite" ref={guestListRef}
                onScroll={event => trackStick(event, guestStick)}>
                {!guestMessages.length && <div className="station-empty-message">联络已建立，写下第一句话吧。</div>}
                {guestMessages.map(message => <Bubble key={message.id} message={message} mine={message.sender === 'guest'} />)}
              </div>
            )}
            <div className="station-feedback">
              <p role="alert" className="form-error">{guestError || presenceError}</p>
            </div>
            {guest && <form className="station-compose" onSubmit={sendGuest}>
              <label htmlFor="gc-guest-message">留言</label>
              <textarea id="gc-guest-message" ref={guestInputRef} rows={3} maxLength={MAX_BODY} value={guestText} disabled={!!guestBusy}
                onChange={event => { const value = event.target.value; setGuestText(value); saveDraft('guest', guest?.space, value); growComposer(event); }} placeholder="写点什么…" />
              <div className="gc-compose-actions">
                <span className="gc-char-count">{guestText.length} / {MAX_BODY}</span>
                <button className="small-control gc-primary" disabled={!!guestBusy || !guestText.trim()}>
                  {guestBusy === 'send' ? '正在发送…' : '发送'}
                </button>
              </div>
            </form>}
          </section>
        </main>
      </>
    ) : (
      <main className="station-workspace">
        <aside className="station-sidebar gc-author-sidebar">
          <ChatCircle size={30} weight="light" />
          <h1>作者工作台</h1>
          <p>已验证 · 自动刷新</p>
          <div className="station-space-list gc-inbox-list">
            <span>联络会话 · {authorSpaces.length}</span>
            {authorSpaces.map(item => <button type="button" key={item.space}
              className={`station-space gc-inbox-item ${item.space === selectedSpace ? 'selected' : ''}`}
              onClick={() => chooseSpace(item.space)}>
              <span className="gc-inbox-title">{item.title || '未命名联络'}{unread[item.space] ? <span className="gc-unread" aria-label="有新消息">新</span> : null}</span>
              <small className="gc-inbox-preview">{item.preview || '（暂无消息）'}</small>
              <small>{formatTime(item.last_at)} · {Number(item.count) || 0} 条</small>
            </button>)}
            {!authorSpaces.length && <p>还没有访客发起联络。</p>}
          </div>
          <div className="gc-author-foot">
            <div className="gc-author-actions">
              <button type="button" className="sample-toggle" onClick={openAuthorInvite}>＋ 新建邀请</button>
              <button type="button" className="sample-toggle" onClick={previewGuest}>访客预览</button>
              <button type="button" className="sample-toggle" disabled={!!authorBusy} onClick={logout}>退出登录</button>
            </div>
            {stats && <p className="gc-build-line">今日访问 {Number(stats.today) || 0} · 近 7 天 {Number(stats.week) || 0}</p>}
          </div>
        </aside>
        <section className="station-conversation" aria-label="作者会话">
          <>
            <div className="station-conversation-heading">
                <h2>{currentSpaceTitle || '选择一个会话'}</h2>
                <span>{authorError ? '连接异常' : '自动刷新中'}</span>
              </div>
              <div className="station-messages" aria-label="消息记录" aria-live="polite" ref={authorListRef}
                onScroll={event => trackStick(event, authorStick)}>
                {!selectedSpace && <div className="station-empty-message">左侧选择一个会话，或等待访客发起联络。</div>}
                {selectedSpace && !authorMessages.length && <div className="station-empty-message">这个会话还没有消息。</div>}
                {authorMessages.map(message => <Bubble key={message.id} message={message} mine={message.sender === 'author'} />)}
              </div>
              <div className="station-feedback"><p role="alert" className="form-error">{authorError}</p></div>
              <form className="station-compose" onSubmit={sendAuthor}>
                <label htmlFor="gc-author-reply">回复访客</label>
                <textarea id="gc-author-reply" ref={authorInputRef} rows={3} maxLength={MAX_BODY} value={authorText} disabled={!selectedSpace || !!authorBusy}
                  onChange={event => { const value = event.target.value; setAuthorText(value); saveDraft('author', selectedSpace, value); growComposer(event); }} placeholder="写下回复…" />
                <div className="gc-compose-actions">
                  <span className="gc-char-count">{authorText.length} / {MAX_BODY}</span>
                  <button className="small-control gc-primary" disabled={!selectedSpace || !!authorBusy || !authorText.trim()}>
                    {authorBusy === 'reply' ? '正在发送…' : '发送回复'}
                  </button>
                </div>
              </form>
          </>
        </section>
      </main>
    )}

    <footer className="gc-footer">
      <span>联络站 · 留言会保存在云端{buildTag && <span className="gc-build"> · 构建 {buildTag}</span>}</span>
      {view === 'guest'
        ? previewAsGuest
          ? <button type="button" className="gc-author-link" onClick={exitPreview}>返回作者工作台 <span aria-hidden="true">→</span></button>
          : <button type="button" className="gc-author-link" onClick={openLogin}>我是作者 · 进入后台 <span aria-hidden="true">→</span></button>
        : <span className="gc-author-badge">已验证作者身份</span>}
    </footer>

    <dialog ref={loginDialog} className="detail-dialog" onCancel={event => { event.preventDefault(); setLoginOpen(false); }}>
      <form className="dialog-inner station-modal-form" onSubmit={submitLogin}>
        <div className="station-dialog-heading">
          <h2>作者登录</h2>
          <button type="button" className="small-control" onClick={() => setLoginOpen(false)}>关闭</button>
        </div>
        <p className="gc-dialog-hint">输入作者口令登录。</p>
        <label htmlFor="gc-author-pass">口令</label>
        <input id="gc-author-pass" type="password" autoComplete="current-password" required value={loginPass}
          onChange={event => { setLoginPass(event.target.value); setLoginError(''); }} />
        <p role="alert" className="form-error">{loginError}</p>
        <div className="gc-dialog-actions">
          <button className="small-control gc-primary" disabled={loginBusy}>{loginBusy ? '登录中…' : '登录'}</button>
        </div>
      </form>
    </dialog>

    {/* 创建空间：名称可编辑，即「创建时的编辑」 */}
    <Dialog open={createOpen} onClose={closeCreate} labelledBy="gc-create-title-h">
      <form className="dialog-inner station-modal-form" onSubmit={submitCreate}>
        <div className="station-dialog-heading">
          <h2 id="gc-create-title-h">创建联络空间</h2>
          <button type="button" className="small-control" onClick={closeCreate}>关闭</button>
        </div>
        <label htmlFor="gc-create-title">空间名称</label>
        <input id="gc-create-title" maxLength={MAX_TITLE} value={createTitle}
          onChange={event => { setCreateTitle(event.target.value); setCreateError(''); }} />
        <p className="gc-dialog-hint">名称之后可修改。</p>
        <p role="alert" className="form-error">{createError}</p>
        <div className="gc-dialog-actions">
          <button type="button" className="gc-text-link" onClick={closeCreate}>取消</button>
          <button type="submit" className="small-control gc-primary" disabled={createBusy || !createTitle.trim()}>
            {createBusy ? '正在创建…' : '创建'}
          </button>
        </div>
      </form>
    </Dialog>

    {/* 作者主动创建邀请链接 */}
    <Dialog open={authorInviteOpen} onClose={closeAuthorInvite} labelledBy="gc-author-invite-h">
      <form className="dialog-inner station-modal-form" onSubmit={submitAuthorInvite}>
        <div className="station-dialog-heading">
          <h2 id="gc-author-invite-h">新建邀请链接</h2>
          <button type="button" className="small-control" onClick={closeAuthorInvite}>关闭</button>
        </div>
        <label htmlFor="gc-author-invite-title">空间名称</label>
        <input id="gc-author-invite-title" maxLength={MAX_TITLE} value={authorInviteTitle}
          onChange={event => { setAuthorInviteTitle(event.target.value); setAuthorInviteError(''); }} />
        {authorInviteData && <>
          <label htmlFor="gc-author-invite-link">邀请链接</label>
          <input id="gc-author-invite-link" className="gc-input gc-invite-link" readOnly value={authorInviteLink}
            onFocus={event => event.target.select()} aria-label="作者邀请链接" />
          <div className="gc-invite-meta">
            <span>{authorInviteData.expires_at ? `有效期至 ${formatTime(authorInviteData.expires_at)}` : '24 小时内有效'}</span>
            <span>剩余 {authorInviteData.uses_left ?? '—'} 次</span>
          </div>
          <InviteQr link={authorInviteLink} alt="作者邀请二维码" />
        </>}
        <p role="alert" className="form-error">{authorInviteError}</p>
        <div className="gc-dialog-actions">
          {authorInviteData
            ? <>
                <button type="button" className="small-control" onClick={submitAuthorInvite} disabled={authorInviteBusy}>重新生成</button>
                <button type="button" className="small-control gc-primary" onClick={copyAuthorInvite}>
                  {authorInviteCopied ? '已复制' : '复制链接'}
                </button>
              </>
            : <button type="submit" className="small-control gc-primary" disabled={authorInviteBusy || !authorInviteTitle.trim()}>
                {authorInviteBusy ? '正在创建…' : '创建邀请'}
              </button>}
        </div>
      </form>
    </Dialog>

    {/* 邀请面板：链接与邀请码均来自 guest_invite_create 返回值 */}
    <Dialog open={inviteOpen} onClose={closeInvite} labelledBy="gc-invite-title-h">
      <div className="dialog-inner station-modal-form">
        <div className="station-dialog-heading">
          <h2 id="gc-invite-title-h">邀请加入空间</h2>
          <button type="button" className="small-control" onClick={closeInvite}>关闭</button>
        </div>
        <p className="gc-dialog-hint">把链接发给对方，对方即可加入一起留言。</p>
        {inviteBusy && <p className="gc-dialog-hint">正在生成邀请链接…</p>}
        {inviteData && <>
          <label htmlFor="gc-invite-link">邀请链接</label>
          <input id="gc-invite-link" className="gc-input gc-invite-link" readOnly value={inviteLink}
            onFocus={event => event.target.select()} aria-label="邀请链接" />
          <div className="gc-invite-meta">
            <span>有效期至 {inviteData.expires_at ? formatTime(inviteData.expires_at) : '24 小时内'}</span>
            <span>剩余 {inviteData.uses_left ?? '—'} 次</span>
          </div>
          <InviteQr link={inviteLink} alt="邀请二维码" />
        </>}
        <p role="alert" className="form-error">{inviteError}</p>
        <div className="gc-dialog-actions">
          <button type="button" className="small-control" onClick={createInvite} disabled={inviteBusy}>
            {inviteData ? '重新生成' : '生成邀请链接'}
          </button>
          {inviteData && <button type="button" className="small-control gc-primary" onClick={copyInvite}>
            {copied ? '已复制' : '复制链接'}
          </button>}
        </div>
      </div>
    </Dialog>
  </div>;
}
