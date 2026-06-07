"""
Amirai — генератор картинок-подборок аниме для TikTok.

Локальный Flask-сервер:
  * отдаёт фронтенд-редактор (templates/index.html);
  * проксирует поиск аниме через Shikimori REST API
    (нужен корректный User-Agent, иначе Shikimori блокирует запросы);
  * проксирует постеры с shikimori.one, чтобы их можно было
    нарисовать на canvas без CORS-tainting и экспортировать в PNG.

База данных не нужна — всё работает через API в реальном времени.
"""

from __future__ import annotations

import io
import time
from urllib.parse import urlparse

import requests
from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    render_template,
    request,
    send_from_directory,
)

app = Flask(__name__)

# --- Конфигурация Shikimori --------------------------------------------------

SHIKIMORI_BASE = "https://shikimori.one"
SHIKIMORI_API = f"{SHIKIMORI_BASE}/api"

# Shikimori ТРЕБУЕТ внятный User-Agent и банит дефолтные python-requests/curl.
# Назовём приложение по имени проекта.
USER_AGENT = "AmiraiPodborka/1.0 (https://amirai.online)"

# Хосты, картинки с которых разрешено проксировать (защита от open-proxy).
ALLOWED_IMAGE_HOSTS = {
    "shikimori.one",
    "shikimori.me",
    "shikimori.org",
    "nyaa.shikimori.one",
    "moe.shikimori.one",
    "desu.shikimori.one",
}

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
)

# Простой троттлинг, чтобы не упереться в лимиты Shikimori (5 rps).
_last_request_ts = 0.0
_MIN_INTERVAL = 0.25


def _throttle() -> None:
    global _last_request_ts
    now = time.monotonic()
    wait = _MIN_INTERVAL - (now - _last_request_ts)
    if wait > 0:
        time.sleep(wait)
    _last_request_ts = time.monotonic()


def _abs_image(url: str | None) -> str | None:
    """Привести относительный путь картинки Shikimori к абсолютному URL."""
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"{SHIKIMORI_BASE}{url}"


def _serialize_anime(item: dict) -> dict:
    image = item.get("image") or {}
    return {
        "id": item.get("id"),
        "name": item.get("name"),
        "russian": item.get("russian") or item.get("name"),
        "kind": item.get("kind"),
        "score": item.get("score"),
        "aired_on": item.get("aired_on"),
        "year": (item.get("aired_on") or "")[:4] or None,
        "episodes": item.get("episodes"),
        "poster_original": _abs_image(image.get("original")),
        "poster_preview": _abs_image(image.get("preview")),
    }


# --- Маршруты ----------------------------------------------------------------


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search")
def api_search():
    """Поиск аниме по названию через Shikimori."""
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify([])

    try:
        limit = max(1, min(int(request.args.get("limit", 16)), 50))
    except ValueError:
        limit = 16

    params = {
        "search": query,
        "limit": limit,
        "order": "popularity",
    }

    try:
        _throttle()
        resp = SESSION.get(f"{SHIKIMORI_API}/animes", params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        return jsonify({"error": f"Shikimori недоступен: {exc}"}), 502

    return jsonify([_serialize_anime(item) for item in data])


@app.route("/api/anime/<int:anime_id>")
def api_anime(anime_id: int):
    """Подробности по одному аниме (например, описание)."""
    try:
        _throttle()
        resp = SESSION.get(f"{SHIKIMORI_API}/animes/{anime_id}", timeout=15)
        resp.raise_for_status()
        item = resp.json()
    except requests.RequestException as exc:
        return jsonify({"error": f"Shikimori недоступен: {exc}"}), 502

    data = _serialize_anime(item)
    # У детального ответа есть описание без html-разметки.
    data["description"] = item.get("description") or ""
    data["studios"] = [s.get("name") for s in (item.get("studios") or [])]
    data["genres"] = [g.get("russian") or g.get("name") for g in (item.get("genres") or [])]
    return jsonify(data)


@app.route("/api/image")
def api_image():
    """
    Прокси для постеров Shikimori.

    Браузер грузит картинку с нашего origin -> canvas не «портится»
    (tainted) и html-to-image может экспортировать слайд в PNG.
    """
    url = request.args.get("url", "")
    if not url:
        abort(400, "no url")

    host = urlparse(url).hostname or ""
    if host not in ALLOWED_IMAGE_HOSTS:
        abort(403, "host not allowed")

    try:
        _throttle()
        resp = SESSION.get(
            url,
            timeout=20,
            headers={"User-Agent": USER_AGENT, "Referer": SHIKIMORI_BASE},
            stream=True,
        )
        resp.raise_for_status()
    except requests.RequestException:
        abort(502, "image fetch failed")

    content_type = resp.headers.get("Content-Type", "image/jpeg")
    data = io.BytesIO(resp.content)

    return Response(
        data.getvalue(),
        content_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.route("/img/<path:filename>")
def brand_img(filename: str):
    """Логотипы бренда из папки static/img."""
    return send_from_directory(app.static_folder + "/img", filename)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
