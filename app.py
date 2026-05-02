from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import yt_dlp
from pathlib import Path

app = Flask(__name__)
CORS(app)

DOWNLOAD_DIR = Path.home() / "Downloads"

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
    url = request.args.get('url')
    # Cấu hình để lấy link video có cả hình lẫn tiếng (thường là 720p trở xuống)
    # Nếu muốn 1080p bạn phải cài thêm ffmpeg và gộp file (phức tạp hơn)
    ydl_opts = {
        'format': 'best', 
        'quiet': True,
        'no_warnings': True
    }
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return jsonify({
                "title": info.get('title'),
                "download_url": info.get('url')
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

    ydl_opts = {
        'format': 'best',
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'outtmpl': str(DOWNLOAD_DIR / '%(title).200s.%(ext)s')
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            file_path = ydl.prepare_filename(info)

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