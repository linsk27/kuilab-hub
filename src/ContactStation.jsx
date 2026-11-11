import React, { useEffect, useRef, useState } from 'react';
import { ChatCircle } from '@phosphor-icons/react';
import { cloud, publicConfig, unwrap, requireSession, explainError } from './station-cloud';
import { randomHex, hashInvite, seal, open, encryptBytes, decryptBytes, parseInvite } from './station-crypto';

const MAX_FILE = 10 * 1024 * 1024;
const FILE_TYPES = /\.(txt|md|csv|json|pdf|docx?|xlsx?|pptx?|zip|7z|png|jpe?g|gif|webp|mp3|m4a|mp4|mov)$/i;
const spaceColumns = 'id,name,owner_id,member_ids,created_at';
const keyStore = uid => `personal-hub-station-keys-v1:${uid}`;
function readKeys(uid) {
  try {
    const data = JSON.parse(localStorage.getItem(keyStore(uid)) || '{}');
    return Object.fromEntries(Object.entries(data).filter(([id, key]) => /^[a-f0-9-]{36}$/i.test(id) && /^[a-f0-9]{64}$/.test(key)));
  } catch { return {}; }
}
function sizeLabel(size) { return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`; }

export default function ContactStation() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [spaces, setSpaces] = useState([]);
  const [selected, setSelected] = useState('');
  const [keys, setKeys] = useState({});
  const [messages, setMessages] = useState([]);
  const [lastSync, setLastSync] = useState('');
  const [title, setTitle] = useState('我的随手传');
  const [pairInput, setPairInput] = useState('');
  const [invitation, setInvitation] = useState('');
  const [dialogMode, setDialogMode] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [hasOlder, setHasOlder] = useState(false);
  const dialog = useRef(null);
  const fileInput = useRef(null);
  const refreshEpoch = useRef(0);
  const pendingSend = useRef(null);
  const operation = useRef(false);
  const messageEnd = useRef(null);
  const active = spaces.find(item => item.id === selected);
  const localOrigin = location.origin !== publicConfig.endpoint;

  async function run(name, action) {
    if (operation.current) return;
    operation.current = true;
    setBusy(name); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(explainError(e)); }
    finally { operation.current = false; setBusy(''); }
  }
  function saveKey(space, key, uid = session.user.id) {
    const next = { ...readKeys(uid), [space]: key };
    localStorage.setItem(keyStore(uid), JSON.stringify(next));
    setKeys(next);
  }
  function showDialog(mode) {
    setDialogMode(mode); setInvitation(''); setPairInput(''); setError('');
    dialog.current.showModal();
  }
  useEffect(() => {
    let alive = true;
    const unsubscribe = cloud.auth.onAuthStateChange((_event, next) => {
      if (alive) setSession(next || null);
    });
    (async () => {
      try {
        const url = new URL(location.href);
        if (url.searchParams.has('code') || url.searchParams.has('error')) {
          const provider = url.searchParams.get('provider');
          if (provider !== 'wechat') throw Error('授权回调无效');
          const restored = unwrap(await cloud.auth.handleWechatWebCallback());
          if (!restored) throw Error('授权未完成');
          for (const field of ['code', 'state', 'provider', 'error', 'error_description']) url.searchParams.delete(field);
          url.hash = '#/chat';
          history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        }
        const restored = unwrap(await cloud.auth.getSession());
        if (alive) setSession(restored || null);
      } catch (e) { if (alive) setError(explainError(e)); }
      finally { if (alive) setReady(true); }
    })();
    return () => { alive = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!countdown) return;
    const timer = setTimeout(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);
  async function loadSpaces() {
    await requireSession();
    const rows = unwrap(await cloud.database.from('station_spaces').select(spaceColumns).order('created_at', { ascending: false })) || [];
    setSpaces(rows);
    setSelected(current => rows.some(row => row.id === current) ? current : (rows[0]?.id || ''));
    return rows;
  }
  useEffect(() => {
    refreshEpoch.current++;
    setSpaces([]); setSelected(''); setMessages([]); setLastSync(''); setInvitation('');
    pendingSend.current = null;
    setText(''); setFile(null);
    if (!session) { setKeys({}); return; }
    setKeys(readKeys(session.user.id));
    let alive = true;
    (async () => {
      try {
        await requireSession();
        const rows = unwrap(await cloud.database.from('station_spaces').select(spaceColumns).order('created_at', { ascending: false })) || [];
        if (alive) { setSpaces(rows); setSelected(rows[0]?.id || ''); }
      } catch (e) { if (alive) setError(explainError(e)); }
    })();
    return () => { alive = false; };
  }, [session?.user.id]);
  async function decodeRows(rows, space, key) {
    return Promise.all(rows.map(async row => {
      try {
        const body = await open(row.payload, key, `${space}:${row.client_id}`);
        if (typeof body.text !== 'string' || body.text.length > 4000) throw Error('消息无效');
        if (body.file && (typeof body.file.name !== 'string' || body.file.name.length > 255 || !Number.isInteger(body.file.size) || body.file.size < 1 || body.file.size > MAX_FILE || !body.file.path.startsWith(`shared/${row.owner_id}/station/${space}/`) || !/\/[a-f0-9-]{36}\.bin$/.test(body.file.path))) throw Error('附件无效');
        return { ...row, body };
      } catch { return { ...row, unreadable: true }; }
    }));
  }
  async function fetchMessages(space, key, before) {
    await requireSession();
    let query = cloud.database.from('station_messages').select('*').eq('space_id', space).order('id', { ascending: false }).limit(100);
    if (before) query = query.lt('id', before);
    const rows = unwrap(await query) || [];
    return { decoded: await decodeRows(rows.reverse(), space, key), more: rows.length === 100 };
  }
  useEffect(() => {
    const epoch = ++refreshEpoch.current;
    let running = false;
    setMessages([]); setLastSync(''); setSyncError(''); setHasOlder(false);
    if (pendingSend.current?.space !== selected) pendingSend.current = null;
    if (!session || !selected || !keys[selected]) return;
    async function poll() {
      if (running || document.hidden) return;
      running = true;
      try {
        const { decoded, more } = await fetchMessages(selected, keys[selected]);
        if (refreshEpoch.current !== epoch) return;
        setMessages(previous => {
          const map = new Map(previous.map(item => [item.id, item]));
          decoded.forEach(item => map.set(item.id, item));
          return [...map.values()].sort((a, b) => Number(a.id) - Number(b.id));
        });
        setHasOlder(previous => previous || more);
        setLastSync(new Date().toLocaleTimeString('zh-CN'));
        setSyncError('');
      } catch (e) { if (refreshEpoch.current === epoch) setSyncError(explainError(e)); }
      finally { running = false; }
    }
    poll();
    const timer = setInterval(poll, 3000);
    document.addEventListener('visibilitychange', poll);
    return () => { refreshEpoch.current++; clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [session?.user.id, selected, keys[selected]]);
  useEffect(() => { messageEnd.current?.scrollIntoView({ block: 'nearest' }); }, [messages.at(-1)?.id]);

  async function sendOtp() {
    if (!/^1\d{10}$/.test(phone)) { setError('请输入正确的 11 位手机号'); return; }
    await run('otp', async () => {
      const data = unwrap(await cloud.auth.sendOtp({ phone }));
      setChallenge({ phone, ...data }); setCountdown(60); setNotice('验证码已发送，请查收。');
    });
  }
  async function login(event) {
    event.preventDefault();
    if (!challenge || challenge.phone !== phone) { setError('请先获取当前手机号的验证码。'); return; }
    await run('login', async () => {
      const next = unwrap(await cloud.auth.verifyOtp({ phone: challenge.phone, verificationId: challenge.verificationId, isExistingUser: challenge.isExistingUser, token: otp }));
      if (!next?.user) throw Error('登录未完成');
      setSession(next); setChallenge(null); setOtp(''); setPhone('');
    });
  }
  async function wechat() {
    await run('wechat', async () => {
      if (localOrigin) { setError('微信登录需要在已发布的应用域名完成。本地预览无法接收授权回调。'); return; }
      const back = new URL(location.href); back.pathname = '/'; back.hash = '#/chat';
      for (const field of ['code', 'state', 'provider']) back.searchParams.delete(field);
      const data = unwrap(await cloud.auth.signInWithOAuth({ provider: 'wechat', redirectTo: back.toString() }));
      location.assign(data.url);
    });
  }
  async function createSpace(event) {
    event.preventDefault();
    await run('create', async () => {
      await requireSession();
      const secret = randomHex(), key = randomHex();
      const row = unwrap(await cloud.database.rpc('station_space_action', { action: 'create', title: title.trim(), invite_hash: await hashInvite(secret) }));
      saveKey(row.id, key);
      await loadSpaces(); setSelected(row.id);
      setInvitation(`${row.id}.${secret}.${key}`); setDialogMode('invite');
      setNotice('空间已创建，邀请在 24 小时后失效。请妥善保存配对邀请。');
    });
  }
  async function joinSpace(event) {
    event.preventDefault();
    await run('join', async () => {
      let pair;
      try { pair = parseInvite(pairInput); } catch { setError('邀请格式不完整，请粘贴全部内容。'); return; }
      await requireSession();
      const existing = spaces.find(row => row.id === pair.space);
      const row = existing || unwrap(await cloud.database.rpc('station_space_action', { action: 'join', space: pair.space, invite_hash: await hashInvite(pair.secret) }));
      const check = await fetchMessages(row.id, pair.key);
      if (check.decoded.some(message => message.unreadable)) { setError('邀请中的密钥无法解密这个空间，请向创建者索取正确邀请。'); return; }
      saveKey(row.id, pair.key); await loadSpaces(); setSelected(row.id);
      setPairInput(''); dialog.current.close(); setNotice('空间已连接，可以同步消息和文件。');
    });
  }
  async function generateInvitation() {
    await run('invite', async () => {
      await requireSession();
      const secret = randomHex();
      unwrap(await cloud.database.rpc('station_space_action', { action: 'invite', space: selected, invite_hash: await hashInvite(secret) }));
      setInvitation(`${selected}.${secret}.${keys[selected]}`); setDialogMode('invite'); dialog.current.showModal();
    });
  }
  function chooseFile(event) {
    const picked = event.target.files?.[0]; event.target.value = '';
    if (!picked) return;
    if (!picked.size || picked.size > MAX_FILE) { setError('请选择大于 0 且不超过 10 MB 的文件。'); return; }
    if (!FILE_TYPES.test(picked.name) || picked.name.length > 255) { setError('支持常用文档、压缩包、图片和音视频；文件名最多 255 字。'); return; }
    setFile(picked); setError('');
  }
  async function sendMessage(event) {
    event.preventDefault();
    if (!text.trim() && !file) return;
    if (!keys[selected]) { setError('请先用配对邀请恢复此设备上的空间密钥。'); return; }
    const space = selected, key = keys[space], content = text.trim(), attachment = file;
    await run('send', async () => {
      const current = await requireSession();
      let pending = pendingSend.current;
      if (!pending || pending.space !== space || pending.text !== content || pending.file !== attachment) {
        pending = { id: crypto.randomUUID(), space, text: content, file: attachment };
        pendingSend.current = pending;
      }
      if (attachment && !pending.upload) {
        if (!pending.encrypted) pending.encrypted = await encryptBytes(await attachment.arrayBuffer(), key, `${space}:${pending.id}:file`);
        const path = cloud.storage.sharedPath(current.user.id, `station/${space}/${pending.id}.bin`);
        // 重试同一条待发送附件时，复用相同密文和路径。
        unwrap(await cloud.storage.upload(path, new Blob([pending.encrypted.ciphertext], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: true }));
        pending.upload = { path, iv: pending.encrypted.iv, name: attachment.name, size: attachment.size };
      }
      const payload = await seal({ text: content, ...(pending.upload ? { file: pending.upload } : {}) }, key, `${space}:${pending.id}`);
      const inserted = await cloud.database.from('station_messages').insert({ client_id: pending.id, space_id: space, payload }).select('*');
      let row;
      if (/23505$/.test(inserted.error?.code || '')) {
        row = unwrap(await cloud.database.from('station_messages').select('*').eq('client_id', pending.id).eq('space_id', space).single());
      } else { row = unwrap(inserted)?.[0]; }
      if (!row) throw Error('消息未写入');
      const decoded = await decodeRows([row], space, key);
      setMessages(previous => [...previous.filter(item => item.id !== row.id), ...decoded].sort((a, b) => Number(a.id) - Number(b.id)));
      pendingSend.current = null; setText(''); setFile(null); setNotice('已写入云端。');
    });
  }
  async function download(message) {
    await run('download', async () => {
      await requireSession();
      const metadata = message.body.file;
      const blob = unwrap(await cloud.storage.download(metadata.path));
      const decrypted = await decryptBytes(await blob.arrayBuffer(), metadata.iv, keys[selected], `${selected}:${message.client_id}:file`);
      if (decrypted.byteLength !== metadata.size) throw Error('附件大小不一致');
      const url = URL.createObjectURL(new Blob([decrypted], { type: 'application/octet-stream' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = metadata.name.replace(/[\\/\u0000-\u001f]/g, '_'); anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice('文件已解密并开始下载。');
    });
  }
  async function refresh() {
    await run('refresh', async () => {
      await loadSpaces();
      if (selected && keys[selected]) {
        const { decoded, more } = await fetchMessages(selected, keys[selected]);
        setMessages(decoded); setHasOlder(more); setLastSync(new Date().toLocaleTimeString('zh-CN'));
      }
    });
  }
  return <div className="station-page min-h-dvh">
    <header className="station-header"><a href="./">← Personal Hub</a><span>联络站 · 随手传</span></header>
    {localOrigin && <p className="station-environment" role="note">当前为本地预览。已确认本地能请求数据库；微信授权回调需要应用正式域名，登录与跨设备收发尚待真实账号验证。</p>}
    <main className="station-workspace">
      <aside className="station-sidebar"><ChatCircle size={30} weight="light" /><h1>联络站</h1><p>留一句话，传一份文件。</p>
        <div className="station-space-list"><span>我的空间</span>{spaces.map(row => <button key={row.id} className={`station-space ${row.id === selected ? 'selected' : ''}`} disabled={!!busy} onClick={() => setSelected(row.id)}>{row.name}<small>{row.member_ids.length} 个账号 · {keys[row.id] ? '密钥就绪' : '需恢复密钥'}</small></button>)}{!spaces.length && <p>{session ? '创建或加入第一个空间' : '登录后连接你的空间'}</p>}</div>
        <button disabled={!session || !!busy} className="small-control" onClick={() => showDialog('create')}>创建空间</button>
        <button disabled={!session || !!busy} className="small-control" onClick={() => showDialog('join')}>配对设备 / 加入空间</button>
        {session && <><button className="small-control" disabled={!!busy} onClick={refresh}>刷新空间和消息</button><button className="sample-toggle" disabled={!!busy} onClick={() => run('logout', async () => { unwrap(await cloud.auth.signOut()); setSession(null); setNotice('已退出登录；此设备保留空间密钥。'); })}>退出登录</button></>}
        <p className="station-private-note">邀请含空间密钥，请通过可信渠道传递。密钥仅保存在此浏览器，清除浏览器数据前请保留邀请。空间名、成员和消息时间仍对云端可见。暂不具备密钥轮换和前向保密。</p>
      </aside>
      <section className="station-conversation" aria-label="聊天空间">
        <div className="station-conversation-heading"><h2>{active?.name || '自己的小小联络站'}</h2><span>{!ready ? '正在恢复登录…' : !session ? '尚未登录' : lastSync ? `已同步 ${lastSync}` : '等待连接'}</span>{active?.owner_id === session?.user.id && keys[selected] && <button className="small-control" disabled={!!busy} onClick={generateInvitation}>生成邀请</button>}</div>
        {!ready ? <div className="station-connection-state">正在恢复登录…</div> : !session ? <div className="station-connection-state"><ChatCircle size={42} weight="thin" /><h3>让设备在这里碰面</h3><p>登录同一账号可找回空间；使用配对邀请，把密钥带到另一台设备。</p><form className="station-login" onSubmit={login}><label htmlFor="station-phone">手机号</label><input id="station-phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={11} value={phone} onChange={e => { setPhone(e.target.value); setError(''); }} placeholder="11 位手机号" /><label htmlFor="station-otp">验证码</label><div className="station-otp"><input id="station-otp" inputMode="numeric" autoComplete="one-time-code" required value={otp} onChange={e => setOtp(e.target.value)} maxLength={10} /><button type="button" className="small-control" disabled={!!busy || countdown > 0} onClick={sendOtp}>{countdown ? `${countdown} 秒后重发` : '获取验证码'}</button></div><button className="small-control" disabled={!!busy}>{busy === 'login' ? '登录中…' : '登录 / 注册'}</button><button type="button" className="small-control" disabled={!!busy} onClick={wechat}>微信登录</button></form></div> : !active ? <div className="station-connection-state"><h3>从一个小空间开始</h3><p>创建空间，或粘贴另一台设备的配对邀请。</p></div> : !keys[selected] ? <div className="station-connection-state"><h3>这个设备还没有空间密钥</h3><p>在原设备生成邀请，再到这里粘贴，即可恢复消息和文件。</p><button className="small-control" onClick={() => showDialog('join')}>粘贴配对邀请</button></div> : <div className="station-messages" aria-label="消息记录" aria-live="polite">{hasOlder && <button className="small-control" disabled={!!busy} onClick={() => run('older', async () => { const { decoded, more } = await fetchMessages(selected, keys[selected], messages[0]?.id); setMessages(previous => [...decoded, ...previous.filter(item => !decoded.some(row => row.id === item.id))]); setHasOlder(more); })}>加载更早消息</button>}{!messages.length && <div className="station-empty-message">空间已连接。写下第一句，或传一份小文件。</div>}{messages.map(message => <article key={message.id} className={`station-message ${message.owner_id === session.user.id ? 'mine' : ''}`}><div className="station-message-meta">{message.owner_id === session.user.id ? '我' : '空间成员'} · {new Date(message.created_at).toLocaleString('zh-CN')}</div>{message.unreadable ? <p>无法解密此消息，请检查空间密钥或消息完整性。</p> : <>{message.body.text && <p>{message.body.text}</p>}{message.body.file && <button className="station-attachment" disabled={!!busy} onClick={() => download(message)}>下载 {message.body.file.name}<small>{sizeLabel(message.body.file.size)} · 解密后下载</small></button>}</>}</article>)}<div ref={messageEnd} /></div>}
        <div className="station-feedback"><p role="alert" className="form-error">{error || syncError}</p><p role="status">{notice}</p></div>
        <form className="station-compose" onSubmit={sendMessage}><label htmlFor="station-message">消息</label><textarea id="station-message" disabled={!session || !keys[selected] || !!busy} placeholder="写下想同步的内容…" rows={3} maxLength={4000} value={text} onChange={e => setText(e.target.value)} />{file && <p className="station-file-selection">{file.name} · {sizeLabel(file.size)} <button type="button" disabled={!!busy} onClick={() => setFile(null)}>移除</button></p>}<input ref={fileInput} type="file" hidden accept=".txt,.md,.csv,.json,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.7z,.png,.jpg,.jpeg,.gif,.webp,.mp3,.m4a,.mp4,.mov" onChange={chooseFile} /><div><button disabled={!session || !keys[selected] || !!busy} type="button" className="small-control" onClick={() => fileInput.current.click()}>选择文件 · ≤10 MB</button><button disabled={!session || !keys[selected] || !!busy || (!text.trim() && !file)} className="small-control">{busy === 'send' ? '正在加密并发送…' : '发送'}</button></div></form>
      </section>
    </main>
    <dialog ref={dialog} className="detail-dialog station-dialog" onCancel={() => { if (busy) return; setPairInput(''); setInvitation(''); }}><div className="dialog-inner"><div className="station-dialog-heading"><h2>{dialogMode === 'create' ? '新建一个空间' : dialogMode === 'invite' ? '带到另一台设备' : '连接你的空间'}</h2><button type="button" className="small-control" disabled={!!busy} onClick={() => { dialog.current.close(); setPairInput(''); setInvitation(''); }}>关闭</button></div>{dialogMode === 'create' ? <form className="station-modal-form" onSubmit={createSpace}><label htmlFor="space-name">空间名称</label><input id="space-name" value={title} onChange={e => setTitle(e.target.value)} required maxLength={60} /><button disabled={!!busy} className="small-control">创建空间</button></form> : dialogMode === 'invite' ? <><p>在另一台设备登录后选择“配对设备 / 加入空间”，粘贴下面的完整邀请。新成员加入邀请有效期为 24 小时；生成新邀请会使旧邀请失效。</p><textarea aria-label="完整配对邀请" className="station-invite" value={invitation} readOnly rows={5} /><button className="small-control" onClick={() => run('copy', async () => { await navigator.clipboard.writeText(invitation); setNotice('邀请已复制。'); })}>复制邀请</button><p>邀请持有者可以读取空间历史，请仅传给可信的人。同账号设备恢复密钥不受邀请有效期限制。</p></> : <form className="station-modal-form" onSubmit={joinSpace}><label htmlFor="space-invite">完整配对邀请</label><textarea id="space-invite" value={pairInput} onChange={e => setPairInput(e.target.value)} required maxLength={200} rows={5} autoComplete="off" spellCheck={false} /><button disabled={!!busy} className="small-control">连接空间</button></form>}<p role="alert" className="form-error">{error}</p><p role="status">{notice}</p></div></dialog>
  </div>;
}
