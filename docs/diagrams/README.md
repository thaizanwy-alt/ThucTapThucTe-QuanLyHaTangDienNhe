# Sơ đồ kiến trúc, Use Case và ERD

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

Nên đưa KT1, KT2, UC1 vào thân báo cáo; UC2a, UC2b, UC3 vào phần phân tích chi tiết hoặc phụ lục. Nhóm ERD bổ sung có mốc đối chiếu riêng ở cuối tài liệu; chưa tạo state, activity, sequence hoặc DFD.

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
