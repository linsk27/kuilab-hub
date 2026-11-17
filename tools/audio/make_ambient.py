"""生成站内示例曲：一段安静的环境音（纯合成，无版权问题）。

思路：四个和弦各 11 秒、首尾交叠 3 秒做交叉淡化；
每个和弦由基频 + 2 次/3 次谐波的正弦叠加，起音 2.6s、收音 3.4s，音量很低；
上面零星撒几颗五声音阶的钟声（指数衰减），像风铃。
单声道 32kHz / 80kbps MP3 —— 只有用户点开播放器才会去下载。

用法：python tools/audio/make_ambient.py
"""
from __future__ import annotations

import math
import pathlib
import random
import struct
import wave

import lameenc

SR = 32000
OUT_WAV = pathlib.Path("tools/audio/_ambient.wav")
OUT_MP3 = pathlib.Path("public/audio/night-sail.mp3")

# D 大调上的四个和弦（Hz），数字是 MIDI 音高
CHORDS = [
    [50, 57, 61, 66],   # D3 A3 C#4 F#4  → Dmaj9 的味道
    [47, 54, 57, 62],   # B2 F#3 A3 D4   → Bm7
    [43, 50, 59, 64],   # G2 D3 B3 E4   → G6
    [45, 52, 57, 61],   # A2 E3 A3 C#4  → A
]
CHORD_SECONDS = 11.0
CROSSFADE = 3.0
ROUNDS = 1

BELL_NOTES = [74, 76, 78, 81, 83, 86]   # D 大调五声，高八度


def hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def envelope(t: float, length: float) -> float:
    """起音 2.6s、收音 3.4s 的梯形包络，再叠一点平滑。"""
    attack, release = 2.6, 3.4
    if t < 0 or t > length:
        return 0.0
    a = min(1.0, t / attack)
    r = min(1.0, (length - t) / release)
    # smoothstep，避免爆音
    a = a * a * (3 - 2 * a)
    r = r * r * (3 - 2 * r)
    return a * r


def main() -> None:
    total = CHORD_SECONDS * len(CHORDS) * ROUNDS + CROSSFADE
    n = int(total * SR)
    buf = [0.0] * n

    # ---- 1. 铺底和弦：每个音三根正弦，略微失谐做“合唱”感 ----
    random.seed(20261117)
    for round_index in range(ROUNDS):
        for chord_index, chord in enumerate(CHORDS):
            start = round_index * CHORD_SECONDS * len(CHORDS) + chord_index * CHORD_SECONDS
            length = CHORD_SECONDS + CROSSFADE
            s0 = int(start * SR)
            s1 = min(n, int((start + length) * SR))
            for midi in chord:
                base = hz(midi)
                voices = [(base, 1.0), (base * 1.0025, 0.75), (base * 0.9975, 0.75)]
                # 每个和弦内各声部音量略有差别，避免整齐得像风琴
                gain = 0.055 * (1.0 if midi > 55 else 1.15)
                phases = [random.random() * math.tau for _ in voices]
                for i in range(s0, s1):
                    t = (i - s0) / SR
                    env = envelope(t, length)
                    if env <= 0:
                        continue
                    v = 0.0
                    for (freq, mul), ph in zip(voices, phases):
                        # 基频 + 一点点三次谐波，音色暖而不亮
                        v += mul * (math.sin(math.tau * freq * t + ph) + 0.12 * math.sin(math.tau * freq * 3 * t + ph))
                    buf[i] += v * gain * env

    # ---- 2. 钟声：稀疏的几点，指数衰减 ----
    bell_times = []
    t_cursor = 3.0
    while t_cursor < total - 4:
        bell_times.append(t_cursor)
        t_cursor += random.uniform(3.2, 6.4)
    for bt in bell_times:
        midi = random.choice(BELL_NOTES)
        freq = hz(midi)
        decay = 2.6
        s0 = int(bt * SR)
        s1 = min(n, int((bt + decay * 2) * SR))
        for i in range(s0, s1):
            t = (i - s0) / SR
            env = math.exp(-t / decay) * min(1.0, t / 0.02)
            buf[i] += 0.05 * env * (math.sin(math.tau * freq * t) + 0.3 * math.sin(math.tau * freq * 2.01 * t))

    # ---- 3. 归一化到 -1.5dB，再淡入淡出，避免起停爆音 ----
    peak = max(abs(v) for v in buf) or 1.0
    scale = 0.84 / peak
    fade_in, fade_out = SR * 1.2, SR * 2.0
    samples = bytearray()
    for i, v in enumerate(buf):
        g = scale
        if i < fade_in:
            g *= i / fade_in
        if i > n - fade_out:
            g *= max(0.0, (n - i) / fade_out)
        samples += struct.pack("<h", int(max(-1.0, min(1.0, v * g)) * 32767))

    OUT_WAV.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT_WAV), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(bytes(samples))

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(80)
    encoder.set_in_sample_rate(SR)
    encoder.set_channels(1)
    encoder.set_quality(2)
    mp3 = encoder.encode(bytes(samples)) + encoder.flush()
    OUT_MP3.parent.mkdir(parents=True, exist_ok=True)
    OUT_MP3.write_bytes(mp3)
    print(f"{OUT_MP3}  {len(mp3) // 1024}KB  {total:.1f}s")
    OUT_WAV.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
