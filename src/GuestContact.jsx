import React, { useEffect, useRef, useState } from 'react';
import { ChatCircle } from '@phosphor-icons/react';
import { rpc, rpcErrorText } from './station-rpc';
// 旧的 OTP / 邀请配对 / 加密文件 / 设备空间逻辑原样保留，只在作者视图的次要 tab 里调用。
import ContactStation from './ContactStation';

const GUEST_KEY = 'personal-hub-guest-v1';
const AUTHOR_KEY = 'personal-hub-author-v1';
const MAX_BODY = 4000;

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
function Disclaimer({ compact }) {
  return <div className={`gc-disclaimer ${compact ? 'compact' : ''}`} role="note">
    <p>留言内容云端可见，请勿发送密码等敏感信息。</p>
    <p>访客暂不支持附件（平台要求登录）。</p>
    {!compact && <p>顶部「作者在线」说的是作者有没有开着页面，不是在判断你是谁。</p>}
  </div>;
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
  const [authorTab, setAuthorTab] = useState('chat');  // 'chat' | 'devices'
  const [seen, setSeen] = useState({});                // 各会话已读消息数基准

  // 作者书签 #/author 直接打开登录框；已保存令牌时不弹，交给自动恢复进入工作台。
  const [loginOpen, setLoginOpen] = useState(() => Boolean(openAuthorLogin) && !readAuthorToken());
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const loginDialog = useRef(null);
  const guestPending = useRef(null);
  const authorPending = useRef(null);
  const selectedSpaceRef = useRef('');
  useEffect(() => { selectedSpaceRef.current = selectedSpace; }, [selectedSpace]);

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

  // 打开访客联络空间。secret 由前端生成，连同 space/title 一起存本地以便刷新恢复。
  async function openGuest() {
    if (guestBusy) return;
    setGuestBusy('open'); setGuestError('');
    try {
      const secret = makeSecret();
      const title = `访客联络 · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
      const data = await rpc('guest_open', { secret, title });
      if (!data.space) { const err = new Error('服务未返回联络空间'); err.code = 'bad_response'; throw err; }
      const next = { space: data.space, secret, title };
      try { localStorage.setItem(GUEST_KEY, JSON.stringify(next)); } catch { /* 仍可在本次会话内使用 */ }
      setGuest(next); setGuestMessages([]); setGuestText(''); guestPending.current = null;
    } catch (e) { setGuestError(rpcErrorText(e)); }
    finally { setGuestBusy(''); }
  }
  function endGuest() {
    try { localStorage.removeItem(GUEST_KEY); } catch { /* 忽略存储限制 */ }
    setGuest(null); setGuestMessages([]); setGuestText(''); setGuestError(''); guestPending.current = null;
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
      guestPending.current = null; setGuestText('');
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
      setToken(data.token); setView('author'); setAuthorTab('chat');
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
      setAuthorTab('chat'); setAuthorText(''); setAuthorError(''); setAuthorBusy('');
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
    selectedSpaceRef.current = space;
    setSelectedSpace(space); setAuthorMessages([]); setAuthorText('');
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
      authorPending.current = null; setAuthorText('');
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
  // 页脚显示当前实际加载的构建资源哈希，方便一眼确认浏览器拿到的是哪一版。
  const buildTag = (() => {
    try {
      const script = document.querySelector('script[type="module"][src]');
      return script?.src.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1]?.slice(0, 7) || '';
    } catch { return ''; }
  })();

  return <div className="station-page min-h-dvh">
    <header className="station-header">
      <a href="./">← Personal Hub</a>
      <span className="gc-header-right">
        <span className={`gc-identity ${view === 'author' ? 'gc-identity-author' : previewAsGuest ? 'gc-identity-preview' : ''}`}>
          {view === 'author' ? '作者身份 · 已验证' : previewAsGuest ? '访客预览中' : '访客视角'}
        </span>
        {view === 'author'
          ? <StatusPill tone="on" label="作者在线（本页）" />
          : <StatusPill
              tone={online === true ? 'on' : online === false ? 'off' : 'unknown'}
              label={online === true ? '作者现在在线' : online === false ? '作者暂时离开' : '正在确认作者状态…'} />}
        <span className="gc-header-title">联络站</span>
      </span>
    </header>

    {(notice || checking) && <p className="gc-notice" role="status">{checking ? '正在恢复作者会话…' : notice}</p>}
    {previewAsGuest && <p className="gc-preview-bar" role="status">
      <span>正在以访客视角预览 · 本页已暂停作者心跳，刷新页面会回到作者工作台</span>
      <button type="button" onClick={exitPreview}>返回作者工作台 →</button>
    </p>}

    {view === 'guest' ? (
      <main className="station-workspace gc-guest-workspace">
        <aside className="station-sidebar">
          <ChatCircle size={30} weight="light" />
          <h1>联络站</h1>
          <p>留一句话，等作者回来。</p>
          <div className="gc-sidebar-note">
            <p>这里不需要登录。点一下「发起联络」，就能给作者留言。</p>
            <p>联络凭据只保存在这台浏览器，刷新页面还能接着聊。</p>
            <p>顶部状态表示作者是否开着页面，与你的身份无关。</p>
          </div>
        </aside>
        <section className="station-conversation" aria-label="访客联络">
          <div className="station-conversation-heading">
            <h2>{guest ? guest.title : '给作者留句话'}</h2>
            <span>{guest ? '已建立联络' : '尚未发起联络'}</span>
            {guest && <button type="button" className="small-control gc-text-button" onClick={endGuest}>结束本次联络 / 新建联络</button>}
          </div>
          {!guest ? (
            <div className="station-connection-state">
              <ChatCircle size={42} weight="thin" />
              <h3>不用注册，直接说</h3>
              <p>点下面的按钮创建一个临时联络空间，作者上线后就能看到并回复。</p>
              <button type="button" className="small-control gc-primary" disabled={!!guestBusy} onClick={openGuest}>
                {guestBusy === 'open' ? '正在创建…' : '发起联络'}
              </button>
              <Disclaimer />
            </div>
          ) : (
            <div className="station-messages" aria-label="消息记录" aria-live="polite">
              {!guestMessages.length && <div className="station-empty-message">联络已建立。写下第一句话吧，作者上线后会回复。</div>}
              {guestMessages.map(message => <Bubble key={message.id} message={message} mine={message.sender === 'guest'} />)}
            </div>
          )}
          <div className="station-feedback">
            <p role="alert" className="form-error">{guestError || presenceError}</p>
          </div>
          {guest && <form className="station-compose" onSubmit={sendGuest}>
            <label htmlFor="gc-guest-message">留言</label>
            <textarea id="gc-guest-message" rows={3} maxLength={MAX_BODY} value={guestText} disabled={!!guestBusy}
              onChange={event => setGuestText(event.target.value)} placeholder="想说的话…（最多 4000 字）" />
            <Disclaimer compact />
            <div className="gc-compose-actions">
              <span className="gc-char-count">{guestText.length} / {MAX_BODY}</span>
              <button className="small-control gc-primary" disabled={!!guestBusy || !guestText.trim()}>
                {guestBusy === 'send' ? '正在发送…' : '发送'}
              </button>
            </div>
          </form>}
        </section>
      </main>
    ) : (
      <main className="station-workspace">
        <aside className="station-sidebar gc-author-sidebar">
          <ChatCircle size={30} weight="light" />
          <h1>作者工作台</h1>
          <p>已通过口令验证 · 会话自动刷新，无需手动上线。</p>
          <div className="gc-tabs" role="tablist" aria-label="作者视图">
            <button type="button" role="tab" aria-selected={authorTab === 'chat'} className={`gc-tab ${authorTab === 'chat' ? 'selected' : ''}`} onClick={() => setAuthorTab('chat')}>联络会话</button>
            <button type="button" role="tab" aria-selected={authorTab === 'devices'} className={`gc-tab ${authorTab === 'devices' ? 'selected' : ''}`} onClick={() => setAuthorTab('devices')}>设备空间</button>
          </div>
          {authorTab === 'chat' && <div className="station-space-list gc-inbox-list">
            <span>联络会话 · {authorSpaces.length}</span>
            {authorSpaces.map(item => <button type="button" key={item.space}
              className={`station-space gc-inbox-item ${item.space === selectedSpace ? 'selected' : ''}`}
              onClick={() => chooseSpace(item.space)}>
              <span className="gc-inbox-title">{item.title || '未命名联络'}{unread[item.space] ? <span className="gc-unread" aria-label="有新消息">新</span> : null}</span>
              <small className="gc-inbox-preview">{item.preview || '（暂无消息）'}</small>
              <small>{formatTime(item.last_at)} · {Number(item.count) || 0} 条</small>
            </button>)}
            {!authorSpaces.length && <p>还没有访客发起联络。页面会自动检查新消息。</p>}
          </div>}
          <div className="gc-author-actions">
            <button type="button" className="sample-toggle" onClick={previewGuest}>以访客身份预览</button>
            <button type="button" className="sample-toggle" disabled={!!authorBusy} onClick={logout}>退出作者登录</button>
          </div>
          <p className="station-private-note">「以访客身份预览」用于自己测试：临时暂停心跳、切到访客视角，本机登录不会被清除。会话每 5 秒自动刷新，在线状态每 20 秒自动维持。切换到后台标签页时会暂停请求，回来后自动补上。</p>
        </aside>
        <section className="station-conversation" aria-label="作者会话">
          {authorTab === 'devices' ? (
            <div className="station-private-embed"><ContactStation /></div>
          ) : (
            <>
              <div className="station-conversation-heading">
                <h2>{currentSpaceTitle || '选择一个会话'}</h2>
                <span>{authorError ? '连接异常' : '自动刷新中'}</span>
              </div>
              <div className="station-messages" aria-label="消息记录" aria-live="polite">
                {!selectedSpace && <div className="station-empty-message">左侧选择一个会话，或等待访客发起联络。</div>}
                {selectedSpace && !authorMessages.length && <div className="station-empty-message">这个会话还没有消息。</div>}
                {authorMessages.map(message => <Bubble key={message.id} message={message} mine={message.sender === 'author'} />)}
              </div>
              <div className="station-feedback"><p role="alert" className="form-error">{authorError}</p></div>
              <form className="station-compose" onSubmit={sendAuthor}>
                <label htmlFor="gc-author-reply">回复访客</label>
                <textarea id="gc-author-reply" rows={3} maxLength={MAX_BODY} value={authorText} disabled={!selectedSpace || !!authorBusy}
                  onChange={event => setAuthorText(event.target.value)} placeholder="写下回复…（最多 4000 字）" />
                <div className="gc-compose-actions">
                  <span className="gc-char-count">{authorText.length} / {MAX_BODY}</span>
                  <button className="small-control gc-primary" disabled={!selectedSpace || !!authorBusy || !authorText.trim()}>
                    {authorBusy === 'reply' ? '正在发送…' : '发送回复'}
                  </button>
                </div>
              </form>
            </>
          )}
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
        <p>输入作者口令，由服务端校验身份。访客无需登录，直接点「发起联络」就能留言。</p>
        <label htmlFor="gc-author-pass">口令</label>
        <input id="gc-author-pass" type="password" autoComplete="current-password" required value={loginPass}
          onChange={event => { setLoginPass(event.target.value); setLoginError(''); }} />
        <p role="alert" className="form-error">{loginError}</p>
        <button className="small-control gc-primary" disabled={loginBusy}>{loginBusy ? '登录中…' : '登录'}</button>
        <p className="gc-login-hint">登录后本页会自动保持在线；把 <code>#/author</code> 存为书签，下次打开直接回到这里。</p>
      </form>
    </dialog>
  </div>;
}
