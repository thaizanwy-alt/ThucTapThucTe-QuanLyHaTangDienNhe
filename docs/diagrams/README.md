# Sơ đồ kiến trúc và Use Case

Mốc đối chiếu: `main`, HEAD `3fa0f5c`, ngày 22/10/2026. Đây là mô hình của chức năng **đã triển khai trong source**, không phải đề xuất mở rộng. Không kiểm tra server hoặc dữ liệu DB local trong lượt này.

## Danh mục và chú thích cho báo cáo

| Mã | Chú thích đề xuất | Giải thích ngắn | Nguồn / SVG / PNG | Bố trí đề xuất |
| --- | --- | --- | --- | --- |
| KT1 | Kiến trúc logic hệ thống quản lý thi công hạ tầng điện nhẹ | Frontend, API/guard, service, TypeORM, PostgreSQL và storage; backend nguyên khối phân module. Mũi tên chỉ hướng sử dụng/trao đổi, không phải sequence. | [Nguồn](src/KT1.puml) · [SVG](rendered/KT1.svg) · [PNG](rendered/KT1.png) | A4 dọc; rộng 170 mm, cao 224,52 mm. |
| KT2 | Mô hình triển khai ứng dụng trong môi trường demo local | Browser, Vite, NestJS, PostgreSQL, XLSX child process và file ngoài repo trên cùng máy Windows. Không phải sơ đồ production. | [Nguồn](src/KT2.puml) · [SVG](rendered/KT2.svg) · [PNG](rendered/KT2.png) | A4 ngang; rộng 200 mm, cao 160,78 mm. |
| UC1 | Biểu đồ Use Case tổng quát theo hai vai trò | Nhóm mục tiêu của MANAGER và TECHNICIAN; quyền chi tiết được giải thích ở ba hình tiếp theo. | [Nguồn](src/UC1.puml) · [SVG](rendered/UC1.svg) · [PNG](rendered/UC1.png) | A4 dọc; cao 245 mm, rộng 134,28 mm. |
| UC2a | Use Case MANAGER: quản lý danh mục kỹ thuật và tài khoản | Project/Area/System, Device, rack/U, khai báo mạng, cổng/dây và tài khoản TECHNICIAN. | [Nguồn](src/UC2a.puml) · [SVG](rendered/UC2a.svg) · [PNG](rendered/UC2a.png) | A4 dọc; rộng 125 mm, cao 242,61 mm. |
| UC2b | Use Case MANAGER: quản lý thi công, kiểm tra và bàn giao | Task, checklist/Issue, evidence, acceptance/snapshot và export. | [Nguồn](src/UC2b.puml) · [SVG](rendered/UC2b.svg) · [PNG](rendered/UC2b.png) | A4 dọc; rộng 125 mm, cao 243,11 mm. |
| UC3 | Use Case TECHNICIAN: tra cứu và xử lý công việc được giao | Quyền đọc danh mục/trace, Task/Issue của mình, evidence theo ownership, summary CONFIRMED và tài khoản mình. | [Nguồn](src/UC3.puml) · [SVG](rendered/UC3.svg) · [PNG](rendered/UC3.png) | A4 dọc; cao 249 mm, rộng 115,95 mm. |

Nên đưa KT1, KT2, UC1 vào thân báo cáo; UC2a, UC2b, UC3 vào phần phân tích chi tiết hoặc phụ lục. Chưa tạo ERD, state, activity, sequence hoặc DFD trong nhóm này.

## Kích thước chèn và QA A4

Đã kiểm tra ngày 23/10/2026 bằng một PDF QA **tạm ngoài repo**, không phải báo cáo cuối. Mỗi trang chứa một hình, giữ tỉ lệ, căn giữa ngang, mép trên hình cách mép giấy 18 mm. Dải chú thích cao 8 mm nằm cách đáy giấy 18 mm; khoảng cách hình tới dải này ít nhất 4 mm. Trang KT2 là A4 ngang, năm trang còn lại A4 dọc. Phần nhãn QA trên đầu trang không thuộc hình bàn giao.

| Hình | SVG viewBox (rộng × cao) | Chiều được đặt khi chèn | Chữ nhỏ nhất, gồm legend |
| --- | --- | --- | --- |
| KT1 | 817 × 1079 | Rộng 170 mm | 10,62 pt |
| KT2 | 979 × 787 | Rộng 200 mm | 10,42 pt |
| UC1 | 678 × 1237 | Cao 245 mm | 10,11 pt |
| UC2a | 541 × 1050 | Rộng 125 mm | 11,79 pt |
| UC2b | 599 × 1165 | Rộng 125 mm | 10,65 pt |
| UC3 | 590 × 1267 | Cao 249 mm | 10,03 pt |

Đặt đúng **chiều được chỉ định**, khóa tỉ lệ; chiều còn lại trong danh mục được làm tròn hai chữ số. Đã đọc trực tiếp SVG: nội dung và legend đều `font-size="18"`, tiêu đề `23`; không còn footer nhỏ trong ảnh. Quy đổi: `cỡ chữ pt = font-size SVG × chiều chèn mm / chiều viewBox tương ứng × 72 / 25,4`. Không lấy kích thước pixel PNG 192 dpi thay cho viewBox SVG trong công thức.

Không thu nhỏ thêm để ghép hai hình hoặc chèn đoạn văn dài trên cùng trang. Nếu mẫu trường yêu cầu lề/header/footer hoặc caption lớn hơn vùng QA này, cần đổi bố cục/tách hình rồi QA lại, không dùng Fit-to-page để ép vừa. Ưu tiên SVG trong báo cáo cuối; PNG đã render ở 192 dpi để bản QA raster không bị mềm. Vẫn chưa kiểm thử in giấy hoặc file Word/PDF báo cáo cuối.

## Code dùng để đối chiếu

Các đường dẫn dưới đây tính từ gốc repo. Khi thay đổi quyền/API, cần cập nhật cả nguồn và hai định dạng render.

### KT1 và KT2

- `frontend/src/App.tsx`, `frontend/src/ProjectWorkspace.tsx`, `frontend/src/api/client.ts`: UI, sáu thẻ, API và phiên demo.
- `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/database/data-source.ts`: bootstrap, CORS, validation, module, kết nối và `synchronize: false`.
- `backend/src/auth/jwt-auth.guard.ts`, `roles.guard.ts`: JWT, active/authVersion, mustChangePassword và quyền vai trò.
- `backend/src/evidence/evidence.storage.ts`, `evidence.service.ts`: file ngoài repo, metadata, API có quyền và xóa mềm.
- `backend/src/exports/exports.controller.ts`, `exports.service.ts`, `exports.render.ts`, `xlsx.worker.ts`, `xlsx-process-slot.ts`: render local, worker, pool riêng đọc graph ZIP, slot, artifact tạm và cleanup.
- `README.md`, `docs/STATUS.md`, `docs/DEMO_GUIDE.md`: cấu hình triển khai local đã ghi nhận. Cổng Vite/Nest có thể đổi; PostgreSQL `55432` là cấu hình local, không phải giá trị mặc định PostgreSQL. Không đưa đường dẫn data directory riêng hoặc credentials vào hình.

Giải thích chuyển khỏi legend KT1/KT2: JWT được đối chiếu User/authVersion trên mỗi request được bảo vệ; service kiểm tra quyền resource. Schema dùng migration và `synchronize: false`. Pool nghiệp vụ và pool riêng đọc graph ZIP đều nằm trong backend; graph ZIP dùng READ ONLY REPEATABLE READ, một connection riêng/tác vụ và startup SQL timeouts. V8 heap limit không phải giới hạn toàn bộ RSS. Export không có lịch sử job/queue; artifact được hoàn tất trước khi gửi, cleanup theo vòng đời tác vụ. Đây là cấu hình đã đối chiếu source, không phải xác nhận runtime local ngày lập hình.

### UC1 — phạm vi tổng quát

- Các controller trong `backend/src/projects`, `devices`, `connections`, `tasks`, `inspections`, `evidence`, `acceptances`, `exports`, `users`, `auth`.
- `backend/src/auth/jwt-auth.guard.ts`, `roles.guard.ts` và service tương ứng: guard vai trò không thay thế kiểm tra ownership/trạng thái trong service.
- `backend/src/projects/project-summary.service.ts`: TECHNICIAN chỉ đếm Task/Issue của mình; được nhận inventory và counts CONFIRMED nhưng không nhận inspections hoặc số acceptance DRAFT.

### UC2a — MANAGER: danh mục và tài khoản

- `backend/src/projects/projects.controller.ts`, `projects.service.ts`: đọc/tạo/sửa Project; CRUD Area/System. Không có API DELETE Project trong controller hiện tại.
- `backend/src/devices/devices.controller.ts`, `devices.service.ts`: CRUD Device, nhiều System, hồ sơ mạng CAMERA/AP.
- `backend/src/devices/racks.controller.ts`, `racks.service.ts`: MAIN/SUB, Area phục vụ, placement U/ZERO_U và dependency.
- `backend/src/connections/connections.controller.ts`, `connections.service.ts`: cổng, dây, trace, expectedVersion khi rewire và VLAN/PoE trên SWITCH.
- `backend/src/users/users.controller.ts`, `users.service.ts`: danh sách/tạo/reset/bật/tắt TECHNICIAN; expectedVersion; status no-op; chặn vô hiệu hóa khi Task khác APPROVED hoặc Issue khác CLOSED. Không DELETE User, đổi role hoặc tự giao lại việc.

### UC2b và UC3 — workflow, minh chứng, nghiệm thu

- `backend/src/tasks/tasks.controller.ts`, `tasks.service.ts`: MANAGER tạo/sửa/giao lại khi ASSIGNED/RETURNED, duyệt/trả khi SUBMITTED; TECHNICIAN chỉ start/submit Task hiện được giao.
- `backend/src/inspections/inspections.controller.ts`, `inspections.service.ts`: phiếu/Item chỉ MANAGER; FAIL/tạo Issue nguyên tử; giao lại chỉ OPEN; TECHNICIAN start/resolve Issue của mình; recheck chỉ RESOLVED. Resolve không tự đổi Item FAIL thành PASS.
- `backend/src/evidence/evidence.controller.ts`, `evidence.service.ts`: quyền target; TECHNICIAN không có evidence Item, chỉ sửa/xóa file mình tải. Task SUBMITTED/APPROVED, Issue RESOLVED/CLOSED và Item PASS khóa ghi; đọc vẫn cần quyền và metadata chưa xóa. Retry idempotency của bản đã lưu không tạo bản ghi mới, không phải quyền chỉnh sửa ở trạng thái khóa.
- `backend/src/acceptances/acceptances.controller.ts`, `acceptances.service.ts`: MANAGER quản lý DRAFT, readiness, confirm, replacement, snapshot và file ghim; TECHNICIAN chỉ nhận whitelist summary CONFIRMED, không file/snapshot. Bản cũ chỉ đã thay thế khi bản mới CONFIRMED; không tự đổi Project.status.
- `backend/src/exports/exports.controller.ts`, `exports.service.ts`: cả PDF, hai XLSX và ZIP chỉ MANAGER; PDF/ZIP theo acceptance CONFIRMED. PDF dùng snapshot; Excel dùng dữ liệu hiện tại; ZIP kết hợp các nguồn có ghi phạm vi/thời điểm.
- `backend/src/auth/auth.controller.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `password-change-allowed.decorator.ts`: login, me, đổi mật khẩu; mustChangePassword chỉ cho me/change-password. Đăng xuất frontend là xóa phiên local, không biểu diễn thành API revoke chưa có.

UC3 tách hai mục tiêu: **xem Task đang giao cho mình ở mọi trạng thái** và **bắt đầu chỉ từ ASSIGNED/RETURNED**. Submit chỉ từ IN_PROGRESS và bắt buộc completionNote; mỗi thao tác vẫn kiểm tra assignee hiện hành. Sau giao lại, người cũ mất quyền Task/Issue và evidence, người mới đọc được evidence theo target. Issue chỉ start từ OPEN, resolve từ IN_PROGRESS, không tự đổi Item thành PASS. TECHNICIAN không duyệt/recheck, không sửa/xóa evidence người khác; khi buộc đổi mật khẩu chỉ me/change-password được guard cho phép. Các chi tiết này nằm ở đoạn văn thay vì dồn xuống legend cỡ nhỏ.

## Quy ước hình

- Nền trắng, Arial, nhãn tiếng Việt, thuật ngữ trạng thái/API giữ nguyên; style chung tại `src/style.iuml`, bao gồm `legendFontSize 18` tường minh.
- Use Case: actor nằm ngoài system boundary; chức năng là ellipse; liên kết actor–Use Case là đường liền không hướng. Không dùng include/extend để chỉ nhóm các chức năng liên quan; không vẽ kế thừa MANAGER từ TECHNICIAN vì quyền không phải tập bao hàm.
- Ellipse có thể nhóm các thao tác cùng mục tiêu; legend và nguồn code ghi rõ giới hạn trạng thái/ownership. Không dùng hình này thay ma trận quyền API chi tiết.
- Trace là đường dây **đã khai báo**, không phải ping/giám sát online. Rack MAIN/SUB không tự tạo uplink. Không có khách hàng ký số, NVR monitoring hoặc microservices.
- Không suy từ acceptance CONFIRMED rằng toàn System/Project đã nghiệm thu hoặc khách hàng đã ký.
- Ưu tiên SVG khi chèn báo cáo để chữ/đường nối giữ nét; PNG là bản xem và dự phòng. Giữ tỉ lệ/kích thước QA, không kéo méo; mỗi hình trên một trang như bảng danh mục. Chưa kiểm thử in giấy hoặc tích hợp vào bản Word/PDF báo cáo cuối cùng.

## Render lại hoàn toàn local — PowerShell

Cần Java, PlantUML JAR và Graphviz mà PlantUML nhận diện được; Arial hoặc font thay thế hỗ trợ tiếng Việt. Không dùng server render, URL include, plugin upload hoặc công cụ tạo ảnh AI.

Runtime đã dùng: OpenJDK 25.0.1, PlantUML **1.2026.9**, Graphviz được renderer báo **2.44.1**. JAR ở thư mục công cụ ngoài repo, được tải sau khi người dùng cho phép; không thay dependency/package/lockfile dự án. Bản phát hành chính thức: [PlantUML v1.2026.9](https://github.com/plantuml/plantuml/releases/tag/v1.2026.9). SHA-256 asset `plantuml.jar` đã đối chiếu với release API:

```text
aa4a1d06f8911c4b842beff4828dd955be431692b631a312d04c0e9fab9581de
```

Tại gốc repo, đặt `PLANTUML_JAR` cho tiến trình PowerShell thành đường dẫn JAR công cụ của máy mình, rồi chạy:

```powershell
if (-not $env:PLANTUML_JAR -or -not (Test-Path -LiteralPath $env:PLANTUML_JAR)) {
  throw 'Hãy đặt PLANTUML_JAR tới JAR local đã xác minh.'
}
& java -jar $env:PLANTUML_JAR -version
if ($LASTEXITCODE -ne 0) { throw 'Không chạy được PlantUML.' }
$diagramSources = @(Get-ChildItem -LiteralPath docs/diagrams/src -Filter '*.puml' |
  Sort-Object Name | ForEach-Object { 'docs/diagrams/src/' + $_.Name })
foreach ($diagramFormat in @('-tsvg', '-tpng')) {
  $diagramDpi = @()
  if ($diagramFormat -eq '-tpng') { $diagramDpi = @('-Sdpi=192') }
  & java '-Djava.awt.headless=true' -jar $env:PLANTUML_JAR -charset UTF-8 `
    -failfast2 $diagramFormat @diagramDpi -o ../rendered @diagramSources
  if ($LASTEXITCODE -ne 0) { throw "Render lỗi: $diagramFormat" }
}
git diff --check
```

`-o ../rendered` được PlantUML tính từ thư mục source, nên output ở `docs/diagrams/rendered/`. Input dùng đường dẫn tương đối đã kiểm chứng; không đổi pipeline sang `FullName` (lượt QA này PlantUML bị đệ quy tìm file khi dùng đường dẫn tuyệt đối, trước khi render). Mọi include đều là file local. Nếu máy khác thiếu Java/Graphviz/font, dừng và bổ sung công cụ sau khi được phép; không chuyển sang dịch vụ render công khai. Thay engine/font/version có thể đổi layout, cần mở xem lại từng hình và đo lại cỡ chữ tại kích thước chèn.

## Kết quả kiểm tra hình

Ngày 22/10/2026 đã tạo nhóm hình ban đầu và kiểm tra từng PNG. Ngày **23/10/2026** đã sửa hai finding: tách quyền xem/bắt đầu Task trong UC3; đặt legend 18 px thực tế, rút gọn còn ba dòng mỗi hình, chuyển giải thích dài và nguồn code sang README, bỏ footer nhỏ khỏi ảnh. Cả sáu SVG/PNG đã render lại local, PNG 192 dpi; đã mở SVG trong Chrome local và mở xem PNG, không chỉ kiểm tra cú pháp. PDF QA sáu trang dùng PNG độ phân giải cao ở đúng kích thước bảng trên; đã render bằng Poppler và mở xem từng trang, không thấy cắt/tràn hoặc đè vùng chú thích. SVG giữ text vector, hiển thị còn phụ thuộc font máy đọc. PDF QA và script/ảnh kiểm tra đều ở ngoài repo, không phải tài liệu cuối và không thuộc phạm vi stage.

Không chạy test/build ứng dụng hoặc truy cập DB trong lượt tạo sơ đồ. Đây không phải kết quả smoke/API mới; không thay thế lịch sử kiểm chứng ở STATUS. Không thay README gốc, STATUS, code ứng dụng hoặc cấu hình môi trường.
