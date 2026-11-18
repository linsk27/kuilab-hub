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

// WebM/Opus：同样的音质只有 MP3 的一半多点，而且 Chrome 不像 Ogg 那样去读文件尾
const WEBM_OK = (() => {
  try {
    return new Audio().canPlayType('audio/webm; codecs="opus"') !== '';
  } catch {
    return false;
  }
})();

// 歌单里每首都带一份 base64 的柱子振幅（build_playlist.py 生成），
// 这样画波形只要几十字节，不必把整首下载下来解码
function decodePeaks(base64) {
  try {
    const bin = atob(base64);
    const out = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i) / 255;
    return out.length ? out : null;
  } catch {
    return null;
  }
}


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
  const barsRef = useRef(null);   // 歌单里预先算好的柱子（0~1）
  const prefetchedRef = useRef('');   // 已经为哪个源发过预取
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
  const [buffering, setBuffering] = useState(false);   // 点了播放但还没声音（慢网时给个交代）
  // 用户还没表示要听（没悬停、没展开、没点播放）之前，audio 连 src 都不设：
  // 这样「提前取」只有一次请求，不会先拉元数据再掐掉重来
  const [armed, setArmed] = useState(false);

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

  // 命令面板（⌘K）遥控：hub:player 事件带 'toggle' | 'next' | 'prev'
  useEffect(() => {
    const onCmd = event => {
      const what = event.detail;
      if (what === 'toggle') toggle();
      else if (what === 'next') go(index + 1);
      else if (what === 'prev') go(index - 1);
    };
    window.addEventListener('hub:player', onCmd);
    return () => window.removeEventListener('hub:player', onCmd);
  });

  // 悬停胶囊、打开面板时把「只取元数据」升级成「提前缓冲」。
  // 注意只改 preload，不再调 load()：load() 会掐掉正在进行的请求重新拉一遍，
  // 慢网下等于白扔几十上百 KB（实测会多出一个重复的 bytes=0- 请求）
  function prefetchAudio() {
    if (!track) return;
    setArmed(true);
  }

  // 展开面板时补画一次：面板闭合期间 canvas 还没挂上，之前那次 draw() 是空跑的
  useEffect(() => {
    if (!open) return undefined;
    const raf = requestAnimationFrame(() => draw());
    const canvas = canvasRef.current;
    const ro = canvas && 'ResizeObserver' in window ? new ResizeObserver(() => draw()) : null;
    if (canvas && ro) ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  // 音源：能放 WebM 就用 WebM（Opus 64k，体积约为 MP3 的 40%），Safari 之类退回 MP3
  const src = !track ? '' : (WEBM_OK && track.webm ? track.webm : track.src);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track || !armed) return undefined;
    audio.preload = 'auto';
    audio.src = src;
    audio.load();
    setFailed(false);
    setBuffering(false);
    setTime(0);
    setDuration(0);
    peaksRef.current = null;
    barsRef.current = track.peaks ? decodePeaks(track.peaks) : null;
    prefetchedRef.current = '';
    progressRef.current = 0;
    draw();
    if (wantPlay.current) {
      const resume = () => audio.play().catch(() => setFailed(true));
      audio.addEventListener('canplay', resume, { once: true });
      return () => audio.removeEventListener('canplay', resume);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, armed]);

  // 解码一次拿峰值（同源才行；跨域失败就退回进度线）
  // 两个前提，都是为了不跟「真正要听的声音」抢带宽：
  //   · 面板打开之后才解码 —— 收起状态没人看波形，没必要为它下一整首
  //   · 等音频能播了（canplay）再解码 —— 一首歌三四 MB，先让声音出来，波形随后补
  useEffect(() => {
    if (!track || !open || barsRef.current) return undefined;   // 有预计算的柱子就不解码
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return undefined;
    const audio = audioRef.current;
    const controller = new AbortController();
    let ctx = null;
    let timer = 0;

    const decode = () => {
      if (controller.signal.aborted) return;
      ctx = new AudioCtx();
      fetch(src, { signal: controller.signal })
        .then(res => res.arrayBuffer())
        .then(buffer => ctx.decodeAudioData(buffer))
        .then(decoded => {
          peaksRef.current = toPeaks(decoded);
          draw();
        })
        .catch(() => { peaksRef.current = null; draw(); })
        .finally(() => ctx && ctx.close().catch(() => {}));
    };

    if (!audio || audio.readyState >= 3) decode();
    else {
      audio.addEventListener('canplay', decode, { once: true });
      timer = window.setTimeout(decode, 7000);   // 用户一直没点播放，也别让波形永远空着
    }

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      audio?.removeEventListener('canplay', decode);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, open]);

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
      if (tracks.length > 1) go(index + 1, true);   // 自动接下一首，别停在这儿
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => { setFailed(true); setBuffering(false); };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => { setBuffering(false); setPlaying(true); };
    const onCanPlay = () => setBuffering(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
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
    const bars = barsRef.current;
    const mid = height / 2;
    const audio = audioRef.current;
    const ratio = audio && audio.duration ? Math.min(1, audio.currentTime / audio.duration) : 0;

    if (bars) {
      const gap = 1.6;
      const bar = Math.max(1, (width - gap * (bars.length - 1)) / bars.length);
      const cut = width * ratio;
      const span = mid - 2;
      for (let i = 0; i < bars.length; i += 1) {
        const x = i * (bar + gap);
        const h = Math.max(1, bars[i] * span * 2);
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = baseColor;
        ctx.fillRect(x, mid - h / 2, bar, h);
        if (x <= cut) {
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = warm;
          ctx.fillRect(x, mid - h / 2, Math.min(bar, cut - x), h);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = warm;
      ctx.fillRect(cut - 0.5, 0, 1, height);
      return;
    }

    if (!peaks) {
      // 没解码成功：一条细线 + 已播部分
      ctx.globalAlpha = 0.5;
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
      if (!armed) { setArmed(true); return; }   // 还没取过音频：交给换源 effect 加载并自动播放
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(() => setFailed(true));
    } else {
      wantPlay.current = false;
      audio.pause();
    }
  }

  // forcePlay：播完自动接下一首时必须传 true —— 那一刻 audio.paused 已经是 true，
  // 用「原本在播吗」来判断会得出 false，歌就停在下一首的 0:00 不动
  function go(nextIndex, forcePlay) {
    if (!tracks.length) return;
    const audio = audioRef.current;
    wantPlay.current = forcePlay === true ? true : Boolean(audio && !audio.paused);
    setIndex(((nextIndex % tracks.length) + tracks.length) % tracks.length);
  }
  function selectTrack(i) {
    if (i === index) { toggle(); return; }
    wantPlay.current = true;
    setArmed(true);
    setIndex(i);
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
                ? (failed ? '放不了这首，换一首试试' : buffering ? '正在缓冲…' : track.artist)
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
            <span>{duration > 0 ? fmt(duration) : track?.duration ? fmt(track.duration) : '--:--'}</span>
          </div>

          <div className="player-controls">
            <button type="button" className="player-icon" onClick={prev} disabled={tracks.length < 2} aria-label="上一首">
              <SkipBack size={17} weight="fill" />
            </button>
            <button
              type="button"
              className={`player-play ${buffering ? 'is-buffering' : ''}`}
              onClick={toggle}
              disabled={!hasTrack}
              aria-label={playing ? '暂停' : '播放'}
            >
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

          {/* 曲目列表：有歌单时直接挑，不用一直按下一首 */}
          {tracks.length > 1 && (
            <ol className="player-list" aria-label="曲目">
              {tracks.map((item, i) => (
                <li key={`${item.src}-${i}`}>
                  <button
                    type="button"
                    className={`player-track ${i === index ? 'is-current' : ''}`}
                    onClick={() => selectTrack(i)}
                    aria-current={i === index ? 'true' : undefined}
                  >
                    <span className="player-track-no">
                      {i === index && playing
                        ? <span className="player-track-eq" aria-hidden="true"><i /><i /><i /></span>
                        : String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="player-track-name">{item.title}</span>
                    {item.tag && <span className="player-track-tag">{item.tag}</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}

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
          <em>{buffering ? '正在缓冲…' : playing ? '正在播放' : hasTrack ? '点开听一段' : listState === 'loading' ? '正在准备…' : '拖首歌进来'}</em>
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
