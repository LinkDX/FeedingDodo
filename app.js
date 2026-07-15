/* ===== 逗逗貓吃什麼 — app.js ===== */

/* ⚠️⚠️⚠️ 請替換成你自己的 Firebase 專案設定(見 README.md)⚠️⚠️⚠️
   還沒填之前會以「本機試玩模式」執行(資料只存在這台裝置的瀏覽器)。 */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBfr1OAi2cQw2tXmebTD1dcH3SdWa6D93c",
  authDomain: "feedingdodo-a1fd8.firebaseapp.com",
  databaseURL: "https://feedingdodo-a1fd8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "feedingdodo-a1fd8",
  storageBucket: "feedingdodo-a1fd8.firebasestorage.app",
  messagingSenderId: "323759958446",
  appId: "1:323759958446:web:1b92149ad60af00e3c803f",
  measurementId: "G-2FYQ7BF2Z6"
};

const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

/* ===== 分類:吃的 / 喝的 ===== */

const CATS = {
  food:  { emoji: "🍱", label: "吃的", verb: "吃" },
  drink: { emoji: "🧋", label: "喝的", verb: "喝" },
};

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
     write(updates)     — 多路徑更新,如 { "food/usedThisWeek/abc": true }
     newId()            — 產生一個新的唯一 id
     listRooms()        — 列出所有房間
     deleteRoom(id)     — 刪除房間
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
    newId() { return push(child(roomRef, "x")).key; },
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
  historyList: $("history-list"), historyEmptyHint: $("history-empty-hint"),
  btnShare: $("btn-share"),
  adminOverlay: $("admin-overlay"), adminList: $("admin-list"),
  adminEmpty: $("admin-empty"), btnAdminClose: $("btn-admin-close"),
  toast: $("toast"),
};

// 每個分類各自的一組元素(結果格 + 清單卡)
const catEl = {};
for (const cat of Object.keys(CATS)) {
  const slot = document.querySelector(`.result-slot[data-cat="${cat}"]`);
  const card = document.querySelector(`.list-card[data-cat="${cat}"]`);
  catEl[cat] = {
    drawArea: slot.querySelector(".draw-area"),
    btnDraw: slot.querySelector(".btn-draw"),
    drawHint: slot.querySelector(".draw-hint"),
    pickArea: slot.querySelector(".pick-area"),
    pickName: slot.querySelector(".pick-name"),
    btnOrder: slot.querySelector(".btn-order"),
    btnRedraw: slot.querySelector(".pick-area .btn-redraw"),
    emptyArea: slot.querySelector(".empty-area"),
    btnResetWeek: slot.querySelector(".btn-reset-week"),
    list: card.querySelector(".list"),
    count: card.querySelector(".count"),
    listEmptyHint: card.querySelector(".list-empty-hint"),
    usedBlock: card.querySelector(".used-block"),
    usedList: card.querySelector(".used-list"),
    addForm: card.querySelector(".add-form"),
    addName: card.querySelector(".add-name"),
    addUrl: card.querySelector(".add-url"),
  };
}

let backend = null;
let state = {};                          // 目前 room 資料
const rolling = { food: false, drink: false }; // 抽選動畫進行中

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

function normalizeUrl(raw) {
  const url = (raw || "").trim();
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : "https://" + url;
}

/* ===== 資料存取(依分類)===== */

const catData = (cat) => state[cat] || {};
const restaurants = (cat) => catData(cat).restaurants || {};
const usedThisWeek = (cat) => catData(cat).usedThisWeek || {};
const candidates = (cat) =>
  Object.keys(restaurants(cat)).filter((id) => !usedThisWeek(cat)[id]);

function validTodayPick(cat) {
  const p = catData(cat).todayPick;
  if (!p || p.date !== todayKey()) return null;
  const r = restaurants(cat)[p.restaurantId];
  return r ? { id: p.restaurantId, ...r } : null;
}

/* ===== 舊資料遷移(單一清單 → food)===== */

function maybeMigrateLegacy() {
  if (!state.restaurants) return false;
  const updates = {
    "food/restaurants": state.restaurants,
    restaurants: null, usedThisWeek: null, todayPick: null,
  };
  if (state.usedThisWeek) updates["food/usedThisWeek"] = state.usedThisWeek;
  if (state.todayPick) updates["food/todayPick"] = state.todayPick;
  for (const [date, h] of Object.entries(state.history || {})) {
    if (h && h.name) updates[`history/${date}`] = { food: { name: h.name, url: h.url || "" } };
  }
  backend.write(updates);
  return true; // 等下一次 watch 回呼再渲染
}

/* ===== 每週 lazy reset ===== */

function maybeResetWeek() {
  const wk = mondayKey();
  if (state.weekKey !== wk) {
    backend.write({ weekKey: wk, "food/usedThisWeek": null, "drink/usedThisWeek": null });
    return true;
  }
  return false;
}

/* ===== 抽選 ===== */

function drawRestaurant(cat) {
  if (rolling[cat]) return;
  if (maybeResetWeek()) { setTimeout(() => drawRestaurant(cat), 150); return; }

  const c = catEl[cat];
  const pool = candidates(cat);
  if (pool.length === 0) {
    // 今天已抽中但本週名單也用完 → 引導清空重抽
    c.pickArea.hidden = true;
    c.drawArea.hidden = true;
    c.emptyArea.hidden = false;
    setCat("normal", `${CATS[cat].label}全部${CATS[cat].verb}過一輪了喵…`);
    return;
  }

  rolling[cat] = true;
  c.btnDraw.disabled = true;
  c.btnRedraw.disabled = true;
  setCat("normal", "抽選中…🥁");

  const chosenId = pool[Math.floor(Math.random() * pool.length)];

  // 轉盤動畫:快速跳店名後定格
  c.drawArea.hidden = true;
  c.emptyArea.hidden = true;
  c.pickArea.hidden = false;
  c.btnOrder.hidden = true;
  c.pickName.classList.add("rolling");

  const names = pool.map((id) => restaurants(cat)[id].name);
  let tick = 0;
  const timer = setInterval(() => {
    c.pickName.textContent = names[tick % names.length];
    tick++;
  }, 90);

  setTimeout(async () => {
    clearInterval(timer);
    c.pickName.classList.remove("rolling");
    rolling[cat] = false;
    c.btnDraw.disabled = false;
    c.btnRedraw.disabled = false;

    const r = restaurants(cat)[chosenId];
    if (!r) { render(); return; } // 店家在動畫期間被刪除
    await backend.write({
      [`${cat}/usedThisWeek/${chosenId}`]: true,
      [`${cat}/todayPick`]: { date: todayKey(), restaurantId: chosenId },
      [`history/${todayKey()}/${cat}`]: { name: r.name, url: r.url || "" },
    });
    setCat("happy", `就${CATS[cat].verb}這家喵!🎉`);
  }, 1200);
}

/* ===== 自動從連結找店名 ===== */

function cleanSlug(s) {
  try { s = decodeURIComponent(s); } catch {}
  return s.replace(/-/g, " ").trim().slice(0, 40);
}

function cleanTitle(t) {
  return t
    .split(/[|｜]/)[0]
    .replace(/(外送|外賣|菜單|線上訂|網路訂|Order Online|Delivery|Menu).*$/i, "")
    .trim()
    .slice(0, 40);
}

// 第一層:從網址路徑直接解析(Uber Eats / foodpanda 的 slug 通常就是店名,零網路請求)
function guessNameFromPath(raw) {
  try {
    const url = new URL(normalizeUrl(raw));
    let m;
    if (url.hostname.includes("ubereats")) {
      m = url.pathname.match(/\/store\/([^/]+)/);
      if (m) return cleanSlug(m[1]);
    }
    if (url.hostname.includes("foodpanda")) {
      m = url.pathname.match(/\/restaurant\/[^/]+\/([^/]+)/);
      if (m) return cleanSlug(m[1]);
    }
  } catch {}
  return null;
}

// 第二層:透過公開 CORS 代理抓頁面標題(盡力而為,6 秒逾時)
async function guessNameFromTitle(raw) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      "https://api.allorigins.win/get?url=" + encodeURIComponent(normalizeUrl(raw)),
      { signal: ctrl.signal }
    );
    const j = await res.json();
    const m = (j.contents || "").match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) {
      const name = cleanTitle(m[1]);
      if (name) return name;
    }
  } catch {}
  return null;
}

async function autofillName(cat) {
  const c = catEl[cat];
  const url = c.addUrl.value.trim();
  if (!url || c.addName.value.trim()) return; // 沒連結或已手動填名字就不動

  const fromPath = guessNameFromPath(url);
  if (fromPath) {
    c.addName.value = fromPath;
    toast("已自動帶入店名,可自行修改 ✏️");
    return;
  }

  c.addName.placeholder = "🔍 正在找店名…";
  const fromTitle = await guessNameFromTitle(url);
  c.addName.placeholder = "店名(貼連結可自動帶入)";
  if (fromTitle && !c.addName.value.trim()) {
    c.addName.value = fromTitle;
    toast("已自動帶入店名,可自行修改 ✏️");
  }
}

/* ===== 畫面 ===== */

function renderSlot(cat) {
  if (rolling[cat]) return; // 動畫中不重畫結果格

  const c = catEl[cat];
  const ids = Object.keys(restaurants(cat));
  const pool = candidates(cat);
  const pick = validTodayPick(cat);

  c.drawArea.hidden = true;
  c.pickArea.hidden = true;
  c.emptyArea.hidden = true;

  if (pick) {
    c.pickArea.hidden = false;
    c.pickName.textContent = pick.name;
    if (pick.url) {
      c.btnOrder.href = pick.url;
      c.btnOrder.hidden = false;
    } else {
      c.btnOrder.hidden = true;
    }
  } else if (ids.length > 0 && pool.length === 0) {
    c.emptyArea.hidden = false;
  } else {
    c.drawArea.hidden = false;
    c.drawHint.textContent = ids.length === 0
      ? `先在下面加幾家${CATS[cat].label}的店吧!`
      : `本週還有 ${pool.length} 家可以抽`;
    c.btnDraw.disabled = ids.length === 0;
  }
}

function renderList(cat) {
  const c = catEl[cat];
  const all = restaurants(cat);
  const ids = Object.keys(all);
  const used = usedThisWeek(cat);

  c.count.textContent = ids.length ? `(${ids.length} 家)` : "";
  c.listEmptyHint.hidden = ids.length !== 0;
  c.list.innerHTML = ids
    .map((id) => {
      const r = all[id];
      const link = r.url
        ? `<a class="link-icon" href="${escapeHtml(r.url)}" target="_blank" rel="noopener" title="訂餐連結">🔗</a>`
        : "";
      const usedTag = used[id] ? `<span class="tag-used">本週已抽</span>` : "";
      return `<li>
        <span class="name ${used[id] ? "used" : ""}">${escapeHtml(r.name)}</span>
        ${usedTag}${link}
        <button class="btn-del" data-del="${id}" data-cat="${cat}" title="刪除">🗑️</button>
      </li>`;
    })
    .join("");

  const usedIds = Object.keys(used).filter((id) => all[id]);
  c.usedBlock.hidden = usedIds.length === 0;
  c.usedList.innerHTML = usedIds
    .map((id) => `<li><button class="chip" data-unuse="${id}" data-cat="${cat}">${escapeHtml(all[id].name)} ✕</button></li>`)
    .join("");
}

function renderHistory() {
  const history = state.history || {};
  const dates = Object.keys(history).sort().reverse();
  el.historyEmptyHint.hidden = dates.length !== 0;
  el.historyList.innerHTML = dates
    .map((d) => {
      const items = Object.keys(CATS)
        .filter((cat) => history[d]?.[cat]?.name)
        .map((cat) => {
          const h = history[d][cat];
          const name = h.url
            ? `<a href="${escapeHtml(h.url)}" target="_blank" rel="noopener">${escapeHtml(h.name)}</a>`
            : escapeHtml(h.name);
          return `${CATS[cat].emoji} ${name}`;
        })
        .join("<span class='dot'>・</span>");
      return items ? `<li><span class="date">${d}</span><span class="hist-items">${items}</span></li>` : "";
    })
    .join("");
}

function render() {
  for (const cat of Object.keys(CATS)) {
    renderSlot(cat);
    renderList(cat);
  }
  renderHistory();

  // 逗逗貓心情:兩樣都抽好了最開心
  if (Object.keys(CATS).every((cat) => rolling[cat])) return;
  const foodPick = validTodayPick("food");
  const drinkPick = validTodayPick("drink");
  if (foodPick && drinkPick) setCat("happy", "吃的喝的都搞定喵!😋");
  else if (foodPick) setCat("happy", "再抽個喝的吧?🧋");
  else if (drinkPick) setCat("happy", "再抽個吃的吧?🍱");
  else setCat("normal", "今天吃什麼呢?");
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
      const nFood = Object.keys(room.food?.restaurants || room.restaurants || {}).length;
      const nDrink = Object.keys(room.drink?.restaurants || {}).length;
      const lastDate = Object.keys(room.history || {}).sort().pop();
      const meta = `🍱${nFood}・🧋${nDrink}${lastDate ? `・最近 ${lastDate}` : ""}`;
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
  for (const cat of Object.keys(CATS)) {
    const c = catEl[cat];
    c.btnDraw.addEventListener("click", () => drawRestaurant(cat));
    c.btnRedraw.addEventListener("click", () => drawRestaurant(cat));

    c.btnResetWeek.addEventListener("click", () => {
      backend.write({ [`${cat}/usedThisWeek`]: null, [`${cat}/todayPick`]: null });
      toast(`已清空${CATS[cat].label}的本週紀錄 🧹`);
    });

    c.addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = c.addName.value.trim();
      if (!name) { c.addName.focus(); return; }
      const url = normalizeUrl(c.addUrl.value);
      backend.write({ [`${cat}/restaurants/${backend.newId()}`]: { name, url } });
      c.addName.value = "";
      c.addUrl.value = "";
      c.addName.focus();
      toast(`已加入「${name}」${CATS[cat].emoji}`);
    });

    // 貼上/填完連結後自動找店名
    c.addUrl.addEventListener("change", () => autofillName(cat));
    c.addUrl.addEventListener("paste", () => setTimeout(() => autofillName(cat), 50));
  }

  document.body.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      const { del: id, cat } = del.dataset;
      const name = restaurants(cat)[id]?.name || "";
      if (confirm(`確定刪除「${name}」?`)) {
        const updates = {
          [`${cat}/restaurants/${id}`]: null,
          [`${cat}/usedThisWeek/${id}`]: null,
        };
        if (catData(cat).todayPick?.restaurantId === id) updates[`${cat}/todayPick`] = null;
        backend.write(updates);
      }
    }
    const unuse = e.target.closest("[data-unuse]");
    if (unuse) {
      const { unuse: id, cat } = unuse.dataset;
      const updates = { [`${cat}/usedThisWeek/${id}`]: null };
      if (catData(cat).todayPick?.restaurantId === id) updates[`${cat}/todayPick`] = null;
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
    if (maybeMigrateLegacy()) return; // 遷移後等下一次回呼
    maybeResetWeek();
    render();
  });
}

// 換房間(hash 變更)時重新載入,確保連到正確的房間
window.addEventListener("hashchange", () => location.reload());

main();
