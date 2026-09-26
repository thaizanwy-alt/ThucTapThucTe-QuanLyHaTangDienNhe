# Quản lý thi công điện nhẹ — nền dự án

Yêu cầu: Node.js 20.19+ và PostgreSQL đang chạy.

1. Tạo database PostgreSQL tên `electrical_infrastructure` (hoặc đổi `DB_NAME`).
2. Sao chép `.env.example` thành `backend/.env`, rồi điền thông tin kết nối.
3. Chạy `npm install` tại thư mục gốc.
4. Mở hai terminal: `npm run dev:backend` và `npm run dev:frontend`.
5. Mở địa chỉ Vite in ra terminal (thường là http://localhost:5173); kiểm tra API tại http://localhost:3000/health.

`GET /health` trả `{"status":"ok","database":"connected"}` khi PostgreSQL kết nối và truy vấn được. Chạy `npm run build` để build cả hai ứng dụng.

Nền dự án chưa tạo bảng dữ liệu; TypeORM được cấu hình `synchronize: false` để tránh tự thay đổi database.
