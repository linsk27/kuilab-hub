import React, { useEffect, useRef } from 'react';

// 猫爪拖尾：光标走过的地方留几枚慢慢淡掉的爪印。
// 只用一块 canvas，一个 rAF 循环；没有爪印时循环立刻停，静止页面零开销。
// 只在有精确指针的设备上跑（触屏没有"光标走过"这回事），减弱动效时整体关掉。

const LIFE = 900;     // 一枚爪印活多久（ms）
const GAP = 96;       // 走多远盖一枚：太密会糊成一条地毯，96px 刚好能一眼看出是"走过"
const MAX = 8;        // 同时最多几枚（按最坏情况：极快的鼠标）

function warmRGB() {
  try {
    const raw = getComputedStyle(document.body).getPropertyValue('--warm').trim();
    const hex = raw.replace('#', '');
    if (hex.length === 3) {
      return [0, 1, 2].map(i => parseInt(hex[i] + hex[i], 16));
    }
    if (hex.length === 6) {
      return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    }
  } catch { /* 读不到就用默认色 */ }
  return [200, 160, 115];
}

export default function PawTrail() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let dpr = 1;
    let color = warmRGB();
    // 墨底上同一个透明度看起来更淡，所以暗色给得足一点
    let strength = 0.58;
    let raf = 0;
    let last = null;
    const paws = [];

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // 一枚爪印 = 一块掌垫 + 四个脚趾，画一次存成 Path2D，之后只做变换。
    // 坐标是量出来的：脚趾之间留 1 个单位以上的缝（≈1px），小于这个宽度抗锯齿会把缝糊上，
    // 24px 以下就退化成"一串泡泡"。所以下面的 scale 保持在 1.1 以上。
    const paw = new Path2D();
    paw.ellipse(0, 5, 6.4, 4.7, 0, 0, Math.PI * 2);
    [[-8.1, -2.6, 2.35], [-2.9, -5.1, 2.4], [2.9, -5.1, 2.4], [8.1, -2.6, 2.35]].forEach(([x, y, r]) => {
      paw.ellipse(x, y, r, r * 1.12, x * 0.02, 0, Math.PI * 2);
    });

    function frame(now) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = false;
      for (let i = paws.length - 1; i >= 0; i -= 1) {
        const p = paws[i];
        const t = (now - p.at) / LIFE;
        if (t >= 1) { paws.splice(i, 1); continue; }
        alive = true;
        const fade = 1 - t;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.scale(p.s * (1 - 0.12 * t), p.s * (1 - 0.12 * t));
        ctx.globalAlpha = fade * fade * strength;   // 平方：淡出得更"快一点"，尾巴不拖泥带水
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.fill(paw);
        ctx.restore();
      }
      raf = alive ? requestAnimationFrame(frame) : 0;
      if (!alive) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }

    function move(event) {
      if (event.buttons !== 0) return;          // 拖着选择文字/拖猫的时候不留印
      const { clientX: x, clientY: y } = event;
      if (!last) { last = { x, y }; return; }
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      if (dist < GAP) return;
      last = { x, y };
      paws.push({
        x, y,
        // 爪尖朝行进方向，再加一点随机：完全对齐会像印刷的脚印
        a: Math.atan2(dy, dx) + Math.PI / 2 + (Math.random() - 0.5) * 0.18,
        s: 1.12 + Math.random() * 0.16,
        at: performance.now(),
      });
      if (paws.length > MAX) paws.shift();
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function leave() { last = null; }

    // 换主题时暖色和透明度都要重取一次；这个属性很少变，开销可忽略
    const readTheme = () => {
      color = warmRGB();
      strength = document.documentElement.dataset.theme === 'light' ? 0.54 : 0.68;
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerleave', leave, { passive: true });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerleave', leave);
    };
  }, []);

  return <canvas className="paw-trail" ref={ref} aria-hidden="true" />;
}
