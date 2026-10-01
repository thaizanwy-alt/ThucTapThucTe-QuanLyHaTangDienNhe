# Trạng thái bàn giao

Ảnh chụp trạng thái từ code và Git tại HEAD `1ebe20f`, trước khi thêm bộ tài liệu này.
Hướng dẫn cài đặt/chạy nằm trong [README.md](../README.md).

## Git

- Branch hiện tại: `feature/auth-backend`; `main` vẫn ở `f135786`.
- `f135786`: nền React/Vite, NestJS/TypeORM, PostgreSQL và `/health`.
- `0fd835c`: backend auth, migration User, seed và test guard vai trò.
- `1ebe20f`: frontend đăng nhập và phiên demo; backend auth đã có commit riêng.
- Working tree sạch trước lượt tài liệu này. `AGENTS.md`, file này và phần sửa README chưa commit.

## Đã có trong mã nguồn

- Nền dự án: npm workspaces `frontend/`, `backend/`, package-lock và mẫu env; `/health` truy vấn DB bằng `SELECT 1`.
- Backend auth: User có email unique, hash bcrypt, role và active; migration `CreateUsers1790000000000` tạo bảng `users`.
- Seed hai tài khoản demo từ biến môi trường; chạy lặp không tạo trùng, cập nhật hash khi mật khẩu đổi và khôi phục role/active.
- `POST /auth/login` nhận email/password, trả `accessToken`; JWT có thời hạn 1 giờ. `GET /auth/me` cần Bearer token, trả id/email/role/isActive, không trả hash.
- Có JWT guard và role guard. Ba test role guard được lưu trong `backend/test/roles.guard.test.cjs`.
- Frontend: form đăng nhập, lỗi/loading, tổng quan tài khoản và đăng xuất; khôi phục phiên qua `/auth/me`, xử lý hết hạn/401, có CSS cho màn hình nhỏ.

## Quyết định đã thể hiện trong repo

- PostgreSQL dùng migration; cả AppModule và DataSource CLI giữ `synchronize: false`.
- Hai vai trò: `MANAGER`, `TECHNICIAN`; API chưa có tên nên giao diện hiển thị email.
- Token lưu localStorage chỉ phục vụ demo local; URL API frontend cấu hình bằng `VITE_API_URL`.
- `.env` thật, dependencies và output build được ignore; giữ `.env.example` và package-lock trong Git.
- Chưa có module nghiệp vụ công trình/công việc; chưa có đăng ký công khai, quên mật khẩu hoặc OAuth.

## Chưa xác nhận và bước kế tiếp

- Trạng thái PostgreSQL/backend/frontend đang chạy, migration đã áp dụng trên DB hiện tại và kết quả build/test hiện tại: **chưa xác nhận** trong lượt rà tài liệu này.
- Git chỉ lưu test role guard; chưa có bộ kiểm thử API/frontend được theo dõi trong Git.
- Bước tiếp theo theo yêu cầu bàn giao: **công trình → tầng/phòng → hạng mục**. Chưa triển khai trong code.
- Trước khi triển khai, chốt field, quan hệ và quyền từng vai trò; các chi tiết nghiệp vụ này **chưa xác nhận**.
