# Trạng thái bàn giao

Cập nhật ngày 03/10/2026. Hướng dẫn cài/chạy: [README.md](../README.md).

## Git và phạm vi

- Branch `feature/work-progress`, HEAD `91e81b0` (`feat: add project task backend`); `main` ở `401041f`.
- Backend ProjectTask đã commit. Giao diện công việc và tài liệu STATUS trong lượt này còn chưa commit; không push.

## Đã triển khai

- Nền React/Vite, NestJS/TypeORM và PostgreSQL. AppModule/DataSource CLI giữ `synchronize: false`; schema dùng migration.
- Auth JWT cho `MANAGER` và `TECHNICIAN`; frontend lưu phiên trong localStorage chỉ phục vụ demo local.
- Project → Area (FLOOR/ROOM) → ProjectSystem (LAN/WIFI/CAMERA) có backend và frontend; MANAGER ghi, TECHNICIAN đọc hồ sơ công trình.
- Backend ProjectTask có một kỹ thuật viên active mỗi việc; MANAGER giao/sửa khi `ASSIGNED` hoặc `RETURNED`, duyệt/trả việc đã gửi; TECHNICIAN chỉ thấy việc của mình, bắt đầu và gửi duyệt với ghi chú bắt buộc. Migration dùng FK ghép cùng Project và `ON DELETE RESTRICT`.
- Frontend công việc trong trang công trình dùng API thật: chọn kỹ thuật viên active, tạo/sửa, bắt đầu, gửi duyệt, trả việc và duyệt; có loading/empty/error. Sau ghi thành công mà GET làm mới lỗi, form đóng, ẩn danh sách cũ và cho tải lại bằng GET.
- Chưa làm Device, checklist, nghiệm thu, bảo trì hoặc frontend test tự động riêng.

## Đã xác minh local

- `npm run build` đạt trong lượt này. Backend test 16/16 và DB/Nest HTTP test 2/2 đã đạt ở lượt backend trước; không chạy lại vì lượt này không sửa backend.
- Thử giao diện bằng Chrome local: MANAGER tạo/sửa việc → TECHNICIAN bắt đầu/gửi duyệt → MANAGER trả việc → TECHNICIAN bắt đầu/gửi lại → MANAGER duyệt. Ghi chú chỉ gồm khoảng trắng bị chặn; tải lại trang giữ trạng thái chờ duyệt và đã duyệt.
- Giả lập GET công việc thất bại sau PATCH thành công: server đã lưu, giao diện báo đúng, không hiện danh sách cũ; nút tải lại GET khôi phục dữ liệu. Ở 390 px, trang và form không tràn ngang.
- Hai công việc thử trong công trình demo còn ở PostgreSQL local (một đã duyệt, một đã giao).

## Cần lưu ý

- Khi kiểm tra, cổng 3000 đang chạy backend cũ không có Task API; lượt này dùng backend mới ở 3001 và Vite ở 5174 với `VITE_API_URL=http://localhost:3001`. Cần khởi động lại backend mặc định trước khi demo trên 3000/5173.
- `backend/.env` không được Git theo dõi; không đưa mật khẩu, JWT secret hoặc token vào repo. Chưa commit/push giao diện Task.
