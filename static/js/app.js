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

const STORAGE_KEY = "amirai-podborka-v1";

// Проксированный URL постера (чтобы canvas не «портился» CORS-ом).
const proxied = (url) => (url ? "/api/image?url=" + encodeURIComponent(url) : "");

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

        // сетка / привязка
        snap: true,
        showGrid: true,
        gridSize: 40,
        // реально измеренный прямоугольник слайда (для точного overlay сетки)
        slideRect: { left: 0, top: 0, w: 0, h: 0 },

        // поиск
        query: "",
        results: [],
        searching: false,
        searchError: "",

        // выделение карточки / арта
        selectedCardUid: null,
        selectedArtUid: null,
        dragInfo: null,

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
            if (!this.loadFromStorage()) {
                // Стартовый набор: титульный слайд + один слайд-сетка.
                this.slides = [
                    this.makeTitleSlide("Топ аниме которые стоит посмотреть", "подборка от amirai.online"),
                    this.makeGridSlide(),
                ];
                this.current = 0;
            }
            this.$nextTick(() => this.fitStage());
            window.addEventListener("resize", () => this.fitStage());
            // глобальные обработчики drag
            window.addEventListener("pointermove", (e) => this.onPointerMove(e));
            window.addEventListener("pointerup", () => this.onPointerUp());

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
                gridSize: this.gridSize,
                snap: this.snap,
                showGrid: this.showGrid,
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

            this.slides = data.slides;
            this.format = data.format || "9:16";
            this.current = Math.min(data.current || 0, this.slides.length - 1);
            if (typeof data.gridSize === "number") this.gridSize = data.gridSize;
            if (typeof data.snap === "boolean") this.snap = data.snap;
            if (typeof data.showGrid === "boolean") this.showGrid = data.showGrid;

            // сдвинуть счётчик uid выше всех загруженных id
            this.slides.forEach((s) => {
                bumpUid(s.id);
                (s.cards || []).forEach((c) => bumpUid(c.uid));
                (s.arts || []).forEach((a) => bumpUid(a.uid));
            });
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
                equalSize: true, // все карточки одного размера
                cards: [],
                arts: [],
                // нижняя полоса: призыв + сайт справа, Telegram по центру
                showSides: true,
                sideText: "Смотри аниме на нашем сайте",
                tgHandle: "@AmiraiAnime",
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
        get gridBgScreen() {
            // overlay сетки в ЭКРАННЫХ px (шаг * фактический масштаб слайда),
            // чтобы линии 1px были чёткими и совпадали с краями карточек
            const eff = this.slideRect.w ? this.slideRect.w / this.dims.w : this.scale;
            const g = Math.max(2, this.gridSize * eff);
            return (
                `linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px) 0 0/${g}px ${g}px,` +
                `linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px) 0 0/${g}px ${g}px`
            );
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
            // Слайд центрируется в wrap идиомой top/left:50% + translate(-50%,-50%),
            // значит его визуальный центр = центр wrap. Считаем rect аналитически
            // (без getBoundingClientRect → нет проблем тайминга с transform).
            const rw = w * this.scale;
            const rh = h * this.scale;
            this.slideRect = {
                left: wrap.clientWidth / 2 - rw / 2,
                top: wrap.clientHeight / 2 - rh / 2,
                w: rw,
                h: rh,
            };
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
                const r = await fetch("/api/search?limit=24&q=" + encodeURIComponent(q));
                const data = await r.json();
                if (data.error) {
                    this.searchError = data.error;
                    this.results = [];
                } else {
                    this.results = data;
                }
            } catch (e) {
                this.searchError = "Ошибка сети: " + e.message;
            } finally {
                this.searching = false;
            }
        },

        // ---- работа с карточками ----
        snapVal(v) {
            return this.snap ? Math.round(v / this.gridSize) * this.gridSize : Math.round(v);
        },

        addCard(anime) {
            if (!this.slide || this.slide.type !== "grid") {
                this.showToast("Добавьте карточки на слайд-сетку");
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
                w: 300,
            };
            this.slide.cards.push(card);
            this.selectedCardUid = card.uid;
            preload(poster);
            this.autoArrange(); // аккуратно разложить по сетке
        },

        removeCard(cardUid) {
            const s = this.slide;
            s.cards = s.cards.filter((c) => c.uid !== cardUid);
            if (this.selectedCardUid === cardUid) this.selectedCardUid = null;
            this.autoArrange();
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
            this.autoArrange();
        },

        get selectedCard() {
            if (!this.slide || this.slide.type !== "grid") return null;
            return this.slide.cards.find((c) => c.uid === this.selectedCardUid) || null;
        },

        selectCard(cardUid) {
            this.selectedCardUid = cardUid;
        },

        cardHeight(card, slide) {
            const posterH = card.w * 1.5;
            const cap = (slide || this.slide).showCaption ? card.w * 0.22 : 0;
            return posterH + cap;
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

        // Безопасная зона для карточек: ниже шапки, выше нижней полосы.
        // На обложке (title) ограничений нет — объекты свободны.
        contentArea(s) {
            s = s || this.slide;
            const { w: W, h: H } = this.dims;
            if (!s || s.type !== "grid") return { left: 0, top: 0, right: W, bottom: H };
            const pad = s.pad || 40;
            const footer = s.showSides ? 184 : 56; // место под нижнюю полосу
            return { left: pad, top: s.headerH, right: W - pad, bottom: H - footer };
        },

        // все перетаскиваемые объекты слайда (карточки + арты)
        movableEls(s) {
            s = s || this.slide;
            return [...(s.cards || []), ...(s.arts || [])];
        },

        // пересекаются ли два объекта (AABB) при положении (x,y) у obj
        overlaps(obj, x, y, other) {
            const h1 = this.elHeight(obj);
            const w2 = other.w,
                h2 = this.elHeight(other);
            return x < other.x + w2 && x + obj.w > other.x && y < other.y + h2 && y + h1 > other.y;
        },

        // есть ли коллизия obj в точке (x,y) с другими объектами грид-слайда
        collides(obj, x, y) {
            if (!this.slide || this.slide.type !== "grid") return false;
            return this.movableEls().some((o) => o !== obj && this.overlaps(obj, x, y, o));
        },

        // Авто-раскладка карточек ровной сеткой cols x rows внутри безопасной зоны.
        // Ширина подбирается так, чтобы ВСЕ ряды влезли по высоте (карточки не
        // уезжают за экран) и по ширине. Все карточки одного размера.
        autoArrange() {
            const s = this.slide;
            if (!s || s.type !== "grid" || !s.cards.length) return;
            const g = this.snap ? this.gridSize : 1;
            const toGrid = (v) => Math.round(v / g) * g;
            const area = this.contentArea(s);

            const cols = Math.max(1, s.cols);
            const rows = Math.ceil(s.cards.length / cols);
            const gap = toGrid(s.gap);
            const left = toGrid(area.left);
            const top = toGrid(area.top);
            const innerW = area.right - left;
            const innerH = area.bottom - top;

            // высота карточки = w * (постер 1.5 + подпись 0.22)
            const hFactor = 1.5 + (s.showCaption ? 0.22 : 0);

            // ширина по ограничению ширины и по ограничению высоты — берём минимум
            const wByWidth = (innerW - (cols - 1) * gap) / cols;
            const wByHeight = (innerH - (rows - 1) * gap) / rows / hFactor;
            let cardW = Math.floor(Math.min(wByWidth, wByHeight));
            cardW = Math.max(g, Math.floor(cardW / g) * g);

            const pitchX = cardW + gap;
            const rowH = toGrid(cardW * hFactor);
            const pitchY = rowH + gap;

            s.cards.forEach((card, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                card.w = cardW;
                card.x = left + col * pitchX;
                card.y = top + row * pitchY;
            });
        },

        // Уравнять размеры всех карточек и переразложить (для «одинакового размера»).
        equalizeCards(w) {
            const s = this.slide;
            if (!s || !s.cards) return;
            if (w) s.cards.forEach((c) => (c.w = w));
            this.autoArrange();
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
            const x = this.snapVal((a.left + a.right) / 2 - c.w / 2);
            if (!this.collides(c, x, c.y)) c.x = x;
        },

        // высота элемента в координатах слайда: арт — по своему аспекту,
        // карточка — постер 2:3 (+ подпись)
        elHeight(obj) {
            if (obj && obj.kind === "art") return obj.w / (obj.aspect || 1);
            return this.cardHeight(obj);
        },

        // ---- drag & resize (общий для карточек и артов) ----
        startDrag(e, obj, mode, kind = "card") {
            if (e.button !== undefined && e.button !== 0) return;
            if (kind === "art") {
                this.selectedArtUid = obj.uid;
                this.selectedCardUid = null;
                this.bringFrontArt(obj);
            } else {
                this.selectedCardUid = obj.uid;
                this.selectedArtUid = null;
                this.bringFront(obj);
            }
            this.dragInfo = {
                obj,
                mode, // 'move' | 'resize'
                startX: e.clientX,
                startY: e.clientY,
                origX: obj.x,
                origY: obj.y,
                origW: obj.w,
            };
        },

        onPointerMove(e) {
            const d = this.dragInfo;
            if (!d) return;
            const dx = (e.clientX - d.startX) / this.scale;
            const dy = (e.clientY - d.startY) / this.scale;
            const isGrid = this.slide && this.slide.type === "grid";
            const a = this.contentArea();

            if (d.mode === "move") {
                const oh = this.elHeight(d.obj);
                let nx = this.snapVal(d.origX + dx);
                let ny = this.snapVal(d.origY + dy);
                // клампим в безопасную зону (грид) или в пределы слайда (обложка)
                nx = Math.max(a.left, Math.min(nx, a.right - d.obj.w));
                ny = Math.max(a.top, Math.min(ny, a.bottom - oh));

                if (isGrid) {
                    // запрет наложения: пробуем обе оси, затем по одной (скольжение)
                    if (!this.collides(d.obj, nx, ny)) {
                        d.obj.x = nx;
                        d.obj.y = ny;
                    } else if (!this.collides(d.obj, nx, d.obj.y)) {
                        d.obj.x = nx;
                    } else if (!this.collides(d.obj, d.obj.x, ny)) {
                        d.obj.y = ny;
                    }
                } else {
                    d.obj.x = nx;
                    d.obj.y = ny;
                }
            } else {
                let nw = this.snapVal(d.origW + dx);
                nw = Math.max(80, Math.min(nw, a.right - d.obj.x));
                if (isGrid) {
                    const prev = d.obj.w;
                    d.obj.w = nw;
                    if (this.collides(d.obj, d.obj.x, d.obj.y)) d.obj.w = prev; // не лезть в наложение
                } else {
                    d.obj.w = nw;
                }
            }
        },

        onPointerUp() {
            const d = this.dragInfo;
            this.dragInfo = null;
            // при «одинаковом размере» ресайз одной карточки уравнивает все
            if (d && d.mode === "resize" && d.obj.kind !== "art" &&
                this.slide && this.slide.type === "grid" && this.slide.equalSize) {
                this.equalizeCards(d.obj.w);
            }
        },

        // ---- слайды ----
        addSlide(type) {
            const s = type === "title" ? this.makeTitleSlide("Заголовок", "amirai.online") : this.makeGridSlide();
            this.slides.push(s);
            this.current = this.slides.length - 1;
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
        },

        moveSlide(i, dir) {
            const j = i + dir;
            if (j < 0 || j >= this.slides.length) return;
            const tmp = this.slides[i];
            this.slides[i] = this.slides[j];
            this.slides[j] = tmp;
            this.current = j;
        },

        selectSlide(i) {
            this.current = i;
            this.selectedCardUid = null;
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
                    this.downloadDataUrl(dataUrl, `amirai-${this.format.replace(":", "x")}-${i + 1}.png`);
                    await new Promise((r) => setTimeout(r, 120));
                }
                this.toast = "Готово! Картинки сохранены в загрузки.";
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
            root.querySelectorAll(".grid-overlay, .resize-handle").forEach((n) => n.remove());
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
