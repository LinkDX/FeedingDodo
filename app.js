/* ===== 逗逗貓吃什麼 — app.js ===== */

/* ⚠️⚠️⚠️ 請替換成你自己的 Firebase 專案設定(見 README.md)⚠️⚠️⚠️
   還沒填之前會以「本機試玩模式」執行(資料只存在這台裝置的瀏覽器)。 */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT",
  appId: "YOUR_APP_ID",
};

const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

/* ===== 台北時間日期工具 ===== */

// 今天日期(Asia/Taipei),格式 YYYY-MM-DD
function todayKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

// 本週週一日期(Asia/Taipei),格式 YYYY-MM-DD
function mondayKey() {
  const today = todayKey();
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "short",
  }).format(new Date());
  const offsets = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - offsets[weekdayName]);
  return d.toISOString().slice(0, 10);
}

/* ===== 儲存後端(Firebase / 本機)=====
   介面:
     watch(cb)          — 資料變動時以整個 room 物件呼叫 cb
     write(updates)     — 多路徑更新,如 { "usedThisWeek/abc": true, "todayPick": {...} }
     newId()            — 產生一個新的唯一 id
*/

function makeLocalBackend(roomId) {
  const storeKey = `feedingdodo/${roomId}`;
  let cb = null;

  const read = () => JSON.parse(localStorage.getItem(storeKey) || "{}");
  const notify = () => cb && cb(read());

  // 跨分頁同步(方便開兩個分頁測試)
  window.addEventListener("storage", (e) => {
    if (e.key === storeKey) notify();
  });

  return {
    watch(fn) { cb = fn; notify(); },
    async write(updates) {
      const data = read();
      for (const [path, value] of Object.entries(updates)) {
        const keys = path.split("/");
        let node = data;
        for (let i = 0; i < keys.length - 1; i++) {
          if (typeof node[keys[i]] !== "object" || node[keys[i]] === null) node[keys[i]] = {};
          node = node[keys[i]];
        }
        const last = keys[keys.length - 1];
        if (value === null) delete node[last];
        else node[last] = value;
      }
      localStorage.setItem(storeKey, JSON.stringify(data));
      notify();
    },
    newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    async listRooms() {
      const rooms = {};
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("feedingdodo/")) {
          rooms[key.slice("feedingdodo/".length)] = JSON.parse(localStorage.getItem(key) || "{}");
        }
      }
      return rooms;
    },
    async deleteRoom(id) { localStorage.removeItem(`feedingdodo/${id}`); },
  };
}

async function makeFirebaseBackend(roomId) {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getDatabase, ref, onValue, update, push, child, get, remove } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");

  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);
  const roomRef = ref(db, `rooms/${roomId}`);

  return {
    watch(fn) { onValue(roomRef, (snap) => fn(snap.val() || {})); },
    async write(updates) { await update(roomRef, updates); },
    newId() { return push(child(roomRef, "restaurants")).key; },
    async listRooms() {
      const snap = await get(ref(db, "rooms"));
      return snap.val() || {};
    },
    async deleteRoom(id) { await remove(ref(db, `rooms/${id}`)); },
  };
}

/* ===== 房間 ===== */

function getRoomId() {
  // 1. 網址上有 room id → 直接用,並記住它
  // 2. 沒有 → 回到這個瀏覽器上次用的房間
  // 3. 都沒有 → 建新房間
  const m = location.hash.match(/r=([A-Za-z0-9_-]+)/);
  const id = m ? m[1]
    : (localStorage.getItem("feedingdodo:lastRoom") ||
       Math.random().toString(36).slice(2, 10));
  localStorage.setItem("feedingdodo:lastRoom", id);
  history.replaceState(null, "", `#r=${id}`);
  return id;
}

/* ===== DOM ===== */

const $ = (id) => document.getElementById(id);
const el = {
  localBanner: $("local-banner"),
  cat: $("cat"), catFace: $("cat-face"), catBubble: $("cat-bubble"),
  drawArea: $("draw-area"), btnDraw: $("btn-draw"), drawHint: $("draw-hint"),
  pickArea: $("pick-area"), pickName: $("pick-name"),
  btnOrder: $("btn-order"), btnRedraw: $("btn-redraw"),
  emptyArea: $("empty-area"), btnResetWeek: $("btn-reset-week"),
  restaurantList: $("restaurant-list"), restaurantCount: $("restaurant-count"),
  listEmptyHint: $("list-empty-hint"),
  addForm: $("add-form"), addName: $("add-name"), addUrl: $("add-url"),
  usedCard: $("used-card"), usedList: $("used-list"),
  adminOverlay: $("admin-overlay"), adminList: $("admin-list"),
  adminEmpty: $("admin-empty"), btnAdminClose: $("btn-admin-close"),
  historyList: $("history-list"), historyEmptyHint: $("history-empty-hint"),
  btnShare: $("btn-share"),
  toast: $("toast"),
};

let backend = null;
let state = {};       // 目前 room 資料
let rolling = false;  // 抽選動畫進行中

/* ===== 小工具 ===== */

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

function setCat(mood, bubbleText) {
  const open = el.catFace.querySelector(".eyes-open");
  const happy = el.catFace.querySelector(".eyes-happy");
  open.style.display = mood === "happy" ? "none" : "";
  happy.style.display = mood === "happy" ? "" : "none";
  el.catBubble.textContent = bubbleText;
  el.cat.classList.toggle("happy", mood === "happy");
  if (mood === "happy") {
    el.cat.addEventListener("animationend", () => el.cat.classList.remove("happy"), { once: true });
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ===== 資料存取 ===== */

const restaurants = () => state.restaurants || {};
const usedThisWeek = () => state.usedThisWeek || {};
const candidates = () =>
  Object.keys(restaurants()).filter((id) => !usedThisWeek()[id]);

function validTodayPick() {
  const p = state.todayPick;
  if (!p || p.date !== todayKey()) return null;
  const r = restaurants()[p.restaurantId];
  return r ? { id: p.restaurantId, ...r } : null;
}

/* ===== 每週 lazy reset ===== */

function maybeResetWeek() {
  const wk = mondayKey();
  if (state.weekKey !== wk) {
    backend.write({ weekKey: wk, usedThisWeek: null });
    return true; // 已觸發重置,等下一次 watch 回呼
  }
  return false;
}

/* ===== 抽選 ===== */

function drawRestaurant() {
  if (rolling) return;
  if (maybeResetWeek()) { setTimeout(drawRestaurant, 150); return; }

  const pool = candidates();
  if (pool.length === 0) {
    // 今天已抽中但本週名單也用完 → 引導清空重抽
    el.pickArea.hidden = true;
    el.drawArea.hidden = true;
    el.emptyArea.hidden = false;
    setCat("normal", "全部吃過一輪了喵…");
    return;
  }

  rolling = true;
  el.btnDraw.disabled = true;
  el.btnRedraw.disabled = true;
  setCat("normal", "抽選中…🥁");

  const chosenId = pool[Math.floor(Math.random() * pool.length)];

  // 轉盤動畫:快速跳店名後定格
  el.drawArea.hidden = true;
  el.emptyArea.hidden = true;
  el.pickArea.hidden = false;
  el.btnOrder.hidden = true;
  el.pickName.classList.add("rolling");

  const names = pool.map((id) => restaurants()[id].name);
  let tick = 0;
  const timer = setInterval(() => {
    el.pickName.textContent = names[tick % names.length];
    tick++;
  }, 90);

  setTimeout(async () => {
    clearInterval(timer);
    el.pickName.classList.remove("rolling");
    rolling = false;
    el.btnDraw.disabled = false;
    el.btnRedraw.disabled = false;

    const r = restaurants()[chosenId];
    if (!r) { render(); return; } // 店家在動畫期間被刪除
    await backend.write({
      [`usedThisWeek/${chosenId}`]: true,
      todayPick: { date: todayKey(), restaurantId: chosenId },
      [`history/${todayKey()}`]: { name: r.name, url: r.url || "" },
    });
    setCat("happy", "就吃這家喵!🎉");
  }, 1200);
}

/* ===== 畫面 ===== */

function render() {
  if (rolling) return; // 動畫中不重畫結果卡

  const all = restaurants();
  const ids = Object.keys(all);
  const used = usedThisWeek();
  const pick = validTodayPick();
  const pool = candidates();

  // --- 今日結果卡片 ---
  el.drawArea.hidden = true;
  el.pickArea.hidden = true;
  el.emptyArea.hidden = true;

  if (pick) {
    el.pickArea.hidden = false;
    el.pickName.textContent = pick.name;
    if (pick.url) {
      el.btnOrder.href = pick.url;
      el.btnOrder.hidden = false;
    } else {
      el.btnOrder.hidden = true;
    }
    setCat("happy", "今天吃這家喵!😋");
  } else if (ids.length > 0 && pool.length === 0) {
    el.emptyArea.hidden = false;
    setCat("normal", "全部吃過一輪了喵…");
  } else {
    el.drawArea.hidden = false;
    el.drawHint.textContent = ids.length === 0
      ? "先在下面加幾家店吧!"
      : `本週還有 ${pool.length} 家可以抽`;
    el.btnDraw.disabled = ids.length === 0;
    setCat("normal", "今天吃什麼呢?");
  }

  // --- 店家清單 ---
  el.restaurantCount.textContent = ids.length ? `(${ids.length} 家)` : "";
  el.listEmptyHint.hidden = ids.length !== 0;
  el.restaurantList.innerHTML = ids
    .map((id) => {
      const r = all[id];
      const link = r.url
        ? `<a class="link-icon" href="${escapeHtml(r.url)}" target="_blank" rel="noopener" title="訂餐連結">🔗</a>`
        : "";
      const usedTag = used[id] ? `<span class="tag-used">本週已抽</span>` : "";
      return `<li>
        <span class="name ${used[id] ? "used" : ""}">${escapeHtml(r.name)}</span>
        ${usedTag}${link}
        <button class="btn-del" data-del="${id}" title="刪除">🗑️</button>
      </li>`;
    })
    .join("");

  // --- 本週已抽 ---
  const usedIds = Object.keys(used).filter((id) => all[id]);
  el.usedCard.hidden = usedIds.length === 0;
  el.usedList.innerHTML = usedIds
    .map((id) => `<li><button class="chip" data-unuse="${id}">${escapeHtml(all[id].name)} ✕</button></li>`)
    .join("");

  // --- 歷史紀錄 ---
  const history = state.history || {};
  const dates = Object.keys(history).sort().reverse();
  el.historyEmptyHint.hidden = dates.length !== 0;
  el.historyList.innerHTML = dates
    .map((d) => {
      const h = history[d];
      const name = h.url
        ? `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener">${escapeHtml(h.name)}</a>`
        : escapeHtml(h.name);
      return `<li><span class="date">${d}</span><span>${name}</span></li>`;
    })
    .join("");
}

/* ===== 隱藏管理介面(連點貓咪 5 次)===== */

let currentRoomId = null;

async function openAdmin() {
  el.adminList.innerHTML = "<li class='hint'>載入中…</li>";
  el.adminOverlay.hidden = false;

  const rooms = await backend.listRooms();
  // 依最近抽選日期排序(新的在前),沒紀錄的排最後
  const entries = Object.entries(rooms).sort((a, b) => {
    const last = (r) => Object.keys(r[1].history || {}).sort().pop() || "";
    return last(b).localeCompare(last(a));
  });

  el.adminEmpty.hidden = entries.length !== 0;
  el.adminList.innerHTML = entries
    .map(([id, room]) => {
      const count = Object.keys(room.restaurants || {}).length;
      const lastDate = Object.keys(room.history || {}).sort().pop();
      const meta = `${count} 家店${lastDate ? `・最近抽選 ${lastDate}` : ""}`;
      const action = id === currentRoomId
        ? `<span class="tag-used">目前所在</span>`
        : `<button class="chip" data-goto="${escapeHtml(id)}">進入</button>
           <button class="btn-del" data-delroom="${escapeHtml(id)}" title="刪除房間">🗑️</button>`;
      return `<li>
        <div class="admin-room"><code>${escapeHtml(id)}</code><span class="hint">${meta}</span></div>
        ${action}
      </li>`;
    })
    .join("");
}

function bindAdmin() {
  let clicks = 0, timer = null;
  el.cat.addEventListener("click", () => {
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 1500);
    if (clicks >= 5) { clicks = 0; openAdmin(); }
  });

  el.btnAdminClose.addEventListener("click", () => { el.adminOverlay.hidden = true; });
  el.adminOverlay.addEventListener("click", async (e) => {
    if (e.target === el.adminOverlay) el.adminOverlay.hidden = true;
    const goto = e.target.closest("[data-goto]");
    if (goto) location.hash = `#r=${goto.dataset.goto}`; // hashchange 會自動重新載入
    const delRoom = e.target.closest("[data-delroom]");
    if (delRoom) {
      const id = delRoom.dataset.delroom;
      if (confirm(`確定永久刪除房間「${id}」?裡面的清單與紀錄都會消失。`)) {
        await backend.deleteRoom(id);
        toast("房間已刪除 🗑️");
        openAdmin(); // 重新整理列表
      }
    }
  });
}

/* ===== 事件 ===== */

function bindEvents() {
  el.btnDraw.addEventListener("click", drawRestaurant);
  el.btnRedraw.addEventListener("click", drawRestaurant);

  el.btnResetWeek.addEventListener("click", () => {
    backend.write({ usedThisWeek: null, todayPick: null });
    toast("已清空本週紀錄 🧹");
  });

  el.addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el.addName.value.trim();
    if (!name) return;
    let url = el.addUrl.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    backend.write({ [`restaurants/${backend.newId()}`]: { name, url } });
    el.addName.value = "";
    el.addUrl.value = "";
    el.addName.focus();
    toast(`已加入「${name}」🍽️`);
  });

  document.body.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const id = del.dataset.del;
      const name = restaurants()[id]?.name || "";
      if (confirm(`確定刪除「${name}」?`)) {
        const updates = { [`restaurants/${id}`]: null, [`usedThisWeek/${id}`]: null };
        if (state.todayPick?.restaurantId === id) updates.todayPick = null;
        backend.write(updates);
      }
    }
    const unuse = e.target.closest("[data-unuse]");
    if (unuse) {
      const id = unuse.dataset.unuse;
      const updates = { [`usedThisWeek/${id}`]: null };
      if (state.todayPick?.restaurantId === id) updates.todayPick = null;
      backend.write(updates);
      toast("已放回本週候選 ↩️");
    }
  });

  el.btnShare.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("連結已複製,貼給另一半吧 💌");
    } catch {
      prompt("複製這個連結分享:", location.href);
    }
  });
}

/* ===== 啟動 ===== */

async function main() {
  const roomId = getRoomId();
  currentRoomId = roomId;

  if (isConfigured) {
    backend = await makeFirebaseBackend(roomId);
  } else {
    backend = makeLocalBackend(roomId);
    el.localBanner.hidden = false;
  }

  bindEvents();
  bindAdmin();
  backend.watch((data) => {
    state = data || {};
    maybeResetWeek();
    render();
  });
}

// 換房間(hash 變更)時重新載入,確保連到正確的房間
window.addEventListener("hashchange", () => location.reload());

main();
