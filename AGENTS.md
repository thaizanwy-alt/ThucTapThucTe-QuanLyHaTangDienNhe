# Quy ước làm việc

- Mục tiêu: web quản lý thi công hạ tầng điện nhẹ phục vụ thực tập.
- Repo dùng npm workspaces: `frontend/` và `backend/`.
- Frontend: React + TypeScript + Vite.
- Backend: NestJS + TypeORM; database PostgreSQL.
- Đọc `README.md` để cài/chạy; đọc `docs/STATUS.md` để nắm trạng thái bàn giao.
- Trước khi sửa, kiểm tra branch, `git status` và diff; giữ nguyên thay đổi chưa commit không thuộc nhiệm vụ.
- Mọi thay đổi schema phải có migration; giữ `synchronize: false` ở ứng dụng và DataSource CLI.
- Không đưa `.env` thật, mật khẩu, giá trị JWT_SECRET hoặc token vào Git, log hay tài liệu.
- Chỉ commit mẫu `.env.example` không có bí mật; không đặt bí mật trong biến `VITE_*`.
- Đối chiếu contract API từ code; không đoán tên field hoặc mở rộng nghiệp vụ ngoài yêu cầu.
- Hai vai trò hiện có: `MANAGER`, `TECHNICIAN`; backend chịu trách nhiệm xác thực/phân quyền.
- Lưu token trên localStorage hiện chỉ dành cho demo local.
- Sau thay đổi code, chạy `npm run build` và các kiểm thử liên quan.
- Kiểm tra diff và `git diff --check`; trước commit rà staged diff để tránh file ngoài phạm vi hoặc bí mật.
- Thay đổi chỉ tài liệu: rà nội dung/diff, không cần build lại.
- Không tự commit hoặc push; chỉ thực hiện khi người dùng yêu cầu.
