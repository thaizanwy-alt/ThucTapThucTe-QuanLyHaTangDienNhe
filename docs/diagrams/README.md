# Sơ đồ kiến trúc, Use Case, ERD, trạng thái, hoạt động và trình tự

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

Nên đưa KT1, KT2, UC1 vào thân báo cáo; UC2a, UC2b, UC3 vào phần phân tích chi tiết hoặc phụ lục. Nhóm ERD, ST1, ST2, ST3 và AC1/SQ1–SQ3 bổ sung có phần đối chiếu riêng ở cuối tài liệu; chưa tạo sơ đồ trạng thái tài khoản hoặc DFD.

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

## Nhóm ERD — schema sau migration

Mốc đối chiếu ERD: `main`, HEAD `8c0d5d2`, ngày **23/10/2026**. Đã đọc toàn bộ 15 file entity (22 bảng nghiệp vụ) và 14 migration theo thứ tự dưới đây, cùng service khi cần phân biệt quy tắc nghiệp vụ. Đây là schema cuối **suy ra từ source sau khi áp đủ migration up**, không phải xác nhận schema/dữ liệu DB đang chạy. `backend/src/database/data-source.ts` đăng ký các entity/migration và giữ `synchronize: false`.

Tám nhóm yêu cầu được trình bày thành **11 hình**: ER2a, ER3b và ER4b mỗi nhóm tách hai trang để giữ chữ đọc được. ER0 phù hợp thân báo cáo; ER1 và các ER chi tiết dùng trong chương thiết kế dữ liệu hoặc phụ lục. Không ghép nhiều ER chi tiết rồi thu nhỏ vào một trang.

| Mã | Chú thích đề xuất / mục đích | Nguồn / SVG / PNG |
| --- | --- | --- |
| ER0 | Quan hệ nghiệp vụ chính: Project, danh mục kỹ thuật, thi công, kiểm tra, minh chứng và nghiệm thu; chỉ entity/quan hệ chính. | [Nguồn](src/ER0.puml) · [SVG](rendered/ER0.svg) · [PNG](rendered/ER0.png) |
| ER1 | User, Project, Area và System; không có bảng thành viên User–Project. | [Nguồn](src/ER1.puml) · [SVG](rendered/ER1.svg) · [PNG](rendered/ER1.png) |
| ER2a-1 | Device, nơi đặt, rack quản lý và bố trí U trên chính bảng Device. | [Nguồn](src/ER2a-1.puml) · [SVG](rendered/ER2a-1.svg) · [PNG](rendered/ER2a-1.png) |
| ER2a-2 | Liên kết nhiều System, Area phục vụ của rack và NetworkProfile. | [Nguồn](src/ER2a-2.puml) · [SVG](rendered/ER2a-2.svg) · [PNG](rendered/ER2a-2.png) |
| ER2b | Cổng, dây vật lý và hai endpoint; phân biệt cardinality DB với mặt cổng theo loại thiết bị. | [Nguồn](src/ER2b.puml) · [SVG](rendered/ER2b.svg) · [PNG](rendered/ER2b.png) |
| ER3a | Task, System/Area, người được giao và người duyệt. | [Nguồn](src/ER3a.puml) · [SVG](rendered/ER3a.svg) · [PNG](rendered/ER3a.png) |
| ER3b-1 | Mẫu có revision, phiếu và nội dung mục được sao chép. | [Nguồn](src/ER3b-1.puml) · [SVG](rendered/ER3b-1.svg) · [PNG](rendered/ER3b-1.png) |
| ER3b-2 | Lịch sử Issue của Item và quan hệ phân công/kiểm tra lại. | [Nguồn](src/ER3b-2.puml) · [SVG](rendered/ER3b-2.svg) · [PNG](rendered/ER3b-2.png) |
| ER4a | Evidence: ba FK target nullable, CHECK XOR, người tải/xóa và xóa mềm. | [Nguồn](src/ER4a.puml) · [SVG](rendered/ER4a.svg) · [PNG](rendered/ER4a.png) |
| ER4b-1 | Hồ sơ nghiệm thu và các bảng lựa chọn phiếu/evidence. | [Nguồn](src/ER4b-1.puml) · [SVG](rendered/ER4b-1.svg) · [PNG](rendered/ER4b-1.png) |
| ER4b-2 | Snapshot JSON sao chép và chuỗi hồ sơ thay thế. | [Nguồn](src/ER4b-2.puml) · [SVG](rendered/ER4b-2.svg) · [PNG](rendered/ER4b-2.png) |

### Ký hiệu, cardinality và phần lược bỏ

- `[PK]` chỉ cột tham gia khóa chính; nhiều cột cùng nhãn là **một PK ghép**, không phải mỗi cột unique riêng. `[UQ]` chỉ unique; các unique ghép/partial được giải thích trong legend và dưới đây. `?` là nullable; cột không có `?` là NOT NULL. Dòng `code, name` là cách gộp hai cột để tiết kiệm chỗ, không phải tên một cột DB.
- `[FK]` là FK đơn; `[FK*]` là thành phần FK ghép với `project_id` để giữ cùng Project. `[FKr]` là cặp `(template_id,template_revision)` tới `(id,revision)` của template. `[FKps]` là `(project_id,system_id,replaces_id)` tới cùng bảng acceptance. Không lặp tất cả cạnh tới Project để tránh rối; field vẫn ghi FK. Các bảng “tham chiếu” chỉ lặp phần khóa cần thiết, không phải định nghĩa bảng mới.
- Đường liền/crow's foot biểu diễn FK thật: một parent có `0..*` child; mỗi child có một parent hoặc `0..1` nếu FK nullable. Riêng ER2b ghi số: một connection phải có **2 endpoint tại COMMIT**; một port có tối đa **3 endpoint theo schema DB** (ba giá trị side, unique từng side), còn service giới hạn mặt hợp lệ theo loại thiết bị. Không hiểu `0..3` là API cho phép cả ba mặt trên mọi loại.
- Nét chấm ER0 là N:N **qua bảng nối có tên trên cạnh**; nét chấm ER3b-1 là sao chép nội dung bằng service, **không phải FK Item → TemplateItem**. Những FK tới context không vẽ thành hộp vẫn ghi đích tại field: System=`project_systems`, Area=`project_areas`, Device=`project_devices`, User=`users`.
- Tất cả FK thể hiện dùng `ON DELETE RESTRICT`; không suy rằng mọi FK đều có `ON UPDATE RESTRICT` (đa số dùng mặc định NO ACTION). FK nullable ghép không biến cột target nullable thành bắt buộc; `project_id` vẫn NOT NULL.
- ER0 cố ý lược Area, port, Item/Issue, snapshot và phần lớn field. Toàn bộ 22 bảng nghiệp vụ xuất hiện trong các ER chi tiết; bảng `migrations` là hạ tầng, không đưa vào ERD nghiệp vụ. Sequence, enum type và trigger là object DB, không vẽ thành entity. Không có bảng Rack, Placement, UserProject, export job hoặc FK Task → Inspection/Issue.
- Các hình chi tiết ưu tiên khóa, field trạng thái/phiên bản và nullable ảnh hưởng quan hệ; lược phần lớn `created_at`/`updated_at`, độ dài varchar không thiết yếu, index phục vụ truy vấn và một số field mô tả. User có `password_hash` NOT NULL nhưng được lược khỏi hình; không có giá trị hash/credentials trong tài liệu. Device còn các field mô tả/thông tin tùy chọn, không phải mọi cột đều được liệt kê ở ER2a-1.
- ER4a lược `original_name varchar(255) NOT NULL`, `mime_type varchar NOT NULL`, `size_bytes integer NOT NULL`, `caption text NULL`, `delete_reason text NULL`, `created_at timestamptz NOT NULL`. Metadata này không tạo FK. Storage key là **tên cột schema**, không phải đường dẫn hoặc giá trị storage thật. ER4b-1/2 là hai phần của cùng bảng acceptance; các field ở phần bổ sung không thay thế phần trước.

### Nguồn entity và service theo hình

Đường dẫn tính từ `backend/src/`:

| Hình | Entity | Service để đối chiếu quy tắc không suy từ FK |
| --- | --- | --- |
| ER0, ER1 | `users/user.entity.ts`; `projects/project.entity.ts`, `project-area.entity.ts`, `project-system.entity.ts` | `projects/projects.service.ts`, `users/users.service.ts` |
| ER2a-1/2 | `devices/project-device.entity.ts`, `project-device-system.entity.ts`, `rack-served-area.entity.ts`, `device-network-profile.entity.ts` | `devices/devices.service.ts`, `racks.service.ts` |
| ER2b | `connections/device-port.entity.ts`, `physical-connection.entity.ts`, `connection-endpoint.entity.ts` | `connections/connections.service.ts` |
| ER3a | `tasks/project-task.entity.ts` | `tasks/tasks.service.ts` |
| ER3b-1/2 | `inspections/inspection.entities.ts` (5 entity) | `inspections/inspections.service.ts` |
| ER4a | `evidence/evidence.entity.ts` | `evidence/evidence.service.ts`, `evidence.storage.ts` |
| ER4b-1/2 | `acceptances/acceptance.entities.ts` (4 entity) | `acceptances/acceptances.service.ts` |

### Migration đã đối chiếu theo thứ tự áp dụng

Tất cả file trong `backend/src/database/migrations/`. Những migration sau **bổ sung/sửa ràng buộc trước**, không được chỉ đọc migration tạo bảng hoặc chỉ decorator để kết luận schema cuối.

| Thứ tự | File | Ảnh hưởng chính tới ERD |
| --- | --- | --- |
| 1 | `1790000000000-CreateUsers.ts` | User, email unique, CHECK role. |
| 2 | `1791000000000-CreateProjectStructure.ts` | Project/Area/System; parent Area là FK đơn `parent_id → id`; unique code theo Project. |
| 3 | `1792000000000-CreateProjectTasks.ts` | Task; FK System/Area cùng Project, assignee/reviewer; CHECK trạng thái/ghi chú. |
| 4 | `1793000000000-CreateProjectDevices.ts` | Device; self-FK rack, FK Area và bảng nhiều System; các candidate key `(project_id,id)`. |
| 5 | `1794000000000-CreateDeviceConnections.ts` | Port/connection/endpoint; PK `(connection_id,end)`, unique mặt và unique cặp connection/port. |
| 6 | `1795000000000-EnforceConnectionEndpointPair.ts` | Preflight; constraint trigger deferred bảo đảm đủ A/B ở COMMIT, bỏ qua connection đã xóa hợp lệ. |
| 7 | `1796000000000-AddDeviceNetworkProfileAndPortMetadata.ts` | NetworkProfile; CHECK mode/IPv4/MAC; IP không unique; VLAN/PoE nullable trên port. |
| 8 | `1797000000000-AddRackLayout.ts` | Mở rộng enum Device; role/parent/U; served Area; GiST exclusion và trigger layout. |
| 9 | `1798000000000-EnforceRackLayoutIntegrity.ts` | Sửa CHECK mount chống NULL lọt qua; trigger deferred kiểm tra loại rack phục vụ Area. |
| 10 | `1799000000000-EnforceRackServedAreaForeignKey.ts` | Khóa bảng trước preflight; `rack_type` cố định RACK; unique `(project_id,id,type)` và FK ghép phân biệt type, chống race đổi type. FK/trigger cũ vẫn tồn tại. |
| 11 | `1800000000000-CreateInspections.ts` | 5 bảng; FK template/revision, scope; Item; Issue và partial unique lỗi chưa CLOSED. |
| 12 | `1801000000000-CreateEvidenceAttachments.ts` | Evidence, 3 FK target cùng Project, XOR, idempotency, CHECK file/xóa mềm; candidate key Task/Issue. |
| 13 | `1802000000000-CreateProjectAcceptances.ts` | Acceptance, 2 bảng lựa chọn, snapshot; replacement cùng Project/System, partial unique khi CONFIRMED; candidate key Evidence. |
| 14 | `1803000000000-AddUserAccountSecurity.ts` | mustChangePassword/authVersion/version; CHECK và unique lower(email), giữ dữ liệu User hiện có. |

### DB cưỡng chế và service kiểm tra

- **Area:** DB kiểm tra enum, sort và FK parent tồn tại; parent FK không ghép Project. Cùng Project, ROOM cần FLOOR và FLOOR không có parent được `ProjectsService` kiểm tra, không gán nhầm cho FK.
- **Device/rack:** DB có CHECK vị trí/role/mount, FK parent cùng Project, exclusion chống chồng khoảng U, trigger kiểm tra capacity/layout. Mount null yêu cầu tọa độ U null; U/ZERO_U đều cần height không null theo CHECK đã sửa; chỉ PDU được ZERO_U. `rack_served_areas.rack_type` NOT NULL/default/CHECK RACK cùng FK `(project_id,rack_id,rack_type)` cưỡng chế đúng loại, kể cả đổi type đồng thời. FK `rack_id` chứa Device **không tự là FK phân biệt loại**; service kiểm tra rack đích. `effectiveAreaId` là suy ra, không có cột đó. Area phục vụ tường minh; không tự mở rộng FLOOR thành ROOM; MAIN/SUB là quản lý, không tạo uplink.
- **Network/port:** DB có CHECK IPv4/mode/MAC, VLAN null hoặc 1–4094 và boolean PoE nullable; IP trùng không bị unique. NetworkProfile chỉ CAMERA/AP và VLAN/PoE khác null chỉ trên SWITCH là quy tắc service, không có DB type constraint tương ứng. CAMERA/AP tối đa một port được service khóa Device và đếm, không phải partial unique của DB. `false` không đồng nghĩa null.
- **Task/Issue:** DB kiểm tra trạng thái, ghi chú/thời điểm cần thiết và FK User; active/role/ownership, chuyển trạng thái và thứ tự khóa do service. Task không có cột version. Issue có partial unique `item_id WHERE status <> 'CLOSED'`: nhiều lỗi lịch sử nhưng tối đa một lỗi chưa đóng. FAIL/tạo lỗi và recheck Item/Issue là transaction nghiệp vụ; resolve không tự đổi FAIL thành PASS.
- **Template/inspection:** FK `(template_id,template_revision)` giữ revision; Item chứa nội dung sao chép, không FK tới mục mẫu. CHECK scope cho Area hoặc Device hoặc cả hai null, không đồng thời. Khớp category/System và Device thuộc System được kiểm tra lúc tạo bằng service, không tạo FK lịch sử tới bảng liên kết Device–System.
- **Evidence:** DB CHECK tương đương `(task_id IS NOT NULL)::int + (inspection_item_id IS NOT NULL)::int + (issue_id IS NOT NULL)::int = 1`, cùng ba FK nullable ghép Project. Unique idempotency là `(project_id,uploaded_by_id,idempotency_key)`; storage key unique. DB giới hạn MIME JPEG/PNG/PDF, size_bytes từ 1 byte đến 10 MiB (10.485.760 byte), định dạng hash/key, caption và bộ field xóa mềm. Quyền/khóa trạng thái, quota 20 active và fingerprint file/metadata do service; không mô tả MIME/signature là quét mã độc. Disk không phải một bảng hay FK.
- **Acceptance:** DB giữ FK lựa chọn cùng Project, CHECK status/actor/thời điểm, reason đi cùng replaces_id và không tự tham chiếu. FK replacement còn ghép System. Có thể nhiều DRAFT thay thế; partial unique chỉ cho một replacement CONFIRMED trực tiếp. Latest-chain, cùng System/phạm vi của các lựa chọn, PASS/Issue CLOSED, file active/hash, pin và bất biến sau confirm do service. DB cho `0..1` snapshot mỗi acceptance; service tạo đúng một khi confirm. JSON `content` là bản sao dữ liệu với CHECK object/schema_version=1, **không có FK bên trong tới từng entity lịch sử**. Không tự đổi Project.status hoặc khẳng định khách hàng đã ký.

### Kích thước A4 và kết quả QA ERD

Cả 11 hình dùng **A4 dọc**, mỗi hình một trang, cùng vùng QA như nhóm trước: đỉnh hình 18 mm, dải chú thích cao 8 mm cách đáy 18 mm, cách hình ít nhất 4 mm. Khóa tỉ lệ và đặt đúng chiều được chỉ định; không dùng Fit-to-page hoặc thu nhỏ để ghép hình.

| Hình | SVG viewBox | Chiều đặt | Kích thước thực rộng × cao | Chữ nhỏ nhất gồm legend |
| --- | --- | --- | --- | --- |
| ER0 | 638 × 1086 | Cao 240 mm | 140,99 × 240,00 mm | 11,28 pt |
| ER1 | 734 × 956 | Rộng 170 mm | 170,00 × 221,42 mm | 11,82 pt |
| ER2a-1 | 799 × 997 | Rộng 170 mm | 170,00 × 212,13 mm | 10,86 pt |
| ER2a-2 | 816 × 751 | Rộng 170 mm | 170,00 × 156,46 mm | 10,63 pt |
| ER2b | 717 × 1117 | Cao 245 mm | 157,26 × 245,00 mm | 11,19 pt |
| ER3a | 733 × 935 | Rộng 170 mm | 170,00 × 216,85 mm | 11,83 pt |
| ER3b-1 | 750 × 1036 | Rộng 170 mm | 170,00 × 234,83 mm | 11,57 pt |
| ER3b-2 | 640 × 1259 | Cao 249 mm | 126,58 × 249,00 mm | 10,09 pt |
| ER4a | 598 × 1198 | Cao 245 mm | 122,30 × 245,00 mm | 10,43 pt |
| ER4b-1 | 800 × 1116 | Rộng 170 mm | 170,00 × 237,15 mm | 10,84 pt |
| ER4b-2 | 643 × 916 | Rộng 170 mm | 170,00 × 242,18 mm | 13,49 pt |

Style bổ sung [erd-style.iuml](src/erd-style.iuml) chỉ include style local chung, không sửa hình KT/UC. Nội dung/legend SVG thực tế 18 px, tiêu đề 23 px; công thức quy đổi như phần QA trên. Thuộc tính chứa dấu ngoặc được khai báo `{field}` để PlantUML không nhầm thành method bị ẩn. Dùng lệnh PowerShell render chung ở trên: input tương đối, SVG và PNG 192 dpi; không gửi source ra dịch vụ công khai.

Ngày 23/10/2026 đã render local và mở xem **từng SVG trong Chrome, từng hình qua PNG và đủ 11 trang PDF QA A4**. PDF QA dùng PNG 192 dpi đặt đúng kích thước trên, render lại bằng Poppler; không thấy chữ bị cắt, đường/nhãn đè nhau hoặc tràn vùng chú thích. File QA/script/screenshot nằm ngoài repo, không phải báo cáo cuối. Chữ nhỏ nhất sau quy đổi 10,09–13,49 pt; chưa kiểm tra ghép vào Word, template báo cáo cuối hoặc in giấy. Nếu đổi font/engine/lề/chú thích phải QA lại, không suy từ font nguồn rằng mọi kích thước chèn đều đọc được.

Không chạy test/build ứng dụng, SQL hoặc DB trong lượt ERD; không kiểm chứng schema drift trên DB live. Những quy tắc chỉ ở service đã được gắn nhãn rõ; không suy diễn chúng thành constraint bảo vệ mọi thao tác SQL/import ngoài API.

## ST1 — trạng thái Task

Mốc đối chiếu: `main`, HEAD `2a675fe`, ngày **23/10/2026**. Chỉ tạo ST1, không bổ sung sơ đồ trạng thái Issue, acceptance hoặc tài khoản trong lượt này. Phù hợp chương phân tích/thiết kế quy trình thi công; chú thích đề xuất: **Vòng đời công việc và quyền chuyển trạng thái**.

| Mã | Nội dung | Nguồn / SVG / PNG | Kích thước chèn đã QA |
| --- | --- | --- | --- |
| ST1 | Luồng bắt đầu, gửi duyệt, trả việc và duyệt; sửa/giao lại không đổi trạng thái. | [Nguồn](src/ST1.puml) · [SVG](rendered/ST1.svg) · [PNG](rendered/ST1.png) | A4 dọc, rộng **170 mm**, cao **204,12 mm**, khóa tỉ lệ. |

### Đối chiếu source, API và điều kiện

Các đường dẫn dưới đây tính từ gốc repo. Đã đọc test để xác định assertion đang có, **không chạy lại test** trong lượt tài liệu này.

- `backend/src/tasks/task-status.enum.ts`: đúng năm trạng thái ASSIGNED, IN_PROGRESS, SUBMITTED, RETURNED, APPROVED.
- `backend/src/tasks/tasks.controller.ts`: JWT/role guard; MANAGER tạo/sửa/approve/return, TECHNICIAN start/submit. Route nằm dưới `/projects/:projectId/tasks`.
- `backend/src/tasks/tasks.service.ts`: `createTask`, `updateTask`, `startTask`, `submitTask`, `approveTask`, `returnTask`, `transition`; kiểm tra trạng thái, assignee hiện hành, liên kết cùng Project và cập nhật có điều kiện.
- `backend/src/tasks/dto/task.dto.ts`: dữ liệu tạo/sửa, completionNote và reason; `backend/src/projects/dto/dto.transforms.ts`: chuẩn hóa mã và trim text. `backend/src/tasks/project-task.entity.ts` và `backend/src/database/migrations/1792000000000-CreateProjectTasks.ts`: trạng thái mặc định và CHECK ghi chú; FK/nullable xem ER3a.
- `backend/test/tasks.test.cjs`: assertion tạo ở ASSIGNED, normalization/null, quyền/ownership, giao lại, return/resubmit/terminal và cập nhật stale. `backend/test/tasks.db.test.cjs`: FK/CHECK và luồng service trên PostgreSQL tạm. `backend/test/tasks.http.test.cjs`: Nest boot, JWT/role/UUID; không coi file HTTP này tự nó đã kiểm tra mọi cạnh workflow.
- `backend/src/auth/jwt-auth.guard.ts`, `auth.service.ts`, `roles.guard.ts`: JWT hiện hành, User active/authVersion, buộc đổi mật khẩu và role. Đây là điều kiện API chung, không phải trạng thái Task mới.

| Từ → đến | API/thao tác và actor | Điều kiện / dữ liệu có ý nghĩa |
| --- | --- | --- |
| Khởi tạo → ASSIGNED | `POST /projects/:projectId/tasks`, MANAGER | Bắt buộc code/title/systemId/assigneeId hợp lệ; Project/System tồn tại, cùng Project; Area tùy chọn cũng cùng Project. Người nhận phải là TECHNICIAN active. Code chuẩn hóa, title không trống. Không nhận trạng thái khởi tạo tùy ý từ client. |
| ASSIGNED → IN_PROGRESS | `POST .../:taskId/start`, TECHNICIAN | Chỉ người được giao hiện hành. Không yêu cầu body bổ sung. |
| RETURNED → IN_PROGRESS | `POST .../:taskId/start`, TECHNICIAN | Cùng thao tác start, vẫn kiểm tra assignee hiện hành; không phải một trạng thái “làm lại” mới. |
| IN_PROGRESS → SUBMITTED | `POST .../:taskId/submit`, TECHNICIAN | Đúng assignee; completionNote là chuỗi không trống sau trim. Lưu submittedAt; xóa returnReason, reviewedById và reviewedAt cũ khi gửi lại. |
| SUBMITTED → APPROVED | `POST .../:taskId/approve`, MANAGER | Chỉ từ SUBMITTED; ghi người/thời điểm duyệt, không yêu cầu ghi chú duyệt mới. |
| SUBMITTED → RETURNED | `POST .../:taskId/return`, MANAGER | reason là chuỗi không trống sau trim; lưu lý do, người và thời điểm trả việc. |

Ghi chú sửa/giao lại trên hình áp dụng cho **cả ASSIGNED và RETURNED**, dù neo cạnh ASSIGNED để tránh dây chéo. `PATCH .../:taskId` chỉ MANAGER, yêu cầu ít nhất một field cho phép: code, title, systemId, areaId, assigneeId hoặc description. Nếu đổi người nhận thì kiểm tra TECHNICIAN active dưới khóa; System/Area mới vẫn cùng Project. PATCH không đổi status, không tự xóa lịch sử review; không vẽ self-transition có ngữ nghĩa thoát/vào lại trạng thái. IN_PROGRESS, SUBMITTED và APPROVED không được sửa/giao lại bằng API này.

APPROVED không có cạnh chuyển tiếp ra trong API Task hiện tại; bản ghi vẫn tồn tại và người đang được giao vẫn có thể xem ở mọi trạng thái. Không thêm trạng thái CANCELLED/DELETED hoặc tự chuyển APPROVED trở lại. **Duyệt Task không cập nhật Project.status và không có nghĩa toàn Project đã hoàn thành.**

Thao tác ngoài trạng thái cho phép hoặc cập nhật có điều kiện thua tranh chấp trả 409; Task không dùng expectedVersion. Điều kiện UPDATE vẫn gồm status nguồn và, với TECHNICIAN, assigneeId. Không biểu diễn mọi cạnh từ chối lên hình: DTO/ghi chú thiếu trả 400; JWT không hợp lệ 401; sai vai trò 403; TECHNICIAN truy cập Task người khác hoặc resource khác Project 404. Guard còn có 403 PASSWORD_CHANGE_REQUIRED nếu chưa đổi mật khẩu tạm. Đây là mô tả source, không phải kết quả HTTP smoke mới.

### Render và QA ST1

Tái sử dụng `style.iuml`, local PlantUML/Java/Graphviz theo lệnh PowerShell chung phía trên; nguồn ST1 chỉ override style state và noteFontSize=18, không thay style hoặc bản render của các hình khác. Đã render SVG và PNG 192 dpi, mở SVG bằng Chrome local, xem PNG cuối và **một trang PDF QA A4 ngoài repo** qua bản render Poppler.

SVG viewBox **837 × 1005**, chữ nội dung/cạnh/ghi chú/legend thực tế **18 px**, tiêu đề 23 px. Chèn rộng 170 mm, cao 204,12 mm cho chữ nhỏ nhất **10,36 pt** theo công thức quy đổi đã nêu. Trang QA A4 dọc có hình cách đỉnh 18 mm, căn giữa ngang (lề mỗi bên 20 mm); dải trống chú thích cao 8 mm cách đáy 18 mm. Không thấy cắt/đè chữ, đường đi hoặc tràn trang ở kích thước này. Không thu nhỏ thêm; nếu mẫu báo cáo đổi lề/kích thước chèn cần QA lại.

PDF QA, script và screenshot kiểm tra đều ngoài repo, không phải báo cáo cuối. Chưa ghép Word hoặc in giấy; không kiểm chứng runtime/DB mới, không chạy test/build/seed. Lượt này chỉ thêm ba file ST1 và cập nhật README sơ đồ; không sửa ứng dụng, DB hoặc dependency.

## ST2 — vòng đời Issue và kiểm tra lại

Mốc đối chiếu: `main`, HEAD `34626e8`, ngày **23/10/2026**. Chỉ mô hình hóa `IssueStatus`: OPEN, IN_PROGRESS, RESOLVED, CLOSED; **không trộn** các giá trị `InspectionResult` NOT_CHECKED/PASS/FAIL thành trạng thái của Issue. Trên cạnh, phần sau `/` là tác động tới dữ liệu, không phải state mới. Chú thích đề xuất cho chương quy trình kiểm tra/khắc phục: **Vòng đời lỗi, quyền xử lý và kiểm tra lại nguyên tử**.

| Mã | Nguồn / SVG / PNG | Kích thước chèn đã QA |
| --- | --- | --- |
| ST2 | [Nguồn](src/ST2.puml) · [SVG](rendered/ST2.svg) · [PNG](rendered/ST2.png) | A4 dọc; rộng **150 mm**, cao **238,01 mm**, khóa tỉ lệ. |

### Nguồn đối chiếu ST2

- `backend/src/inspections/inspection.enums.ts`: hai enum riêng IssueStatus và InspectionResult.
- `backend/src/inspections/inspections.controller.ts`: MANAGER ghi kết quả Item/giao lại/recheck; TECHNICIAN start/resolve; hai vai trò đọc Issue theo service. Phiếu/Item chỉ MANAGER.
- `backend/src/inspections/dto/inspection.dto.ts`: `PutInspectionResultDto`, `CreateIssueDto`, `VersionDto`, `AssignIssueDto`, `ResolveIssueDto`, `RecheckIssueDto`.
- `backend/src/inspections/inspections.service.ts`: `putResult`, `visibleIssue`, `mutateIssue`, `lockIssueAssignees`, `startIssue`, `resolveIssue`, `assignIssue`, `recheckIssue`, `write` và kiểm tra `version`.
- `backend/src/inspections/inspection.entities.ts`; `backend/src/database/migrations/1800000000000-CreateInspections.ts`: quan hệ Item/Issue, CHECK ghi chú/thời điểm và partial UNIQUE `item_id WHERE status <> 'CLOSED'`. ER3b-2 mô tả quan hệ lịch sử, ST2 mô tả hành vi API; không suy rằng CHECK DB tự cưỡng chế mọi cạnh workflow.
- `backend/test/inspections.test.cjs`: validation DTO/version/null/ghi chú. `backend/test/inspections.db.test.cjs`: FAIL rollback/concurrency, ownership/giao lại/start, resolve giữ FAIL, recheck hai version/reason, rollback khi đóng, CLOSED bất biến và FAIL mới; có hai thứ tự race có kiểm soát assign/start và PUT-result/recheck cùng các assertion HTTP. Chỉ đọc source test trong lượt này, không chạy hoặc tuyên bố kết quả mới.

### API, version và tác động tới Item

Trong bảng, `I` là version Item hiện hành, `V` là version Issue hiện hành. Version là số nguyên dương; sai/thiếu định dạng trả 400, stale hoặc đạt trần tăng version trả 409 theo service. Recheck không được chỉ gửi một trong hai version.

| Chuyển/thao tác | Actor, request | Điều kiện và dữ liệu cập nhật |
| --- | --- | --- |
| Khởi tạo → OPEN | MANAGER, `PUT /projects/:projectId/inspections/:inspectionId/items/:itemId/result` | `{expectedVersion:I, result:'FAIL', issue:{description,assigneeId}, note?}`. Chưa có Issue khác CLOSED; description không trống sau trim, assignee là TECHNICIAN active. Cùng transaction tạo Issue version=1 và cập nhật Item FAIL, note, người/thời điểm kiểm tra, tăng Item.version. Lỗi ở bất kỳ bước nào rollback cả hai. |
| OPEN → IN_PROGRESS | TECHNICIAN, `POST /projects/:projectId/issues/:issueId/start` | `{expectedVersion:V}`; đúng assignee hiện hành. Tăng Issue.version, không đổi kết quả hoặc version Item. |
| IN_PROGRESS → RESOLVED | TECHNICIAN, `POST .../:issueId/resolve` | `{expectedVersion:V,resolutionNote}`; đúng assignee, resolutionNote không trống sau trim. Lưu ghi chú/thời điểm sửa và tăng Issue.version; Item vẫn FAIL, version Item không đổi. RESOLVED vẫn được đếm là lỗi chưa CLOSED. |
| RESOLVED → CLOSED | MANAGER, `POST .../:issueId/recheck` | `{expectedVersion:V,expectedItemVersion:I,result:'PASS',note}`; note không trống sau trim. Nguyên tử: Issue CLOSED, người/thời điểm duyệt, xóa returnReason; Item PASS, note, người/thời điểm kiểm tra. Cả hai version tăng. Giữ resolutionNote/resolvedAt của lần sửa. |
| RESOLVED → OPEN | MANAGER, cùng API recheck | `{expectedVersion:V,expectedItemVersion:I,result:'FAIL',note,reason}`; **cả note và reason bắt buộc không trống**. Nguyên tử: Item vẫn FAIL và nhận note; Issue OPEN, lưu reason vào returnReason, xóa resolutionNote/resolvedAt và reviewedById/reviewedAt cũ. Cả hai version tăng. Đây là cùng Issue chưa đóng, không tạo Issue mới. |
| Giao lại ở OPEN | MANAGER, `PATCH .../:issueId/assignee` | `{expectedVersion:V,assigneeId}`; người nhận mới là TECHNICIAN active. Không đổi status, tăng Issue.version; Item không đổi. Không vẽ self-transition mang nghĩa thoát/vào lại trạng thái. IN_PROGRESS/RESOLVED/CLOSED không được giao lại. |

TECHNICIAN chỉ nhìn thấy và start/resolve Issue hiện được giao cho mình; sau giao lại, người cũ nhận 404. Service đọc lại ownership và Issue.version sau khi chờ khóa Inspection; khóa Item trước callback recheck rồi kiểm tra expectedItemVersion. Giao lại khóa User cũ/mới theo thứ tự UUID ổn định trước các khóa nghiệp vụ và kiểm tra lại assignee. Các ghi trong `write`/`mutateIssue` nằm trong transaction; version cũ hoặc trạng thái sai không được ghi đè. Mọi API còn cần JWT/User active/authVersion và không bị buộc đổi mật khẩu; actor sai vai trò trả 403, resource khác Project/người khác trả 404.

Khi đã có Issue chưa CLOSED, `PUT result` không được đổi Item trực tiếp sang PASS/NOT_CHECKED hoặc gửi thêm `issue` để tạo lỗi trùng (409). MANAGER vẫn có thể ghi lại FAIL/note **không kèm issue mới**, với expectedVersion Item đúng; thao tác này tăng Item.version nhưng không đổi Issue/status/version. Vì vậy recheck luôn phải tải/kiểm tra cả version Item lẫn Issue.

**CLOSED bất biến trong API Issue**, không có cạnh CLOSED → OPEN. Nếu về sau Item được đánh FAIL khi không còn Issue chưa đóng, MANAGER phải gửi mô tả/người nhận để tạo **Issue ID mới**, version Issue mới=1; Issue CLOSED và lịch sử trước giữ nguyên. Không vẽ nối CLOSED tới OPEN vì như vậy sẽ ngụ ý mở lại cùng bản ghi. Partial unique ở DB và transaction/khóa ở service giữ tối đa một Issue chưa CLOSED cho mỗi Item.

### QA A4 ST2 và giới hạn

Giữ style ST1: include local `style.iuml`, màu state giống nhau, note/legend/nội dung 18 px, tiêu đề 23 px. Render bằng PlantUML/Java/Graphviz local đã có, SVG và PNG 192 dpi; không cài dependency hoặc gửi source ra dịch vụ công khai. SVG viewBox **680 × 1079**; rộng 150 mm cho cao 238,01 mm, chữ nhỏ nhất **11,26 pt** theo công thức quy đổi phần trên, không cần tách hình.

Đã mở SVG trong Chrome local, xem PNG và trang PDF QA A4 render bằng Poppler ngoài repo. Hình cách đỉnh trang 18 mm, lề ngang mỗi bên 30 mm, chừa dải chú thích cao 8 mm cách đáy 18 mm. Không thấy chữ/nhãn/đường nối chồng hoặc cắt/tràn ở kích thước này. PDF QA và script/screenshot không thuộc repo hoặc phạm vi stage. Chưa kiểm tra Word/in giấy; nếu đổi kích thước chèn/font/lề cần QA lại. Không chạy test/build/seed/DB hoặc xác minh runtime mới; chỉ thêm ST2 và cập nhật README, không thay ST1/ứng dụng/schema/dependency.

## ST3 — nghiệm thu và quan hệ thay thế

Mốc đối chiếu: `main`, HEAD `ad22f6c`, ngày **23/10/2026**. Tách thành **ST3a và ST3b** để không dùng cạnh chuyển trạng thái biểu diễn việc sinh hồ sơ mới. Dùng trong chương thiết kế quy trình kiểm tra/nghiệm thu; không thay thế ER4b về cấu trúc dữ liệu.

| Mã | Chú thích đề xuất / nội dung | Nguồn / SVG / PNG | Kích thước A4 đã QA |
| --- | --- | --- | --- |
| ST3a | Vòng đời một hồ sơ nghiệm thu; chỉ hai trạng thái DB DRAFT và CONFIRMED. | [Nguồn](src/ST3a.puml) · [SVG](rendered/ST3a.svg) · [PNG](rendered/ST3a.png) | Dọc, rộng **170 mm**, cao **192,79 mm**; chữ nhỏ nhất **14,01 pt**. |
| ST3b | Quan hệ thay thế giữa các hồ sơ riêng biệt tại hai thời điểm. | [Nguồn](src/ST3b.puml) · [SVG](rendered/ST3b.svg) · [PNG](rendered/ST3b.png) | Dọc, rộng **170 mm**, cao **240,49 mm**; chữ nhỏ nhất **12,44 pt**. |

### Nguồn đối chiếu ST3

- `backend/src/acceptances/acceptance.entities.ts`: enum AcceptanceStatus, ProjectAcceptance, AcceptanceSnapshot và các lựa chọn phiếu/evidence. Chỉ DRAFT/CONFIRMED; replacesId/replacementReason nullable. Không có enum SUPERSEDED/REPLACED hoặc cột replacedById.
- `backend/src/acceptances/acceptances.controller.ts`: MANAGER tạo/sửa/readiness/confirm/replacement và file; TECHNICIAN chỉ GET theo whitelist của service, không mutation.
- `backend/src/acceptances/acceptance.dto.ts`: CreateAcceptanceDto, UpdateAcceptanceDto, ConfirmAcceptanceDto, ReplacementAcceptanceDto; VersionDto dùng chung từ `backend/src/inspections/dto/inspection.dto.ts`.
- `backend/src/acceptances/acceptances.service.ts`: `editable`, `latest`, `validateSelection`, `replaceSelection`, `sources`, `readiness`, `verifyFile`, `confirm`, `replacement`, `response`, `file` và `write`. Đây là nguồn điều kiện service và transaction, không chỉ enum/decorator.
- `backend/src/database/migrations/1802000000000-CreateProjectAcceptances.ts`: FK replacement cùng Project/System, CHECK status/actor/thời điểm, reason và partial UNIQUE một replacement CONFIRMED trực tiếp. Bất biến snapshot và điều kiện nghiệm thu còn do service kiểm tra, không suy từ FK rằng SQL tùy ý cũng theo workflow.
- `backend/test/acceptances.test.cjs`: DTO/null/hai mảng bắt buộc nhưng cho phép [], fingerprint canonical. `backend/test/acceptances.db.test.cjs`: blockers, source fingerprint, thiếu/sai hash file rollback, snapshot bất biến/file ghim sau xóa mềm, confirm/concurrency với checklist/evidence, hai replacement tranh confirm, chuỗi tiếp và HTTP replacement với lựa chọn mới khi Task đổi System. Chỉ đọc test; không chạy test hoặc tuyên bố kết quả runtime mới.

### Vòng đời một hồ sơ — ST3a

Các endpoint dưới `/projects/:projectId/acceptances`; tất cả mutation chỉ MANAGER và vẫn cần JWT/quyền hiện hành.

| Thao tác | Request / điều kiện | Tác động |
| --- | --- | --- |
| Tạo thường | `POST` với code, title, systemId, inspectionIds, evidenceIds; note tùy chọn. Hai mảng bắt buộc, không trùng, có thể []. | Hồ sơ **ID mới**, DRAFT, version=1, replacesId/replacementReason null. Chưa có snapshot hoặc file ghim. |
| Sửa nháp | `PATCH /:id`, expectedVersion đúng, ít nhất một field cho phép code/title/note/inspectionIds/evidenceIds. | Chỉ DRAFT; tăng version, không đổi status hoặc System. Mảng được gửi thay toàn bộ lựa chọn tương ứng; [] hợp lệ, mảng bỏ qua giữ lựa chọn hiện tại. Không dùng self-transition mang nghĩa thoát/vào lại state. |
| Readiness | `GET /:id/readiness`, chỉ DRAFT. | Trả eligible/blockers/sourceFingerprint/version; chỉ tư vấn, không xác nhận. Nguồn có thể thay đổi sau response; kiểm tra file vật lý nằm ở confirm, nên eligible không bảo đảm file thực tế còn hợp lệ. |
| Confirm | `POST /:id/confirm` với expectedVersion và expectedSourceFingerprint hợp lệ, khớp nguồn đọc lại dưới khóa. | Trong cùng transaction: lưu snapshot schemaVersion=1, ghim các evidence đã chọn, đổi status CONFIRMED, tăng version và ghi confirmedById/confirmedAt. Không có cạnh quay về DRAFT. |

“Phiếu đủ điều kiện; file hợp lệ” trên cạnh confirm là cách rút gọn các kiểm tra sau, **không bỏ điều kiện service**:

1. Project/System và lựa chọn tồn tại đúng phạm vi. Phiếu cùng Project/System; evidence Task phải cùng System; evidence Item/Issue phải thuộc phiếu đã chọn. Evidence phải active tại confirm; không tự lấy thêm evidence ngoài lựa chọn.
2. Có ít nhất một phiếu; mỗi phiếu có ít nhất một Item; **mọi Item PASS và mọi Issue của các Item đều CLOSED**. RESOLVED chưa đủ. Device đổi liên kết System sau khi tạo phiếu không tự làm phiếu lịch sử mất giá trị.
3. Version hồ sơ đúng, fingerprint mới khớp toàn bộ dữ liệu thực sự đưa vào snapshot (Project/System, phạm vi Area/Device, phiếu/Item/Issue, Task evidence, actors và metadata evidence). Nguồn được chuẩn hóa thứ tự; readiness không thay confirm kiểm tra lại.
4. Mỗi evidence đã chọn được đọc từ storage và kiểm tra **size cùng SHA-256** so với metadata. File thiếu/không đọc được hoặc sai integrity không được bỏ qua để confirm gói thiếu; transaction không để snapshot/pin/status dở dang. Evidence **không bắt buộc**: danh sách [] vẫn có thể confirm nếu các điều kiện khác đủ.
5. Với DRAFT thay thế, bản gốc vẫn phải là CONFIRMED và chưa có replacement CONFIRMED trực tiếp khi kiểm tra lại dưới khóa; xem ST3b.

“Ghim” theo code là ghi `pinnedStorageKey` nội bộ trong liên kết AcceptanceEvidence tới file hiện hữu, **không phải copy file mới sang một thư mục archive**. Snapshot giữ metadata/nội dung nghiệp vụ; không có FK tới từng field lịch sử bên trong JSON. Sau confirm, API đọc snapshot, không lấy nội dung sống thay thế; xóa mềm evidence nguồn không làm mất file ghim cho MANAGER qua API hồ sơ. Cơ chế này không phải backup chống mất/hỏng file disk.

CONFIRMED không sửa nội dung hoặc quay lại nháp bằng API; sửa sai bằng ID mới. “Bất biến” nói về nội dung/snapshot/liên kết của hồ sơ, không có nghĩa field **suy ra** replacedById luôn giữ nguyên. Không tự cập nhật Project.status, không chứng minh toàn System/Project được bao phủ và không biểu thị khách hàng đã ký.

### Quan hệ giữa các hồ sơ — ST3b

ST3b là minh họa đối tượng/quan hệ, **không phải state machine thứ hai**. A/B/C là ba ID khác nhau; hai khung là hai thời điểm của cùng ví dụ, không phải các state. Mũi tên nét chấm đi **từ bản mới về bản gốc** theo replacesId. Không có cạnh từ CONFIRMED của A sang DRAFT của B.

MANAGER gọi `POST /:id/replacement` trên bản gốc với `{code,title,reason,inspectionIds,evidenceIds}`. reason không trống sau trim, tối đa 2000 ký tự, được lưu thành replacementReason. Hai mảng bắt buộc, không trùng, cho phép []; lựa chọn được kiểm tra giống tạo nháp và lỗi rollback cả nháp mới. Không tự sao chép evidence hoặc danh sách phiếu từ bản gốc. Code hiện tại **sao chép note của bản gốc**, giữ cùng Project/System; các field này không phải bằng chứng rằng snapshot/evidence cũ bị ghi đè. API tạo replacement không nhận expectedVersion; kiểm tra bản gốc bằng khóa và `latest`. Sửa/confirm nháp mới vẫn dùng version của chính nháp đó.

- **Thời điểm 1:** A CONFIRMED, B DRAFT với B.replacesId=A. A.replacedById vẫn null: tạo nháp không làm A mất hiệu lực. Có thể nhiều DRAFT cùng trỏ A; ST3b chỉ vẽ một để tránh rối.
- **Khi confirm B:** kiểm tra lại các điều kiện ST3a và bản gốc A. B CONFIRMED thành công thì response của A mới suy ra replacedById=B. Không UPDATE A thành SUPERSEDED/REPLACED; status A vẫn CONFIRMED, snapshot và file ghim A giữ nguyên.
- **Thời điểm 2:** sau khi tạo C từ B và confirm C, C.replacesId=B, B.replacesId=A. Response A.replacedById=B, B.replacedById=C, C.replacedById=null. “Đã thay thế” của A/B là nhãn suy ra từ quan hệ, **không phải enum/cột status mới**. replacedById chỉ là field response được tìm từ replacement CONFIRMED trực tiếp.
- Chỉ chọn bản gốc CONFIRMED **chưa có replacement CONFIRMED trực tiếp**, tức đầu mới nhất của **chuỗi đó**, không phải bản có createdAt mới nhất toàn Project. Không chọn DRAFT hoặc A sau khi B đã confirm. Nhiều candidate DRAFT được tạo trước đó không thể cùng confirm; khóa predecessor/candidate và partial UNIQUE chặn hai replacement CONFIRMED cùng bản gốc. Candidate thua vẫn DRAFT; không có API tự chuyển nó sang một state “hủy”. Muốn thay tiếp phải tạo từ B (hoặc C khi C đã confirm), không vòng về A.

### Phần lược bỏ, quyền và QA ST3

Hình lược endpoint chi tiết, bảng lựa chọn, số version cụ thể, dữ liệu snapshot và các nhánh lỗi để đọc rõ trên A4; xem ER4b cho schema và các đoạn trên cho điều kiện. Không mô hình hóa lỗi HTTP thành state: validation 400, JWT 401, sai quyền 403, resource/phạm vi không tồn tại 404, version/fingerprint/trạng thái hoặc race 409; lỗi đọc storage có thể 503. TECHNICIAN chỉ nhận summary CONFIRMED whitelist; không form ghi, snapshot chi tiết hoặc file hồ sơ.

Giữ style local ST1/ST2; không sửa `style.iuml` hoặc render hình trước. Nội dung/cạnh/legend/field của SVG là 18 px, tiêu đề 23 px; ST3b tiêu đề khung cũng 18 px. ViewBox ST3a **619 × 702**, ST3b **697 × 986**. Kích thước trong bảng dùng công thức quy đổi đã nêu, mỗi hình trên **một trang A4 dọc**, rộng 170 mm, lề ngang 20 mm, đỉnh hình 18 mm; dải chú thích trống cao 8 mm cách đáy 18 mm.

Đã render SVG/PNG 192 dpi hoàn toàn local, mở từng SVG bằng Chrome, xem từng PNG cuối và đủ hai trang PDF QA ngoài repo qua Poppler. Không thấy cắt/đè chữ hoặc đường nối, không tràn vùng chú thích; chữ nhỏ nhất 14,01 pt (ST3a) và 12,44 pt (ST3b). QA/script/screenshot không thuộc repo và không phải báo cáo cuối. Chưa ghép Word/in giấy; đổi lề/font/kích thước phải QA lại. Lượt này chỉ tạo sáu file ST3a/ST3b và cập nhật README; không sửa ứng dụng/DB/dependency, không chạy test/build/seed hoặc kiểm chứng runtime mới.

## AC1 và SQ1–SQ3 — phối hợp nghiệp vụ và các luồng trọng tâm

Đối chiếu source hiện có ngày **23/10/2026**, không kiểm tra server/DB hoặc chạy lại test. Các hình mô tả chức năng đã triển khai; không thêm điều kiện liên thông giữa các module. Giữ style local của bộ hình trước, không sửa style dùng chung hoặc render lại hình cũ.

| Mã | Chú thích đề xuất | Nguồn / SVG / PNG | Kích thước chèn A4 dọc đã QA | Vị trí đề xuất |
| --- | --- | --- | --- | --- |
| AC1 | Phối hợp thi công, kiểm tra và bàn giao theo ba vai trò | [Nguồn](src/AC1.puml) · [SVG](rendered/AC1.svg) · [PNG](rendered/AC1.png) | Cao **249 mm**, rộng **167,51 mm**; chữ nhỏ nhất **10,07 pt**. | Thân báo cáo, chương phân tích quy trình. |
| SQ1 | Trình tự ghi FAIL, xử lý lỗi và kiểm tra lại | [Nguồn](src/SQ1.puml) · [SVG](rendered/SQ1.svg) · [PNG](rendered/SQ1.png) | Rộng **170 mm**, cao **209,18 mm**; chữ nhỏ nhất **10,25 pt**. | Thân báo cáo, chương thiết kế/xử lý nghiệp vụ. |
| SQ2 | Trình tự xác nhận nghiệm thu và lưu snapshot | [Nguồn](src/SQ2.puml) · [SVG](rendered/SQ2.svg) · [PNG](rendered/SQ2.png) | Rộng **170 mm**, cao **245,16 mm**; chữ nhỏ nhất **10,80 pt**; lề ngang **20 mm**. | Thân báo cáo, giải thích tính nhất quán hồ sơ. |
| SQ3 | Trình tự tạo, tải và dọn gói ZIP bàn giao | [Nguồn](src/SQ3.puml) · [SVG](rendered/SQ3.svg) · [PNG](rendered/SQ3.png) | Rộng **170 mm**, cao **230 mm**; chữ nhỏ nhất **10,20 pt**. | Phụ lục kỹ thuật; thân báo cáo chỉ dẫn chiếu. |

Nếu giới hạn số hình trong thân báo cáo, ưu tiên AC1 và SQ1; có thể chuyển SQ2 cùng SQ3 sang phụ lục. Không cần tách sequence thành hai hình ở các kích thước trên. Cả nhóm vừa A4 dọc với lề ngang ít nhất 20 mm. SQ2 đã rút gọn/xuống dòng nhãn để rộng 170 mm, giữ font nguồn 18 px thay vì thu nhỏ toàn hình; nếu mẫu báo cáo dùng lề/kích thước khác phải QA lại.

### Nguồn code đối chiếu

| Nhóm | File làm nguồn |
| --- | --- |
| Project/danh mục và Task trong AC1 | `backend/src/projects/projects.controller.ts`, `projects.service.ts`, `project-area.entity.ts`, `project-system.entity.ts`, `dto/area.dto.ts`, `dto/system.dto.ts`; `backend/src/devices/`; `backend/src/tasks/tasks.controller.ts`, `tasks.service.ts`, `task-status.enum.ts`, `dto/task.dto.ts`; `backend/test/tasks.test.cjs`, `tasks.db.test.cjs`. |
| Checklist/Issue — AC1, SQ1 | `backend/src/inspections/inspections.controller.ts`, `inspections.service.ts`, `inspection.enums.ts`, `inspection.entities.ts`, `dto/inspection.dto.ts`; `backend/test/inspections.test.cjs`, `inspections.db.test.cjs`. |
| Nghiệm thu — AC1, SQ2 | `backend/src/acceptances/acceptances.controller.ts`, `acceptances.service.ts`, `acceptance.dto.ts`, `acceptance.entities.ts`; `backend/test/acceptances.test.cjs`, `acceptances.db.test.cjs`. |
| Export — AC1, SQ3 | `backend/src/exports/exports.controller.ts`, `exports.service.ts`, `exports.render.ts`, `xlsx-process-slot.ts`, `xlsx.worker.ts`; `backend/test/exports.db.test.cjs`, `exports.worker.test.cjs`. |
| Quyền và evidence dùng chung | `backend/src/auth/` (JWT/role guard); `backend/src/evidence/`; quyền đọc file ghim qua acceptance nằm trong `acceptances.service.ts`, nguồn snapshot/pin xuất ZIP nằm trong `exports.service.ts`. |

Các đường dẫn rút gọn trong cùng ô giữ thư mục của file đầu tiên. Đã đọc controller/guard/service/DTO liên quan; test chỉ được dùng làm nguồn đối chiếu, không phải kết quả chạy mới.

### AC1 — cách đọc và giới hạn liên thông

Ba swimlane là **MANAGER, TECHNICIAN và Hệ thống**. Các bước khai báo/giao việc, thi công, chủ động tạo phiếu, chọn nguồn nghiệm thu và yêu cầu export thể hiện cách người dùng phối hợp thủ công. Không có job tự chuyển từ Task sang checklist hoặc acceptance. Thao tác kiểm tra/version/ghi kết quả/confirm/export vẫn do API kiểm soát.

- Khối Task gom vòng thực hiện/gửi duyệt/duyệt hoặc trả; xem ST1 cho từng trạng thái. Task APPROVED **không tự tạo phiếu**, không phải điều kiện đủ hoặc điều kiện bắt buộc do acceptance kiểm tra. Không đổi Project.status theo kết quả Task hoặc hồ sơ.
- MANAGER chủ động tạo phiếu và ghi từng Item. Khi cần tạo lỗi mới, FAIL + Issue OPEN được ghi nguyên tử. Vòng khắc phục trong AC1 gom quy trình chi tiết SQ1; recheck chỉ từ RESOLVED, không phải từ mọi trạng thái lỗi.
- “Không còn lỗi chưa đóng” chưa bảo đảm đủ điều kiện nghiệm thu: phiếu không rỗng và mọi Item PASS cùng các điều kiện SQ2 vẫn được kiểm tra. Nhánh confirm không hợp lệ kết thúc lượt yêu cầu, giữ DRAFT; người dùng có thể hoàn thiện nguồn rồi thực hiện lượt mới.
- Export sau confirm là kịch bản trình diễn bàn giao, không phải ràng buộc mọi export đều cần acceptance: PDF/ZIP cần hồ sơ CONFIRMED, còn hai Excel riêng xuất dữ liệu hiện tại theo Project. Không khẳng định toàn Project được nghiệm thu hoặc khách hàng đã ký.

### SQ1 — FAIL, khắc phục và recheck

Mỗi mũi tên từ actor là một request riêng, có xác thực/quyền hiện hành và version mới trả về sau thành công; hình lược các response trung gian. TECHNICIAN phải là assignee hiện hành. MANAGER ghi FAIL dùng `expectedVersion` của Item; khi chưa có Issue mở phải có mô tả không trống và TECHNICIAN active. Transaction cập nhật Item FAIL và tạo Issue OPEN; partial UNIQUE ngăn hai lỗi chưa CLOSED trên cùng Item. Không tự tạo lỗi trùng khi đã có Issue mở, không bỏ qua lỗi mở để đổi trực tiếp PASS/NOT_CHECKED.

Start/resolve dùng `expectedVersion` của Issue, lần lượt OPEN → IN_PROGRESS → RESOLVED. Resolve bắt buộc `resolutionNote`, **Item vẫn FAIL**. Recheck nhận `expectedVersion` của Issue, `expectedItemVersion` của Item và `note` không trống; chỉ khi RESOLVED, kiểm tra cả hai version sau khóa. PASS đóng Issue và đổi Item PASS nguyên tử; FAIL bắt buộc thêm `reason`, trả Issue về OPEN và giữ Item FAIL. Cả hai version được tăng trong cùng transaction. Lỗi kiểm tra/ghi rollback, không đi tiếp các bước còn lại.

Giao lại chỉ khi OPEN, không đổi trạng thái, được lược khỏi sequence để tập trung vòng khắc phục. CLOSED bất biến; nếu Item bị FAIL lại thì tạo Issue ID mới và giữ lịch sử cũ. Khung transaction là ranh giới ghi nghiệp vụ, không phải transaction kéo dài qua thời gian con người sửa lỗi.

### SQ2 — xác nhận lại nguồn rồi lưu hồ sơ bất biến

Readiness chỉ tư vấn, trả `version`, `sourceFingerprint`, blockers; confirm gửi `expectedVersion` và **`expectedSourceFingerprint`**. “fingerprint” trên hình là nhãn rút gọn, không phải tên field request mới. Confirm mở transaction khác và đọc/khóa lại hồ sơ DRAFT cùng nguồn, không dùng kết quả readiness làm bảo đảm.

Các kiểm tra gom trên hình: lựa chọn đúng Project/System/phạm vi; có phiếu không rỗng; mọi Item PASS và mọi Issue CLOSED; version/fingerprint chuẩn hóa khớp; với replacement, predecessor vẫn CONFIRMED và chưa có replacement CONFIRMED trực tiếp. Fingerprint bao phủ dữ liệu thực sự đưa vào snapshot, không chỉ danh sách ID. Trình tự dừng tại kiểm tra lỗi: nguồn không hợp lệ không tiếp tục đọc file. Evidence tùy chọn; nếu có thì phải active, đọc được, đúng size và SHA-256. Nhánh file trên hình chỉ thực hiện khi có lựa chọn và nguồn hợp lệ.

Snapshot, liên kết ghim evidence và status CONFIRMED được ghi trong cùng transaction. “Ghim” giữ tham chiếu nội bộ tới file hiện hữu, không copy sang archive mới; sau xác nhận xóa mềm evidence nguồn vẫn cho MANAGER đọc qua hồ sơ. Nội dung CONFIRMED không được lấy dữ liệu sống thay thế. Tạo replacement là tạo ID DRAFT khác; chỉ khi bản mới confirm thành công bản cũ mới được coi đã thay thế (xem ST3b). Không đổi status bản gốc thành enum mới, không tự đổi Project.status, không xác nhận chữ ký khách hàng.

### SQ3 — phạm vi dữ liệu, integrity và vòng đời tác vụ

“File / renderer local” gom thao tác file, PDF renderer, XLSX child process và archive trong backend local; **không phải một microservice**. Các bước chuẩn bị dừng ngay tại lỗi; nhánh lỗi cuối hình gom việc thoát/cleanup từ bất kỳ bước nào, không có nghĩa vẫn tạo ZIP sau khi kiểm tra thất bại.

1. Chỉ MANAGER với JWT/quyền hiện hành; hồ sơ CONFIRMED đúng Project. Giữ slot chung ZIP/XLSX trước đọc/dựng dữ liệu lớn: tối đa một tác vụ/process, không hàng đợi, không tự lấy lại slot khi gọi renderer từ ZIP.
2. Đọc hồ sơ/snapshot/pin, trạng thái replacement hiện tại và hai graph inventory/đấu nối trong **cùng transaction READ ONLY REPEATABLE READ/EntityManager**. Kết thúc transaction trước render/hash/archive. Hai Excel dùng cùng graph/lượt đọc, không gọi lại nguồn ở hai thời điểm. Thời điểm đọc hiện tại được ghi riêng với thời điểm snapshot nghiệm thu; `transaction_timestamp()` là lúc bắt đầu transaction, không timestamp chính xác thiết lập MVCC snapshot.
3. PDF dùng snapshot lịch sử; nhãn đã thay thế là thông tin hiện tại tách riêng. Hai XLSX là dữ liệu hiện tại. Hash artifact đã tạo; copy từng evidence ghim sang staging đồng thời đo size/SHA-256 và so với snapshot. Chấp nhận file nguồn đã xóa mềm nếu đã ghim, không tự thêm evidence khác. Thiếu/sai integrity hủy cả gói; chỉ archive bản staging đã xác minh, không đọc lại file nguồn để đóng ZIP.
4. Manifest ghi metadata snapshot và hash/size/path của đúng artifact/evidence đưa vào gói; không tự hash manifest. Tên entry do server sinh, không dùng tên gốc làm đường dẫn, không lộ storageKey/đường dẫn nội bộ. ZIP hoàn tất trước headers; tối đa 50 evidence, tổng byte chưa nén (kể cả manifest) và ZIP đều tối đa 200 MiB, deadline toàn tác vụ 120 giây. Giới hạn riêng PDF/XLSX vẫn áp dụng, không cắt dữ liệu.
5. Lỗi trước headers chỉ trả lỗi khi client còn nối; sau headers phải ngắt luồng, không gửi JSON/status mới. Bận 503 + Retry-After; vượt giới hạn 413; deadline 504; storage lỗi 503; file ghim thiếu/sai integrity 409. Abort/deadline hủy stream/worker/archive tương ứng và chờ đóng trước cleanup. Không coi Promise.race là đã hủy công việc.
6. File staging và artifact trung gian được dọn khi chuẩn bị xong/lỗi; ZIP cuối cùng và slot giữ đến khi gửi xong hoặc cleanup lỗi/abort. Release idempotent, không trả slot khi stream còn gửi. Kết nối/pool export riêng được đóng khi abort; startup/server timeout hữu hạn là giới hạn cuối cho query PostgreSQL, **không bảo đảm query server dừng tức thời**, không signaling PID. Không tác động pool nghiệp vụ hoặc xóa evidence nguồn.

### Render lại và kết quả QA nhóm AC1/SQ

Dùng lệnh PlantUML local ở phần render chung, lần lượt truyền `docs/diagrams/src/AC1.puml`, `SQ1.puml`, `SQ2.puml`, `SQ3.puml` (các tên sau cùng thư mục). SVG dùng `-tsvg`; PNG dùng `-tpng -Sdpi=192`, UTF-8, output `../rendered`, include chỉ `style.iuml` local. Không gửi source ra dịch vụ render hoặc cài dependency.

Đã mở từng SVG bằng Chrome local, xem từng PNG và đủ **bốn trang PDF QA A4** render bằng Poppler. Sau đó chỉnh riêng nhãn SQ2 và cập nhật PDF bốn trang; đã xem lại SVG/PNG và trang A4 SQ2 cuối. SVG viewBox hiện tại lần lượt **849 × 1262**, **846 × 1041**, **803 × 1158**, **850 × 1150**; text/legend nhỏ nhất trong SVG là 18 px, tiêu đề 23 px. Quy đổi theo kích thước chèn trong bảng cho chữ nhỏ nhất **10,07 / 10,25 / 10,80 / 10,20 pt**. Mỗi hình giữ tỉ lệ, đỉnh cách mép giấy 18 mm, dải chú thích cao 8 mm cách đáy 18 mm; không thấy cắt chữ, đè nhãn/đường nối hoặc tràn dải chú thích. SQ2 kết thúc cách đáy khoảng 33,84 mm, còn khoảng 7,84 mm trước dải chú thích.

PDF xem trước bốn hình, script và screenshot QA nằm **ngoài repo**; không phải báo cáo cuối. Chưa ghép Word hoặc in giấy; cần giữ kích thước/lề đã QA, không dùng auto-fit làm chữ nhỏ hơn 10 pt. Chỉ thêm bốn nguồn PlantUML, tám SVG/PNG và cập nhật danh mục này; không sửa ứng dụng/DB/dependency, không chạy test/build/seed và không thao tác staging.
