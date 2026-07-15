# 逗逗貓吃什麼 🐱🐾 (FeedingDodo)

不知道要吃什麼的時候,讓逗逗貓幫你抽!兩人共用同一份店家清單與紀錄,把網址貼到 Messenger 對話就能一起用。

## 功能

- 🎲 從店家清單隨機抽選,**本週抽過的不再出現**(每週一台北時間重置)
- 🔄 不滿意可以重抽(剛抽過的也不會再出現)
- 📌 當日抽中的結果會釘選:當天再打開頁面,雙方都看到同一家店
- 🛵 店家可選填訂餐連結(如 Uber Eats),抽中後一鍵去點餐
- ➕ 新增/刪除店家、列出所有店家
- 📖 過去每天吃什麼的抽選紀錄
- 🔗 分享連結給另一半,清單與紀錄即時同步(Firebase)
- 🛠️ 隱藏管理介面:**連點逗逗貓 5 次**,列出所有現存房間並可切換

## 部署步驟

### 1. 建立 Firebase 專案(免費,用來讓兩人資料同步)

1. 到 [Firebase Console](https://console.firebase.google.com) → 「新增專案」(名稱隨意,例如 `feeding-dodo`,Analytics 可以不開)
2. 左側「建構 → Realtime Database」→「建立資料庫」→ 地區選 `asia-southeast1`(新加坡,離台灣最近)→ 以「鎖定模式」啟動
3. 到資料庫的「規則」頁籤,貼上以下規則後發布:

   ```json
   {
     "rules": {
       "rooms": {
         ".read": true,
         "$roomId": {
           ".write": true
         }
       }
     }
   }
   ```

   > 安全性說明:`rooms` 開放整層讀取是為了讓隱藏管理介面能列出所有房間。這代表知道你資料庫網址的人可以讀到所有房間內容 — 對午餐抽選 app 來說可接受;不要放敏感資料。

4. 回到專案首頁 → 齒輪「專案設定」→「你的應用程式」→ 新增「網頁應用程式」(`</>` 圖示)→ 註冊後複製 `firebaseConfig` 內容
5. 打開本專案的 `app.js`,把最上面的 `firebaseConfig` 換成你複製的內容(**`databaseURL` 一定要有**;若複製出來的設定沒有,到 Realtime Database 頁面上方複製資料庫網址補上,長得像 `https://xxx-default-rtdb.asia-southeast1.firebasedatabase.app`)

> 還沒設定 Firebase 之前,頁面會以「本機試玩模式」執行,資料只存在自己的瀏覽器,無法兩人同步。

### 2. 部署到 GitHub Pages

1. 在 GitHub 建一個 repo(例如 `FeedingDodo`),把這個資料夾的檔案 push 上去
2. Repo → Settings → Pages → Source 選 `Deploy from a branch`,Branch 選 `main` / `/ (root)` → Save
3. 等一兩分鐘,網頁就會出現在 `https://<你的帳號>.github.io/FeedingDodo/`

### 3. 開始使用

1. 打開網頁,網址會自動加上房間 id(`#r=xxxxxxxx`)
2. 新增幾家店(可以順手貼上 Uber Eats 連結)
3. 按「🔗 複製分享連結」,把連結貼到 Messenger 傳給另一半 — 對方打開就是同一份清單
4. 之後兩人都從這個連結(建議加到書籤/Messenger 釘選訊息)進入

## 本機開發

```
python -m http.server 8000
```

打開 `http://localhost:8000` 即可(未填 Firebase 設定時走本機試玩模式)。

## 常見問題

- **為什麼不是 Messenger 機器人?** Messenger 的 bot 無法加入兩個個人帳號的私人對話(bot 只能掛在粉絲專頁下做 1:1 客服對話),所以改用「網頁 + 對話中貼連結」的方式達成一起抽選。
- **「本週」怎麼算?** 台北時間每週一 00:00 重置。抽過(含重抽跳過)的店家該週不再出現;可以在「本週已抽」點一下把店家放回候選。
