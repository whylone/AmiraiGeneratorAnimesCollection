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

let _uid = 0;
const uid = () => ++_uid;

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

        // поиск
        query: "",
        results: [],
        searching: false,
        searchError: "",

        // выделение карточки
        selectedCardUid: null,
        dragInfo: null,

        // экспорт
        exporting: false,
        toast: "",

        bgPresets: BG_PRESETS,

        // ------------------------------------------------------
        init() {
            // Стартовый набор: титульный слайд + один слайд-сетка.
            this.slides = [
                this.makeTitleSlide("Топ аниме которые стоит посмотреть", "подборка от amiria.online"),
                this.makeGridSlide(),
            ];
            this.current = 0;
            this.$nextTick(() => this.fitStage());
            window.addEventListener("resize", () => this.fitStage());
            // глобальные обработчики drag
            window.addEventListener("pointermove", (e) => this.onPointerMove(e));
            window.addEventListener("pointerup", () => this.onPointerUp());
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
                siteUrl: "amiria.online",
                bg: BG_PRESETS["Чёрный (бренд)"],
            };
        },

        makeGridSlide(heading = "Подборка аниме") {
            return {
                id: uid(),
                type: "grid",
                heading,
                showLogo: true,
                showUrl: true,
                siteUrl: "amiria.online",
                showRank: true,
                showCaption: true,
                bg: BG_PRESETS["Чёрный (бренд)"],
                cols: 2,
                gap: 36,
                pad: 56,
                headerH: 200,
                cards: [],
            };
        },

        // ---- удобные геттеры ----
        get dims() {
            return FORMATS[this.format];
        },
        get slide() {
            return this.slides[this.current];
        },
        get gridBg() {
            // overlay сетки как повторяющийся фон
            const g = this.gridSize;
            return (
                `linear-gradient(rgba(255,255,255,.10) 1px, transparent 1px) 0 0/${g}px ${g}px,` +
                `linear-gradient(90deg, rgba(255,255,255,.10) 1px, transparent 1px) 0 0/${g}px ${g}px`
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
        },

        setFormat(f) {
            this.format = f;
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

        // Авто-раскладка карточек ровной сеткой cols x rows.
        autoArrange() {
            const s = this.slide;
            if (!s || s.type !== "grid" || !s.cards.length) return;
            const { w: W } = this.dims;
            const cols = Math.max(1, s.cols);
            const cardW = Math.floor((W - 2 * s.pad - (cols - 1) * s.gap) / cols);
            s.cards.forEach((card, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                card.w = cardW;
                card.x = s.pad + col * (cardW + s.gap);
                card.y = s.headerH + row * (this.cardHeight({ ...card, w: cardW }, s) + s.gap);
            });
        },

        // ---- drag & resize ----
        startDrag(e, card, mode) {
            if (e.button !== undefined && e.button !== 0) return;
            this.selectedCardUid = card.uid;
            this.bringFront(card);
            this.dragInfo = {
                card,
                mode, // 'move' | 'resize'
                startX: e.clientX,
                startY: e.clientY,
                origX: card.x,
                origY: card.y,
                origW: card.w,
            };
        },

        onPointerMove(e) {
            const d = this.dragInfo;
            if (!d) return;
            const dx = (e.clientX - d.startX) / this.scale;
            const dy = (e.clientY - d.startY) / this.scale;
            const { w: W, h: H } = this.dims;
            if (d.mode === "move") {
                let nx = this.snapVal(d.origX + dx);
                let ny = this.snapVal(d.origY + dy);
                const cardH = this.cardHeight(d.card);
                nx = Math.max(0, Math.min(nx, W - d.card.w));
                ny = Math.max(0, Math.min(ny, H - cardH));
                d.card.x = nx;
                d.card.y = ny;
            } else {
                let nw = this.snapVal(d.origW + dx);
                nw = Math.max(120, Math.min(nw, W));
                d.card.w = nw;
            }
        },

        onPointerUp() {
            this.dragInfo = null;
        },

        // ---- слайды ----
        addSlide(type) {
            const s = type === "title" ? this.makeTitleSlide("Заголовок", "amiria.online") : this.makeGridSlide();
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
            this.selectedCardUid = null;
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
