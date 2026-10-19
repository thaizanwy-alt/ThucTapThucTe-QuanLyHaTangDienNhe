# Hướng dẫn bàn giao và trình diễn

Soạn ngày 19/10/2026 trên `main`, HEAD `9bef18b`. Đối chiếu code, seed và [STATUS](STATUS.md); **không truy vấn DB, chạy seed hoặc xác minh lại giao diện trong lượt soạn này**. Mã bên dưới lấy từ fixture và kết quả đã ghi, không suy trạng thái từ tên. Trước buổi demo phải mở UI xác nhận dữ liệu còn đúng; nếu lệch, không tự reset.

## 1. Chuẩn bị và bật đúng môi trường

### PostgreSQL trước, API sau, Vite cuối

Máy local đã kiểm chứng dùng PostgreSQL 18, `127.0.0.1:55432`, database `electrical_infrastructure`, UTF8; system ID `7628257575938021648`, data directory `D:\PostgreSQLdowload\data`. Máy khác không mặc định có đường dẫn/cluster này. Không `initdb`, tạo DB mới trùng tên hoặc restore đè để xử lý lỗi kết nối.

Các lệnh dưới đây là **hướng dẫn người vận hành chạy sau**, không phải kết quả thực thi mới:

```powershell
# Trên máy local đã kiểm chứng; dùng đúng bản công cụ PostgreSQL 18.
& 'D:\PostgreSQLdowload\bin\pg_ctl.exe' status -D 'D:\PostgreSQLdowload\data'
Test-NetConnection 127.0.0.1 -Port 55432
```

Nếu cluster chưa chạy: xác nhận data directory và system ID bằng `pg_controldata` trước, kiểm tra không có server khác giữ cổng. Chỉ sau khi đúng đích mới bật cluster; không chạy thêm instance nếu service đã quản lý nó:

```powershell
& 'D:\PostgreSQLdowload\bin\pg_controldata.exe' 'D:\PostgreSQLdowload\data'
# Chỉ khi đã xác nhận đúng cluster đang tắt. Thay đường dẫn log ngoài repo.
& 'D:\PostgreSQLdowload\bin\pg_ctl.exe' start -D 'D:\PostgreSQLdowload\data' -l '<log-PostgreSQL-ngoai-repo>'
# Đăng nhập psql bằng DB_USER local; nhập mật khẩu ở prompt, không trong argv.
& 'D:\PostgreSQLdowload\bin\psql.exe' -h 127.0.0.1 -p 55432 -U '<DB_USER-local>' -d electrical_infrastructure -W
```

Trong psql, chỉ đọc để đối chiếu đích:

```sql
SELECT system_identifier FROM pg_control_system();
SELECT current_database(), inet_server_port(),
       current_setting('data_directory'), current_setting('server_encoding');
SELECT timestamp, name FROM migrations ORDER BY timestamp;
SELECT code, name, status FROM projects WHERE code = 'CT-DEMO-ELV-01';
```

Nếu không có quyền đọc định danh, nhờ người quản trị xác minh; không tự nâng quyền hoặc bỏ guard. Mốc backup 19/10 có **14 migration**, cuối là `1803000000000-AddUserAccountSecurity`. Thiếu migration, không có demo hoặc sai encoding/cluster: dừng chuẩn bị, kiểm tra cấu hình, không seed/migrate để che nhầm DB.

Node.js cần 20.19+; dependencies phải được chuẩn bị theo [README](../README.md) trước buổi demo. Từ thư mục gốc repo, mở hai terminal:

```powershell
# Terminal 1
npm run dev:backend
# Terminal 2
npm run dev:frontend
```

Mở URL Vite thực tế in ra terminal (thường `http://localhost:5173`). Nếu Vite đổi cổng vì bận, dùng cổng thực tế; không dừng nhầm tiến trình khác. Kiểm tra API riêng:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Kết quả mong đợi: `status=ok`, `database=connected`. Backend dùng `PORT` (mặc định 3000); Vite dùng `VITE_API_URL` hoặc mặc định `http://localhost:3000`. Khi đổi cấu hình phải khởi động lại tiến trình liên quan. Không chạy migration/seed trong thao tác bật lại thông thường. Nếu công cụ/sandbox không truy cập loopback nhưng PowerShell host truy cập được, dùng host; không suy ra server đã tắt.

### Cấu hình và tài khoản

Giữ `backend/.env` local, không commit/in nội dung. Kiểm tra `DB_HOST`, `DB_PORT`, `DB_NAME`, thông tin đăng nhập DB, `PORT`, `JWT_SECRET` và `EVIDENCE_STORAGE_DIR`. Biến môi trường tiến trình có thể ghi đè file; app đọc `.env`/`backend/.env`, CLI DataSource đọc `backend/.env`, nên tránh cấu hình cạnh tranh ở root hoặc terminal cũ. Không đặt secret trong `VITE_*`.

- `JWT_SECRET` ít nhất 32 ký tự; giữ ổn định khi chỉ restart. Storage phải là đường dẫn tuyệt đối ngoài repo, trỏ đúng bộ file đi cùng DB, không thay bằng thư mục rỗng để hết lỗi. Mốc backup dùng `D:\ElectricalInfrastructureStorage\evidence`; máy khác cần cấu hình riêng.
- Email demo mặc định: `manager.demo@example.local`, `technician.demo@example.local`, hoặc giá trị `DEMO_MANAGER_EMAIL`/`DEMO_TECHNICIAN_EMAIL` local đã cấu hình. Mật khẩu hiện hành chỉ lưu riêng trong `DEMO_MANAGER_PASSWORD`/`DEMO_TECHNICIAN_PASSWORD` khi công cụ cần; không chép vào guide, URL, ảnh, log hoặc slide.
- Tài khoản B nếu dùng: cặp `DEMO_SECOND_TECHNICIAN_EMAIL`/`DEMO_SECOND_TECHNICIAN_PASSWORD` phải là tài khoản đã tồn tại, active, khác ID với A và đã đổi mật khẩu bắt buộc. Không tự tạo/reset chỉ để chạy demo. Chưa xác minh lại credentials/active của B trong lượt soạn tài liệu.
- **Sửa credentials trong `.env` không thay mật khẩu DB.** Không chạy `npm run seed -w backend` để thử chữa 401: seed tài khoản có thể cập nhật hash, vai trò và active của hai tài khoản demo. Tạo/reset/đổi mật khẩu qua workflow hợp lệ khi được phép; mật khẩu mới ít nhất 12 ký tự Unicode, tối đa 72 byte UTF-8, không trim/cắt ngầm.
- User mới/reset có `mustChangePassword=true`: chỉ đổi mật khẩu/đăng xuất, chưa vào nghiệp vụ. Đổi/reset mật khẩu hoặc đổi active thu hồi JWT; đăng nhập lại, không reset tiếp. Chưa cung cấp mật khẩu mẫu nào trong tài liệu này.

| Vai trò | Những gì nên trình diễn |
| --- | --- |
| MANAGER | Hồ sơ công trình, tạo/giao/duyệt việc, kiểm tra/recheck, quản lý minh chứng, nghiệm thu và export. Quản lý tài khoản nằm riêng ngoài sáu thẻ Project. |
| TECHNICIAN | Task/Issue đang giao cho mình (kể cả trạng thái kết thúc), start/submit/resolve khi được phép; đọc danh mục/trace/rack. Chỉ đọc summary nghiệm thu CONFIRMED, không snapshot/file/export; không có evidence Item. |

Dùng hai profile/cửa sổ trình duyệt có phiên độc lập cho MANAGER và TECHNICIAN; không chia sẻ JWT. Sau giao lại, người cũ mất quyền Task/Issue và file; người mới đọc được file cũ nhưng không sửa/xóa file người khác. Kiểm tra người được giao từ dữ liệu trả về, không dựa vào email viết trong slide.

## 2. Fixture để tra cứu — không phải trạng thái DB vừa đọc

Nguồn: `backend/scripts/seed-demo.cjs`, `seed-demo-workflow.cjs` và snapshot demo 17/10 trong STATUS. Lượt restore 19/10 xác nhận lại demo, `DEMO-AC-CONFIRMED-V1` và file ghim của nó; **không đọc lại mọi fixture trong lượt viết guide**. Dùng mã để tìm, sau đó kiểm tra trường trạng thái/quan hệ thực tế trên UI. Project đích phải là `CT-DEMO-ELV-01`; fixture seed nhận diện bằng marker `DEMO_SEED:ELV-BUILDING-V1 (fictional training data)` và field/checkpoint, không chỉ bằng code.

### Cấu trúc và tủ

| Mã | Cấu hình fixture đã ghi |
| --- | --- |
| `T01`, `T02` | Hai FLOOR; ROOM `T01-KT`, `T01-SANH` thuộc T01; `T02-KT`, `T02-VP` thuộc T02. |
| `LAN-BUILDING`, `WIFI-BUILDING`, `CAMERA-BUILDING` | Category lần lượt LAN, WIFI, CAMERA; hạng mục thuộc Project, không gắn trực tiếp Area. |
| `RACK-CORE` | MAIN, 42U, đặt `T01-KT`, phục vụ tường minh `T01-KT` và `T01-SANH`. |
| `RACK-T02` | SUB của CORE, 24U, đặt `T02-KT`, phục vụ `T02-KT` và `T02-VP`. Cây quản lý **không chứng minh dây uplink**. |
| CORE — thiết bị đã xếp | `UPS-CORE` U1–2; `NVR-CORE` U4–5; `RTR-CORE` U8; `CM-CORE` U39; `SW-CORE` U40; `PP-CORE` U41; `ODF-CORE` U42. U1 ở đáy. |
| CORE — ngoài ô U | `PDU-CORE` ZERO_U; `SHELF-CORE` chưa xếp. Không vẽ chúng như đang chiếm U. |
| T02 | `SW-T02` U22; `PP-T02` U24; `ODF-T02` chưa xếp. |

Tên NVR/ODF/UPS là danh mục minh họa; không tuyên bố có quản trị NVR, giám sát điện hoặc đấu quang. Các loại mới không tự được cấp cổng RJ45.

### Trace và hồ sơ mạng

Trong **Đấu nối & tra cứu**, nhập mã Device dưới đây, không nhập UUID. FRONT/REAR là hai mặt của cùng cổng panel/outlet; SINGLE là cổng thiết bị. Tên cổng theo fixture, không suy từ tên switch.

| Mã tra | Đường đã khai báo / đoạn thiếu | IP khai báo; switch cuối |
| --- | --- | --- |
| `CAM-DIRECT` | ETH1 SINGLE → switch trực tiếp | STATIC `192.0.2.21`; `SW-CORE/ETH2`, VLAN 30, PoE bật. |
| `CAM-PANEL` | ETH1 SINGLE → `PP-CORE/P02` REAR, qua mặt FRONT → switch | STATIC `192.0.2.23`; `SW-CORE/ETH3`, VLAN 30, PoE bật. |
| `CAM-OUTLET` | ETH1 SINGLE → `OUT-CAM-T02/P01` FRONT, qua REAR → `PP-T02/P01` REAR, qua FRONT → switch | DHCP, IP null/chưa cấp; `SW-T02/ETH1`, VLAN 30, PoE bật. |
| `OUT-LOBBY` | P01 REAR → `PP-CORE/P01` REAR, qua FRONT → switch | `SW-CORE/ETH1`, VLAN 10, PoE **tắt**, không phải chưa biết. |
| `OUT-PENDING` | P01 REAR → `PP-T02/P02` REAR; **chưa có dây nhảy FRONT tới switch** | Chưa complete, không tự suy ra switch/VLAN/PoE. |
| `AP-T02` | ETH1 SINGLE → switch trực tiếp | DHCP, IP null; `SW-T02/ETH2`, VLAN 20, PoE bật. |

MAC fixture: CAM-DIRECT `AA:BB:CC:DD:EE:21`, CAM-PANEL `AA:BB:CC:DD:EE:23`, CAM-OUTLET `AA:BB:CC:DD:EE:22`, AP-T02 `AA:BB:CC:DD:EE:24`. IP/MAC/VLAN/PoE là **hồ sơ nhập tay**, không phải kết quả phát hiện online. IP camera không phải IP quản trị switch. `complete` chỉ nghĩa đường dây được khai báo đủ tới switch, không chứng minh thông mạng/nguồn/thi công thực tế.

### Công việc, kiểm tra và minh chứng

| Mã | Trạng thái/điểm dùng để trình diễn theo snapshot và seed |
| --- | --- |
| `TASK-LAN-ASSIGNED` | ASSIGNED; có evidence dùng cho hồ sơ nghiệm thu. Chỉ xem, không start/giao lại bản fixture này. |
| `TASK-WIFI-STARTED` | IN_PROGRESS. |
| `TASK-CAM-SUBMITTED` | SUBMITTED, chờ MANAGER duyệt/trả. Không bấm duyệt trên fixture gốc. |
| `TASK-CAM-RETURNED-V2` | RETURNED; fixture riêng để minh họa việc bị trả. |
| `TASK-CAM-RETURNED` (cũ) | STATUS ghi thực tế **IN_PROGRESS** ở mốc 17/10, không phải RETURNED dù tên như vậy; seed revision này giữ nguyên, không quản lý/reset nó. |
| `TASK-LAN-APPROVED`, `DEMO-TASK-EVIDENCE-LOCKED` | APPROVED; Task sau có `demo-approved-task.png` active, chỉ đọc, không bổ sung/sửa/xóa minh chứng. |
| `DEMO-INSP-LAN-PASS` | Ba mục PASS, phiếu đạt, nguồn của hồ sơ LAN. |
| `DEMO-INSP-WIFI-NOTCHECK` | Ba mục NOT_CHECKED; chưa kiểm tra, không coi là phiếu đạt. |
| `DEMO-INSP-CAM-OPEN` / `DEMO-INSP-CAM-STARTED` / `DEMO-INSP-CAM-RESOLVED` | Mỗi phiếu một FAIL + hai NOT_CHECKED; Issue tương ứng OPEN / IN_PROGRESS / RESOLVED. Tra Issue từ phiếu/item, không có mã Issue tự đặt trong guide. |
| `DEMO-INSP-CAM-CLOSED` | Ba PASS, giữ lịch sử Issue CLOSED; có `demo-closed-issue.png` active, khóa ghi. |
| `demo-current.pdf` | Minh chứng active của `TASK-LAN-ASSIGNED`, chọn trong hồ sơ LAN; PDF giả định để tải, không preview ảnh. |
| `demo-archived.png` | Đã xóa mềm ở nguồn sau khi ghim vào V1; không xuất hiện trong danh sách active, MANAGER vẫn đọc qua **File ghim của hồ sơ CONFIRMED**. |

Resolve chỉ giữ Item FAIL; MANAGER recheck khi Issue RESOLVED. Recheck FAIL trả Issue OPEN, recheck PASS đóng Issue và cập nhật Item nguyên tử. Giao lại Issue chỉ OPEN; CLOSED bất biến, FAIL lại sau CLOSED tạo lỗi mới. Phiếu đạt khi không rỗng, mọi mục PASS và không còn Issue khác CLOSED; lấy `passed`/summary từ server, không cộng tay để tuyên bố nghiệm thu.

### Nghiệm thu

| Mã hồ sơ | Trạng thái/quan hệ fixture |
| --- | --- |
| `DEMO-AC-BLOCKED` | DRAFT, chọn phiếu camera OPEN nên có blockers. |
| `DEMO-AC-READY` | DRAFT, chọn phiếu LAN PASS và `demo-current.pdf`; đủ điều kiện theo mốc fixture. Readiness phải tải mới; không bấm confirm trên bản gốc. |
| `DEMO-AC-CONFIRMED-V1` | CONFIRMED lịch sử, được V2 thay thế; pin `demo-archived.png` vẫn đọc được. Đã thử đọc file/PDF/ZIP trên bản restore 19/10. |
| `DEMO-AC-CONFIRMED-V2` | CONFIRMED, thay V1 và đã được V3 thay thế. |
| `DEMO-AC-CONFIRMED-V3` | CONFIRMED cuối chuỗi fixture; dùng quan hệ `replacedById` thực tế để xác định hiện hành. |

CONFIRMED đọc snapshot, không trộn dữ liệu sống. Replacement tạo từ bản cuối còn hiệu lực, nhập lý do và chọn tường minh hai danh sách phiếu/evidence (nháp cho phép rỗng); không tự sao chép evidence. Chỉ khi bản mới CONFIRMED, bản cũ mới được coi đã thay thế. Không gọi đây là nghiệm thu cả công trình, không tự đổi Project.status hoặc nói khách hàng đã ký.

## 3. Kịch bản chính 13 phút — chỉ xem CT-DEMO-ELV-01

Đăng nhập hai phiên trước khi bắt đầu. Mỗi bước quay bằng **Về tổng quan**, giữ sáu thẻ: Khu vực & hệ thống; Thiết bị; Công việc; Đấu nối & tra cứu; Kiểm tra; Sơ đồ tủ. Bảng dưới **không ghi DB**; tải export chỉ tạo/tự dọn file tạm trên server và lưu bản tải ở máy người xem.

| Phút | Thao tác | Điều cần nói/kiểm tra |
| --- | --- | --- |
| 0–1 | MANAGER mở đúng Project, Tổng quan và một link nhóm tổng kết rồi quay lại | Count từ API, không cộng rack lần nữa vào tổng Device; readAt là bắt đầu lượt đọc. Không đổi Project.status, không trình bày % hoàn thành hay “đủ bàn giao toàn công trình”. |
| 1–3 | Sơ đồ tủ: CORE → T02, chọn UPS/PDU/chưa xếp; sang Thiết bị, mở một camera | U1 ở đáy, UPS 2U, ZERO_U và chưa xếp tách riêng; nơi đặt/Area phục vụ; switch thuộc nhiều System. Không bấm lưu/xếp lại. |
| 3–4,5 | Tra CAM-DIRECT → CAM-PANEL → CAM-OUTLET; thêm OUT-PENDING | Ba đường hoàn chỉnh, đường thiếu rõ mã port/mặt; DHCP null không là lỗi; complete không phải ping/online. |
| 4,5–6 | MANAGER mở Công việc; phiên TECHNICIAN mở Việc của tôi | Xem ASSIGNED/IN_PROGRESS/SUBMITTED/RETURNED/APPROVED bằng bộ lọc; người được giao quyết định quyền. Không start/submit/approve fixture gốc. |
| 6–8 | Kiểm tra: phiếu NOTCHECK, PASS, OPEN/RESOLVED/CLOSED; xem lịch sử lỗi | FAIL và Issue đi cùng nhau; RESOLVED chưa đóng/chưa tự PASS; MANAGER recheck. TECHNICIAN chỉ lỗi của mình. Chỉ xem, đóng dialog bằng Escape. |
| 8–9 | Chi tiết Task APPROVED và Issue CLOSED; xem ảnh/tải file active | Có file nhưng khóa ghi; file người khác không được sửa/xóa. Với Item, chỉ MANAGER có API minh chứng. Không upload/xóa file fixture. |
| 9–11 | Hồ sơ nghiệm thu: BLOCKED → READY (tải readiness) → V1/V2/V3 | Blockers/nháp không phải xác nhận. Xem snapshot, phạm vi, lý do thay thế; V1 vẫn đọc file ghim đã xóa mềm. TECHNICIAN chỉ summary, không nút file/export. Không confirm/tạo replacement ở fixture gốc. |
| 11–13 | V1: Tải PDF/Tải gói bàn giao ZIP; Thiết bị/Đấu nối: hai nút Excel | PDF là snapshot; Excel dữ liệu hiện tại; ZIP kết hợp hai nguồn/thời điểm, chỉ evidence đã ghim. Mở PDF/workbook, xem manifest và so SHA-256 một entry ZIP, không chỉ xem tên file. |

Dành 1–2 phút dự phòng cho reload và viewport 390px: sáu thẻ, chọn tủ thay cây rộng, Tab/Shift+Tab/Escape trong dialog. Số liệu danh sách đích có thể khác lượt tổng kết do tải mới. Export chỉ MANAGER; giữ một lượt tải đang chạy, không nhấn lặp.

## 4. Khi cần thao tác ghi: fixture riêng, không đổi seed gốc

Đây là **nhánh mutation tùy chọn**, thay một phần trình diễn chỉ xem, không cộng toàn bộ vào 13 phút. Chuẩn bị trước bằng UI trên Project thử riêng được người vận hành cho phép, ví dụ mã mới `DEMO-LIVE-<ngay>-<suffix>`; tên này là **đề xuất mới**, không phải Project đã tồn tại. Tự tạo System/Area/Task/phiếu thuộc Project đó, không dùng UUID của CT-DEMO. Không có chức năng tự clone Project. Ghi lại đúng ID/code và file phát sinh; không tự dọn theo prefix.

1. Tạo Task cho TECHNICIAN A; nếu đã xác minh B thì giao A→B khi ASSIGNED/RETURNED. B start → upload ảnh khi còn được ghi → submit với ghi chú; MANAGER approve. Muốn sửa/xóa evidence B, làm **trước submit**; sau APPROVED chỉ đọc. Không reset User nếu thiếu credentials B.
2. MANAGER tạo phiếu theo category System, scope Area **hoặc** Device **hoặc** không gắn; Device phải thuộc System lúc tạo. Ghi FAIL kèm mô tả/TECHNICIAN active. Người được giao start → resolve có ghi chú; MANAGER recheck FAIL → người được giao sửa lại → recheck PASS. Recheck gửi version Item/Issue; gặp 409 đọc lại, không ép thao tác theo dữ liệu cũ.
3. Làm PASS các mục còn lại trên **phiếu thử**, tạo acceptance DRAFT, xem blockers/readiness, chọn phiếu/evidence hợp lệ rồi confirm. Tạo replacement của bản mới xác nhận, chọn rõ phiếu/evidence, nhập lý do và confirm; giữ cả snapshot cũ/mới. Nếu không đủ thời gian, chỉ dùng chuỗi fixture chỉ xem ở mục 3.

Các bước tạo/sửa/start/submit/resolve/recheck/confirm/upload/xóa mềm đều **làm đổi dữ liệu**. Nhiều đối tượng không có DELETE (Project/Task/phiếu/Issue/hồ sơ nghiệm thu); file xóa mềm vẫn giữ disk. Không hứa “demo xong tự trở về ban đầu”; muốn reset bằng restore cần kế hoạch riêng và phê duyệt đích, không restore đè nguồn trong buổi trình diễn.

Seed không phải nút reset: `seed:demo` nhận marker, field và checkpoint; lệch fixture phải dừng, không ghi đè thay đổi người dùng. OPEN/DRAFT/RETURNED có chủ đích là trạng thái cuối fixture. Chạy lại có thể tạo phần thiếu/tiếp tục checkpoint đúng, nên cũng là thao tác ghi; **không chạy chỉ để kiểm tra trước buổi diễn**. Mẫu checklist có revision/snapshot, seed mẫu không ghi đè revision. Seed tài khoản còn có thể thay hash/role/active; xem cảnh báo mục 1. Chuỗi replacement đã tiếp tục được sau gián đoạn local nhưng chưa có test tự động mô phỏng gián đoạn giữa các replacement.

## 5. Backup trước buổi demo, khởi động lại và xử lý lỗi

### Backup khi các tiến trình ghi còn tắt

Thực hiện trước bước bật backend/Vite ở mục 1. Dùng mục kiểm chứng backup–restore trong [README](../README.md): chuẩn bị `backend/dist` đúng code, `PG_BIN_DIR` (PostgreSQL 18), `EXPORT_PYTHON_BIN` có pypdf/pdfplumber; chọn `ELV_BACKUP_ROOT` ngoài repo/storage. Không cài dependency giữa buổi demo.

```powershell
node backend/scripts/backup-restore-check.cjs --preflight
node backend/scripts/backup-restore-check.cjs --execute
```

Chỉ tiếp tục sau khi đọc kết quả: đúng cluster, dump và toàn bộ storage/manifest có checksum, restore DB/storage tạm và API smoke thành công, cleanup không báo tài nguyên còn lại. Script giữ backup, không tự bật server local. Bộ có dump/TOC/storage/manifest/checksum/verification; bảo vệ bằng ACL, không đưa Git hoặc chia sẻ dump (có dữ liệu tài khoản). Nếu CREATE thành công nhưng chưa xác nhận ownership, report ghi DB giữ lại; không tự DROP. Không xóa QA/storage mồ côi. Nếu guard lệch, dừng, không sửa guard để vượt kiểm tra.

### Lỗi thường gặp

| Triệu chứng | Cách xử lý an toàn |
| --- | --- |
| Health không truy cập được | Kiểm tra đúng host/cổng và terminal backend; dùng PowerShell host nếu sandbox bị chặn. Không kết luận PostgreSQL dừng chỉ từ lỗi frontend/công cụ. |
| Health báo lỗi DB/đăng nhập DB thất bại | Đối chiếu cluster, data directory, DB_PORT/DB_NAME và biến môi trường ghi đè. Không tạo DB rỗng hoặc chạy migration/seed trước khi xác nhận đúng đích. |
| 401 | Đăng nhập lại bằng mật khẩu hiện hành; JWT cũ/thu hồi hoặc thiếu authVersion sẽ bị từ chối. Không in token, không reset User như bước xử lý mặc định. |
| PASSWORD_CHANGE_REQUIRED / 403 | Phân biệt buộc đổi mật khẩu với sai vai trò/ownership/trạng thái. TECHNICIAN không được export; đổi mật khẩu hợp lệ thì đăng nhập lại. |
| 404 sau giao lại | Quyền người cũ bị thu hồi là hành vi đúng; kiểm tra đúng User/Project/assignee trước khi coi mất dữ liệu. |
| 409 | Đọc lại resource/readiness, kiểm tra version, cổng/U bận hoặc open work. Không gửi lại mutation tự động, không force ghi đè. |
| Ghi thành công nhưng GET lỗi | Form đóng, dữ liệu cũ bị ẩn; dùng Tải lại bằng GET, không POST lại. Khi chưa biết ghi đã thành công chưa, giữ draft, kiểm tra resource trước khi thử lại. Upload retry cùng nội dung giữ Idempotency-Key trong luồng UI; sau reload/đóng form không mặc định key cũ còn giữ. |
| Evidence 413/415 hoặc storage 503 | Kiểm tra JPEG/PNG/PDF ≤10 MiB và storage đúng/quyền file. Không đổi extension để lách validator; không trỏ sang thư mục rỗng. |
| Export 503 / 504 / 413 | Bận có Retry-After: chờ tác vụ trước kết thúc; 504 là hết deadline, 413 là vượt giới hạn. Không tự retry liên tục hoặc giảm dữ liệu âm thầm. ZIP thiếu/sai hash file ghim phải thất bại toàn gói; PDF riêng có thể vẫn xuất với cảnh báo file tương ứng. |

Nếu chỉ mất Internet, khi dependencies/assets đã chuẩn bị và các tiến trình local còn chạy thì thử health localhost trước; **không có offline/PWA hoặc hàng đợi ghi đã được bảo đảm**. Khi mất kết nối giữa trình duyệt và API, dừng mutation, không nhấn Lưu nhiều lần. Khi máy/backend khởi động lại, bật đúng cluster → kiểm tra DB/storage → API health → Vite → đăng nhập/GET lại; không seed lại. Nếu nghi DB/file mất đồng bộ hoặc crash giữa upload, dừng ghi, giữ file và backup, đối soát trước khi phục hồi; chưa có tự purge/crash recovery.

Nếu cần dùng file PDF/Excel/ZIP tải sẵn làm dự phòng trình chiếu, ghi rõ **artifact của lần xuất trước**, không nói là dữ liệu vừa xuất trực tiếp. Không dùng phương án dự phòng để che một bước live thất bại.

## 6. Mức kiểm chứng và giới hạn bàn giao

- E2E Chrome/API thật trên DB/storage tạm đã hoàn tất một luồng chính: Project/Area/System, placement/network/trace, Task A→B, checklist sửa lại, evidence PNG, acceptance/replacement, PDF/XLSX/ZIP, reload/quyền/390px. Một số baseline Device/port/dây, Task/evidence A và mục PASS được tạo qua API; không mô tả toàn bộ là nhập UI. Không lặp mọi mutation trên demo local trong lượt đó.
- Giao lại Task/Issue A→B trên host có log API PASS ngày 18/10 (`MVDIO4CZ-BD660B`), fixture ở FE-TEST, **UI chưa chạy trong lượt đó**. Không chạy script reassignment như một bước demo chỉ xem: script có tạo/chuyển trạng thái/file. Nguồn có 4 User ở mốc backup không tự chứng minh đủ hai TECHNICIAN active/credentials đúng hôm diễn.
- Backup/restore thật ngày 19/10 khớp 23 bảng, sequence và 61 file; 51 file mồ côi giữ nguyên. Smoke backend restore đọc V1/file ghim/PDF/ZIP và workbook đạt. Lượt này trước ba sửa guard/report; regression sau sửa **5/5** chỉ dùng tài nguyên tạm, chưa chạy lại toàn bộ drill nguồn trên script mới.
- Full PostgreSQL/HTTP từng đạt 115/115; seed sau cách ly đạt 16/16; không gọi các mốc riêng là một full suite mới trên `main 9bef18b`. Kết quả build/test chi tiết và các lần lỗi đã xử lý nằm trong STATUS, không chạy lại khi soạn guide.
- Chưa kiểm chứng crash/mất mạng thực, WAL/PITR, restore global role/ACL hoặc filesystem ACL/timestamp; chưa có test tự động gián đoạn giữa replacement. Các lỗi browser route giả lập không chứng minh lỗi thật của storage/timeout đã được tái hiện.
- Minh chứng local, JWT/localStorage chỉ dành demo; kiểm tra MIME/chữ ký không phải quét mã độc. Chưa có giám sát online/NVR, chữ ký điện tử, PDF khách hàng ký hoặc tự hoàn thành Project. XLSX/ZIP có giới hạn tài nguyên, không tuyên bố V8 heap limit là hard limit RSS; không coi dữ liệu nhập tay/complete là kết quả nghiệm thu hiện trường.

Trước buổi diễn cần xác nhận lại: credentials/assignee, trạng thái từng fixture, file ghim còn đọc được, readiness, bộ backup mới và cổng máy đang dùng. Nếu chưa đủ bằng chứng, chọn luồng chỉ xem có dữ liệu đã xác nhận hoặc ghi rõ phần chưa trình diễn, không sửa DB trực tiếp để khớp slide.
