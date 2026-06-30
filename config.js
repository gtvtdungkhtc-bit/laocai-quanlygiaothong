// ============================================================
//  CẤU HÌNH ỨNG DỤNG — QLGT-LAOCAI
// ============================================================

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAJpJGRNqUXqhbf0sz_Q-THIzk4yrnjfJk",
  authDomain:        "qlgt-laocai.firebaseapp.com",
  projectId:         "qlgt-laocai",
  storageBucket:     "qlgt-laocai.firebasestorage.app",
  messagingSenderId: "821362960702",
  appId:             "1:821362960702:web:75d3e1e3d3af6ac31b246f",
  measurementId:     "G-WMJF7RGT7S"
};

// Tâm bản đồ mặc định (Lào Cai)
const MAP_DEFAULT_CENTER = { lat: 22.3333, lng: 103.9667 };
const MAP_DEFAULT_ZOOM   = 11;

// ── Loại đường — màu sắc & độ dày ──────────────────────────
const LOAI_DUONG = {
  'Quốc lộ':       { color: '#c62828', weight: 8, dash: null,  kmlColor: 'ff2828c6' },
  'Đường tỉnh':    { color: '#e65100', weight: 6, dash: null,  kmlColor: 'ff0051e6' },
  'Đường xã':      { color: '#1565c0', weight: 5, dash: null,  kmlColor: 'ffc06515' },
  'Đường đô thị':  { color: '#6a1b9a', weight: 5, dash: null,  kmlColor: 'ff9a1b6a' },
  'Đường thôn':    { color: '#2e7d32', weight: 4, dash: '8,4', kmlColor: 'ff327d2e' },
  'Đường ngõ xóm': { color: '#5d4037', weight: 3, dash: '4,4', kmlColor: 'ff37405d' },
};

// ── Tài khoản Admin (được phép quản lý toàn tỉnh) ──────────
const ADMIN_EMAILS = [
  'gtvt.dungkhtc@gmail.com',
  // Thêm email admin khác vào đây nếu cần
];

// ── 99 Xã/Phường tỉnh Lào Cai (sau sáp nhập 2025) ──────────
const XA_LC = [
  'Phường Lào Cai','Phường Cam Đường','Xã Cốc San','Xã Hợp Thành',
  'Phường Sa Pa','Xã Mường Bo','Xã Tả Van','Xã Bản Hồ','Xã Tả Phìn','Xã Ngũ Chỉ Sơn',
  'Xã Bảo Thắng','Xã Phong Hải','Xã Xuân Quang','Xã Tằng Loỏng','Xã Gia Phú',
  'Xã Bảo Yên','Xã Nghĩa Đô','Xã Thượng Hà','Xã Xuân Hòa','Xã Phúc Khánh','Xã Bảo Hà',
  'Xã Văn Bàn','Xã Võ Lao','Xã Khánh Yên','Xã Dương Quỳ','Xã Chiềng Ken',
  'Xã Minh Lương','Xã Nậm Chày','Xã Nậm Xé',
  'Xã Bát Xát','Xã Mường Hum','Xã Dền Sáng','Xã Y Tý','Xã A Mú Sung','Xã Trịnh Tường','Xã Bản Xèo',
  'Xã Mường Khương','Xã Pha Long','Xã Bản Lầu','Xã Cao Sơn',
  'Xã Bắc Hà','Xã Cốc Lầu','Xã Bảo Nhai','Xã Bản Liền','Xã Tả Củ Tỷ','Xã Lùng Phình',
  'Xã Si Ma Cai','Xã Sín Chéng',
  'Xã Lục Yên','Xã Tân Lĩnh','Xã Lâm Thượng','Xã Khánh Hòa','Xã Phúc Lợi','Xã Mường Lai',
  'Xã Mù Cang Chải','Xã Púng Luông','Xã Khao Mang','Xã Tú Lệ','Xã Chế Tạo','Xã Lao Chải','Xã Nậm Có',
  'Phường Yên Bái','Phường Văn Phú','Phường Nam Cường','Phường Âu Lâu',
  'Phường Nghĩa Lộ','Phường Cầu Thia','Phường Trung Tâm',
  'Xã Liên Sơn','Xã Yên Bình','Xã Bảo Ái','Xã Thác Bà','Xã Yên Thành','Xã Cảm Nhân',
  'Xã Mậu A','Xã Lâm Giang','Xã Châu Quế','Xã Phong Dụ Hạ','Xã Đông Cuông','Xã Phong Dụ Thượng',
  'Xã Tân Hợp','Xã Xuân Ái','Xã Mỏ Vàng',
  'Xã Trấn Yên','Xã Hưng Khánh','Xã Quy Mông','Xã Việt Hồng','Xã Lương Thịnh',
  'Xã Văn Chấn','Xã Cát Thịnh','Xã Gia Hội','Xã Sơn Lương','Xã Thượng Bắc La',
  'Xã Chấn Thịnh','Xã Nghĩa Tâm','Xã Hạnh Phúc','Xã Tà Xi Láng','Xã Phình Hồ','Xã Trạm Tấu',
];
