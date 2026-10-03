# Trạng thái bàn giao

Cập nhật ngày 03/10/2026. Hướng dẫn cài/chạy: [README.md](../README.md).

## Git và phạm vi

- Branch `feature/device-inventory`, HEAD `e397a89` (`feat: add project device inventory backend`); `main` ở `0146390` (`feat: add project task frontend`).
- Backend Device đã commit riêng; frontend danh mục thiết bị, kiểm thử frontend và STATUS hiện chưa stage/commit. Không push.

## Đã triển khai

- Nền React/Vite, NestJS/TypeORM và PostgreSQL. AppModule/DataSource CLI giữ `synchronize: false`; schema dùng migration.
- Auth JWT cho `MANAGER` và `TECHNICIAN`; frontend lưu phiên trong localStorage chỉ phục vụ demo local.
- Project → Area (FLOOR/ROOM) → ProjectSystem (LAN/WIFI/CAMERA) có backend và frontend; MANAGER ghi, TECHNICIAN đọc hồ sơ công trình.
- Backend ProjectTask có một kỹ thuật viên active mỗi việc; MANAGER giao/sửa khi `ASSIGNED` hoặc `RETURNED`, duyệt/trả việc đã gửi; TECHNICIAN chỉ thấy việc của mình, bắt đầu và gửi duyệt với ghi chú bắt buộc. Migration dùng FK ghép cùng Project và `ON DELETE RESTRICT`.
- Frontend công việc trong trang công trình dùng API thật: chọn kỹ thuật viên active, tạo/sửa, bắt đầu, gửi duyệt, trả việc và duyệt; có loading/empty/error. Sau ghi thành công mà GET làm mới lỗi, form đóng, ẩn danh sách cũ và cho tải lại bằng GET.
- Backend Device có sáu loại RACK/PATCH_PANEL/SWITCH/NETWORK_OUTLET/AP/CAMERA; mã unique theo Project, FK ghép cùng Project và `ON DELETE RESTRICT`. Migration `1793000000000-CreateProjectDevices` chỉ thêm Device và bảng liên kết hệ thống.
- Frontend Thiết bị trong chi tiết công trình: cả hai vai trò xem danh sách theo mã và thông tin đầy đủ; MANAGER tạo/sửa/xóa, TECHNICIAN chỉ đọc. Form khóa loại khi sửa, hỗ trợ trường tùy chọn, dung lượng rack, nhiều hệ thống và vị trí trực tiếp hoặc kế thừa từ rack. Đổi vị trí gửi cả `areaId` và `rackId` trong cùng PATCH; `systemIds` thay toàn bộ, mảng rỗng xóa liên kết.
- Chỉ Switch/Patch panel nằm trong rack; không lồng rack. `capacityU` tùy chọn, chỉ cho rack, số nguyên 1–2147483647. Sau ghi thành công nhưng GET lỗi: đóng form, ẩn danh sách cũ, khóa ghi và cho tải lại bằng GET.
- Chưa làm cổng/sơ đồ kết nối thiết bị, checklist, nghiệm thu hoặc bảo trì. Giữ nguyên luồng Task; DevicePanel dùng React key riêng để không trùng TaskPanel.

## Đã xác minh local

- `npm run build` toàn repo kết thúc exit code 0; `node --test --test-reporter=spec frontend/test/devices.test.cjs` đạt 5/5. Test dùng logic form thật: normalization, PATCH không gửi type, chuyển vị trí, xóa liên kết, null và biên capacityU.
- `frontend/test/devices.browser.cjs` chạy đạt trên Chrome headless local, Vite `http://localhost:5173` và API `http://localhost:3000`; Nest khởi động thật, `/health` trả `database: connected`. Test đọc mật khẩu demo từ `backend/.env` local, không ghi vào log/Git.
- MANAGER đăng nhập, tạo đủ sáu loại, xem đầy đủ, sửa Rack ↔ Area, nhiều hệ thống → bỏ toàn bộ; xóa có xác nhận. API thật trả 409 khi trùng mã hoặc xóa rack còn thiết bị, giao diện hiển thị lỗi.
- POST thật thành công rồi giả lập GET 503: form đóng, danh sách cũ ẩn, tạo mới bị khóa, chỉ một POST được gửi; retry GET khôi phục dữ liệu. Kiểm tra hiển thị lỗi 400/404 bằng response giả lập trong trình duyệt, không khẳng định đã gây hai lỗi này trên API thật.
- Tải lại trang giữ dữ liệu cho cả hai vai trò; TECHNICIAN không có nút ghi và xem được đầy đủ. Kiểm tra trang/dialog ở 390 px không tràn ngang, xem screenshot mobile. TaskPanel còn đúng một bản; không kiểm thử lại toàn bộ vòng duyệt Task trong lượt này.
- Chuyển trực tiếp công trình A → B: trong lúc GET của B còn chờ, Area/System/Task/Device của A đều ẩn; sau khi GET của A trả về muộn, Area/System hiển thị vẫn khớp B và panel Device/Task chỉ thuộc B.
- Chỉ tạo Device có mã thử riêng trong công trình hiện có, dọn bằng API theo thứ tự thiết bị con → rack; danh mục thiết bị có sẵn giữ nguyên. Không sửa backend/schema, không chạy migration hoặc backend test lại trong lượt frontend.

## Cần lưu ý

- Smoke test: chạy backend và Vite theo README (mặc định API `localhost:3000`, Vite `localhost:5173`), rồi chạy `node frontend/test/devices.browser.cjs`. Cần migration/seed và mật khẩu demo trong `backend/.env` local, ít nhất hai công trình; một công trình có Area và System. Node phải tìm được gói Playwright/Chromium đã cài ngoài repo; nếu không, đặt `PLAYWRIGHT_MODULE` tới thư mục gói Playwright và `CHROME_EXECUTABLE` tới Chrome local. Có thể đổi URL bằng `DEVICE_WEB_URL`/`DEVICE_API_URL`. Không thêm dependency repo chỉ cho smoke test; test tạo rồi dọn riêng Device của lượt chạy.
- Chưa kiểm thử tương tác cảm ứng trên điện thoại vật lý, nhiều người dùng cùng sửa thiết bị hoặc toàn bộ luồng Task; viewport 390 px không thay thế thiết bị thật.
- `.env` thật không được đưa vào Git; không commit/push lượt này. Bước tiếp theo cần chốt contract trước khi làm cổng/kết nối thiết bị.
