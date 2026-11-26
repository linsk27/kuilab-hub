import React, { useEffect, useRef, useState } from 'react';
import { getRole, setRole, useRole } from './role';

// 猫头顶那张问话的小卡片。进首页 1.4 秒后出现，只问一次：
//   「欢迎回来，你是 Linda 吗？」
// 是 → 有口令就直接过（老用户），没有才让他说一句；
// 不是 → 记成访客，卡片收起，之后就按访客的样子给页面。
//
// 它不验证真伪：任何 6 位以上的话都能"进来"。真正的锁在待办那条线上，
// 口令不对只是打不开旧记录 —— 卡片上也这么写了。

const PASS_KEY = 'hub-work-pass';

export default function RoleAsk() {
  const role = useRole();
  const [step, setStep] = useState('idle');   // idle | ask | pass | done
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (role) { setStep('done'); return undefined; }
    // role 被清空（点了状态条的身份）→ 1.4 秒后重新问
    // 换身份时 step 还停在 'done'，这里要能回到 'ask'；
    // 只有正在输口令（'pass'）时不打断
    const timer = window.setTimeout(() => {
      setStep(current => (current === 'pass' ? current : 'ask'));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [role]);

  useEffect(() => {
    if (step === 'pass') inputRef.current?.focus();
  }, [step]);

  function yes() {
    let saved = '';
    try { saved = window.localStorage.getItem(PASS_KEY) || ''; } catch { saved = ''; }
    if (saved.length >= 6) {
      setRole('host');
      window.dispatchEvent(new CustomEvent('hub:toast', { detail: '欢迎回来，Linda' }));
      setStep('done');
      return;
    }
    setStep('pass');
  }

  function no() {
    setRole('guest');
    window.dispatchEvent(new CustomEvent('hub:toast', { detail: '那就随便逛逛吧' }));
    setStep('done');
  }

  async function submit(event) {
    event.preventDefault();
    const value = pass.trim();
    if (value.length < 6) { setError('至少要 6 个字符'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/work', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', payload: { pass: value } }),
        cache: 'no-store',
        signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(String(data?.error || res.status));
      try { window.localStorage.setItem(PASS_KEY, value); } catch { /* 存不了就本次有效 */ }
      setRole('host');
      window.dispatchEvent(new CustomEvent('hub:toast', {
        detail: data.items?.length ? `欢迎回来，${data.items.length} 条待办在等你` : '欢迎回来',
      }));
      setStep('done');
    } catch {
      setError('连不上云端，等网络稳一点再试');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'idle' || step === 'done') return null;

  return (
    <div className="role-ask" role="dialog" aria-label="确认身份" aria-live="polite">
      <span className="role-ask-tail" aria-hidden="true" />
      {step === 'ask' ? (
        <>
          <p className="role-ask-text">欢迎回来，你是 Linda 吗？</p>
          <div className="role-ask-actions">
            <button type="button" className="role-yes" onClick={yes}>是我</button>
            <button type="button" className="role-no" onClick={no}>不是</button>
          </div>
        </>
      ) : (
        <form className="role-ask-form" onSubmit={submit}>
          <p className="role-ask-text">那说一句只有你知道的话</p>
          <div className="role-ask-row">
            <input
              ref={inputRef}
              type="password"
              value={pass}
              onChange={event => { setPass(event.target.value); setError(''); }}
              placeholder="至少 6 个字符"
              autoComplete="current-password"
              aria-label="口令"
            />
            <button type="submit" className="role-go" disabled={busy}>{busy ? '…' : '进入'}</button>
          </div>
          {error && <p className="role-ask-error" role="alert">{error}</p>}
          <p className="role-ask-note">这句就是你的空间名：同一句进同一份清单，换一句就是换一个空空间。说错了只是打不开旧记录。</p>
          <button type="button" className="role-ask-back" onClick={() => { setStep('ask'); setError(''); }}>返回</button>
        </form>
      )}
    </div>
  );
}
