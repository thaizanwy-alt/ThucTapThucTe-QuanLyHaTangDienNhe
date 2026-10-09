import { SystemCategory } from '../projects/system-category.enum';

// These are manual inspection criteria, not inferred from network trace/online state.
export const templateFixtures = [
  { code: 'ELV-LAN', name: 'Kiểm tra LAN', category: SystemCategory.LAN, revision: 1, items: [
    { code: 'LABEL', title: 'Nhãn thiết bị và điểm mạng khớp hồ sơ', instruction: 'Đối chiếu mã nhãn thực tế với danh mục và vị trí.', sortOrder: 0 },
    { code: 'CABLING', title: 'Đấu nối và cố định dây đúng hồ sơ', instruction: 'Kiểm tra trực tiếp dây, đầu nối và đường đấu nối.', sortOrder: 1 },
    { code: 'LINK', title: 'Kết nối mạng hoạt động qua kiểm tra thực tế', instruction: 'Ghi nhận phép thử kết nối tại phạm vi kiểm tra.', sortOrder: 2 },
  ] },
  { code: 'ELV-WIFI', name: 'Kiểm tra WiFi', category: SystemCategory.WIFI, revision: 1, items: [
    { code: 'INSTALL', title: 'AP được lắp và gắn nhãn đúng vị trí', instruction: 'Đối chiếu vị trí lắp và nhãn AP.', sortOrder: 0 },
    { code: 'SSID', title: 'SSID được phát đúng hồ sơ cấu hình', instruction: 'Kiểm tra bằng thiết bị khách; không ghi mật khẩu vào phiếu.', sortOrder: 1 },
    { code: 'ACCESS', title: 'Thiết bị khách kết nối và truy cập mạng được', instruction: 'Ghi nhận kết quả thử tại phạm vi kiểm tra.', sortOrder: 2 },
  ] },
  { code: 'ELV-CAMERA', name: 'Kiểm tra camera', category: SystemCategory.CAMERA, revision: 1, items: [
    { code: 'INSTALL', title: 'Camera được lắp chắc và gắn nhãn đúng vị trí', instruction: 'Kiểm tra trực tiếp vị trí, nhãn và gá lắp.', sortOrder: 0 },
    { code: 'IMAGE', title: 'Hình ảnh camera xem được qua thử thực tế', instruction: 'Kiểm tra hình ảnh; không suy ra từ hồ sơ IP hoặc trace.', sortOrder: 1 },
    { code: 'VIEW', title: 'Góc quan sát đáp ứng phạm vi đã thống nhất', instruction: 'Đối chiếu góc quan sát với yêu cầu công trình.', sortOrder: 2 },
  ] },
];
