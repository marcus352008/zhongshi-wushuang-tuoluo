/* 中史無雙 draw-app — 學校 email 輸入（無 OAuth／GIS）
 * VERSION: draw-app 0.5.4
 * 翻卡可跳過 → 放大詳情（須按「返回」）；收藏可點開；3:4 人物圖位
 */
(function () {
  const VERSION_FALLBACK = "draw-app 0.5.4";
  const EMAIL_KEY = "wushuang_draw_email";
  const NAME_KEY = "wushuang_draw_name";
  const MUTE_KEY = "wushuang_draw_sfx_mute";
  const PROOF_KEY = "wushuang_draw_auth_proof";
  const GOOGLE_KEY = "wushuang_draw_google_email";
  let authBridgeUrl = "";
  let authBridgeOn = false;
  let authProof = localStorage.getItem(PROOF_KEY) || "";
  let googleEmailStored = localStorage.getItem(GOOGLE_KEY) || "";
  const FLIP_MS = 6000; // 陀螺旋轉 6s
  const FLIP_LEGEND_MS = 6500; // 傳說略長
  const API_TIMEOUT_MS = 12000;
  /** /api/draw only — GAS write can exceed 12s; never auto-retry POST */
  const DRAW_TIMEOUT_MS = 25000;
  const ART_BASE = "/cards/"; // future: /cards/{cardId}.png

  const $ = (id) => document.getElementById(id);
  let email = localStorage.getItem(EMAIL_KEY) || "";
  let displayName = localStorage.getItem(NAME_KEY) || "";
  let sfxMuted = localStorage.getItem(MUTE_KEY) !== "0";
  let flipSkipHandler = null;
  let flipTimer = null;
  let spinSoundTimer = null;
  let modalLocked = false; // during flip, back waits until revealed
  let onModalClose = null;
  /** Last successful refresh snapshot — for draw timeout reconcile */
  let lastSnap = {
    remaining: null,
    ownedIds: [],
    drawIds: [],
    items: [],
  };

  /** Headers must be ISO-8859-1 — never put CJK (姓名) in header values. */
  function headers() {
    const h = { "content-type": "application/json" };
    if (email) h["x-user-email"] = email; // school emails are ASCII
    if (authProof && email && googleEmailStored) {
      // typed|google|token — Worker verifies HMAC
      h["x-auth-proof"] = email + "|" + googleEmailStored + "|" + authProof;
    }
    return h;
  }

  function clearAuthProof() {
    authProof = "";
    googleEmailStored = "";
    localStorage.removeItem(PROOF_KEY);
    localStorage.removeItem(GOOGLE_KEY);
  }

  function saveAuthProof(googleEmail, token) {
    googleEmailStored = (googleEmail || "").trim().toLowerCase();
    authProof = token || "";
    if (googleEmailStored && authProof) {
      localStorage.setItem(GOOGLE_KEY, googleEmailStored);
      localStorage.setItem(PROOF_KEY, authProof);
    } else {
      clearAuthProof();
    }
  }

  /**
   * 開 GAS 橋彈窗（Execute as User → ActiveUser email），等 postMessage。
   */
  function runAuthBridge(typedEmail) {
    return new Promise(function (resolve, reject) {
      if (!authBridgeOn || !authBridgeUrl) {
        // Preview stub：無橋時唔彈窗（Worker ALLOW_MOCK_AUTH 先准）
        resolve({ skipped: true });
        return;
      }
      var origin = window.location.origin;
      var url =
        authBridgeUrl +
        (authBridgeUrl.indexOf("?") >= 0 ? "&" : "?") +
        "typedEmail=" +
        encodeURIComponent(typedEmail) +
        "&returnOrigin=" +
        encodeURIComponent(origin);
      var popup = window.open(url, "wushuang_auth_bridge", "width=480,height=640");
      if (!popup) {
        reject(
          new Error(
            "請允許彈出視窗。若曾空白：請先用學校 Google 帳單獨開核對頁完成授權，再返嚟登入。"
          )
        );
        return;
      }
      var done = false;
      var gotMessage = false;
      var closeGraceTimer = null;

      function finishReject(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(closedPoll);
        if (closeGraceTimer) clearTimeout(closeGraceTimer);
        window.removeEventListener("message", onMsg);
        reject(err);
      }

      function finishResolve(d) {
        if (done) return;
        done = true;
        gotMessage = true;
        clearTimeout(timer);
        clearInterval(closedPoll);
        if (closeGraceTimer) clearTimeout(closeGraceTimer);
        window.removeEventListener("message", onMsg);
        try { popup.close(); } catch (e) {}
        resolve(d);
      }

      var timer = setTimeout(function () {
        if (done || gotMessage) return;
        try { popup.close(); } catch (e) {}
        finishReject(
          new Error(
            "Google 登入核對逾時。請用學校帳單獨開啟核對連結完成授權後再試。"
          )
        );
      }, 45000);

      // When popup closes before message: grace-wait ~800ms for late postMessage
      // (GAS HtmlService iframe may deliver after window.closed flips true).
      var closedPoll = setInterval(function () {
        if (done || gotMessage) return;
        try {
          if (popup.closed) {
            clearInterval(closedPoll);
            if (closeGraceTimer) return;
            closeGraceTimer = setTimeout(function () {
              if (done || gotMessage) return;
              clearTimeout(timer);
              window.removeEventListener("message", onMsg);
              done = true;
              reject(new Error("核對視窗已關閉，請再試登入。"));
            }, 800);
          }
        } catch (e) {}
      }, 400);

      function onMsg(ev) {
        if (done) return;
        // GAS HtmlService 來源係 googleusercontent／script.google.com
        var d = ev && ev.data;
        if (!d || d.type !== "wushuang-auth-bridge") return;
        gotMessage = true;
        if (closeGraceTimer) {
          clearTimeout(closeGraceTimer);
          closeGraceTimer = null;
        }
        clearTimeout(timer);
        clearInterval(closedPoll);
        window.removeEventListener("message", onMsg);
        try { popup.close(); } catch (e) {}
        if (d.ok && d.match && d.token) {
          finishResolve(d);
        } else {
          done = true;
          reject(
            new Error(
              (d && d.error) ||
                "輸入帳號與 Google 帳號不符，無法登入。若彈窗空白，請先單獨開核對頁授權。"
            )
          );
        }
      }
      window.addEventListener("message", onMsg);
    });
  }

  async function api(path, opts) {
    opts = opts || {};
    let url = path;
    // UTF-8 name via query (GET) — encodeURIComponent is safe
    if (displayName) {
      const sep = url.indexOf("?") >= 0 ? "&" : "?";
      url = url + sep + "name=" + encodeURIComponent(displayName);
    }
    let body = opts.body;
    const method = (opts.method || "GET").toUpperCase();
    if (method === "POST" && displayName) {
      try {
        const parsed = body ? JSON.parse(body) : {};
        if (parsed.name == null || parsed.name === "") parsed.name = displayName;
        body = JSON.stringify(parsed);
      } catch (_) {
        /* leave body as-is */
      }
    }
    const timeoutMs =
      typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
        ? opts.timeoutMs
        : API_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        body: body !== undefined ? body : opts.body,
        headers: { ...headers(), ...(opts.headers || {}) },
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && (e.name === "AbortError" || e.name === "TimeoutError")) {
        const err = new Error("連線逾時，請稍後再試。");
        err.status = 408;
        throw err;
      }
      throw e;
    }
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function showMain(on) {
    $("login-panel").classList.toggle("hidden", on);
    $("main-panel").classList.toggle("hidden", !on);
  }

  function setLoginError(msg) {
    const el = $("login-error");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rarityClass(r) {
    const ok = ["普通", "優秀", "史詩", "傳說"];
    return ok.indexOf(r) >= 0 ? r : "優秀";
  }

  function updateMuteButton() {
    const btn = $("btn-mute");
    if (!btn) return;
    btn.textContent = sfxMuted ? "音效：關" : "音效：開";
    btn.setAttribute("aria-pressed", sfxMuted ? "true" : "false");
  }

  /* 陀螺高速旋轉音效 */
  function startSpinSfx(rarity) {
    if (sfxMuted) return;
    stopSpinSfx();
    const isLegend = rarity === "傳說";
    let step = 0;
    spinSoundTimer = setInterval(() => {
      if (sfxMuted) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = isLegend ? "sawtooth" : "sine";
        const baseFreq = isLegend ? 260 + step * 35 : 200 + step * 20;
        o.frequency.setValueAtTime(Math.min(baseFreq, 920), ctx.currentTime);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(isLegend ? 0.045 : 0.03, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.11);
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.12);
        setTimeout(() => ctx.close().catch(() => {}), 180);
        step++;
      } catch (_) {}
    }, 220);
  }

  function stopSpinSfx() {
    if (spinSoundTimer) {
      clearInterval(spinSoundTimer);
      spinSoundTimer = null;
    }
  }

  /* 揭曉音效（傳說卡擁有專屬號角和弦） */
  function playRevealSfx(rarity) {
    if (sfxMuted) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();

      if (rarity === "傳說") {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
        notes.forEach((freq, idx) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "triangle";
          const start = ctx.currentTime + idx * 0.075;
          o.frequency.setValueAtTime(freq, start);
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(0.09, start + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.65);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(start);
          o.stop(start + 0.68);
        });
        setTimeout(() => ctx.close().catch(() => {}), 1200);
        return;
      }

      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(520, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(
        rarity === "史詩" ? 1046 : 880,
        ctx.currentTime + 0.15
      );
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.34);
      setTimeout(() => ctx.close().catch(() => {}), 450);
    } catch (_) {}
  }

  function artUrl(cardId) {
    return ART_BASE + encodeURIComponent(cardId) + ".png";
  }

  function portraitHtml(c) {
    const r = rarityClass(c.rarity || "");
    const slot = c.slot || "";
    const id = c.id || "";
    return (
      '<div class="portrait slot-' +
      escapeHtml(slot) +
      " rarity-frame-" +
      escapeHtml(r) +
      '" data-card-id="' +
      escapeHtml(id) +
      '">' +
      '<div class="portrait-ph">' +
      '<span class="slot-tag">' +
      escapeHtml(slot || "—") +
      "</span>" +
      "<span>人物圖待上</span>" +
      "</div>" +
      '<img alt="" decoding="async" src="' +
      escapeHtml(artUrl(id)) +
      '" />' +
      "</div>"
    );
  }

  function bindPortraitImages(root) {
    if (!root) return;
    root.querySelectorAll(".portrait img").forEach((img) => {
      const wrap = img.closest(".portrait");
      const show = () => {
        img.classList.add("loaded");
        if (wrap) wrap.classList.add("has-art");
      };
      const hide = () => {
        img.classList.remove("loaded");
        if (wrap) wrap.classList.remove("has-art");
      };
      if (img.complete) {
        if (img.naturalWidth > 0) show();
        else hide();
        return;
      }
      img.addEventListener("load", show, { once: true });
      img.addEventListener("error", hide, { once: true });
    });
  }

  function statsHtml(c) {
    const cells = [
      ["攻", c.atk],
      ["防", c.def],
      ["續", c.sta_decay],
      ["速", c.spd],
      ["穩", c.mas],
      ["爆", c.br],
    ];
    return (
      '<div class="stats-row">' +
      cells
        .map(
          ([lab, v]) =>
            "<span>" +
            lab +
            "<strong>" +
            escapeHtml(v != null && v !== "" ? String(v) : "—") +
            "</strong></span>"
        )
        .join("") +
      "</div>"
    );
  }

  function sparksHtml(count) {
    let html = '<div class="fx-particles" aria-hidden="true">';
    for (let i = 0; i < count; i++) {
      const left = Math.round(10 + Math.random() * 80);
      const delay = (Math.random() * 1.8).toFixed(2);
      const dur = (1.8 + Math.random() * 1.4).toFixed(2);
      const dx = Math.round((Math.random() - 0.5) * 70);
      html +=
        '<span class="fx-spark" style="left:' +
        left +
        "%;--delay:" +
        delay +
        "s;--dur:" +
        dur +
        "s;--dx:" +
        dx +
        'px"></span>';
    }
    html += "</div>";
    return html;
  }

  function detailHtml(c, opts) {
    opts = opts || {};
    const r = rarityClass(c.rarity || "");
    const isLegend = r === "傳說";
    return (
      '<div class="detail-wrap detail-wrap-' +
      escapeHtml(r) +
      '">' +
      (opts.flash && isLegend ? '<div class="fx-flash"></div>' : "") +
      (isLegend ? '<div class="fx-rays" aria-hidden="true"></div>' + sparksHtml(14) : "") +
      '<div class="detail-card rarity-frame-' +
      escapeHtml(r) +
      '">' +
      (isLegend && opts.headline === "抽到！"
        ? '<div class="legend-banner">★ 傳說無雙降臨 ★</div>'
        : "") +
      (opts.headline ? "<h2>" + escapeHtml(opts.headline) + "</h2>" : "") +
      portraitHtml(c) +
      '<span class="rarity-badge ' +
      escapeHtml(r) +
      '">' +
      escapeHtml(r || "—") +
      "</span>" +
      '<p class="name" id="modal-card-name">' +
      escapeHtml(c.name || "") +
      "</p>" +
      '<p class="meta">' +
      escapeHtml(c.era_role || "") +
      "</p>" +
      '<p class="meta">' +
      escapeHtml(c.slot || "") +
      " · Cost " +
      escapeHtml(String(c.cost ?? "")) +
      "</p>" +
      "<p>" +
      escapeHtml(c.main_label || "") +
      "</p>" +
      (c.sub_mod
        ? '<p class="hint">' + escapeHtml(c.sub_mod) + "</p>"
        : "") +
      statsHtml(c) +
      '<p class="lore">' +
      escapeHtml(c.lore_28 || "") +
      "</p>" +
      (opts.isDuplicate
        ? '<p class="dup">呢張你已有（重複；碎片規則未定）</p>'
        : opts.headline === "抽到！"
          ? '<p class="new-tag">新卡入圖鑑！</p>'
          : "") +
      (opts.count != null
        ? '<div class="count-badge">擁有 ×' +
          escapeHtml(String(opts.count)) +
          "</div>"
        : "") +
      (opts.remaining != null
        ? '<p class="hint">剩餘抽數：' + opts.remaining + "</p>"
        : "") +
      "</div>" +
      "</div>"
    );
  }

  function openModal() {
    const m = $("card-modal");
    m.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (modalLocked) return;
    stopSpinSfx();
    const m = $("card-modal");
    m.classList.add("hidden");
    $("modal-body").innerHTML = "";
    document.body.style.overflow = "";
    const cb = onModalClose;
    onModalClose = null;
    if (cb) cb();
  }

  function clearFlipListeners() {
    stopSpinSfx();
    if (flipTimer) {
      clearTimeout(flipTimer);
      flipTimer = null;
    }
    if (flipSkipHandler) {
      const box = $("modal-body");
      if (box) box.removeEventListener("click", flipSkipHandler);
      flipSkipHandler = null;
    }
  }

  function showDetailInModal(c, opts) {
    modalLocked = false;
    $("modal-body").innerHTML = detailHtml(c, opts);
    bindPortraitImages($("modal-body"));
    openModal();
    $("btn-modal-back").focus();
  }

  function playFlipReveal(data) {
    return new Promise((resolve) => {
      clearFlipListeners();
      modalLocked = true;
      onModalClose = () => resolve();
      openModal();
      const c = data.card || {};
      const r = rarityClass(c.rarity || "");
      const isLegend = r === "傳說";
      const opts = {
        headline: "抽到！",
        isDuplicate: data.isDuplicate,
        remaining: data.remainingDraws,
        flash: true,
      };
      const reduceMotion =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      let settled = false;
      let landTimer = null;
      const cardElRef = { el: null };

      function finish(instant) {
        if (settled) return;
        settled = true;
        clearFlipListeners();
        if (landTimer) {
          clearTimeout(landTimer);
          landTimer = null;
        }
        const cardEl = cardElRef.el || $("flip-card-el");

        if (instant) {
          playRevealSfx(r);
          showDetailInModal(c, opts);
          return;
        }

        // Landing climax: reveal front face in place (gyro ended front-facing)
        if (cardEl) cardEl.classList.add("art-revealed");
        const stage = $("modal-body").querySelector(".flip-stage");
        if (isLegend && stage && !stage.querySelector(".fx-flash")) {
          const flash = document.createElement("div");
          flash.className = "fx-flash";
          stage.insertBefore(flash, stage.firstChild);
        }
        playRevealSfx(r);

        // Settle briefly so user sees land + flash, then amplify full detail
        landTimer = setTimeout(() => {
          landTimer = null;
          showDetailInModal(c, opts);
        }, 550);
      }

      if (reduceMotion) {
        finish(true);
        return;
      }

      // detailHtml lives on .flip-front for landing FX, but stays hidden until
      // .art-revealed (CSS visibility) so mid-spin never leaks portrait.
      $("modal-body").innerHTML =
        '<div class="flip-stage spinning rarity-stage-' +
        escapeHtml(r) +
        '" role="button" tabindex="0" aria-label="點擊跳過翻卡">' +
        '<div class="fx-aura" aria-hidden="true"></div>' +
        '<div class="fx-rays" aria-hidden="true"></div>' +
        (isLegend ? sparksHtml(16) : "") +
        '<div class="flip-card" id="flip-card-el">' +
        '<div class="flip-face flip-back">' +
        '<div class="seal">無雙</div>' +
        '<div class="hint-tap">陀螺蓄力中… 點擊可即揭</div>' +
        "</div>" +
        '<div class="flip-face flip-front">' +
        detailHtml(c, { ...opts, flash: false }) +
        "</div>" +
        "</div>" +
        '<button type="button" class="skip" id="btn-skip-flip">跳過／即揭</button>' +
        "</div>";
      bindPortraitImages($("modal-body"));
      startSpinSfx(r);

      const cardEl = $("flip-card-el");
      cardElRef.el = cardEl;
      // Force reflow then add .flipped so CSS animation auto-starts (no second tap)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (settled || !cardEl) return;
          void cardEl.offsetWidth;
          cardEl.classList.add("flipped");
        });
      });

      flipSkipHandler = (ev) => {
        if (ev.target && ev.target.id === "btn-modal-back") return;
        ev.preventDefault();
        finish(true);
      };
      $("modal-body").addEventListener("click", flipSkipHandler);
      const skipBtn = $("btn-skip-flip");
      if (skipBtn) {
        skipBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          finish(true);
        });
      }
      const duration = isLegend ? FLIP_LEGEND_MS : FLIP_MS;
      flipTimer = setTimeout(() => finish(false), duration);
      if (cardEl) {
        cardEl.addEventListener(
          "animationend",
          (ev) => {
            if (ev.target !== cardEl) return;
            if (!String(ev.animationName || "").startsWith("gyro-spin")) return;
            finish(false);
          },
          { once: true }
        );
      }
    });
  }

  function renderCollection(data) {
    const box = $("collection");
    const empty = $("collection-empty");
    box.innerHTML = "";
    if (!data.items || data.items.length === 0) {
      empty.classList.remove("hidden");
      empty.textContent = data.message || "尚未有卡。";
      return;
    }
    empty.classList.add("hidden");
    for (const it of data.items) {
      const c = it.card || {};
      const r = rarityClass(c.rarity || "");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-tile rarity-tile-" + r;
      btn.setAttribute(
        "aria-label",
        "查看 " + (c.name || it.cardId)
      );
      btn.innerHTML =
        '<div class="tile-thumb">' +
        '<div class="ph">人物圖待上</div>' +
        '<img alt="" decoding="async" src="' +
        escapeHtml(artUrl(c.id || it.cardId)) +
        '" />' +
        "</div>" +
        '<div class="name">' +
        escapeHtml(c.name || it.cardId) +
        "</div>" +
        (c.rarity
          ? '<span class="rarity-badge ' +
            escapeHtml(r) +
            '">' +
            escapeHtml(r) +
            "</span>"
          : "") +
        '<div class="slot">' +
        escapeHtml(c.slot || "") +
        " · Cost " +
        escapeHtml(String(c.cost ?? "")) +
        "</div>" +
        "<div>" +
        escapeHtml(c.main_label || "") +
        "</div>" +
        '<div class="hint">×' +
        it.count +
        "</div>";
      const thumbImg = btn.querySelector(".tile-thumb img");
      const thumb = btn.querySelector(".tile-thumb");
      const ph = btn.querySelector(".tile-thumb .ph");
      if (thumbImg) {
        const showThumb = () => {
          thumbImg.classList.add("loaded");
          if (thumb) thumb.classList.add("has-art");
          if (ph) ph.style.display = "none";
        };
        const hideThumb = () => {
          thumbImg.classList.remove("loaded");
          if (thumb) thumb.classList.remove("has-art");
        };
        if (thumbImg.complete) {
          if (thumbImg.naturalWidth > 0) showThumb();
          else hideThumb();
        } else {
          thumbImg.addEventListener("load", showThumb, { once: true });
          thumbImg.addEventListener("error", hideThumb, { once: true });
        }
      }
      btn.addEventListener("click", () => {
        onModalClose = null;
        showDetailInModal(c, {
          count: it.count,
          isDuplicate: it.count > 1,
        });
      });
      box.appendChild(btn);
    }
  }

  function renderLog(data) {
    const ul = $("draw-log");
    ul.innerHTML = "";
    if (!data.items || data.items.length === 0) {
      ul.innerHTML = "<li class='hint'>未有記錄</li>";
      return;
    }
    for (const e of data.items) {
      const li = document.createElement("li");
      li.textContent =
        e.drawnAt +
        " · " +
        e.cardName +
        "（" +
        e.cardId +
        "）" +
        (e.isDuplicate ? " 〔重複〕" : "");
      ul.appendChild(li);
    }
  }

  async function refresh() {
    // Parallel: /api/me + collection + log (roster cached server-side)
    const [me, col, log] = await Promise.all([
      api("/api/me"),
      api("/api/collection"),
      api("/api/log?limit=15"),
    ]);
    $("version").textContent = me.version || VERSION_FALLBACK;
    $("user-email").textContent = me.email;
    $("user-name").textContent = displayName ? "（" + displayName + "）" : "";
    $("credited-min").textContent = String(me.creditedMinutes);
    $("entitled").textContent = String(me.entitledDraws);
    $("used").textContent = String(me.drawLogCount);
    $("remaining").textContent = String(me.remainingDraws);
    $("study-source").textContent = "";
    $("study-source").classList.add("hidden");
    const rem = Number(me.remainingDraws) || 0;
    $("btn-draw").disabled = rem < 1;
    let drawHint = $("draw-hint");
    if (!drawHint) {
      drawHint = document.createElement("p");
      drawHint.id = "draw-hint";
      drawHint.className = "hint";
      $("btn-draw").insertAdjacentElement("afterend", drawHint);
    }
    drawHint.textContent =
      rem < 1
        ? "剩餘 0 抽：請先溫習 Flash Card（每 10 分鐘＝1 抽）。"
        : "";
    renderCollection(col);
    renderLog(log);
    lastSnap = {
      remaining: rem,
      ownedIds: (col.items || []).map(function (it) {
        return String(it.cardId || (it.card && it.card.id) || "");
      }).filter(Boolean),
      drawIds: (log.items || []).map(function (e) {
        return String(e.drawId || "");
      }).filter(Boolean),
      items: col.items || [],
      logItems: log.items || [],
    };
    return { me: me, col: col, log: log };
  }

  /**
   * After draw timeout/abort: refresh and detect if server already wrote.
   * Never auto-retries POST /api/draw (冪等 risk).
   * @returns {{ ok: boolean, data?: object, message?: string }}
   */
  async function reconcileAfterDrawTimeout(preSnap) {
    let pack;
    try {
      pack = await refresh();
    } catch (e) {
      return { ok: false, message: e.message || "重新整理失敗" };
    }
    const remNow = Number(pack.me.remainingDraws);
    const remBefore =
      preSnap && preSnap.remaining != null
        ? Number(preSnap.remaining)
        : null;
    const ownedBefore = new Set((preSnap && preSnap.ownedIds) || []);
    const drawBefore = new Set((preSnap && preSnap.drawIds) || []);
    const newOwned = (pack.col.items || []).filter(function (it) {
      const id = String(it.cardId || (it.card && it.card.id) || "");
      return id && !ownedBefore.has(id);
    });
    const newDraws = (pack.log.items || []).filter(function (e) {
      const id = String(e.drawId || "");
      return id && !drawBefore.has(id);
    });
    const remDropped =
      remBefore != null && Number.isFinite(remNow) && remNow < remBefore;
    if (!remDropped && newOwned.length === 0 && newDraws.length === 0) {
      return { ok: false };
    }
    // Prefer newest log entry for card identity
    let card = null;
    let isDuplicate = false;
    if (newDraws.length > 0) {
      const d = newDraws[0];
      const fromCol = (pack.col.items || []).find(function (it) {
        return String(it.cardId) === String(d.cardId);
      });
      card = (fromCol && fromCol.card) || {
        id: d.cardId,
        name: d.cardName,
        slot: d.slot,
        cost: d.cost,
        rarity: "",
      };
      isDuplicate = !!d.isDuplicate;
    } else if (newOwned.length > 0) {
      card = newOwned[0].card || {
        id: newOwned[0].cardId,
        name: "",
        rarity: "",
      };
      isDuplicate = false;
    }
    const data = {
      ok: true,
      card: card,
      isDuplicate: isDuplicate,
      remainingDraws: remNow,
      reconciled: true,
    };
    return { ok: true, data: data };
  }

  async function doEnter(em, name) {
    email = (em || "").trim().toLowerCase();
    displayName = (name || "").trim();
    if (!email) {
      setLoginError("請輸入學校 email。");
      return;
    }
    setLoginError("");
    // 主規則：GAS ActiveUser vs 輸入；相符先入
    try {
      if (authBridgeOn) {
        const bridge = await runAuthBridge(email);
        if (!bridge.skipped) {
          if (
            (bridge.typedEmail || "").toLowerCase() !== email ||
            !(bridge.ok && bridge.match && bridge.token)
          ) {
            throw new Error(
              (bridge && bridge.error) || "輸入帳號與 Google 帳號不符，無法登入"
            );
          }
          saveAuthProof(bridge.googleEmail, bridge.token);
        }
      } else {
        clearAuthProof();
      }
      await refresh();
    } catch (e) {
      email = "";
      displayName = "";
      clearAuthProof();
      localStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem(NAME_KEY);
      showMain(false);
      setLoginError(e.message || String(e));
      throw e;
    }
    localStorage.setItem(EMAIL_KEY, (em || "").trim().toLowerCase());
    email = (em || "").trim().toLowerCase();
    displayName = (name || "").trim();
    if (displayName) localStorage.setItem(NAME_KEY, displayName);
    else localStorage.removeItem(NAME_KEY);
    showMain(true);
  }

  $("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("btn-enter");
    const prev = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "核對中…";
    }
    try {
      await doEnter($("school-email").value, $("school-name").value);
    } catch (e) {
      showMain(false);
      setLoginError(e.message || String(e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev || "進入";
      }
    }
  });

  $("btn-logout").addEventListener("click", () => {
    email = "";
    displayName = "";
    clearAuthProof();
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(NAME_KEY);
    showMain(false);
    setLoginError("");
  });

  $("btn-refresh").addEventListener("click", () => {
    refresh().catch((e) => alert(e.message));
  });

  $("btn-mute").addEventListener("click", () => {
    sfxMuted = !sfxMuted;
    localStorage.setItem(MUTE_KEY, sfxMuted ? "1" : "0");
    updateMuteButton();
  });
  updateMuteButton();

  $("btn-modal-back").addEventListener("click", () => closeModal());

  $("btn-draw").addEventListener("click", async () => {
    const btn = $("btn-draw");
    if (btn.disabled) {
      alert("剩餘 0 抽：請先溫習 Flash Card（每 10 分鐘＝1 抽）。");
      return;
    }
    const prevLabel = btn.textContent;
    // Snapshot before POST — for timeout reconcile (do NOT auto-retry draw)
    const preSnap = {
      remaining: lastSnap.remaining != null
        ? lastSnap.remaining
        : Number($("remaining").textContent),
      ownedIds: (lastSnap.ownedIds || []).slice(),
      drawIds: (lastSnap.drawIds || []).slice(),
    };
    btn.disabled = true;
    btn.textContent = "抽卡／寫入中…";
    let revealed = false;
    try {
      const body = displayName ? JSON.stringify({ name: displayName }) : "{}";
      const data = await api("/api/draw", {
        method: "POST",
        body: body,
        timeoutMs: DRAW_TIMEOUT_MS,
      });
      $("draw-result").classList.add("hidden");
      await playFlipReveal(data);
      revealed = true;
    } catch (e) {
      const isTimeout =
        e &&
        (e.status === 408 ||
          /逾時|timeout|aborted/i.test(String(e.message || "")));
      if (isTimeout) {
        btn.textContent = "對帳中…";
        try {
          const rec = await reconcileAfterDrawTimeout(preSnap);
          if (rec.ok && rec.data && rec.data.card && rec.data.card.id) {
            $("draw-result").classList.add("hidden");
            await playFlipReveal(rec.data);
            revealed = true;
          } else if (rec.ok) {
            alert(
              "抽卡已成功（伺服器已入帳）。重新整理後可喺圖鑑睇卡。"
            );
            revealed = true;
          } else {
            alert((e.data && e.data.error) || e.message || "連線逾時，請稍後再試。");
          }
        } catch (re) {
          alert(
            "連線逾時。若圖鑑／剩餘有變，即係已抽中——請撳重新整理，唔好連撳抽卡。"
          );
        }
      } else {
        alert((e.data && e.data.error) || e.message || "抽卡失敗");
      }
    } finally {
      btn.textContent = prevLabel || "抽 1 張";
      // Always refresh to restore remaining/disabled; never leave button stuck
      // Skip second refresh if reconcile already refreshed (still safe to refresh)
      try {
        await refresh();
      } catch (_) {
        btn.disabled = false;
      }
    }
  });

  function boot() {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        $("version").textContent = h.version || VERSION_FALLBACK;
        authBridgeOn = !!h.authBridge;
        authBridgeUrl = h.authBridgeUrl || "";
        var hint = "";
        if (authBridgeOn) {
          hint =
            "進入時會彈窗核對 Chrome／Google 帳；不符則拒。若彈窗空白請先單獨開核對頁授權。";
        } else {
          hint =
            "Google 登入核對橋尚未啟用（待 Deploy GAS）。預覽模式可暫入。";
        }
        if (h.sheets) {
          hint += h.mockStudy ? "溫習時數暫用 mock。" : "";
        }
        $("login-hint").textContent = hint;
      })
      .catch(function () {})
      .finally(function () {
        if (email) {
          $("school-email").value = email;
          $("school-name").value = displayName;
          // 有 proof 先自動入；否則要再走彈窗
          if (authProof && googleEmailStored) {
            doEnter(email, displayName).catch(function (e) {
              showMain(false);
              setLoginError((e && e.message) || "無法登入");
            });
          }
        }
      });
  }
  boot();
})();
