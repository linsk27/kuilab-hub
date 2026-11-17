import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash, FolderOpen, X, CaretUp } from '@phosphor-icons/react';

// 随身听：一片厚纸上的小唱片。
// 播放走原生 <audio>（移动端最稳），波形是自己按解码后的峰值画的 —— 这样颜色能跟
// 墨/纸两套主题走，也不用为了几十个柱子引入视觉库（audioMotion 是 AGPL，wavesurfer 的
// 默认样式又跟这套版式不搭）。要点：
//   · 面板收起时继续播，收起只是藏起面板，不销毁 audio
//   · 波形在解码失败（跨域音频）时自动退回一条可点的进度线，不会白屏
//   · 本地文件用 ObjectURL 播放，不占服务器；离开时统一 revoke

const VOLUME_KEY = 'hub-player-volume';
const PEAKS = 168;

function fmt(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 把解码后的波形压成 PEAKS 组 [min,max] 峰值，画图时只认这份数据
function toPeaks(audioBuffer) {
  const channel = audioBuffer.getChannelData(0);
  const block = Math.floor(channel.length / PEAKS) || 1;
  const peaks = [];
  for (let i = 0; i < PEAKS; i += 1) {
    let min = 1;
    let max = -1;
    const start = i * block;
    for (let j = 0; j < block; j += 1) {
      const v = channel[start + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks.push([min, max]);
  }
  return peaks;
}

export default function MusicPlayer() {
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const peaksRef = useRef(null);
  const progressRef = useRef(0);
  const rafRef = useRef(0);
  const dragRef = useRef(false);
  const ctxRef = useRef(null);
  const fileRef = useRef(null);
  const objectUrls = useRef([]);
  const wantPlay = useRef(false);

  const [tracks, setTracks] = useState([]);
  const [listState, setListState] = useState('loading');   // loading | ready
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(() => {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 0.7;
    const saved = Number(raw);
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.7;
  });
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  const track = tracks[index] || null;

  // 歌单：public/playlist.json，改它不用重新构建
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}playlist.json`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const list = Array.isArray(data?.tracks) ? data.tracks.filter(t => t && t.src) : [];
        if (list.length) setTracks(list);
        setListState('ready');
      })
      .catch(() => setListState('ready'));   // 没有歌单就是空的，本地文件照样能放
    return () => controller.abort();
  }, []);

  useEffect(() => () => objectUrls.current.forEach(URL.revokeObjectURL), []);

  // 悬停胶囊、打开面板时先把音频缓冲起来：点播放时不用从零等
  function prefetchAudio() {
    const audio = audioRef.current;
    if (!audio || !track || audio.readyState > 0) return;
    audio.preload = 'auto';
    audio.load();
  }

  // 点面板外面收起（点小猫、卡片都算外面）
  useEffect(() => {
    if (!open) return undefined;
    prefetchAudio();
    const onDown = event => {
      if (!event.target.closest?.('.player')) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // 音源变化：换 src；如果本来在播（或刚点了播放），等能播了接着播
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return undefined;
    audio.src = track.src;
    audio.load();
    setFailed(false);
    setTime(0);
    setDuration(0);
    peaksRef.current = null;
    progressRef.current = 0;
    draw();
    if (wantPlay.current) {
      const resume = () => audio.play().catch(() => setFailed(true));
      audio.addEventListener('canplay', resume, { once: true });
      return () => audio.removeEventListener('canplay', resume);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  // 解码一次拿峰值（同源才行；跨域失败就退回进度线）
  useEffect(() => {
    if (!track) return undefined;
    const controller = new AbortController();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return undefined;
    const ctx = new AudioCtx();
    fetch(track.src, { signal: controller.signal })
      .then(res => res.arrayBuffer())
      .then(buffer => ctx.decodeAudioData(buffer))
      .then(decoded => {
        peaksRef.current = toPeaks(decoded);
        draw();
      })
      .catch(() => { peaksRef.current = null; draw(); })
      .finally(() => ctx.close().catch(() => {}));
    return () => controller.abort();
  }, [track]);

  // 音量：写进 audio + 记住
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = muted ? 0 : volume;
      audio.muted = muted;
    }
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume, muted]);

  // 主题切换 / 尺寸变化后重画（颜色取自 CSS 变量）
  useEffect(() => {
    const redraw = () => draw();
    window.addEventListener('resize', redraw);
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      window.removeEventListener('resize', redraw);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => {
      setTime(audio.currentTime);
      if (playing) scheduleDraw();
    };
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setPlaying(false);
      if (tracks.length > 1) next();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setFailed(true);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
    };
  });

  function scheduleDraw() {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }

  // 画波形：底色一帧，播放过的部分用暖色叠一层
  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const css = getComputedStyle(document.body);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const baseColor = css.getPropertyValue('--ink-3').trim() || '#8a827a';
    const warm = css.getPropertyValue('--warm').trim() || '#b08a5e';
    const peaks = peaksRef.current;
    const mid = height / 2;
    const audio = audioRef.current;
    const ratio = audio && audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;

    if (!peaks) {
      // 没解码成功：一条细线 + 已播部分
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = baseColor;
      ctx.fillRect(0, mid - 0.75, width, 1.5);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = warm;
      ctx.fillRect(0, mid - 0.75, width * ratio, 1.5);
      ctx.globalAlpha = 1;
      return;
    }

    const gap = 1.6;
    const bar = Math.max(1, (width - gap * (peaks.length - 1)) / peaks.length);
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = baseColor;
    peaks.forEach(([min, max], i) => {
      const x = i * (bar + gap);
      const top = mid - max * (mid - 2);
      const bottom = mid - min * (mid - 2);
      ctx.fillRect(x, top, bar, Math.max(1, bottom - top));
    });

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = warm;
    const cut = width * ratio;
    peaks.forEach(([min, max], i) => {
      const x = i * (bar + gap);
      if (x > cut) return;
      const top = mid - max * (mid - 2);
      const bottom = mid - min * (mid - 2);
      ctx.fillRect(x, top, Math.min(bar, cut - x), Math.max(1, bottom - top));
    });
    ctx.globalAlpha = 1;

    // 播放头
    ctx.fillStyle = warm;
    ctx.fillRect(cut - 0.5, 0, 1, height);
  }

  function seekTo(event) {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    if (Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
    setTime(audio.currentTime);
    draw();
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) {
      wantPlay.current = true;
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => setFailed(true));
    } else {
      wantPlay.current = false;
      audio.pause();
    }
  }

  function go(nextIndex) {
    if (!tracks.length) return;
    const audio = audioRef.current;
    wantPlay.current = Boolean(audio && !audio.paused);
    setIndex(((nextIndex % tracks.length) + tracks.length) % tracks.length);
  }
  function next() { go(index + 1); }
  function prev() { go(index - 1); }

  // 本地文件：拖进来或选进来，直接排进歌单
  function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('audio/'));
    if (!files.length) return;
    const added = files.map(file => {
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      return { title: file.name.replace(/\.[^.]+$/, ''), artist: '本地文件', src: url };
    });
    const start = tracks.length;
    wantPlay.current = true;
    setTracks(list => [...list, ...added]);
    setIndex(start);
    setOpen(true);
  }

  function onDrop(event) {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }

  const hasTrack = Boolean(track);

  return (
    <div className={`player ${open ? 'is-open' : ''} ${playing ? 'is-playing' : ''}`}>
      {open && (
        <section className="player-panel" aria-label="随身听">
          <header className="player-head">
            <div className="player-title">
              <strong>{hasTrack ? track.title : listState === 'loading' ? '正在准备' : '还没有歌'}</strong>
              <em>{hasTrack
                ? (failed ? '放不了这首，换一首试试' : track.artist)
                : listState === 'loading' ? '正在取歌单…' : '把歌拖进来，或写进 playlist.json'}</em>
            </div>
            <button type="button" className="player-icon" onClick={() => setOpen(false)} aria-label="收起播放器">
              <X size={15} weight="light" />
            </button>
          </header>

          <div className="player-wave-wrap">
            <canvas
              ref={canvasRef}
              className="player-wave"
              role="slider"
              tabIndex={0}
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(time)}
              onPointerDown={event => { dragRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); seekTo(event); }}
              onPointerMove={event => { if (dragRef.current) seekTo(event); }}
              onPointerUp={() => { dragRef.current = false; }}
              onPointerCancel={() => { dragRef.current = false; }}
              onKeyDown={event => {
                const audio = audioRef.current;
                if (!audio) return;
                if (event.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); setTime(audio.currentTime); draw(); }
                if (event.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); setTime(audio.currentTime); draw(); }
              }}
            />
          </div>

          <div className="player-time">
            <span>{fmt(time)}</span>
            <span>{fmt(duration)}</span>
          </div>

          <div className="player-controls">
            <button type="button" className="player-icon" onClick={prev} disabled={tracks.length < 2} aria-label="上一首">
              <SkipBack size={17} weight="fill" />
            </button>
            <button type="button" className="player-play" onClick={toggle} disabled={!hasTrack} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
            </button>
            <button type="button" className="player-icon" onClick={next} disabled={tracks.length < 2} aria-label="下一首">
              <SkipForward size={17} weight="fill" />
            </button>
            <div className="player-vol">
              <button type="button" className="player-icon" onClick={() => setMuted(m => !m)} aria-label={muted ? '取消静音' : '静音'}>
                {muted || volume === 0 ? <SpeakerSlash size={16} weight="light" /> : <SpeakerHigh size={16} weight="light" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={muted ? 0 : volume}
                onChange={event => { setMuted(false); setVolume(Number(event.target.value)); }}
                aria-label="音量"
              />
            </div>
          </div>

          <footer className="player-foot">
            <button type="button" className="player-add" onClick={() => fileRef.current?.click()}>
              <FolderOpen size={15} weight="light" />
              本地文件
            </button>
            <span className="player-count">
              {tracks.length ? `${index + 1} / ${tracks.length}` : '0'}
            </span>
          </footer>
        </section>
      )}

      <button
        type="button"
        className="player-pill"
        onClick={() => { setOpen(o => !o); prefetchAudio(); }}
        onPointerEnter={prefetchAudio}
        onDragOver={event => event.preventDefault()}
        onDrop={onDrop}
        aria-expanded={open}
        aria-label={open ? '收起随身听' : '打开随身听'}
      >
        <span className="player-disc" aria-hidden="true">
          <span className="player-disc-label" />
        </span>
        <span className="player-meta">
          <strong>{hasTrack ? track.title : '随身听'}</strong>
          <em>{playing ? '正在播放' : hasTrack ? '点开听一段' : listState === 'loading' ? '正在准备…' : '拖首歌进来'}</em>
        </span>
        <span className="player-bars" aria-hidden="true"><i /><i /><i /></span>
        <CaretUp size={13} weight="bold" className="player-waveicon" aria-hidden="true" />
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={event => { addFiles(event.target.files); event.target.value = ''; }}
      />
      <audio ref={audioRef} preload="metadata" />
    </div>
  );
}
