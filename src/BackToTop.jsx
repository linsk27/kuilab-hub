import React, { useEffect, useState } from 'react';
import { ArrowUp } from '@phosphor-icons/react';

// 长纸回到顶。#/archive 在手机上有 4300px、#/uses 2600px，
// 滑到底之后只能一路往回滑 —— 这里给一枚盖在右下角的圆章。
// 只滚过一屏才出现，平时不占纸面。
//
// 首页不挂：那张纸的右下角本来就坐着猫（手机上猫和播放器都在纸底），
// 圆章会直接压在猫身上，两个都点不动。首页也不过一屏多的长度。

const THRESHOLD = 640;
const HOME_HASHES = ['', '#/', '#/manage'];

export default function BackToTop() {
  const [scrolled, setScrolled] = useState(false);
  const [onHome, setOnHome] = useState(() => HOME_HASHES.includes(window.location.hash));

  useEffect(() => {
    let frame = 0;
    const read = () => { frame = 0; setScrolled(window.scrollY > THRESHOLD); };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    const onHash = () => {
      setOnHome(HOME_HASHES.includes(window.location.hash));
      read();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onHash);
    read();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onHash);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const shown = scrolled && !onHome;

  return (
    <button
      type="button"
      className={`back-top${shown ? ' is-shown' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      tabIndex={shown ? 0 : -1}
      aria-hidden={shown ? undefined : true}
      aria-label="回到顶部"
    >
      <ArrowUp size={15} weight="bold" aria-hidden="true" />
      <span>顶</span>
    </button>
  );
}
