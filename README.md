# 🎱 Bida Pool – Mini App tính điểm trên Telegram

Cloudflare Workers (API + bot) + D1 (database) + giao diện tĩnh trong `public/`.
Toàn bộ làm trên trình duyệt, **không cần cài gì lên máy**.

## Cấu trúc

```
public/          Giao diện Mini App (HTML/CSS/JS thuần)
src/index.ts     API + bot webhook
src/scoring.ts   Logic tính điểm, xếp hạng, ▲▼
src/telegram.ts  Xác thực initData của Telegram
schema.sql       Tạo bảng
seed.sql         Dữ liệu 2 buổi đầu tiên
test/            Test logic tính điểm (đã chạy pass)
wrangler.toml    Cấu hình Worker
```

## Luật tính điểm

- Thắng 1 trận: +1 điểm.
- League và Cup: Top 1 +3, Top 2 +2, Top 3 +1, còn lại +0.
- Hạng League tự tính theo số trận thắng của buổi đó, bằng nhau thì đồng hạng và cùng nhận điểm.
- Cup nhập hạng. Thắng/thua tự điền: Top 1 = 2-0, Top 2 và 3 = 1-1, Top 4 = 0-2 (sửa được).
- ▲▼ so sánh với bảng trước buổi gần nhất.

## Deploy (khoảng 20 phút)

### 1. Tạo bot Telegram
1. Chat với **@BotFather**, gõ `/newbot`, đặt tên. Lưu lại **token** (dạng `123456:ABC...`).
2. Chat với **@userinfobot** để lấy **ID Telegram** của bạn (một dãy số). Đây là ID admin.

### 2. Đưa code lên GitHub
1. Tạo repo mới trên github.com (để Private cũng được).
2. Bấm **Add file → Upload files**, kéo cả nội dung thư mục `bida-pool` vào, rồi bấm Commit.
   (Hoặc dùng `git push` nếu bạn quen.)

### 3. Tạo database D1
1. Đăng ký/đăng nhập **dash.cloudflare.com** (free, không cần thẻ).
2. Vào **Storage & Databases → D1 → Create**, đặt tên `bida-pool`.
3. Mở tab **Console**, dán toàn bộ nội dung `schema.sql` rồi bấm Execute.
   Sau đó dán `seed.sql` rồi Execute (nạp dữ liệu 2 buổi đã chơi).
   Nếu console báo lỗi khi chạy nhiều lệnh cùng lúc, chạy từng lệnh một.
4. Copy **Database ID** ở trang D1 đó.
5. Trên GitHub, mở file `wrangler.toml`, bấm ✏️, thay `00000000-0000-0000-0000-000000000000` bằng Database ID vừa copy, rồi Commit.

### 4. Tạo Worker từ GitHub
1. Vào **Workers & Pages → Create → Import a repository**, kết nối GitHub và chọn repo vừa tạo.
2. Project name: `bida-pool`. Build command để trống, Deploy command giữ `npx wrangler deploy`.
3. Bấm Deploy. Xong sẽ có link dạng `https://bida-pool.<tên-bạn>.workers.dev`.
   Từ giờ mỗi lần sửa code trên GitHub, Cloudflare tự deploy lại.

### 5. Khai báo biến bí mật
Vào Worker **bida-pool → Settings → Variables and Secrets → Add**:

| Tên | Loại | Giá trị |
|---|---|---|
| `BOT_TOKEN` | Secret | token từ BotFather |
| `WEBHOOK_SECRET` | Secret | một chuỗi tự đặt, chỉ chữ và số, VD `bidaPool2026xyz` |
| `ADMIN_IDS` | Text | ID Telegram của admin, nhiều người thì cách nhau dấu phẩy |

Bấm Deploy/Save để áp dụng.

### 6. Kết nối bot với app
Mở link sau trên trình duyệt (thay đúng tên miền và secret):

```
https://bida-pool.<tên-bạn>.workers.dev/bot/setup?key=<WEBHOOK_SECRET>
```

Thấy 3 dòng `"ok": true` là xong.

### 7. Dùng
- Chat riêng với bot: bấm nút menu **Bảng xếp hạng** cạnh ô chat để mở app. Admin sẽ thấy thêm tab **Nhập buổi** và **Cơ thủ**.
- Thêm bot vào group bida, gõ `/bxh` để bot gửi bảng xếp hạng dạng chữ vào group.

## Ghi chú
- Chỉ ID có trong `ADMIN_IDS` mới thêm/sửa/xoá được. Người khác chỉ xem.
- Ngày của Buổi 1 trong `seed.sql` đang để 11/11/2026. Nếu sai, vào **Các buổi → Sửa**.
- Sao lưu: mở `https://.../api/export` từ trong app (admin) để lấy JSON, hoặc vào D1 Console chạy `SELECT * FROM results`.

## Chạy thử trên máy (không bắt buộc, cần Node.js)

```
npm install
npm test
printf 'DEV_MODE=1\n' > .dev.vars   # chỉ dùng local: bỏ qua đăng nhập, ai cũng là admin
npm run db:local
npm run dev                          # mở http://localhost:8787
```
