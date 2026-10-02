# Trạng thái bàn giao

Cập nhật ngày 03/10/2026. Hướng dẫn cài/chạy: [README.md](../README.md).

## Git và phạm vi

- Branch `feature/project-structure`, HEAD `bda5341` (backend Project Structure). `main` và `feature/auth-backend` ở `65fee4b`.
- Đã commit: nền dự án, backend auth, frontend login, tài liệu quy ước, backend Project → Area → ProjectSystem.
- Chưa commit: sửa export JWT trong `AuthModule`, frontend Project Structure, chỉnh `backend/.env.example` và tài liệu trạng thái này. Không push.

## Đã triển khai

- React/Vite và NestJS/TypeORM dùng PostgreSQL; AppModule và DataSource CLI giữ `synchronize: false`, thay đổi schema qua migration.
- Auth có hai vai trò `MANAGER` và `TECHNICIAN`, JWT `/auth/login` và `/auth/me`; phiên frontend lưu localStorage chỉ cho demo local.
- Backend có Project, ProjectArea (FLOOR/ROOM), ProjectSystem (LAN/WIFI/CAMERA), DTO, migration, API và phân quyền: MANAGER ghi, TECHNICIAN đọc.
- Frontend có danh sách/tạo/sửa công trình, cây tầng/phòng, danh sách/tạo/sửa/xóa hạng mục, trạng thái tải/rỗng/lỗi, bố cục mobile. Lỗi mã trùng nay hiển thị ngay trong hộp thoại.
- Chưa triển khai Task, Device, tiến độ, checklist, nghiệm thu hay các nghiệp vụ ngoài phạm vi.

## Đã xác minh trên máy local

- `npm run build` đạt; `npm run test -w backend` đạt 8/8 sau sửa frontend.
- Backend ở `localhost:3000`; `/health` trả `database: connected`.
- Chrome local: MANAGER đăng nhập, tạo/sửa công trình, thêm FLOOR → ROOM và LAN/WIFI/CAMERA. Tải lại trang vẫn thấy tên đã sửa, tầng, phòng và đủ ba hạng mục.
- TECHNICIAN đăng nhập, xem được cùng công trình; giao diện không hiện thao tác ghi. Kiểm thử HTTP trước đó xác nhận POST/PATCH của TECHNICIAN trả 403.
- Lỗi trùng mã hiện trong hộp thoại; ở chiều rộng 390 px, trang không tràn ngang và khu vực chi tiết xem được.
- Dữ liệu kiểm thử local còn trong database: công trình `TEST-LOCAL-1790962973373` và `FE-TEST-1790963672478`.

## Cần lưu ý

- Frontend chưa có test tự động riêng; các luồng trên được kiểm tra tương tác bằng Chrome local trong lượt này.
- `backend/.env` không được Git theo dõi. Các biến mật khẩu/JWT trong `.env.example` đã rỗng; host/port trong mẫu vẫn là cấu hình local từ thay đổi chưa commit.
- Rà diff và quyết định dữ liệu kiểm thử local trước khi commit. Không có API xóa Project.
