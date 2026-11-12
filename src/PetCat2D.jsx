import React, { useEffect, useRef, useState } from 'react';

// 2D 版小猫：直接用 IP 的高精度渲染图，靠 CSS/JS 做呼吸、跳、拖拽倾斜。
// 相比程序化 3D，同一个挂件尺寸下这就是“原图级”的质感，代价是没有 360° 自由旋转。
export default function PetCat2D({ onPet, petSignal = 0, onUnavailable }) {
  const hostRef = useRef(null);
  const tiltRef = useRef(null);
  const imgRef = useRef(null);
  const shadowRef = useRef(null);
  const seenSignal = useRef(petSignal);
  const [blink, setBlink] = useState(false);

  // 拖拽状态 + 弹簧回正
  useEffect(() => {
    const host = hostRef.current;
    const tilt = tiltRef.current;
    if (!host || !tilt) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return undefined;

    const state = { dragging: false, lastX: 0, lastY: 0, moved: 0, targetY: 0, targetX: 0, y: 0, x: 0, vy: 0, vx: 0 };
    let raf = 0;
    let prev = performance.now();

    const tick = now => {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      // 弹簧：刚度 120、阻尼 14，手感跟手又不抖
      const k = 120;
      const c = 14;
      state.vy += ((state.targetY - state.y) * k - state.vy * c) * dt;
      state.vx += ((state.targetX - state.x) * k - state.vx * c) * dt;
      state.y += state.vy * dt;
      state.x += state.vx * dt;
      tilt.style.transform = `perspective(620px) rotateY(${state.y.toFixed(2)}deg) rotateX(${state.x.toFixed(2)}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    function down(event) {
      state.dragging = true;
      state.moved = 0;
      state.lastX = event.clientX;
      state.lastY = event.clientY;
      try { host.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
    }
    function move(event) {
      if (!state.dragging) return;
      const dx = event.clientX - state.lastX;
      const dy = event.clientY - state.lastY;
      state.moved += Math.abs(dx) + Math.abs(dy);
      state.targetY = Math.max(-34, Math.min(34, state.targetY + dx * 0.42));
      state.targetX = Math.max(-18, Math.min(18, state.targetX - dy * 0.28));
      state.lastX = event.clientX;
      state.lastY = event.clientY;
    }
    function up() {
      if (!state.dragging) return;
      state.dragging = false;
      if (state.moved < 6) {
        onPet?.({ detail: 1 });
      }
      state.targetY = 0;
      state.targetX = 0;
    }

    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
    };
  }, [onPet]);

  // 随机眨眼：3.4~7 秒一次，闭眼 120ms
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let alive = true;
    let off = 0;
    let on = 0;
    const schedule = () => {
      off = window.setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        on = window.setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          schedule();
        }, 120);
      }, 3400 + Math.random() * 3600);
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(off);
      window.clearTimeout(on);
    };
  }, []);

  // 被摸时跳一下：先蓄力压扁，再起跳，落地回弹；影子跟着缩小
  useEffect(() => {
    if (petSignal === seenSignal.current) return;
    seenSignal.current = petSignal;
    const img = imgRef.current;
    const shadow = shadowRef.current;
    if (!img || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    img.animate([
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(2px) scale(1.05, 0.93)', offset: 0.14 },
      { transform: 'translateY(-15px) scale(0.97, 1.05)', offset: 0.42 },
      { transform: 'translateY(0) scale(1.03, 0.96)', offset: 0.72 },
      { transform: 'translateY(0) scale(1, 1)' },
    ], { duration: 620, easing: 'cubic-bezier(.3,.9,.4,1)' });
    shadow?.animate([
      { transform: 'scale(1, 1)', opacity: 0.5 },
      { transform: 'scale(0.82, 0.8)', opacity: 0.3, offset: 0.42 },
      { transform: 'scale(1, 1)', opacity: 0.5 },
    ], { duration: 620, easing: 'ease-out' });
  }, [petSignal]);

  return (
    <div className="pet-2d" ref={hostRef} role="button" tabIndex={0}
      aria-label="摸摸小猫" title="摸摸我"
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPet?.({ detail: 1 }); } }}
      onError={() => onUnavailable?.()}>
      <span className="pet-2d-shadow" ref={shadowRef} aria-hidden="true" />
      <span className="pet-2d-tilt" ref={tiltRef}>
        <span className="pet-2d-breathe">
          <img
            ref={imgRef}
            className="pet-2d-img"
            src="/cat/small-cat.webp"
            alt=""
            draggable="false"
            width="456"
            height="496"
          />
          <img
            className={`pet-2d-img pet-2d-blink ${blink ? 'on' : ''}`}
            src="/cat/small-cat-blink.webp"
            alt=""
            aria-hidden="true"
            draggable="false"
            width="456"
            height="496"
          />
        </span>
      </span>
    </div>
  );
}
