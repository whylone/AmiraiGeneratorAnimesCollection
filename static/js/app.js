/* ============================================================
   Amirai — редактор подборок аниме (Alpine.js).
   ============================================================ */

const FORMATS = {
    "9:16": { w: 1080, h: 1920 },
    "1:1": { w: 1080, h: 1080 },
};

const BG_PRESETS = {
    "Чёрный (бренд)": "#000000",
    "Красный градиент": "linear-gradient(135deg,#ff3333,#cc2929)",
    "Красный → чёрный": "linear-gradient(160deg,#cc2929,#000000)",
    "Тёмная карточка": "#0a0a0a",
    "Графит": "#1a1a1a",
};

// Рукописные «наброски» цифр 0-9 в боксе 100x150 — одна свободная линия,
// которая примерно повторяет цифру, но не идеально (эффект скетча).
const SKETCH_PATHS = {
    "0": "M52 14 C26 16 17 50 18 80 C19 116 35 140 55 138 C82 135 85 96 83 64 C81 32 70 16 44 16",
    "1": "M28 46 C40 40 50 31 58 17 C58 60 57 100 56 134 C56 137 57 138 60 138",
    "2": "M20 46 C24 22 62 16 78 34 C92 52 68 80 44 104 C30 118 20 130 18 138 C42 138 68 137 88 136",
    "3": "M22 38 C38 16 76 18 81 43 C85 64 58 71 47 73 C66 73 92 82 85 110 C78 136 36 139 18 116",
    "4": "M68 16 C49 54 31 88 16 106 C40 106 66 105 86 105 M70 60 C70 92 70 118 71 138",
    "5": "M80 20 C57 20 39 20 30 22 C28 48 26 64 26 71 C41 60 80 60 83 93 C87 124 44 141 20 118",
    "6": "M76 24 C51 22 30 52 26 88 C22 122 41 142 59 137 C83 131 84 95 63 90 C44 85 28 102 31 118",
    "7": "M18 26 C44 24 74 24 88 27 C71 61 53 100 43 138",
    "8": "M52 16 C30 18 28 50 51 60 C78 71 80 24 50 19 M51 62 C24 67 18 110 51 129 C86 128 80 76 52 62",
    "9": "M73 72 C73 36 49 27 37 41 C25 55 31 80 53 81 C73 82 77 56 74 41 C74 82 70 118 44 138",
};

let _uid = 0;
const uid = () => ++_uid;
const bumpUid = (n) => {
    if (typeof n === "number" && n > _uid) _uid = n;
};

// Версия в ключе: подняли до v2 → старые сохранения игнорируются,
// приложение стартует с чистого листа (полный сброс localStorage).
const STORAGE_KEY = "amirai-podborka-v2";
const MAX_CARDS = 6; // максимум карточек на одном слайде
const MAX_COLS = 3; // максимум карточек в ширину
// Высота подписи под постером = ширина карточки × этот коэффициент.
// Запас под 2-3 строки длинных названий, чтобы текст не вылезал на постер.
const CAP_FACTOR = 0.3;
const CAP_FONT_FACTOR = 0.072; // размер шрифта подписи = ширина × этот коэффициент

// --- Сетевой слой: две среды ----------------------------------------------
// 1) Flask-веб (десктоп/PWA): ходим через прокси /api/* (нужен UA + CORS).
// 2) Android-APK (Capacitor): сервера нет — стучимся в Shikimori напрямую
//    нативным HTTP (CapacitorHttp минует CORS и позволяет задать User-Agent).
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const SHIKI = "https://shikimori.one";
const SHIKI_UA = "AmiraiPodborka/1.0 (https://amirai.online)";

// относительный путь картинки Shikimori → абсолютный URL
const absImg = (u) => (!u ? null : /^https?:\/\//.test(u) ? u : SHIKI + u);

// URL постера для показа/экспорта.
// В вебе — через прокси (иначе canvas «портится» CORS-ом и PNG не снять).
// В нативе — прямой URL (html-to-image встроит его нативным fetch без CORS).
const proxied = (url) => {
    if (!url) return "";
    return IS_NATIVE ? url : "/api/image?url=" + encodeURIComponent(url);
};

// нормализация ответа Shikimori к форме, которую ждёт фронт
const serializeAnime = (item) => {
    const image = item.image || {};
    return {
        id: item.id,
        name: item.name,
        russian: item.russian || item.name,
        kind: item.kind,
        score: item.score,
        poster_original: absImg(image.original),
        poster_preview: absImg(image.preview),
    };
};

// Поиск аниме: нативно — прямой запрос к Shikimori, в вебе — через Flask-прокси.
async function searchAnime(q, limit = 24) {
    if (IS_NATIVE) {
        const http = window.CapacitorHttp || (window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp);
        const res = await http.request({
            method: "GET",
            url: SHIKI + "/api/animes",
            params: { search: q, limit: String(limit), order: "popularity" },
            headers: { "User-Agent": SHIKI_UA, Accept: "application/json" },
        });
        const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
        if (!Array.isArray(data)) throw new Error("Shikimori вернул неожиданный ответ");
        return data.map(serializeAnime);
    }
    const r = await fetch("/api/search?limit=" + limit + "&q=" + encodeURIComponent(q));
    const data = await r.json();
    if (data && data.error) throw new Error(data.error);
    return data;
}

function preload(src) {
    return new Promise((resolve) => {
        if (!src) return resolve();
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
    });
}

function editor() {
    return {
        // ---- состояние ----
        format: "9:16",
        slides: [],
        current: 0,
        scale: 1,

        // активная вкладка нижней панели (мобильный интерфейс)
        tab: "search",

        // единая ширина карточек для ВСЕХ грид-слайдов
        globalCardW: 300,

        // поиск
        query: "",
        results: [],
        searching: false,
        searchError: "",
        // режим замены: uid карточки, которую заменяем выбором из поиска
        replaceCardUid: null,

        // выделение карточки / арта
        selectedCardUid: null,
        selectedCardUids: [], // мультивыделение рамкой
        selectedArtUid: null,
        dragInfo: null,
        marquee: null, // рамка выделения зажатым ЛКМ {x0,y0,x,y}

        // перестановка карточек в списке (drag&drop)
        cardDragIdx: null,
        cardOverIdx: null,

        // экспорт
        exporting: false,
        toast: "",

        bgPresets: BG_PRESETS,

        // автосохранение
        _saveTimer: null,
        _pending: null,
        saved: false,

        // ------------------------------------------------------
        init() {
            // подчищаем старые версии хранилища (полный сброс кэша)
            try {
                localStorage.removeItem("amirai-podborka-v1");
            } catch (e) {}
            if (!this.loadFromStorage()) {
                // Стартовый набор: титульный слайд + один слайд-сетка.
                this.slides = [
                    this.makeTitleSlide("Топ аниме которые стоит посмотреть", "подборка от amirai.online"),
                    this.makeGridSlide(),
                ];
                this.current = 0;
            }
            this.ensureValidTab();
            this.$nextTick(() => this.fitStage());
            window.addEventListener("resize", () => this.fitStage());
            // глобальные обработчики drag
            window.addEventListener("pointermove", (e) => this.onPointerMove(e));
            window.addEventListener("pointerup", () => this.onPointerUp());
            // Delete — удалить выделенные рамкой карточки (если не в поле ввода)
            window.addEventListener("keydown", (e) => {
                if (e.key !== "Delete") return;
                const t = document.activeElement;
                if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
                if (this.selectedCardUids.length) {
                    e.preventDefault();
                    this.removeSelectedCards();
                }
            });

            // автосохранение: реактивный эффект следит за состоянием и пишет в
            // localStorage с задержкой (debounce). Во время перетаскивания не
            // сериализуем состояние (иначе лаги) — сохраним по отпусканию.
            this.$nextTick(() => {
                Alpine.effect(() => {
                    if (this.dragInfo) return; // тянем карточку — пропускаем
                    const snapshot = JSON.stringify(this.persistState());
                    this.scheduleSave(snapshot);
                });
            });
            // успеть сохранить перед закрытием вкладки
            window.addEventListener("beforeunload", () => this.saveNow());
        },

        // ---- автосохранение ----
        persistState() {
            return {
                v: 1,
                format: this.format,
                current: this.current,
                globalCardW: this.globalCardW,
                slides: this.slides,
            };
        },

        scheduleSave(snapshot) {
            this._pending = snapshot;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.saveNow(), 500);
        },

        saveNow() {
            try {
                localStorage.setItem(STORAGE_KEY, this._pending || JSON.stringify(this.persistState()));
                this.saved = true;
            } catch (e) {
                // обычно превышение квоты из-за тяжёлых артов
                this.toast = "Не удалось сохранить (возможно, слишком много/тяжёлых артов)";
                setTimeout(() => (this.toast = ""), 3000);
            }
        },

        loadFromStorage() {
            let data;
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return false;
                data = JSON.parse(raw);
            } catch (e) {
                return false;
            }
            if (!data || !Array.isArray(data.slides) || !data.slides.length) return false;

            // Миграция: чиним старую опечатку в домене (amiria.online → amirai.online),
            // которая могла попасть в сохранённые слайды до фикса.
            data.slides = JSON.parse(
                JSON.stringify(data.slides).replace(/amiria\.online/gi, "amirai.online")
            );

            // Миграция: у карточек без ручного номера проставляем порядковый,
            // у титульных слайдов — призыв (теперь он есть и на титуле).
            data.slides.forEach((s) => {
                if (s.type === "grid" && Array.isArray(s.cards)) {
                    s.cards.forEach((c, i) => {
                        if (c.rank == null) c.rank = i + 1;
                    });
                }
                if (s.type === "title") {
                    if (typeof s.showSides !== "boolean") s.showSides = true;
                    if (s.sideText == null) s.sideText = "Смотри аниме на нашем сайте";
                }
            });

            this.slides = data.slides;
            this.format = data.format || "9:16";
            this.current = Math.min(data.current || 0, this.slides.length - 1);
            if (typeof data.globalCardW === "number") this.globalCardW = data.globalCardW;

            // сдвинуть счётчик uid выше всех загруженных id
            this.slides.forEach((s) => {
                bumpUid(s.id);
                (s.cards || []).forEach((c) => bumpUid(c.uid));
                (s.arts || []).forEach((a) => bumpUid(a.uid));
            });
            // Пересобрать раскладку под новую высоту подписи: старые сохранения
            // считали ряды от меньшей высоты, иначе строки наезжали бы друг на друга.
            this.layoutAll(this.globalCardW);
            return true;
        },

        resetAll() {
            if (!confirm("Сбросить все слайды и начать заново? Текущая работа удалится.")) return;
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch (e) {}
            this.slides = [
                this.makeTitleSlide("Топ аниме которые стоит посмотреть", "подборка от amirai.online"),
                this.makeGridSlide(),
            ];
            this.current = 0;
            this.selectedCardUid = null;
            this.selectedArtUid = null;
            this.$nextTick(() => this.fitStage());
        },

        // ---- фабрики слайдов ----
        makeTitleSlide(title, subtitle) {
            return {
                id: uid(),
                type: "title",
                title,
                subtitle,
                showLogo: true,
                showUrl: true,
                siteUrl: "amirai.online",
                // призыв над сайтом — общий брендбар с грид-слайдами
                showSides: true,
                sideText: "Смотри аниме на нашем сайте",
                bg: BG_PRESETS["Чёрный (бренд)"],
                // крупная цифра-обложка
                showNumber: true,
                bigNumber: "10",
                numStyle: "solid", // solid | outline | scribble | shadow
                numColor: "#ff3333",
                numPos: "tl", // tl | tr | center
                arts: [],
            };
        },

        makeGridSlide(heading = "Подборка аниме") {
            return {
                id: uid(),
                type: "grid",
                heading,
                showLogo: true,
                showUrl: true,
                siteUrl: "amirai.online",
                showRank: true,
                showCaption: true,
                bg: BG_PRESETS["Чёрный (бренд)"],
                cols: 2,
                gap: 40,
                pad: 40,
                headerH: 200, // верх области карточек (под шапкой)
                cards: [],
                arts: [],
                // призыв + сайт в верхнем брендбаре
                showSides: true,
                sideText: "Смотри аниме на нашем сайте",
            };
        },

        // ---- удобные геттеры ----
        get dims() {
            return FORMATS[this.format];
        },
        get numberChars() {
            return String(this.slide && this.slide.bigNumber != null ? this.slide.bigNumber : "").split("");
        },
        sketchFor(ch) {
            return SKETCH_PATHS[ch] || "";
        },
        get slide() {
            return this.slides[this.current];
        },

        // ---- нижние вкладки (мобильный интерфейс) ----
        // Набор вкладок зависит от типа слайда. Арт и экспорт — общие.
        get tabs() {
            if (!this.slide) return [];
            if (this.slide.type === "title") {
                return [
                    { id: "cover", label: "Цифра", icon: "①" },
                    { id: "text", label: "Текст", icon: "T" },
                    { id: "art", label: "Арт", icon: "🖼" },
                    { id: "export", label: "Экспорт", icon: "⬇" },
                ];
            }
            return [
                { id: "search", label: "Поиск", icon: "🔍" },
                { id: "cards", label: "Карточки", icon: "▦" },
                { id: "style", label: "Стиль", icon: "🎨" },
                { id: "art", label: "Арт", icon: "🖼" },
                { id: "export", label: "Экспорт", icon: "⬇" },
            ];
        },

        // если текущая вкладка недоступна для этого слайда — переключиться на первую
        ensureValidTab() {
            const ids = this.tabs.map((t) => t.id);
            if (!ids.includes(this.tab)) this.tab = ids[0] || "export";
        },

        // ---- масштаб сцены ----
        fitStage() {
            const wrap = this.$refs.canvasWrap;
            if (!wrap) return;
            const pad = 40;
            const aw = wrap.clientWidth - pad;
            const ah = wrap.clientHeight - pad;
            const { w, h } = this.dims;
            this.scale = Math.min(aw / w, ah / h, 1);
        },

        setFormat(f) {
            this.format = f;
            // при смене формата подтянуть карточки внутрь нового кадра
            this.slides.forEach((s) => this.clampAllCards(s));
            this.$nextTick(() => this.fitStage());
        },

        // ---- поиск ----
        async search() {
            const q = this.query.trim();
            if (!q) {
                this.results = [];
                return;
            }
            this.searching = true;
            this.searchError = "";
            try {
                this.results = await searchAnime(q, 24);
            } catch (e) {
                this.searchError = "Ошибка поиска: " + (e && e.message ? e.message : e);
                this.results = [];
            } finally {
                this.searching = false;
            }
        },

        // URL миниатюры для результата поиска (через прокси в вебе / прямой в нативе)
        thumb(anime) {
            return proxied(anime.poster_preview || anime.poster_original);
        },

        // ---- работа с карточками ----
        // привязки к сетке больше нет — просто целые координаты,
        // ровность даёт авто-выравнивание (alignCards), а не сетка.
        snapVal(v) {
            return Math.round(v);
        },

        // Клик по результату поиска: если активен режим замены — заменяем
        // выбранную карточку (сохраняя номер/позицию/размер), иначе добавляем новую.
        pickAnime(anime) {
            if (this.replaceCardUid) {
                this.replaceCard(anime);
            } else {
                this.addCard(anime);
            }
        },

        addCard(anime) {
            if (!this.slide || this.slide.type !== "grid") {
                this.showToast("Добавьте карточки на слайд-сетку");
                return;
            }
            if (this.slide.cards.length >= MAX_CARDS) {
                this.showToast(`Максимум ${MAX_CARDS} карточек на слайде`);
                return;
            }
            const poster = proxied(anime.poster_original || anime.poster_preview);
            const card = {
                uid: uid(),
                animeId: anime.id,
                name: anime.russian || anime.name || "",
                poster,
                x: 0,
                y: 0,
                w: this.globalCardW,
                rank: this.slide.cards.length + 1, // номер по умолчанию, можно менять вручную
            };
            this.slide.cards.push(card);
            this.selectedCardUid = card.uid;
            preload(poster);
            this.layoutAll(this.globalCardW); // разложить, сохранив текущий размер
        },

        // Начать замену карточки (ПКМ по карточке / кнопка в списке).
        startReplace(cardUid) {
            this.replaceCardUid = cardUid;
            this.selectedCardUid = cardUid;
            this.results = [];
            this.query = "";
            this.showToast("Замена карточки — найдите аниме в поиске");
            this.$nextTick(() => {
                const inp = document.querySelector('input[type="search"]');
                if (inp) inp.focus();
            });
        },

        cancelReplace() {
            this.replaceCardUid = null;
        },

        // Заменить постер/название/id карточки, НЕ трогая номер, позицию и размер.
        replaceCard(anime) {
            const s = this.slide;
            const card = s && s.cards ? s.cards.find((c) => c.uid === this.replaceCardUid) : null;
            this.replaceCardUid = null;
            if (!card) return;
            card.animeId = anime.id;
            card.name = anime.russian || anime.name || "";
            card.poster = proxied(anime.poster_original || anime.poster_preview);
            preload(card.poster);
            this.showToast("Карточка заменена");
        },

        // Заменить постер карточки своим изображением (когда у Shikimori заглушка 404).
        // Храним как data-URL: рисуется в PNG напрямую, прокси/CORS не нужны.
        setCardPoster(card, fileList) {
            const file = Array.from(fileList || []).find((f) => f.type.startsWith("image/"));
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                card.poster = ev.target.result;
                card.customPoster = true;
            };
            reader.readAsDataURL(file);
        },

        removeCard(cardUid) {
            const s = this.slide;
            s.cards = s.cards.filter((c) => c.uid !== cardUid);
            if (this.selectedCardUid === cardUid) this.selectedCardUid = null;
            this.selectedCardUids = this.selectedCardUids.filter((u) => u !== cardUid);
            this.layoutAll(this.globalCardW);
        },

        // удалить все выделённые рамкой карточки (клавиша Delete)
        removeSelectedCards() {
            const s = this.slide;
            if (!s || s.type !== "grid" || !this.selectedCardUids.length) return;
            const set = new Set(this.selectedCardUids);
            s.cards = s.cards.filter((c) => !set.has(c.uid));
            this.selectedCardUids = [];
            this.selectedCardUid = null;
            this.layoutAll(this.globalCardW);
        },

        // Перестановка карточек в списке: перенести с from на target,
        // затем заново разложить по сетке (обновятся номера и позиции).
        dropCard(target) {
            const from = this.cardDragIdx;
            this.cardDragIdx = null;
            this.cardOverIdx = null;
            if (from === null || from === target) return;
            const arr = this.slide.cards;
            const [moved] = arr.splice(from, 1);
            arr.splice(target, 0, moved);
            this.layoutAll(this.globalCardW);
        },

        get selectedCard() {
            if (!this.slide || this.slide.type !== "grid") return null;
            return this.slide.cards.find((c) => c.uid === this.selectedCardUid) || null;
        },

        selectCard(cardUid) {
            this.selectedCardUid = cardUid;
            this.selectedCardUids = [cardUid];
        },

        cardHeight(card, slide) {
            const posterH = card.w * 1.5;
            const cap = (slide || this.slide).showCaption ? card.w * CAP_FACTOR : 0;
            return posterH + cap;
        },

        // inline-стиль подписи карточки (высота + размер шрифта от ширины карточки)
        captionStyle(card) {
            return `height:${card.w * CAP_FACTOR}px;font-size:${Math.round(card.w * CAP_FONT_FACTOR)}px`;
        },

        bringFront(card) {
            const s = this.slide;
            s.cards = s.cards.filter((c) => c.uid !== card.uid).concat(card);
            this.selectedCardUid = card.uid;
        },

        // ---- арты (загруженные пользователем картинки) ----
        get selectedArt() {
            if (!this.slide || !this.slide.arts) return null;
            return this.slide.arts.find((a) => a.uid === this.selectedArtUid) || null;
        },

        addArtFiles(fileList) {
            const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
            const { w: W } = this.dims;
            files.forEach((file) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const src = ev.target.result;
                    const img = new Image();
                    img.onload = () => {
                        const aspect = img.naturalWidth / img.naturalHeight || 1;
                        const w = Math.min(480, Math.round(W * 0.45));
                        const art = {
                            uid: uid(),
                            kind: "art",
                            src,
                            aspect,
                            w,
                            x: this.snapVal(W - w - 40),
                            y: this.snapVal(60),
                        };
                        if (!this.slide.arts) this.slide.arts = [];
                        this.slide.arts.push(art);
                        this.selectedArtUid = art.uid;
                    };
                    img.src = src;
                };
                reader.readAsDataURL(file);
            });
        },

        removeArt(artUid) {
            const s = this.slide;
            if (!s.arts) return;
            s.arts = s.arts.filter((a) => a.uid !== artUid);
            if (this.selectedArtUid === artUid) this.selectedArtUid = null;
        },

        bringFrontArt(art) {
            const s = this.slide;
            s.arts = s.arts.filter((a) => a.uid !== art.uid).concat(art);
            this.selectedArtUid = art.uid;
        },

        // Безопасная зона для карточек: ниже шапки, с небольшим отступом снизу.
        // На обложке (title) ограничений нет — объекты свободны.
        contentArea(s) {
            s = s || this.slide;
            const { w: W, h: H } = this.dims;
            if (!s || s.type !== "grid") return { left: 0, top: 0, right: W, bottom: H };
            const pad = s.pad || 40;
            return { left: pad, top: s.headerH, right: W - pad, bottom: H - pad };
        },

        // все перетаскиваемые объекты слайда (карточки + арты)
        movableEls(s) {
            s = s || this.slide;
            return [...(s.cards || []), ...(s.arts || [])];
        },

        // высота карточки относительно её ширины (постер 2:3 + подпись)
        cardHFactor(s) {
            return 1.5 + (s.showCaption ? CAP_FACTOR : 0);
        },

        // Колонки считаются автоматически по числу карточек:
        // 1→1, 2→2, 3→3, дальше максимум 3 в ширину (4..6 карточек → 3 колонки).
        colsFor(s) {
            const n = (s.cards ? s.cards.length : 0) || 1;
            return Math.min(MAX_COLS, n);
        },

        // Максимальная ширина карточки, помещающаяся на КОНКРЕТНОМ грид-слайде
        // (по ширине и по высоте безопасной зоны).
        fitWidthFor(s) {
            const area = this.contentArea(s);
            const cols = this.colsFor(s);
            const rows = Math.max(1, Math.ceil((s.cards ? s.cards.length : 1) / cols));
            const gap = s.gap;
            const innerW = area.right - area.left;
            const innerH = area.bottom - area.top;
            const wByWidth = (innerW - (cols - 1) * gap) / cols;
            const wByHeight = (innerH - (rows - 1) * gap) / rows / this.cardHFactor(s);
            return Math.max(60, Math.floor(Math.min(wByWidth, wByHeight)));
        },

        // Единая ширина карточек для ВСЕХ грид-слайдов: берём минимум из
        // «влезающих» ширин — тогда выбранный размер не вылезает ни на одном слайде.
        maxUniformW() {
            const widths = this.slides
                .filter((s) => s.type === "grid" && s.cards && s.cards.length)
                .map((s) => this.fitWidthFor(s));
            return widths.length ? Math.min(...widths) : this.globalCardW;
        },

        // Идеально ровная раскладка одного слайда при ширине W:
        // блок центрируется по вертикали, КАЖДЫЙ ряд центрируется по горизонтали
        // (даже неполный последний ряд) — карточки всегда стоят ровно и по центру.
        arrangeSlide(s, W) {
            if (!s || s.type !== "grid" || !s.cards.length) return;
            const area = this.contentArea(s);
            const cols = this.colsFor(s);
            const gap = s.gap;
            const n = s.cards.length;
            const rows = Math.ceil(n / cols);
            const cardH = Math.round(W * this.cardHFactor(s));
            const innerW = area.right - area.left;
            const innerH = area.bottom - area.top;
            const blockH = rows * cardH + (rows - 1) * gap;
            const startY = area.top + Math.max(0, (innerH - blockH) / 2);
            s.cards.forEach((card, i) => {
                const row = Math.floor(i / cols);
                const col = i % cols;
                // карточек в этом ряду (последний ряд может быть неполным)
                const inRow = Math.min(cols, n - row * cols);
                const rowW = inRow * W + (inRow - 1) * gap;
                const startX = area.left + Math.max(0, (innerW - rowW) / 2);
                card.w = W;
                card.x = Math.round(startX + col * (W + gap));
                card.y = Math.round(startY + row * (cardH + gap));
            });
        },

        // Раскладка с ОДИНАКОВЫМ размером карточек на всех слайдах.
        // targetW — желаемая ширина (от слайдера/ресайза); без неё — авто-максимум.
        // В любом случае не больше, чем влезает на самый «тесный» слайд.
        layoutAll(targetW) {
            const maxW = this.maxUniformW();
            let W = targetW ? Math.round(targetW) : maxW;
            W = Math.max(60, Math.min(W, maxW)); // не вылезаем ни на одном слайде
            this.globalCardW = W;
            this.slides.forEach((s) => this.arrangeSlide(s, W));
        },

        // Выровнять, сохранив текущий (средний) размер карточек;
        // если он не влезает — автоматически ужмётся под самый тесный слайд.
        autoArrange() {
            this.layoutAll(this.globalCardW);
        },
        // equalizeCards — задать явную ширину (слайдер/ресайз).
        equalizeCards(w) {
            this.layoutAll(w);
        },

        // Подтянуть все карточки/арты слайда внутрь безопасной зоны (после смены формата).
        clampAllCards(s) {
            s = s || this.slide;
            if (!s || s.type !== "grid") return;
            const a = this.contentArea(s);
            this.movableEls(s).forEach((o) => {
                const oh = this.elHeight(o);
                o.x = Math.max(a.left, Math.min(o.x, a.right - o.w));
                o.y = Math.max(a.top, Math.min(o.y, a.bottom - oh));
            });
        },

        // центрировать выделенную карточку по горизонтали в безопасной зоне
        centerSelectedX() {
            const c = this.selectedCard;
            if (!c) return;
            const a = this.contentArea();
            c.x = Math.round((a.left + a.right) / 2 - c.w / 2);
        },

        // высота элемента в координатах слайда: арт — по своему аспекту,
        // карточка — постер 2:3 (+ подпись)
        elHeight(obj) {
            if (obj && obj.kind === "art") return obj.w / (obj.aspect || 1);
            return this.cardHeight(obj);
        },

        // ---- выделение рамкой (зажатый ЛКМ по пустому месту слайда) ----
        // координаты указателя в системе координат слайда (с учётом масштаба)
        pointerToSlide(e) {
            const node = this.$refs.slideNode;
            const r = node.getBoundingClientRect();
            return {
                x: (e.clientX - r.left) / this.scale,
                y: (e.clientY - r.top) / this.scale,
            };
        },

        startMarquee(e) {
            if (e.button !== undefined && e.button !== 0) return;
            if (!this.slide || this.slide.type !== "grid") return;
            this.selectedArtUid = null;
            const p = this.pointerToSlide(e);
            this.marquee = { x0: p.x, y0: p.y, x: p.x, y: p.y };
            this.selectedCardUids = [];
            this.selectedCardUid = null;
        },

        // прямоугольник рамки в координатах слайда
        get marqueeRect() {
            const m = this.marquee;
            if (!m) return { left: 0, top: 0, w: 0, h: 0 };
            return {
                left: Math.min(m.x0, m.x),
                top: Math.min(m.y0, m.y),
                w: Math.abs(m.x - m.x0),
                h: Math.abs(m.y - m.y0),
            };
        },

        updateMarquee(e) {
            const p = this.pointerToSlide(e);
            this.marquee.x = p.x;
            this.marquee.y = p.y;
            const r = this.marqueeRect;
            // выделяем карточки, чьи прямоугольники пересекаются с рамкой
            this.selectedCardUids = (this.slide.cards || [])
                .filter((c) => {
                    const ch = this.elHeight(c);
                    return (
                        r.left < c.x + c.w &&
                        r.left + r.w > c.x &&
                        r.top < c.y + ch &&
                        r.top + r.h > c.y
                    );
                })
                .map((c) => c.uid);
            this.selectedCardUid = this.selectedCardUids[0] || null;
        },

        // ---- drag & resize (общий для карточек и артов) ----
        startDrag(e, obj, mode, kind = "card") {
            if (e.button !== undefined && e.button !== 0) return;
            let group = null;
            if (kind === "art") {
                this.selectedArtUid = obj.uid;
                this.selectedCardUid = null;
                this.selectedCardUids = [];
                this.bringFrontArt(obj);
            } else {
                this.selectedArtUid = null;
                // если тащим карточку из мультивыделения — двигаем всю группу,
                // иначе выделяем только её
                if (mode === "move" && this.selectedCardUids.includes(obj.uid) && this.selectedCardUids.length > 1) {
                    group = this.slide.cards
                        .filter((c) => this.selectedCardUids.includes(c.uid))
                        .map((c) => ({ obj: c, origX: c.x, origY: c.y }));
                } else {
                    this.selectedCardUid = obj.uid;
                    this.selectedCardUids = [obj.uid];
                    this.bringFront(obj);
                }
            }
            this.dragInfo = {
                obj,
                mode, // 'move' | 'resize'
                group, // [{obj,origX,origY}] при перемещении группы
                startX: e.clientX,
                startY: e.clientY,
                origX: obj.x,
                origY: obj.y,
                origW: obj.w,
            };
        },

        onPointerMove(e) {
            if (this.marquee) {
                this.updateMarquee(e);
                return;
            }
            const d = this.dragInfo;
            if (!d) return;
            const dx = (e.clientX - d.startX) / this.scale;
            const dy = (e.clientY - d.startY) / this.scale;
            const isGrid = this.slide && this.slide.type === "grid";
            const a = this.contentArea();

            if (d.mode === "move") {
                if (d.group) {
                    // двигаем всю группу синхронно, держим каждую внутри кадра
                    d.group.forEach((g) => {
                        const oh = this.elHeight(g.obj);
                        g.obj.x = Math.max(a.left, Math.min(Math.round(g.origX + dx), a.right - g.obj.w));
                        g.obj.y = Math.max(a.top, Math.min(Math.round(g.origY + dy), a.bottom - oh));
                    });
                    return;
                }
                let nx = Math.round(d.origX + dx);
                let ny = Math.round(d.origY + dy);
                if (isGrid) {
                    // грид: свободное плавное перемещение, держим внутри кадра
                    const oh = this.elHeight(d.obj);
                    d.obj.x = Math.max(a.left, Math.min(nx, a.right - d.obj.w));
                    d.obj.y = Math.max(a.top, Math.min(ny, a.bottom - oh));
                } else {
                    // титул/обложка: без ограничений — арт можно вынести за край (bleed)
                    d.obj.x = nx;
                    d.obj.y = ny;
                }
            } else {
                let nw = Math.round(d.origW + dx);
                if (isGrid) {
                    d.obj.w = Math.max(80, Math.min(nw, a.right - d.obj.x));
                } else {
                    // титул/обложка: без верхнего ограничения — арт может быть больше кадра
                    d.obj.w = Math.max(40, nw);
                }
            }
        },

        onPointerUp() {
            if (this.marquee) {
                this.marquee = null;
                return;
            }
            const d = this.dragInfo;
            this.dragInfo = null;
            // ресайз одной карточки уравнивает размер на ВСЕХ слайдах
            if (d && d.mode === "resize" && d.obj.kind !== "art" &&
                this.slide && this.slide.type === "grid") {
                this.layoutAll(d.obj.w);
            }
        },

        // ---- слайды ----
        addSlide(type) {
            const s = type === "title" ? this.makeTitleSlide("Заголовок", "amirai.online") : this.makeGridSlide();
            this.slides.push(s);
            this.current = this.slides.length - 1;
            this.ensureValidTab();
            this.$nextTick(() => this.fitStage());
        },

        duplicateSlide() {
            const copy = JSON.parse(JSON.stringify(this.slide));
            copy.id = uid();
            if (copy.cards) copy.cards.forEach((c) => (c.uid = uid()));
            this.slides.splice(this.current + 1, 0, copy);
            this.current += 1;
        },

        removeSlide(i) {
            if (this.slides.length <= 1) {
                this.showToast("Должен остаться хотя бы один слайд");
                return;
            }
            this.slides.splice(i, 1);
            this.current = Math.max(0, Math.min(this.current, this.slides.length - 1));
            this.ensureValidTab();
        },

        moveSlide(i, dir) {
            const j = i + dir;
            if (j < 0 || j >= this.slides.length) return;
            const tmp = this.slides[i];
            this.slides[i] = this.slides[j];
            this.slides[j] = tmp;
            this.current = j;
            this.ensureValidTab();
        },

        selectSlide(i) {
            this.current = i;
            this.selectedCardUid = null;
            this.selectedCardUids = [];
            this.ensureValidTab();
        },

        // ---- экспорт ----
        async exportCurrent() {
            await this.exportSlides([this.current]);
        },

        async exportAll() {
            await this.exportSlides(this.slides.map((_, i) => i));
        },

        async exportSlides(indices) {
            if (this.exporting) return;
            this.exporting = true;
            const savedCurrent = this.current;
            const savedSel = this.selectedCardUid;
            const savedArtSel = this.selectedArtUid;
            this.selectedCardUid = null;
            this.selectedArtUid = null;
            const files = [];
            try {
                await document.fonts.ready;
                for (let k = 0; k < indices.length; k++) {
                    const i = indices[k];
                    this.current = i;
                    this.toast = `Рендер слайда ${k + 1} из ${indices.length}…`;
                    await this.$nextTick();
                    // подождём загрузку постеров текущего слайда
                    const s = this.slides[i];
                    const urls = ["/img/logo.png"];
                    if (s.cards) s.cards.forEach((c) => urls.push(c.poster));
                    await Promise.all(urls.map(preload));
                    await new Promise((r) => setTimeout(r, 120));

                    const { w, h } = this.dims;
                    const dataUrl = await this.renderSlideToPng(w, h);
                    files.push({ dataUrl, filename: `amirai-${this.format.replace(":", "x")}-${i + 1}.png` });
                    await new Promise((r) => setTimeout(r, 120));
                }
                this.toast = "Сохранение…";
                await this.deliver(files);
                this.toast = IS_NATIVE ? "Готово! Выбери, куда сохранить/отправить." : "Готово! Картинки сохранены в загрузки.";
            } catch (e) {
                this.toast = "Ошибка экспорта: " + (e && e.message ? e.message : e);
                console.error(e);
            } finally {
                this.current = savedCurrent;
                this.selectedCardUid = savedSel;
                this.selectedArtUid = savedArtSel;
                this.exporting = false;
                this.$nextTick(() => this.fitStage());
                setTimeout(() => (this.toast = ""), 2500);
            }
        },

        // Рендер текущего слайда в PNG.
        // Клонируем узел и вырезаем директивы Alpine (:style, @click, x-text…),
        // т.к. html-to-image сериализует DOM как XML внутри <foreignObject>,
        // а атрибуты с ':' и '@' ломают XML-парсинг и SVG не загружается.
        async renderSlideToPng(w, h) {
            const live = this.$refs.slideNode;
            const clone = live.cloneNode(true);
            this.stripDirectives(clone);

            clone.style.transform = "none";
            clone.style.position = "static";
            clone.style.top = "0";
            clone.style.left = "0";
            clone.style.margin = "0";
            clone.style.width = w + "px";
            clone.style.height = h + "px";

            const holder = document.createElement("div");
            holder.style.cssText =
                `position:fixed;left:-99999px;top:0;width:${w}px;height:${h}px;overflow:hidden;`;
            holder.appendChild(clone);
            document.body.appendChild(holder);

            try {
                return await htmlToImage.toPng(clone, {
                    width: w,
                    height: h,
                    pixelRatio: 1,
                    cacheBust: false,
                    // ВАЖНО: постеры идут через /api/image?url=… — путь у всех одинаковый,
                    // отличается только query. Без этого флага html-to-image кэширует
                    // картинку по пути (без query) и подставляет ОДИН постер во все карточки.
                    includeQueryParams: true,
                });
            } finally {
                holder.remove();
            }
        },

        // Рекурсивно удаляет служебные атрибуты Alpine и пустые <template>.
        stripDirectives(root) {
            const clean = (el) => {
                if (el.getAttributeNames) {
                    el.getAttributeNames().forEach((name) => {
                        if (
                            name.startsWith("x-") ||
                            name.startsWith("@") ||
                            name.startsWith(":")
                        ) {
                            el.removeAttribute(name);
                        }
                    });
                }
            };
            clean(root);
            root.querySelectorAll("*").forEach((el) => {
                if (el.tagName === "TEMPLATE") {
                    el.remove();
                } else {
                    clean(el);
                }
            });
            // editor-only элементы не нужны в экспорте
            root.querySelectorAll(".grid-overlay, .resize-handle, .marquee").forEach((n) => n.remove());
        },

        // Отдать готовые PNG: в вебе — скачать каждый файл; в нативе — записать
        // во временную папку и показать системный «Поделиться» (Telegram, галерея…).
        async deliver(files) {
            if (!files.length) return;
            if (IS_NATIVE) {
                await this.saveNative(files);
            } else {
                files.forEach((f) => this.downloadDataUrl(f.dataUrl, f.filename));
            }
        },

        async saveNative(files) {
            const P = window.Capacitor.Plugins;
            const Filesystem = P.Filesystem;
            const Share = P.Share;
            const uris = [];
            for (const f of files) {
                const res = await Filesystem.writeFile({
                    path: f.filename,
                    data: f.dataUrl.split(",")[1], // чистый base64
                    directory: "CACHE",
                });
                uris.push(res.uri);
            }
            await Share.share({
                title: "Подборка Amirai",
                text: "Подборка аниме · amirai.online",
                files: uris,
            });
        },

        downloadDataUrl(dataUrl, filename) {
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
        },

        showToast(msg) {
            this.toast = msg;
            setTimeout(() => (this.toast = ""), 2200);
        },
    };
}

window.editor = editor;
