# Quản lý thi công điện nhẹ — nền dự án

Yêu cầu: Node.js 20.19+ và PostgreSQL đang chạy.

1. Tạo database PostgreSQL tên `electrical_infrastructure` (hoặc đổi `DB_NAME`).
2. Sao chép `.env.example` thành `backend/.env`, rồi điền thông tin kết nối và `JWT_SECRET` (ít nhất 32 ký tự). Đặt `DEMO_MANAGER_PASSWORD` và `DEMO_TECHNICIAN_PASSWORD` (mỗi mật khẩu ít nhất 12 ký tự) khi cần chạy seed.
3. Chạy `npm install` tại thư mục gốc.
4. Chạy `npm run migration:run -w backend`, sau đó `npm run seed -w backend` để tạo hai tài khoản demo. Seed chạy lại không tạo trùng; nếu mật khẩu demo trong môi trường thay đổi, seed cập nhật hash của tài khoản tương ứng.
5. Mở hai terminal: `npm run dev:backend` và `npm run dev:frontend`.
6. Mở địa chỉ Vite in ra terminal (thường là http://localhost:5173); kiểm tra API tại http://localhost:3000/health.

`GET /health` trả `{"status":"ok","database":"connected"}` khi PostgreSQL kết nối và truy vấn được. Chạy `npm run build` để build cả hai ứng dụng.

`POST /auth/login` nhận JSON `{"email":"manager.demo@example.local","password":"..."}` và trả `accessToken`. Gửi `Authorization: Bearer <accessToken>` tới `GET /auth/me`. Tài khoản còn lại có email `technician.demo@example.local`; có thể đổi hai email qua biến môi trường. TypeORM giữ `synchronize: false`; bảng `users` chỉ tạo bởi migration.

Các route cần phân quyền về sau dùng `@UseGuards(JwtAuthGuard, RolesGuard)` cùng `@Roles(UserRole.MANAGER)` hoặc `@Roles(UserRole.TECHNICIAN)`; import `AuthModule` vào module chứa route. Chạy `npm run test -w backend` để kiểm tra guard.
