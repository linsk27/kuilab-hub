import React, { useEffect, useRef, useState } from 'react';

// 2D 分层小猫：头、身体、两层投影各自独立。
// 伪 3D 不是靠贴图，是靠三层之间的**差速**做出来的：
//   1) 转动时头比身体多探出一点（视差），剪影就从一张纸变成前后两层；
//   2) 地面投影随转动收窄、随起跳缩小变淡，高度就能被读出来；
//   3) 头层自带一层柔影压在身体上，交界处有厚度而不是一张平贴。
//
// 动作：待机呼吸、随机歪头/抬头/抖毛、眨眼、悬停抬头、单击起跳、长按呼噜、拖拽倾斜。

const IDLE_ACTIONS = ['tilt', 'perk', 'shake', 'wave'];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default function PetCat2D({ onPet, petSignal = 0 }) {
  const hostRef = useRef(null);
  const stageRef = useRef(null);
  const bodyRef = useRef(null);
  const headRef = useRef(null);
  const castRef = useRef(null);
  const contactRef = useRef(null);
  const wrapRef = useRef(null);
  const stateRef = useRef(null);
  const onPetRef = useRef(onPet);
  onPetRef.current = onPet;

  const seenSignal = useRef(petSignal);
  const [blink, setBlink] = useState(false);
  const [act, setAct] = useState('');
  const [purring, setPurring] = useState(false);
  const [ready, setReady] = useState(false);

  // 雪碧图是背景图，没有 onLoad 可等，这里主动探一次再淡入
  useEffect(() => {
    const probe = new Image();
    probe.onload = () => setReady(true);
    probe.onerror = () => setReady(true);
    probe.src = '/cat/cat-sprite.webp';
    if (probe.complete) setReady(true);
  }, []);

  // ---- 主循环：拖拽倾斜 + 视线跟随 + 投影联动 ----
  useEffect(() => {
    const host = hostRef.current;
    const stage = stageRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    const cast = castRef.current;
    const contact = contactRef.current;
    if (!host || !stage) return undefined;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = {
      dragging: false, moved: 0, lastX: 0, lastY: 0, lastT: 0,
      ty: 0, tx: 0, y: 0, x: 0, vy: 0, vx: 0,
      gx: 0, gy: 0, gtx: 0, gty: 0,
      hover: 0, hoverT: 0,
      lift: 0,
    };
    stateRef.current = s;
    if (reduce) return () => { stateRef.current = null; };

    let raf = 0;
    let prev = performance.now();
    let pressTimer = 0;

    const tick = now => {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;

      // 弹簧：转动轴跟随指针，松手回正
      const K = 130;
      const C = 15;
      s.vy += ((s.ty - s.y) * K - s.vy * C) * dt;
      s.vx += ((s.tx - s.x) * K - s.vx * C) * dt;
      s.y += s.vy * dt;
      s.x += s.vx * dt;

      s.gx = lerp(s.gx, s.gtx, 0.11);
      s.gy = lerp(s.gy, s.gty, 0.11);
      s.hover = lerp(s.hover, s.hoverT, 0.1);
      s.lift = Math.max(0, s.lift - dt * 3.4);

      const rotY = s.y;
      const rotX = s.x;
      const normY = rotY / 26;
      const cosY = Math.cos((rotY * Math.PI) / 180);
      const lift = s.lift;

      // 侧移一点点：读起来像猫在转台上被转过去，而不只是被横向压扁
      stage.style.transform = `perspective(620px) translateX(${(rotY * 0.14).toFixed(2)}px) rotateY(${rotY.toFixed(2)}deg) rotateX(${rotX.toFixed(2)}deg)`;

      // 头层的位移必须压在 2px 以内：脖子那条切口一旦错开，就会露出重叠区的浅色断面。
      // 前后关系不靠平移，靠「透视补偿」——身体被 rotateY 压窄，头却按 cos 反补回一部分宽度，
      // 于是头显得比身体更靠近观察者；再叠一点微旋转，读起来就是头在动。
      const headScaleX = 1 + (1 - cosY) * 0.3;
      const hx = rotY * 0.042 + s.gx * 0.55;
      const hy = -rotX * 0.05 + s.gy * 0.45 - s.hover * 0.9;
      head.style.transform = `translate3d(${hx.toFixed(2)}px, ${hy.toFixed(2)}px, 0) rotate(${(rotY * 0.052).toFixed(2)}deg) scaleX(${headScaleX.toFixed(3)})`;
      // 身体只跟视线一点点（转动已经由 stage 统一做了）
      body.style.transform = `translate3d(${(s.gx * 0.18).toFixed(2)}px, ${(s.gy * 0.16).toFixed(2)}px, 0)`;

      // 投影：转动时收窄并往反方向轻移，起跳/悬停时缩小变淡
      const castScaleX = cosY * (1 - s.hover * 0.05 - lift * 0.22);
      const castScaleY = (1 - Math.abs(rotX) * 0.004) * (1 - lift * 0.18);
      cast.style.transform = `translateX(${(-rotY * 0.17).toFixed(2)}px) scale(${castScaleX.toFixed(3)}, ${castScaleY.toFixed(3)})`;
      cast.style.opacity = (0.95 - Math.abs(normY) * 0.12 - s.hover * 0.1 - lift * 0.42).toFixed(3);

      // 接触影更实：跟着身体压地，转动时略微收窄，但不像软影那样飘
      contact.style.transform = `translateX(${(-rotY * 0.07).toFixed(2)}px) scale(${(1 - Math.abs(normY) * 0.04 - lift * 0.3).toFixed(3)}, ${(1 - lift * 0.24).toFixed(3)})`;
      contact.style.opacity = (1 - lift * 0.55).toFixed(3);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    function down(event) {
      if (event.button !== undefined && event.button > 0) return;
      s.dragging = true;
      s.moved = 0;
      s.lastX = event.clientX;
      s.lastY = event.clientY;
      s.lastT = performance.now();
      window.clearTimeout(pressTimer);
      // 按住不动 = 摸它，会眯眼打呼
      pressTimer = window.setTimeout(() => {
        if (s.moved < 12) {
          setPurring(true);
          onPetRef.current?.();
        }
      }, 640);
      try { host.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
    }

    function move(event) {
      if (!s.dragging) return;
      const dx = event.clientX - s.lastX;
      const dy = event.clientY - s.lastY;
      s.moved += Math.abs(dx) + Math.abs(dy);
      if (s.moved > 12) window.clearTimeout(pressTimer);
      s.ty = Math.max(-26, Math.min(26, s.ty + dx * 0.4));
      s.tx = Math.max(-16, Math.min(16, s.tx - dy * 0.26));
      s.lastX = event.clientX;
      s.lastY = event.clientY;
    }

    function release() {
      if (!s.dragging) return;
      s.dragging = false;
      window.clearTimeout(pressTimer);
      setPurring(false);
      if (s.moved < 6) {
        s.lift = 1;
        onPetRef.current?.();
      }
      s.ty = 0;
      s.tx = 0;
    }

    // 视线跟随：头会跟着指针轻微偏移，像真的在看你
    let gazeRaf = 0;
    let lastPointer = null;
    function look(event) {
      lastPointer = event;
      if (gazeRaf) return;
      gazeRaf = requestAnimationFrame(() => {
        gazeRaf = 0;
        const p = lastPointer;
        if (!p) return;
        const box = host.getBoundingClientRect();
        const cx = box.left + box.width * 0.5;
        const cy = box.top + box.height * 0.62;
        s.gtx = Math.max(-1, Math.min(1, (p.clientX - cx) / 170)) * 3.4;
        s.gty = Math.max(-1, Math.min(1, (p.clientY - cy) / 170)) * 2.4;
      });
    }
    function enter() { s.hoverT = 1; }
    function leave() { s.hoverT = 0; s.gtx = 0; s.gty = 0; }

    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', release);
    host.addEventListener('pointercancel', release);
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    window.addEventListener('pointermove', look, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      if (gazeRaf) cancelAnimationFrame(gazeRaf);
      window.clearTimeout(pressTimer);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', release);
      host.removeEventListener('pointercancel', release);
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
      window.removeEventListener('pointermove', look);
      stateRef.current = null;
    };
  }, []);

  // ---- 随机眨眼：3.2~7 秒一次 ----
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
        }, 90);
      }, 3200 + Math.random() * 3800);
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(off);
      window.clearTimeout(on);
    };
  }, []);

  // ---- 待机小动作：6~11 秒随机歪头、抬头或抖一下 ----
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let alive = true;
    let off = 0;
    let back = 0;
    const schedule = () => {
      off = window.setTimeout(() => {
        if (!alive) return;
        setAct(IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)]);
        back = window.setTimeout(() => {
          if (!alive) return;
          setAct('');
          schedule();
        }, 1700);
      }, 6000 + Math.random() * 5000);
    };
    schedule();
    return () => {
      alive = false;
      window.clearTimeout(off);
      window.clearTimeout(back);
    };
  }, []);

  // ---- 被摸时跳一下：蓄力压扁 → 起跳 → 落地回弹 ----
  useEffect(() => {
    if (petSignal === seenSignal.current) return;
    seenSignal.current = petSignal;
    // 每摸三次，它先抬手挥两下
    if (petSignal > 0 && petSignal % 3 === 0) {
      setAct('wave');
      window.setTimeout(() => setAct(current => (current === 'wave' ? '' : current)), 1500);
    }
    const wrap = wrapRef.current;
    if (!wrap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    wrap.getAnimations().forEach(animation => animation.cancel());
    wrap.animate([
      { transform: 'translateY(0) scale(1, 1)' },
      { transform: 'translateY(2px) scale(1.06, 0.93)', offset: 0.13 },
      { transform: 'translateY(-16px) scale(0.96, 1.06)', offset: 0.4 },
      { transform: 'translateY(0) scale(1.045, 0.955)', offset: 0.66 },
      { transform: 'translateY(-3px) scale(0.99, 1.01)', offset: 0.84 },
      { transform: 'translateY(0) scale(1, 1)' },
    ], { duration: 660, easing: 'cubic-bezier(.32,.9,.36,1)' });
  }, [petSignal]);

  const blinking = blink || purring;

  return (
    <div
      className={`pet-2d ${purring ? 'is-purring' : ''} ${ready ? 'is-ready' : ''}`}
      ref={hostRef}
      role="button"
      tabIndex={0}
      aria-label="摸摸小猫：单击会跳，按住会打呼，拖动可以转动"
      title="摸摸我"
      data-act={act || undefined}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (stateRef.current) stateRef.current.lift = 1;
          onPetRef.current?.();
        }
      }}
    >
      <span className="pet-2d-cast" ref={castRef} aria-hidden="true" />
      <span className="pet-2d-contact" ref={contactRef} aria-hidden="true" />

      <span className="pet-2d-stage-wrap" ref={wrapRef}>
        <span className="pet-2d-stage" ref={stageRef}>
          <span className="pet-2d-breathe">
            <span className="pet-2d-sway">
            <span className="pet-2d-layer pet-2d-body" ref={bodyRef}>
              <span className="pet-2d-sprite pet-2d-sprite-body" />
            </span>

            <span className="pet-2d-layer pet-2d-arm" aria-hidden="true">
              <span className="pet-2d-arm-img" />
            </span>

            <span className="pet-2d-layer pet-2d-head" ref={headRef}>
              <span className="pet-2d-head-motion">
                {/* 头压在身上的落影：既是接触阴影，也顺便兜住歪头时颈部可能露出的缝 */}
                <span className="pet-2d-sprite pet-2d-sprite-shadow" aria-hidden="true" />
                <span className="pet-2d-sprite pet-2d-sprite-head" />
                <span
                  className={`pet-2d-sprite pet-2d-sprite-blink ${blinking ? 'on' : ''}`}
                  aria-hidden="true"
                />
              </span>
            </span>
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}
