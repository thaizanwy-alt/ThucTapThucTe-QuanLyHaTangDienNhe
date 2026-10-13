# Quản lý thi công điện nhẹ — nền dự án

Yêu cầu: Node.js 20.19+ và PostgreSQL đang chạy.

1. Tạo database PostgreSQL tên `electrical_infrastructure` (hoặc đổi `DB_NAME`).
2. Nếu chưa có `backend/.env`, sao chép từ `.env.example`; nếu đã có, bổ sung biến còn thiếu và giữ nguyên cấu hình local. Điền thông tin kết nối và `JWT_SECRET` (ít nhất 32 ký tự). Đặt `DEMO_MANAGER_PASSWORD` và `DEMO_TECHNICIAN_PASSWORD` (mỗi mật khẩu ít nhất 12 ký tự) khi cần chạy seed.
3. Chạy `npm install` tại thư mục gốc.
4. Chạy `npm run migration:run -w backend`, sau đó `npm run seed -w backend` để tạo hai tài khoản demo. Seed chạy lại không tạo trùng; nếu mật khẩu demo trong môi trường thay đổi, seed cập nhật hash của tài khoản tương ứng. Seed cũng khôi phục vai trò tương ứng và trạng thái active của hai tài khoản demo.
5. Mở hai terminal: `npm run dev:backend` và `npm run dev:frontend`.
6. Mở địa chỉ Vite in ra terminal (thường là http://localhost:5173); kiểm tra API tại http://localhost:3000/health.

`GET /health` trả `{"status":"ok","database":"connected"}` khi PostgreSQL kết nối và truy vấn được. Chạy `npm run build` để build cả hai ứng dụng.

`POST /auth/login` nhận JSON `{"email":"manager.demo@example.local","password":"..."}` và trả `accessToken`. Gửi `Authorization: Bearer <accessToken>` tới `GET /auth/me`. Tài khoản còn lại có email `technician.demo@example.local`; có thể đổi hai email qua biến môi trường. TypeORM giữ `synchronize: false`; bảng `users` chỉ tạo bởi migration.

Các route cần phân quyền về sau dùng `@UseGuards(JwtAuthGuard, RolesGuard)` cùng `@Roles(UserRole.MANAGER)` hoặc `@Roles(UserRole.TECHNICIAN)`; import `AuthModule` vào module chứa route. Chạy `npm run test -w backend` để kiểm tra guard.

Frontend mặc định gọi API tại `http://localhost:3000`; có thể đặt `VITE_API_URL` trong `frontend/.env.local` theo `frontend/.env.example` rồi khởi động lại Vite. Không đặt mật khẩu hoặc `JWT_SECRET` trong biến `VITE_*`. Phiên demo local dùng localStorage, kiểm tra `/auth/me` khi tải lại và xóa token khi đăng xuất, hết hạn hoặc nhận 401. API chưa có tên người dùng nên giao diện dùng email để nhận diện tài khoản.

Ngữ cảnh bàn giao: [docs/STATUS.md](docs/STATUS.md). Quy ước làm việc với repo: [AGENTS.md](AGENTS.md).

## Minh chứng (backend)

Đặt `EVIDENCE_STORAGE_DIR` trong môi trường backend thành đường dẫn tuyệt đối tới một thư mục riêng **ngoài repo**, tài khoản chạy backend có quyền đọc/ghi. `.env.example` để rỗng, không chứa đường dẫn riêng của máy. Không cấu hình storage thì ứng dụng vẫn khởi động; API cần file trả 503. File nằm trong `tmp/` và `files/`, dùng UUID do server sinh, không dùng tên gốc làm đường dẫn và không public static directory. Giữ storage ngoài Git; không đặt biến này vào `VITE_*`.

- Dưới `/projects/:projectId`: GET/POST `tasks/:taskId/evidence`, `inspections/:inspectionId/items/:itemId/evidence`, `issues/:issueId/evidence`. POST multipart gồm đúng một `file` và `caption` tùy chọn; **bắt buộc header `Idempotency-Key`** (8–128 chữ/số/`_`/`-`). Giữ cùng key/file/metadata khi retry; nội dung khác trả 409. Key unique theo Project/người tải; fingerprint gồm target, tên đã chuẩn hóa, MIME, kích thước, hash và caption trim (rỗng thành null). Retry cùng nội dung trả bản cũ (201), vẫn kiểm tra quyền hiện tại; bản đã xóa trả 404. Retry bản đã lưu được phép dù trạng thái đã khóa, không tạo thêm file hoặc thay đổi hồ sơ.
- PATCH `evidence/:id` nhận `{expectedVersion,caption}` (caption bắt buộc, được null); DELETE nhận `{expectedVersion,reason}` và trả 204. Xóa mềm giữ file disk, không có purge. GET `evidence/:id/content` tải file; GET `evidence/:id/preview` chỉ cho ảnh. Mọi route yêu cầu Bearer JWT, kiểm tra Project/ownership; không dùng token trong URL. Bản đã xóa trả 404. Không trả storage key/path hoặc password hash.
- JPEG/PNG/PDF, 1 byte–10 MiB/file, tối đa 20 file chưa xóa/target. Upload streaming; kiểm tra extension/MIME/chữ ký **không phải quét mã độc**, không bảo đảm file vô hại. Không mở PDF inline bằng preview. 400 dữ liệu sai, 401 JWT, 403 thao tác không được phép, 404 resource ngoài phạm vi/đã xóa, 409 version/trạng thái/quota/idempotency, 413 quá dung lượng, 415 loại file, 503 storage không khả dụng.
- MANAGER quản lý minh chứng; TECHNICIAN chỉ xem/upload Task hoặc Issue hiện được giao, chỉ sửa/xóa file mình tải. Task ghi trong ASSIGNED/IN_PROGRESS/RETURNED, SUBMITTED/APPROVED chỉ đọc; Issue ghi trong OPEN/IN_PROGRESS, RESOLVED/CLOSED chỉ đọc. Item chỉ MANAGER, PASS chỉ đọc. Giao lại thu hồi quyền người cũ; evidence không đổi version/trạng thái của Task/Item/Issue hoặc `passed`.

`npm run test:evidence:db -w backend` tạo/dọn DB và storage tạm (PostgreSQL cần CREATEDB). `npm run evidence:reconcile -w backend` chỉ báo cáo: file thiếu, file chưa được tham chiếu **hoặc đang xử lý**, file tạm; không tự xóa gì, kể cả file xóa mềm. Chỉ dọn file đã promote khi rollback được xác nhận trước khi thử COMMIT; nếu đã thử COMMIT mà kết quả chưa rõ thì giữ file để đối soát, không suy ra rollback từ việc truy vấn chưa thấy metadata. Sau crash, dừng ghi và kiểm tra thủ công trước khi xử lý file mồ côi; chưa có tự phục hồi/purge.

Backup: dừng API/thao tác ghi, backup PostgreSQL và toàn bộ storage thành một bộ có cùng mốc, rồi mở lại. Restore cả DB và storage trước khi chạy API; đối soát file thiếu/hash và thử download theo quyền. Không đưa backup vào Git. Quy trình backup–restore và crash recovery cần kiểm chứng riêng trên môi trường của bạn; test rollback không thay thế kiểm tra crash thật.
