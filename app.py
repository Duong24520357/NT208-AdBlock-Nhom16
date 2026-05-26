from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import yt_dlp
from pathlib import Path
from urllib.parse import urlparse

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = Path.home() / "Downloads"


def is_valid_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme in ('http', 'https') and bool(parsed.netloc)
    except Exception:
        return False


def get_best_direct_url(info: dict) -> str:
    """Lấy URL stream trực tiếp đáng tin cậy nhất từ info dict."""
    formats = info.get('formats', [])
    # Ưu tiên format có cả video lẫn audio, không phải manifest HLS/DASH
    direct_formats = [
        f for f in formats
        if f.get('url')
        and f.get('protocol', '') not in ('m3u8', 'm3u8_native', 'http_dash_segments')
        and f.get('vcodec', 'none') != 'none'
        and f.get('acodec', 'none') != 'none'
    ]
    if direct_formats:
        # Lấy format có bitrate/quality cao nhất trong danh sách hợp lệ
        best = max(direct_formats, key=lambda f: f.get('tbr') or f.get('abr') or 0)
        return best['url']
    # Fallback: lấy url từ info gốc
    return info.get('url', '')


@app.route('/')
def home():
    return render_template_string('''
    <h1>API Video Downloader đang chạy</h1>

    <form action="/get-link" method="get">
        <input type="text" name="url" placeholder="Dán link YouTube" style="width:300px;">
        <button type="submit">Lấy link</button>
    </form>
    ''')


@app.route('/get-link')
def get_link():
    url = (request.args.get('url') or '').strip()

    if not url:
        return jsonify({"error": "Missing 'url'"}), 400
    if not is_valid_url(url):
        return jsonify({"error": "Invalid URL"}), 400

    ydl_opts = {
        'format': 'best',
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 15,
        'noplaylist': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            download_url = get_best_direct_url(info)
            return jsonify({
                "title": info.get('title'),
                "download_url": download_url
            })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/health')
def health():
    return jsonify({"status": "ok"})


@app.route('/download', methods=['POST'])
def download_video():
    payload = request.get_json(silent=True) or {}
    url = (payload.get('url') or '').strip()

    if not url:
        return jsonify({"error": "Missing 'url'"}), 400
    if not is_valid_url(url):
        return jsonify({"error": "Invalid URL"}), 400

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Hook để lấy đường dẫn file thực sau khi download xong
    result = {}

    def progress_hook(d):
        if d['status'] == 'finished':
            result['filepath'] = d.get('filename') or d.get('info_dict', {}).get('_filename', '')

    ydl_opts = {
        'format': 'best',
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'socket_timeout': 15,
        'outtmpl': str(DOWNLOAD_DIR / '%(title).200s.%(ext)s'),
        'progress_hooks': [progress_hook],
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            # Ưu tiên filepath từ hook, fallback về prepare_filename
            file_path = result.get('filepath') or ydl.prepare_filename(info)

        return jsonify({
            "success": True,
            "title": info.get('title'),
            "file_path": file_path,
            "download_dir": str(DOWNLOAD_DIR)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(port=5000)