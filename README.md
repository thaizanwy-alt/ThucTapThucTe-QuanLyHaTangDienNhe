# Hệ thống quản lý hạ tầng mạng và điện nhẹ

Ứng dụng web quản lý thông tin thi công **LAN, WiFi và camera**, từ danh mục thiết bị, đường dây và phân công công việc đến kiểm tra, minh chứng, nghiệm thu và xuất hồ sơ bàn giao.

Dự án thực tập của **Thái Văn Quý — 23IT227**, sinh viên Công nghệ thông tin tại Trường Đại học Công nghệ Thông tin và Truyền thông Việt – Hàn, Đại học Đà Nẵng (VKU). Sản phẩm được phát triển và kiểm chứng trong môi trường **local với dữ liệu mẫu**; chưa có bằng chứng triển khai production hoặc kết quả định lượng tại khách hàng.

> Trace chỉ phản ánh đường dây đã khai báo, không giám sát mạng online. Cây rack là phân cấp quản lý, không chứng minh có dây uplink. Acceptance CONFIRMED xác nhận phạm vi phiếu được chọn, không đồng nghĩa khách hàng đã ký hoặc toàn công trình đã nghiệm thu; không tự đổi Project.status.

## Chức năng chính

| Nhóm | Đã triển khai |
| --- | --- |
| Công trình | Project, tầng/phòng FLOOR/ROOM, System LAN/WIFI/CAMERA; tổng kết theo vai trò và điều hướng sáu thẻ |
| Thiết bị và rack | Vị trí Area/Rack, MAIN/SUB, Area phục vụ, bố trí U và PDU ZERO_U; kiểm tra chồng lấn/sức chứa |
| Đấu nối | Port/mặt cổng, dây cố định/dây nhảy, trace tới switch, rewire có version; IP/MAC CAMERA/AP, access VLAN/PoE trên switch port |
| Công việc | Phân công, giao lại khi được phép, bắt đầu, gửi duyệt, trả lại và duyệt |
| Kiểm tra và lỗi | Mẫu có revision, snapshot tiêu chí, NOT_CHECKED/PASS/FAIL; Issue OPEN → IN_PROGRESS → RESOLVED → CLOSED và recheck |
| Minh chứng | JPEG/PNG/PDF, quyền theo target/người tải/trạng thái, idempotent upload, version và xóa mềm |
| Nghiệm thu | DRAFT/CONFIRMED, readiness, snapshot bất biến, ghim evidence và replacement |
| Bàn giao | PDF snapshot, hai workbook XLSX dữ liệu hiện tại, ZIP kèm manifest SHA-256 |
| Tài khoản | Quản lý TECHNICIAN, mật khẩu tạm, buộc đổi mật khẩu, vô hiệu hóa có kiểm tra việc mở và thu hồi JWT bằng authVersion |

**MANAGER** quản lý danh mục/tài khoản, phân công, duyệt, kiểm tra và xuất hồ sơ chi tiết. **TECHNICIAN** xử lý Task/Issue hiện được giao, đọc danh mục và summary được phép; chỉ sửa/xóa evidence mình tải khi trạng thái cho phép. Item evidence chỉ MANAGER; TECHNICIAN chỉ đọc tóm tắt acceptance CONFIRMED, không đọc snapshot/file nghiệm thu. Backend kiểm tra quyền, ownership và trạng thái, không chỉ ẩn nút trên UI.

## Công nghệ và cấu trúc

React 19 + TypeScript + Vite ở frontend; NestJS 11 + TypeORM + PostgreSQL ở backend; JWT và bcryptjs cho xác thực. Backend là **ứng dụng nguyên khối phân module**, có worker XLSX riêng, không phải microservices. File evidence lưu local ngoài repo, DB lưu metadata. Schema thay đổi bằng migration, **`synchronize: false`** ở ứng dụng và TypeORM CLI.

| Đường dẫn | Nội dung |
| --- | --- |
| `frontend/src/`, `frontend/test/` | UI, API client, session và kiểm thử frontend |
| `backend/src/` | Auth, nghiệp vụ, entity, migration, export và font/license |
| `backend/test/` | Logic, PostgreSQL/HTTP, harness DB tạm và browser E2E |
| `backend/scripts/` | Seed dữ liệu mẫu, smoke và backup/restore chuyên biệt; đọc phạm vi trước khi chạy |
| `docs/` | Trạng thái kiểm chứng, hướng dẫn trình diễn và sơ đồ PlantUML/SVG/PNG |
| `package.json`, `package-lock.json` | npm workspaces `frontend`/`backend`, dependency khóa phiên bản |

## Yêu cầu môi trường

- Node.js **20.19+**, npm tương thích và Git. Đây là mốc hướng dẫn của dự án, chưa khai báo `engines` tại các workspace; runtime dùng khi rà README là Node 24.14.0, không phải chứng nhận mọi phiên bản Node đều đã được kiểm thử.
- PostgreSQL đang chạy; lịch sử kiểm chứng dùng **PostgreSQL 18**. Cổng mẫu backend là `55432`, không phải cổng mặc định PostgreSQL (`5432`). Chọn cổng đúng với server của máy cài đặt.
- Thư mục evidence tuyệt đối, **ngoài repo**, tài khoản chạy backend có quyền đọc/ghi. Python/Playwright không cần để chạy API/UI thông thường.
- Riêng PDF test cần Python có `pypdf`/`pdfplumber`; browser test cần Playwright và Chrome/Edge. Render lại sơ đồ cần Java/PlantUML/Graphviz, xem [danh mục sơ đồ](docs/diagrams/README.md).

## Cài mới trên database riêng

Lệnh dưới đây chạy từ **gốc repo**, dùng PowerShell. Clone bằng URL thật của repository trên GitHub, rồi mở terminal tại thư mục đã clone. Không sao chép `.env`, dump, storage hoặc `node_modules` từ repository công khai.

### 1. Cài dependency

```powershell
node --version
npm --version
npm ci
```

`npm ci` cài các workspace theo lockfile. Nếu manifest/lockfile không khớp, kiểm tra revision; không xóa lockfile để bỏ qua lỗi. Khi chủ động cập nhật dependency trong quá trình phát triển mới dùng `npm install` và review thay đổi lockfile.

### 2. Cấu hình môi trường

Không ghi đè cấu hình local đã có:

```powershell
if (-not (Test-Path -LiteralPath backend/.env)) {
    Copy-Item -LiteralPath backend/.env.example -Destination backend/.env
}
if (-not (Test-Path -LiteralPath frontend/.env.local)) {
    Copy-Item -LiteralPath frontend/.env.example -Destination frontend/.env.local
}
```

Sửa các giá trị **trên máy của mình**, không đưa chúng vào Git/log:

| Biến backend | Cách cấu hình |
| --- | --- |
| `DB_HOST`, `DB_PORT` | Server thực tế; mẫu là `127.0.0.1:55432`, máy khác có thể dùng `5432` |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Role/password riêng; DB mặc định `electrical_infrastructure` |
| `PORT` | Cổng API, mặc định `3000` |
| `JWT_SECRET` | Secret riêng, ngẫu nhiên, ít nhất 32 ký tự; không dùng mật khẩu tài khoản làm secret |
| `DEMO_MANAGER_EMAIL`, `DEMO_TECHNICIAN_EMAIL` | Hai email khác nhau cho bước khởi tạo tài khoản |
| `DEMO_MANAGER_PASSWORD`, `DEMO_TECHNICIAN_PASSWORD` | Bắt buộc khi chạy seed tài khoản, mỗi mật khẩu ít nhất 12 ký tự Unicode, tối đa 72 byte UTF-8, không NUL; không trim |
| `EVIDENCE_STORAGE_DIR` | Đường dẫn tuyệt đối ngoài repo; cần cho upload/download và file ghim. Không cấu hình thì chức năng cần storage trả 503 |
| `DEMO_SECOND_TECHNICIAN_EMAIL/PASSWORD` | Tùy chọn cho smoke/seed công trình dùng TECHNICIAN thứ hai **đã tồn tại**; không tự tạo/reset người thứ hai |

Frontend: `VITE_API_URL=http://localhost:3000` trong `frontend/.env.local` (đổi theo API thực tế). Biến `VITE_*` được đưa vào bundle public: **không đặt mật khẩu, token hoặc JWT_SECRET vào đó**. Khởi động lại Vite sau khi sửa cấu hình.

Dùng **`backend/.env.example`**, không dùng file `.env.example` ở gốc (mẫu cũ, khác cổng và thiếu storage). Các npm script workspace chạy trong `backend`; CLI nạp `backend/.env`. Nest còn cấu hình đường dẫn tương đối `.env`/`backend/.env`, nên chạy trực tiếp từ thư mục khác có thể chọn cấu hình khác. Biến môi trường của tiến trình có thể ghi đè file: kiểm tra terminal nếu kết nối không đúng. Không tạo thêm `.env` ở gốc để che lỗi.

Code hiện bật CORS bằng `enableCors` và expose `Content-Disposition`/`Retry-After`, **chưa có biến cấu hình allowlist origin/credentials**. Không điền một biến origin không được code đọc. Cần đánh giá/harden CORS riêng trước khi triển khai ngoài local.

### 3. Tạo database mới

Khởi động PostgreSQL bằng công cụ/service đã cài. Nếu server đã chạy, không start thêm một bản, không `initdb` hay xóa `postmaster.pid` để thử sửa lỗi.

Mở `psql` (hoặc Query Tool của pgAdmin) bằng role được phép tạo DB. Ví dụ cổng `55432`, thay đúng cổng/role của máy; `psql` hỏi mật khẩu tương tác, không truyền mật khẩu trên dòng lệnh:

```powershell
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres
```

Chỉ thực hiện SQL dưới đây nếu DB **chưa tồn tại**:

```sql
CREATE DATABASE electrical_infrastructure
  WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';
```

Đặt `DB_NAME` đúng tên vừa tạo. Role chạy migration cần quyền tạo/đổi object trong schema, role chạy ứng dụng cần các quyền dữ liệu tương ứng. Quyền `CREATEDB` cho harness kiểm thử không phải yêu cầu runtime thông thường. Không restore đè DB cũ hoặc chạy lại CREATE để reset dữ liệu.

### 4. Áp migration và khởi tạo tài khoản

```powershell
npm run migration:run -w backend
npm run migration:show -w backend
npm run seed -w backend
npm run seed:checklists -w backend
```

- `migration:run`/`migration:show` tự build backend và dùng `dist/database/data-source.js`. Ở revision được rà có 14 migration; sau cài mới, tất cả phải có dấu `[X]`, không còn pending. Không dùng `synchronize` hay chạy migration down trên DB có dữ liệu để thử.
- **`seed` chỉ dành cho khởi tạo hai tài khoản trên DB mới**. Script không chỉ insert: nếu email đã có mà password/role/active khác cấu hình, nó có thể thay hash, role, kích hoạt lại và tăng version/authVersion. Vì thế **không dùng seed để đăng nhập lại, đổi mật khẩu hoặc reset DB**. Tài khoản bootstrap dùng mặc định `mustChangePassword=false`; TECHNICIAN tạo/reset qua API quản lý mới có `mustChangePassword=true`.
- `seed:checklists` tạo mẫu theo revision cho LAN/WIFI/CAMERA (fixture hiện có 3 mẫu/9 mục), chạy lại không ghi đè revision đã tồn tại; dữ liệu lệch thì dừng. Nó không tạo Project hoặc tự hoàn thành phiếu.

### 5. Chạy API, kiểm tra health và mở web

Terminal thứ nhất, tại gốc repo:

```powershell
npm run dev:backend
```

Terminal khác:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Kết quả mong đợi: `{"status":"ok","database":"connected"}`. Endpoint thực hiện `SELECT 1`; nếu truy vấn DB lỗi thì request thất bại (controller không tự quy định riêng mã 503). Đọc thông báo khởi động nếu cổng API chưa mở.

Terminal thứ hai cho frontend:

```powershell
npm run dev:frontend
```

Mở URL **Local do Vite in ra**, thường `http://localhost:5173`; nếu cổng bận Vite có thể chọn cổng khác. Giữ API và Vite chạy khi sử dụng. Đăng nhập bằng email/mật khẩu mình đã cấu hình cho bước seed; repository không phát hành mật khẩu dùng chung hoặc dump DB.

`POST /auth/login` trả `accessToken`; `GET /auth/me` dùng Bearer JWT. Frontend xử lý đăng nhập bằng UI, không cần dán token vào URL. Phiên lưu localStorage chỉ dành cho demo local; xem chi tiết auth phía dưới.

## Mở lại dự án đã có dữ liệu

1. Bật đúng PostgreSQL đang chứa dữ liệu cần giữ.
2. Tại gốc repo, chạy `npm run dev:backend`, kiểm tra `/health`.
3. Chạy `npm run dev:frontend`, mở URL Vite và đăng nhập bằng mật khẩu hiện hành.

**Không chạy lại seed tài khoản, seed công trình, migration hoặc `npm ci` chỉ để mở web.** Chỉ cài lại dependency khi cần theo lockfile; chỉ áp migration mới khi nâng revision có thay schema, sau backup/đối chiếu môi trường. Không tự reset tài khoản khi login thất bại.

### Dữ liệu mẫu không đi kèm Git clone

Project, User thực tế và file evidence nằm trong DB/storage riêng, không tự có khi clone. Có thể nhập qua UI/API hoặc trên một **DB demo mới riêng** chạy `npm run seed:demo -w backend` sau migration, seed tài khoản/mẫu và khi API đang chạy. Script này tạo bộ CT-DEMO-ELV-01, có marker/checkpoint và từ chối fixture lệch; không phải công cụ reset.

Local ngày 24/10 đã có bộ KCN01/KCC01 riêng: **không chạy seed:demo cũ trên bộ đó** vì có thể tạo thêm Project ngoài yêu cầu. Ba script `presentation-data.cjs`, `presentation-inventory.cjs`, `presentation-verify.cjs` chỉ phục vụ vận hành máy local, có ID/guard/checkpoint riêng và **không được phát hành trong repository này** (giữ trên disk, ignore từng đường dẫn); không phải luồng cài mới portable. Clone GitHub không có các script hoặc dữ liệu này. Script backup/restore được công bố vẫn chốt cho cluster/fixture local cụ thể, không tự đổi guard để dùng trên máy khác. Xem [STATUS](docs/STATUS.md) và [DEMO_GUIDE](docs/DEMO_GUIDE.md) để phân biệt dữ liệu hiện hành với lịch sử.

## Build và kiểm thử

Các lệnh dưới đây là hướng dẫn, không có nghĩa đã chạy ở mọi revision:

```powershell
npm run build
npm run test -w backend
$frontendTests = @(Get-ChildItem frontend/test -Filter '*.test.cjs' | ForEach-Object { $_.FullName })
node --test @frontendTests
node --test backend/test/seed-demo.test.cjs
```

Frontend chưa có npm script `test`, nên chạy logic test trực tiếp bằng Node. Backend `test` tự build nhưng không bao gồm toàn bộ DB/browser/seed test.

Kiểm thử DB/HTTP chỉ dùng DB/storage tạm do harness sở hữu:

```powershell
# Python đã cài pypdf/pdfplumber; chỉ đặt biến cho tiến trình terminal hiện tại.
$env:EXPORT_PYTHON_BIN = (py -3 -c 'import sys; print(sys.executable)')
npm run test:db -w backend
```

Nếu thiếu bộ đọc PDF, cài vào Python môi trường kiểm thử: `py -3 -m pip install pypdf pdfplumber`. `EXPORT_PYTHON_BIN` phải trỏ đúng interpreter có hai package đó; không có biến thì test dùng `python` trên PATH. Harness DB kiểm tra name/owner/marker/OID trước migration/DDL/cleanup và cần `CREATEDB` để tạo/xóa DB tạm. Không thay guard hoặc fallback sang DB local khi test lỗi. Suite hỏng giữa chừng: đọc lỗi gốc và báo cáo cleanup; không DROP theo prefix hoặc xóa storage không xác minh sở hữu.

Browser E2E cách ly có tại `backend/test/browser.e2e.cjs`: build trước, cấu hình `PLAYWRIGHT_MODULE` tới module Playwright cài **ngoài repo** và `CHROME_EXECUTABLE` tới Chrome/Edge đã có, sau đó chạy `node --test --test-concurrency=1 backend/test/browser.e2e.cjs`. Harness dùng DB/storage/cổng riêng, không dùng User/server demo. Các file `frontend/test/*.browser.cjs` có chế độ và yêu cầu khác nhau: đọc đầu file trước khi chạy, **không mặc định tất cả là read-only/mock**. Ví dụ accounts browser mặc định mock; `ACCOUNT_REAL_SMOKE=1` tạo tài khoản thử, không dùng như bước mở web. Không cần cài browser tool để chạy ứng dụng bình thường.

Xem script cụ thể bằng `npm run -w backend` và `npm run -w frontend`. Kết quả từng lượt, khác biệt mock/API thật, test chưa chạy lại và giới hạn nằm trong [STATUS](docs/STATUS.md); không coi số pass lịch sử là full suite của worktree hiện tại.

## Tài liệu, sơ đồ và phạm vi công khai

- [Quy ước làm việc](AGENTS.md)
- [Trạng thái và lịch sử kiểm chứng](docs/STATUS.md)
- [Hướng dẫn trình diễn](docs/DEMO_GUIDE.md)
- [Danh mục sơ đồ, nguồn đối chiếu và cách render local](docs/diagrams/README.md)
- [Kiến trúc logic](docs/diagrams/rendered/KT1.svg), [triển khai local](docs/diagrams/rendered/KT2.svg)
- [Use Case tổng quát](docs/diagrams/rendered/UC1.svg), [ERD tổng quan](docs/diagrams/rendered/ER0.svg)
- [Vòng đời Task](docs/diagrams/rendered/ST1.svg), [Issue/recheck](docs/diagrams/rendered/ST2.svg)
- [Nghiệm thu](docs/diagrams/rendered/ST3a.svg), [quan hệ replacement](docs/diagrams/rendered/ST3b.svg)
- [Thành phần bên thứ ba của export](backend/src/exports/THIRD_PARTY.md)

Git/GitHub lưu source và lịch sử, **không phải backup DB/storage**. Không commit `.env` thật, credentials/token, dump, backup, evidence local, `node_modules`, output build hoặc QA cá nhân. `.gitignore` chỉ chặn file chưa tracked, không gỡ file đã commit khỏi lịch sử. Nếu phát hiện secret đã commit: thu hồi/đổi secret trước, rồi xử lý lịch sử có kiểm soát; không chỉ thêm ignore. Review diff và danh sách file trước khi công khai, đặc biệt script vận hành chỉ dành cho máy local. Không tự xóa dữ liệu trên disk để làm sạch repository.

Các hướng dẫn API, giới hạn file, backup/restore và export quan trọng của README cũ được giữ ở các phần dưới.

## Lỗi thường gặp và giới hạn

| Hiện tượng | Kiểm tra trước khi thay đổi dữ liệu |
| --- | --- |
| `ECONNREFUSED`, health không truy cập được | Server PostgreSQL/API, host/port thực tế và log khởi động; không kết luận host đã dừng chỉ từ sandbox không truy cập được loopback |
| Thiếu bảng/cột | Đúng database và revision chưa; dùng `migration:show`, backup trước khi quyết định áp migration mới |
| Login 401 | Credentials hiện hành, active/authVersion; không tự chạy seed/reset để sửa login |
| `PASSWORD_CHANGE_REQUIRED` | Chỉ hoàn tất đổi mật khẩu/đăng xuất rồi đăng nhập lại; khác 403 do sai vai trò |
| Web không gọi được API | `VITE_API_URL`, cổng Vite/API và CORS; khởi động lại Vite nếu đổi biến môi trường |
| Evidence hoặc ZIP lỗi | Storage tuyệt đối ngoài repo, quyền filesystem, file ghim và hash; không purge hoặc bỏ kiểm tra hash để xuất được |
| Test PDF thiếu runtime | `EXPORT_PYTHON_BIN` có đúng interpreter với pypdf/pdfplumber không |

Chưa có giám sát thiết bị online, chữ ký điện tử hoặc đăng nhập khách hàng. LocalStorage JWT, cấu hình CORS local, giới hạn export theo process và fault injection hiện có không thay thế đánh giá bảo mật/tải/triển khai production. Backup drill không chứng minh toàn bộ tình huống mất điện/crash, WAL/PITR hoặc mạng lỗi.

**License mã nguồn dự án chưa được cấp qua một file LICENSE tại gốc repo.** Không mặc định dự án là MIT. Giữ thông báo license font/thư viện và [THIRD_PARTY](backend/src/exports/THIRD_PARTY.md); các mốc dependency audit ở đó là lịch sử, không phải cam kết không có advisory mới.

**Tác giả:** Thái Văn Quý — 23IT227, VKU. Dự án phục vụ học tập, thực tập và minh họa năng lực phát triển ứng dụng web full stack.

## Tài khoản kỹ thuật viên (backend)

Chỉ MANAGER dùng `GET /users/technicians/manage` để xem danh sách quản lý, `POST /users/technicians` để tạo TECHNICIAN (email và mật khẩu tạm), `PATCH /users/technicians/:id/status` để kích hoạt/vô hiệu hóa và `POST /users/technicians/:id/password-reset` để đặt mật khẩu tạm mới. Các response chỉ có whitelist thông tin tài khoản; không trả password hash hoặc mật khẩu. `GET /users/technicians` hiện hữu vẫn chỉ trả `{id,email}` của kỹ thuật viên active để dùng khi giao việc.

Mật khẩu mới/reset cần ít nhất 12 ký tự Unicode, tối đa 72 byte UTF-8 và không chứa NUL; hệ thống từ chối vượt giới hạn thay vì cắt theo giới hạn bcrypt. Tài khoản mới/reset phải đổi mật khẩu qua `POST /auth/change-password` với `currentPassword`, `newPassword` và `expectedVersion`; tới khi đổi, chỉ `/auth/me` và đổi mật khẩu được phép. MANAGER chuyển mật khẩu tạm cho người dùng ngoài hệ thống. Không gửi mật khẩu qua URL/log hoặc đặt trong frontend.

Mỗi JWT được kiểm tra `authVersion` với User ở từng request. Đổi/reset mật khẩu hoặc đổi active state làm token cũ mất hiệu lực; JWT cũ thiếu claim này cần đăng nhập lại. Reset không kích hoạt tài khoản inactive. Vô hiệu hóa bị từ chối 409 khi còn Task chưa APPROVED hoặc Issue chưa CLOSED; API không tự giao lại công việc. Cập nhật trạng thái yêu cầu `expectedVersion`; gọi lại cùng trạng thái là no-op và không thu hồi token.

Sau khi áp migration mới trên môi trường đích, chạy `npm run test:users:db -w backend` để kiểm tra tài khoản/auth và race trên PostgreSQL tạm; harness cần `CREATEDB` chỉ cho DB test riêng. Không chạy test DB trên cơ sở dữ liệu cần giữ dữ liệu nếu tài khoản PostgreSQL không có quyền tạo/xóa DB tạm.

Các controller hiện có dùng `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles(...)` theo nghiệp vụ; module dùng guard import `AuthModule`. Không mở quyền mới chỉ dựa trên việc frontend có hiển thị nút hay không.

Frontend mặc định gọi API tại `http://localhost:3000`; có thể đặt `VITE_API_URL` trong `frontend/.env.local` theo `frontend/.env.example` rồi khởi động lại Vite. Không đặt mật khẩu hoặc `JWT_SECRET` trong biến `VITE_*`. Phiên demo local dùng localStorage, kiểm tra `/auth/me` khi tải lại và xóa token khi đăng xuất, hết hạn hoặc nhận 401. API chưa có tên người dùng nên giao diện dùng email để nhận diện tài khoản.

Hướng dẫn bật đúng môi trường, fixture và kịch bản trình diễn 10–15 phút: [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md). Với máy đã có demo, không chạy lại migration/seed như một bước khởi động hoặc reset; seed tài khoản có thể thay mật khẩu/role/active.

Ngữ cảnh bàn giao và lịch sử kiểm chứng: [docs/STATUS.md](docs/STATUS.md). Quy ước làm việc với repo: [AGENTS.md](AGENTS.md).

## Minh chứng (backend)

Đặt `EVIDENCE_STORAGE_DIR` trong môi trường backend thành đường dẫn tuyệt đối tới một thư mục riêng **ngoài repo**, tài khoản chạy backend có quyền đọc/ghi. `.env.example` để rỗng, không chứa đường dẫn riêng của máy. Không cấu hình storage thì ứng dụng vẫn khởi động; API cần file trả 503. File nằm trong `tmp/` và `files/`, dùng UUID do server sinh, không dùng tên gốc làm đường dẫn và không public static directory. Giữ storage ngoài Git; không đặt biến này vào `VITE_*`.

- Dưới `/projects/:projectId`: GET/POST `tasks/:taskId/evidence`, `inspections/:inspectionId/items/:itemId/evidence`, `issues/:issueId/evidence`. POST multipart gồm đúng một `file` và `caption` tùy chọn; **bắt buộc header `Idempotency-Key`** (8–128 chữ/số/`_`/`-`). Giữ cùng key/file/metadata khi retry; nội dung khác trả 409. Key unique theo Project/người tải; fingerprint gồm target, tên đã chuẩn hóa, MIME, kích thước, hash và caption trim (rỗng thành null). Retry cùng nội dung trả bản cũ (201), vẫn kiểm tra quyền hiện tại; bản đã xóa trả 404. Retry bản đã lưu được phép dù trạng thái đã khóa, không tạo thêm file hoặc thay đổi hồ sơ.
- PATCH `evidence/:id` nhận `{expectedVersion,caption}` (caption bắt buộc, được null); DELETE nhận `{expectedVersion,reason}` và trả 204. Xóa mềm giữ file disk, không có purge. GET `evidence/:id/content` tải file; GET `evidence/:id/preview` chỉ cho ảnh. Mọi route yêu cầu Bearer JWT, kiểm tra Project/ownership; không dùng token trong URL. Bản đã xóa trả 404. Không trả storage key/path hoặc password hash.
- JPEG/PNG/PDF, 1 byte–10 MiB/file, tối đa 20 file chưa xóa/target. Upload streaming; kiểm tra extension/MIME/chữ ký **không phải quét mã độc**, không bảo đảm file vô hại. Không mở PDF inline bằng preview. 400 dữ liệu sai, 401 JWT, 403 thao tác không được phép, 404 resource ngoài phạm vi/đã xóa, 409 version/trạng thái/quota/idempotency, 413 quá dung lượng, 415 loại file, 503 storage không khả dụng.
- MANAGER quản lý minh chứng; TECHNICIAN chỉ xem/upload Task hoặc Issue hiện được giao, chỉ sửa/xóa file mình tải. Task ghi trong ASSIGNED/IN_PROGRESS/RETURNED, SUBMITTED/APPROVED chỉ đọc; Issue ghi trong OPEN/IN_PROGRESS, RESOLVED/CLOSED chỉ đọc. Item chỉ MANAGER, PASS chỉ đọc. Giao lại thu hồi quyền người cũ; evidence không đổi version/trạng thái của Task/Item/Issue hoặc `passed`.

`npm run test:evidence:db -w backend` tạo/dọn DB và storage tạm (PostgreSQL cần CREATEDB). `npm run evidence:reconcile -w backend` chỉ báo cáo: file thiếu, file chưa được tham chiếu **hoặc đang xử lý**, file tạm; không tự xóa gì, kể cả file xóa mềm. Chỉ dọn file đã promote khi rollback được xác nhận trước khi thử COMMIT; nếu đã thử COMMIT mà kết quả chưa rõ thì giữ file để đối soát, không suy ra rollback từ việc truy vấn chưa thấy metadata. Sau crash, dừng ghi và kiểm tra thủ công trước khi xử lý file mồ côi; chưa có tự phục hồi/purge.

Backup: dừng API/thao tác ghi, backup PostgreSQL và toàn bộ storage thành một bộ có cùng mốc, rồi mở lại. Restore cả DB và storage trước khi chạy API; đối soát file thiếu/hash và thử download theo quyền. Không đưa backup vào Git. Quy trình backup–restore và crash recovery cần kiểm chứng riêng trên môi trường của bạn; test rollback không thay thế kiểm tra crash thật.

### Kiểm chứng backup–restore local có kiểm soát

Đây không phải lệnh backup portable dùng ngay cho mọi bộ dữ liệu: script hiện kiểm tra fixture `CT-DEMO-ELV-01` và hồ sơ có file ghim đã xóa mềm. Bộ KCN01/KCC01 hiện hành không còn Project đó; không chạy drill này và coi smoke sẽ đạt nguyên bản, cũng không tạo lại fixture hoặc bỏ guard để ép kết quả xanh. Lượt backup/restore đã ghi trong STATUS gắn với dữ liệu ở thời điểm chạy.

Script `backend/scripts/backup-restore-check.cjs` tạo backup **ngoài repo** và restore vào DB/storage tạm mới, không restore đè nguồn, không migration/seed/reset User. Script được chốt cho cluster local đã xác minh (`7628257575938021648`, `electrical_infrastructure`, cổng `55432`, data directory đã quy định trong guard); không đổi guard để vượt một kết quả preflight sai. Backend/Vite và mọi tác vụ ghi nguồn phải tắt trước khi chạy, và giữ tắt trong toàn bộ lượt kiểm chứng. Script không tự dừng/khởi động server local.

Điều kiện: PostgreSQL 18 `pg_dump`/`pg_restore`; Node/dependency và `backend/dist` khớp code hiện hành; Python có pypdf/pdfplumber. Tài khoản DB kiểm chứng cần SELECT, quyền khóa các bảng nguồn, đọc định danh cluster và tạo/xóa DB tạm; đây không phải yêu cầu quyền của tài khoản runtime. Nạp cấu hình nguồn và credentials hiện hành của hai vai trò từ `backend/.env`/môi trường; script không in token/mật khẩu hoặc thay tài khoản nếu login thất bại.

Chạy từ gốc repo trong PowerShell host (biến dưới đây chỉ áp dụng tiến trình hiện tại):

```powershell
$env:PG_BIN_DIR = '<thu-muc-bin-PostgreSQL-18>'
$env:EXPORT_PYTHON_BIN = '<python-co-pypdf-va-pdfplumber>'
$env:ELV_BACKUP_ROOT = '<thu-muc-backup-rieng-ngoai-repo-va-storage>' # optional
node backend/scripts/backup-restore-check.cjs --preflight # chỉ đọc
node backend/scripts/backup-restore-check.cjs --execute
```

Mặc định backup ở `%USERPROFILE%\.codex\backups\elv-<timestamp>-<random>`. Bộ gồm `database.dump`, `database.toc.txt`, toàn bộ `storage/`, `manifest.json`, `manifest.sha256` và `verification.json`. Manifest ghi thời điểm UTC, migration, count/fingerprint tổng hợp từng bảng/sequence, SHA-256/kích thước dump và từng file; không ghi password/hash của từng User. **Dump vẫn chứa dữ liệu nhạy cảm của DB**: bảo vệ thư mục bằng ACL/quyền hệ điều hành và chính sách backup riêng, không đưa vào Git hoặc chia sẻ công khai. Không sao lưu global roles/password PostgreSQL, ACL/owner hay cấu hình server; dump loại owner/ACL và restore dưới tài khoản kiểm chứng.

Script xác nhận không có session nguồn khác/cổng local đang dùng, giữ SHARE lock chặn DML/DDL trên các bảng hiện hữu và dùng snapshot đó cho dump. Hash storage được đối chiếu nguồn → backup → restore và kiểm tra lại nguồn sau smoke. DB restore có name/owner/marker/OID, storage có marker/thư mục riêng; Nest chỉ dùng bản restore/cổng OS cấp. Smoke chỉ đọc: health, login, demo, summary TECHNICIAN, file ghim đã xóa mềm, PDF/ZIP và nội dung/hash các artifact. Không tự sửa fixture nếu thiếu dữ liệu cần kiểm chứng. Mọi backup được giữ, kể cả khi smoke lỗi; script báo lỗi và không coi lượt đó là pass. DB còn session hoặc ownership sai được giữ thay vì cưỡng chế DROP; cần đọc báo cáo cleanup trước khi xử lý thủ công.

Backup root được canonical hóa (kể cả ancestor hiện hữu của đường dẫn chưa tạo) và kiểm tra lại trước khi tạo dữ liệu: không trùng/nằm trong storage nguồn, không chứa storage nguồn, không nằm trong repo; junction/symlink và khác hoa/thường/separator trên Windows không được dùng để vượt guard. Không thay đổi junction/thư mục trong lúc drill chạy.

Trước CREATE, report ghi tên DB dự kiến/phase; nếu CREATE lỗi hoặc đã thành công nhưng ownership chưa xác nhận, script **không đoán để DROP** mà ghi `cleanup.databaseRetained` với tên/phase/trạng thái xác nhận. Cần xác minh catalog độc lập trước xử lý thủ công; không dùng prefix để xóa. Lỗi gốc và lỗi cleanup/ghi `verification.json` được giữ trong cause/AggregateError nội bộ, log/report chỉ có phase/kind/code cho phép, không in message/config/stderr tùy ý. Nếu ghi report thất bại, console vẫn báo thông tin đã lọc và tiến trình trả lỗi; backup không bị xóa.

Regression không chạy backup nguồn: `node --test --test-concurrency=1 --test-reporter=spec --test-timeout=180000 backend/test/backup-restore-check.test.cjs` (đặt `EXPORT_PYTHON_BIN` như trên). Test dùng junction/storage giả, DB tạm được helper bảo vệ và PDF/ZIP tổng hợp; không gọi main khi import script. Assertion ZIP còn đọc text PDF bên trong, ngoài kiểm tra manifest/hash và workbook. Các test fault injection này không thay thế một lượt restore end-to-end hoặc kiểm thử crash.

Kết quả local 2026-10-19: restore thực và smoke API đạt; dữ liệu nguồn không đổi. File mồ côi và file xóa mềm được sao lưu/giữ nguyên, không purge. Đây không phải kiểm chứng phục hồi crash/WAL/PITR, backup online khi vẫn có writer, quyền runtime tối thiểu, ACL/timestamp filesystem hay triển khai trên máy/cluster khác; xem STATUS để biết số liệu và giới hạn cụ thể.

## Xuất hồ sơ bàn giao (backend)

MANAGER gửi Bearer JWT đến GET `/projects/:projectId/acceptances/:id/export.pdf` (chỉ hồ sơ CONFIRMED), GET `/projects/:projectId/exports/devices.xlsx`, GET `/projects/:projectId/exports/connections.xlsx`. TECHNICIAN không có quyền dùng ba route này. PDF lấy thông tin nghiệp vụ từ snapshot xác nhận, chỉ liệt kê metadata minh chứng; trạng thái đã được thay thế được ghi riêng tại thời điểm xuất. File ghim thiếu, sai SHA-256 hoặc không thể kiểm tra được đánh dấu cảnh báo tương ứng trong PDF; snapshot thiếu/sai schema bị từ chối, không thay bằng dữ liệu hiện tại. PDF không phải tài liệu có chữ ký khách hàng.

Hai workbook dùng danh mục hiện tại của toàn Project tại một thời điểm đọc nhất quán (`READ ONLY REPEATABLE READ`); sheet thiết bị gồm vị trí/rack/U/System/IP/MAC, sheet đấu nối gồm cổng, dây và đường tra cứu/đoạn thiếu. Ô chưa khai báo để trống; PoE `false` hiển thị “Tắt”. Dữ liệu người dùng được ghi như text, không chạy công thức. Giới hạn mỗi workbook 10.000 dòng tính cả mọi sheet/header, mỗi cell tối đa 32.767 UTF-16 code units và tổng text đầu vào tối đa 8 MiB tính theo byte UTF-8; PDF tối đa 200 trang, mỗi file đầu ra 20 MiB. Vượt giới hạn trả 413, không cắt dữ liệu. Mỗi backend process chỉ cho một tác vụ XLSX hoạt động; request đồng thời trả 503 kèm `Retry-After`, không xếp hàng. Đây là giới hạn riêng từng process, không phải toàn cụm; PDF không nằm trong giới hạn này. XLSX được tạo trong child process với timeout 60 giây và V8 heap 256 MiB; heap không phải giới hạn tổng RSS. Tệp tạm được tạo ngoài repo, xóa sau tải/lỗi; không lưu lịch sử export. Gói ZIP bàn giao đã có, với API và giới hạn riêng được mô tả bên dưới.

Test export cần Python 3 có `pypdf` và `pdfplumber` để đọc PDF sinh ra. Cài bằng `py -3 -m pip install pypdf pdfplumber`, rồi trỏ `EXPORT_PYTHON_BIN` tới Python đó (PowerShell: `$env:EXPORT_PYTHON_BIN = (py -3 -c 'import sys; print(sys.executable)')`). Chạy `npm run test:exports:db -w backend` trên database tạm; harness cần quyền `CREATEDB` chỉ để tạo/xóa database test riêng. Quyền này không bắt buộc cho runtime. Tài khoản runtime cần quyền đăng nhập/`CONNECT`, `USAGE` schema và `SELECT` trên các bảng nghiệp vụ export; không cần `CREATEDB`, `pg_signal_backend` hay superuser. Nếu không đặt `EXPORT_PYTHON_BIN`, test gọi lệnh `python` trên PATH.

XLSX dùng `write-excel-file@4.1.1`, test đọc lại bằng `read-excel-file@9.3.10`; ExcelJS và `buffers` đã được gỡ khỏi dependency tree. Thư viện tạo nội dung XML trong RAM trước khi ZIP, nên worker chỉ cô lập công việc và bị dừng theo timeout/giới hạn đầu ra; không phải row-streaming hay hard limit RSS. Xem [docs/STATUS.md](docs/STATUS.md) và [THIRD_PARTY.md](backend/src/exports/THIRD_PARTY.md) để biết kết quả kiểm tra hiện tại.

MANAGER có thể tải gói bàn giao bằng GET `/projects/:projectId/acceptances/:id/handover-package.zip`. Chỉ hồ sơ CONFIRMED cùng Project được chấp nhận. ZIP chứa PDF snapshot, hai workbook dữ liệu hiện tại từ cùng một transaction `READ ONLY REPEATABLE READ`, manifest và đúng các evidence đã ghim trong snapshot (kể cả metadata nguồn đã xóa mềm). Không chọn evidence vẫn tạo đủ PDF, hai workbook và manifest. Thiếu file hoặc sai kích thước/SHA-256 hủy toàn bộ gói; manifest ghi hash/size của đúng các artifact đưa vào ZIP, không ghi storage key hoặc đường dẫn nội bộ. Tên entry do server sinh. Gói được hoàn tất trước khi gửi response.

Giới hạn gói: tối đa 50 evidence; tổng dữ liệu chưa nén và ZIP tối đa 200 MiB; deadline tổng 120 giây gồm chuẩn bị và gửi. Giới hạn slot chia sẻ với API XLSX: chỉ một tác vụ XLSX/package mỗi backend process; slot giữ đến khi response gửi xong hoặc abort/lỗi đã cleanup; không có hàng đợi, request tranh slot trả 503 + `Retry-After`. Đây không phải giới hạn toàn cụm. Riêng gói ZIP tạo một pool TypeORM một connection, tách khỏi pool API nghiệp vụ; checkout có timeout tối đa 5 giây hoặc deadline còn lại nếu ngắn hơn. Lỗi checkout trả 503 (deadline tác vụ trả 504). `pg-pool` không hủy tức thời checkout đang chờ: QueryRunner đến muộn được release, pool riêng đóng trước khi tác vụ kết thúc; không chạy tiếp graph query. Pool export truyền `-c statement_timeout=... -c lock_timeout=...` trong startup options PostgreSQL, trước SQL của phiên; mỗi câu truy vấn trong transaction sau đó được đặt lại theo ngân sách deadline còn lại. Client abort/deadline đóng socket và pool export riêng, không gọi `pg_cancel_backend`/`pg_terminate_backend` theo PID. PostgreSQL có thể tiếp tục câu lệnh đang chạy sau khi request đã dọn tài nguyên cục bộ; giới hạn phía server là `statement_timeout` hữu hiệu của câu lệnh đó (ban đầu tối đa 120 giây, các truy vấn nghiệp vụ trong transaction được cập nhật theo phần deadline còn lại). Vì vậy không bảo đảm dừng server tức thời hoặc đúng cùng thời điểm trả 504; session export cũ có thể tồn tại tới timeout hữu hạn trong khi slot local đã được trả. Client đã kết thúc không được tái sử dụng; pool riêng bị hủy và không ảnh hưởng pool API nghiệp vụ. Timeout trả 504 trước khi gửi; nếu deadline hết sau khi response đã bắt đầu thì kết nối bị đóng và file tạm được dọn. Stream đọc evidence được pipeline hủy cùng AbortSignal; cleanup chờ stream đóng. File staging và ZIP ở thư mục tạm ngoài repo, không lưu lịch sử export. `yazl` tạo ZIP dạng stream; xem phiên bản/license và kết quả xác minh tại [THIRD_PARTY.md](backend/src/exports/THIRD_PARTY.md).
