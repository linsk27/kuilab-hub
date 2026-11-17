"""给 playlist.json 补两样东西，让播放器不必在运行时解码整首：

  · peaks —— 每首 168 个柱子的振幅（单边 0-255，base64），画波形只需要它
  · webm  —— 同名 .webm（Opus 64k），体积约为 MP3 的 40%，20KB/s 的线路也能连续放

（96k 也试过：音质更好但慢线路更容易断，实测 20KB/s 下 64k 只卡 1 次、96k 卡 3 次；
  想换回去只要把 WEBM_BITRATE 改成 "96k" 再跑一次本脚本。）

注意容器要 WebM 不要 Ogg：Ogg 得先读文件尾的索引，Chrome 会额外发一个
90KB 的尾部请求，慢网下首声反而从 0.5s 拖到 4~12s；WebM 只有 1 个分片请求。

跑法：python tools/audio/build_playlist.py     （需要 ffmpeg，缺了会提示）
"""
import base64
import json
import shutil
import subprocess
import pathlib

WEBM_BITRATE = "64k"

BARS = 168
ROOT = pathlib.Path(__file__).resolve().parents[2]
AUDIO = ROOT / "public" / "audio"
PLAYLIST = ROOT / "public" / "playlist.json"


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise SystemExit("找不到 ffmpeg：pip install imageio-ffmpeg 或把 ffmpeg 加进 PATH")


def peaks_of(path, ff):
    """单声道 8kHz 的 PCM，足够算出柱状图，又不用把整首读进内存解析格式。"""
    rate = 8000
    raw = subprocess.run(
        [ff, "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True, check=True,
    ).stdout
    total = len(raw) // 2
    if not total:
        return b""
    step = max(1, total // BARS)
    out = bytearray()
    for i in range(BARS):
        start = i * step
        block = raw[start * 2:(start + step) * 2]
        if not block:
            out.append(0)
            continue
        # 取块内峰值，但用「97 分位」压掉偶发的爆音，柱子看起来才平顺
        values = sorted(abs(int.from_bytes(block[j:j + 2], "little", signed=True)) for j in range(0, len(block) - 1, 2))
        pick = values[int(len(values) * 0.97)] if values else 0
        out.append(min(255, pick * 255 // 32768))
    return bytes(out)


def encode_webm(src, ff):
    """出一份 WebM；已存在且不比源旧就跳过（改歌单时不必重跑编码）。"""
    dst = src.with_suffix(".webm")
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(
            [ff, "-v", "error", "-y", "-i", str(src), "-c:a", "libopus",
             "-b:a", WEBM_BITRATE, "-f", "webm", str(dst)],
            check=True,
        )
    if dst.exists() and dst.stat().st_size >= src.stat().st_size:
        dst.unlink()   # 比源文件还大就别留着了（《夜航》本来就是 64k 单声道）
        return None
    return dst


def main():
    ff = ffmpeg()
    data = json.loads(PLAYLIST.read_text(encoding="utf-8"))
    total_mp3 = 0
    for track in data["tracks"]:
        src = ROOT / "public" / track["src"].lstrip("/")
        if not src.exists():
            print("跳过（文件不在）", track["src"])
            continue
        track.pop("opus", None)   # 旧歌单里可能留着，清掉
        track.pop("webmLite", None)
        webm = encode_webm(src, ff)
        if webm:
            track["webm"] = track["src"].rsplit(".", 1)[0] + ".webm"
        else:
            track.pop("webm", None)
        peaks = peaks_of(src, ff)
        track["peaks"] = base64.b64encode(peaks).decode() if peaks else ""
        sizes = f'{src.stat().st_size // 1024:5d}KB mp3'
        if track.get("webm"):
            sizes += f''' / {(ROOT / "public" / track["webm"].lstrip("/")).stat().st_size // 1024:4d}KB webm'''
        print(f'{track["title"]:6s} {sizes}  {len(peaks)} 根柱子')
        total_mp3 += src.stat().st_size
    data["bars"] = BARS
    PLAYLIST.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nplaylist.json 已更新：{PLAYLIST.stat().st_size // 1024}KB（音频合计 {total_mp3 // 1024}KB）")


if __name__ == "__main__":
    main()
