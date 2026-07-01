// ============================================================
//  HTGTNT Lào Cai v2 — App Logic
//  Phân quyền: Admin (toàn tỉnh) / Xã (chỉ dữ liệu xã mình)
// ============================================================
'use strict';

const S = {
  user: null, isAdmin: false,
  profile: null,          // Firestore users/{uid}
  allUsers: [],           // admin: danh sách user profiles
  tuyen: [], doan: [],
  map: null, layers: {},
  editTuyenId: null, editDoanId: null,
  trackActive: false, watchId: null,
  trackCoords: [], trackLayer: null, currentMarker: null,
  formCoords: [],
  filterLoai: 'all', exportLoai: 'all', filterXa: 'all',
  trackPreset: null,
  formTab: 'tuyen',
};

let db, auth, tuyenCol, doanCol, usersCol;
let secondaryApp = null; // for creating users without signing out

// ============================================================
//  BOOTSTRAP
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  XA_LC.forEach(xa => {
    ['ft-xa','cu-xa'].forEach(id => {
      const el = qs(`#${id}`); if (el) el.appendChild(new Option(xa, xa));
    });
  });
  buildLegend();
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db   = firebase.firestore();
    auth = firebase.auth();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    auth.onAuthStateChanged(handleAuthChange);
  } catch(e) { showToast('⚠️ Firebase: ' + e.message); }
  bindEvents();
  window.addEventListener('online',  updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
});

function buildLegend() {
  const leg = qs('#map-legend'); if (!leg) return;
  leg.innerHTML = '<h4>CHÚ GIẢI</h4>';
  Object.entries(LOAI_DUONG).forEach(([name, s]) => {
    const d = document.createElement('div'); d.className = 'legend-item';
    d.innerHTML = `<div class="legend-line" style="background:${s.dash?'none':s.color};height:${s.weight}px;${s.dash?`border-top:${s.weight}px dashed ${s.color}`:''}"></div><span class="legend-label">${name}</span>`;
    leg.appendChild(d);
  });
}

// ============================================================
//  AUTH & USER PROFILE
// ============================================================
async function handleAuthChange(user) {
  S.user = user;
  if (!user) { showLogin(); return; }

  usersCol = db.collection('users');
  tuyenCol = db.collection('tuyenDuong');
  doanCol  = db.collection('doanTuyen');

  // Xác định admin ngay từ config — không phụ thuộc Firestore
  S.isAdmin = ADMIN_EMAILS.includes(user.email);

  // Tải profile — nếu Firestore chưa cấp quyền vẫn vào được app
  try {
    S.profile = await ensureUserProfile();
    if (S.profile?.role === 'admin') S.isAdmin = true;
  } catch(e) {
    console.warn('Không tải được profile:', e.message);
    S.profile = {
      email: user.email,
      displayName: user.email.split('@')[0],
      role: S.isAdmin ? 'admin' : 'user',
      xa: '',
    };
  }

  showApp();
  subscribeData();
  if (S.isAdmin) subscribeAllUsers();
}

async function ensureUserProfile() {
  const ref  = usersCol.doc(S.user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    const isAdm = ADMIN_EMAILS.includes(S.user.email);
    const profile = {
      email: S.user.email,
      displayName: S.user.email.split('@')[0],
      role: isAdm ? 'admin' : 'user',
      xa: '',
      createdAt: ts(),
    };
    await ref.set(profile);
    return profile;
  }
  return snap.data();
}

async function login() {
  const email = qs('#inp-user').value.trim();
  const pass  = qs('#inp-pass').value;
  if (!email || !pass) return;
  const btn = qs('#btn-login');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  qs('#login-error').textContent = '';
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch(e) {
    let msg = 'Lỗi: ' + e.code;
    if (['auth/user-not-found','auth/wrong-password','auth/invalid-credential'].includes(e.code))
      msg = 'Email hoặc mật khẩu không đúng';
    else if (e.code === 'auth/too-many-requests')
      msg = 'Quá nhiều lần thử. Vui lòng thử lại sau.';
    qs('#login-error').textContent = msg;
  } finally { btn.disabled = false; btn.innerHTML = '🔐 Đăng nhập'; }
}

async function logout() {
  if (!confirm('Đăng xuất?')) return;
  stopTracking(); await auth.signOut();
}

function showLogin() {
  qs('#screen-login').hidden = false; qs('#screen-app').hidden = true;
}

function showApp() {
  qs('#screen-login').hidden = true; qs('#screen-app').hidden = false;
  // Hiển thị thông tin user
  const name = S.profile?.displayName || S.user.email.split('@')[0];
  const xa   = S.profile?.xa ? ` — ${S.profile.xa}` : '';
  qs('#topbar-user').textContent = name;
  qs('#topbar-xa').textContent   = S.isAdmin ? '👑 Quản trị viên' : (S.profile?.xa || '');

  // Hiện tab admin & filter xã chỉ cho admin
  if (S.isAdmin) {
    qs('#nav-admin').style.display     = 'flex';
    qs('#map-user-filter').style.display = 'block';
    qs('#map-user-filter').classList.add('show');
  }

  initMap();
  switchTab('map');
}

// ============================================================
//  FIREBASE — Subscribe data
// ============================================================
function subscribeData() {
  // Admin thấy tất cả, user chỉ thấy của mình
  const tq = S.isAdmin ? tuyenCol.orderBy('createdAt','desc')
    : tuyenCol.where('uid','==',S.user.uid).orderBy('createdAt','desc');
  const dq = S.isAdmin ? doanCol.orderBy('stt','asc')
    : doanCol.where('uid','==',S.user.uid).orderBy('stt','asc');

  tq.onSnapshot(snap => {
    S.tuyen = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRouteList(); fillTuyenSelects();
    updateAdminStats();
  }, e => showToast('Lỗi đọc tuyến: ' + e.message));

  dq.onSnapshot(snap => {
    S.doan = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMapLayers(); renderRouteList();
    updateAdminStats();
  }, e => showToast('Lỗi đọc đoạn: ' + e.message));
}

function subscribeAllUsers() {
  usersCol.orderBy('createdAt','asc').onSnapshot(snap => {
    S.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUserList();
    updateAdminStats();
    updateXaFilterOptions();
  });
}

async function saveTuyen(data) {
  if (S.editTuyenId) {
    await tuyenCol.doc(S.editTuyenId).update({ ...data, updatedAt: ts() });
    showToast('✅ Đã cập nhật tuyến đường');
  } else {
    await tuyenCol.add({ ...data, uid: S.user.uid, createdAt: ts() });
    showToast('✅ Đã lưu tuyến đường');
  }
}

async function saveDoan(data) {
  if (S.editDoanId) {
    await doanCol.doc(S.editDoanId).update({ ...data, updatedAt: ts() });
    showToast('✅ Đã cập nhật đoạn tuyến');
  } else {
    await doanCol.add({ ...data, uid: S.user.uid, createdAt: ts() });
    showToast('✅ Đã lưu đoạn tuyến');
  }
}

async function deleteTuyen(id) {
  const batch = db.batch();
  batch.delete(tuyenCol.doc(id));
  S.doan.filter(d => d.tuyenId === id).forEach(d => batch.delete(doanCol.doc(d.id)));
  await batch.commit(); showToast('🗑️ Đã xoá tuyến và các đoạn');
}

async function deleteDoan(id) {
  await doanCol.doc(id).delete(); showToast('🗑️ Đã xoá đoạn tuyến');
}

const ts = () => firebase.firestore.FieldValue.serverTimestamp();

// ============================================================
//  ADMIN — Quản lý tài khoản
// ============================================================
async function createXaUser() {
  if (!S.isAdmin) return;
  const email = qs('#cu-email').value.trim();
  const pass  = qs('#cu-pass').value.trim();
  const name  = qs('#cu-name').value.trim();
  const xa    = qs('#cu-xa').value;
  const res   = qs('#create-result');

  if (!email || !pass) { showToast('Vui lòng nhập Email và Mật khẩu'); return; }
  if (pass.length < 6) { showToast('Mật khẩu tối thiểu 6 ký tự'); return; }

  const btn = qs('#btn-create-user');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang tạo…';
  res.className = 'create-result'; res.style.display = 'none';

  try {
    // Tạo Firebase Auth user dùng secondary app (không sign out admin)
    if (!secondaryApp) {
      secondaryApp = firebase.initializeApp(FIREBASE_CONFIG, 'secondary');
    }
    const secAuth = firebase.app('secondary').auth();
    const cred = await secAuth.createUserWithEmailAndPassword(email, pass);
    const uid  = cred.user.uid;

    // Lưu profile vào Firestore
    await usersCol.doc(uid).set({
      email, displayName: name || email.split('@')[0],
      role: 'user', xa: qs('#cu-xa').value,
      createdBy: S.user.uid,
      createdAt: ts(),
    });

    await secAuth.signOut();

    // Hiển thị kết quả
    res.className = 'create-result ok';
    const xaVal = qs('#cu-xa').value;
    res.innerHTML = `✅ Đã tạo tài khoản thành công!<br>
      <b>Email:</b> ${email}<br>
      <b>Mật khẩu:</b> ${pass}<br>
      <b>Đơn vị:</b> ${xaVal||'—'}<br>
      <small>⚠️ Lưu lại thông tin và gửi cho người dùng</small>`;

    // Reset form
    ['cu-email','cu-pass','cu-name'].forEach(id => qs('#'+id).value='');
    qs('#cu-xa').value = '';
    showToast('✅ Tạo tài khoản thành công: ' + email);

  } catch(e) {
    let msg = e.message;
    if (e.code === 'auth/email-already-in-use') msg = 'Email này đã được dùng';
    if (e.code === 'auth/invalid-email') msg = 'Email không hợp lệ';
    res.className = 'create-result err';
    res.textContent = '❌ Lỗi: ' + msg;
  } finally {
    btn.disabled = false; btn.innerHTML = '👤 Tạo tài khoản';
  }
}

window.genPassword = function() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#';
  let pw = '';
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  qs('#cu-pass').value = pw;
};

function renderUserList() {
  const ul  = qs('#user-list'); if (!ul) return;
  const users = S.allUsers.filter(u => u.role !== 'admin');
  qs('#user-list-count').textContent = users.length;

  if (!users.length) {
    ul.innerHTML = '<div style="text-align:center;padding:20px;color:#90a4ae;font-size:13px;">Chưa có tài khoản xã nào</div>';
    return;
  }

  ul.innerHTML = users.map(u => {
    const nT = S.tuyen.filter(t => t.uid === u.id).length;
    const nD = S.doan.filter(d => d.uid === u.id).length;
    const nG = S.doan.filter(d => d.uid === u.id && d.coords?.length >= 2).length;
    const init = (u.displayName||u.email||'?')[0].toUpperCase();
    return `
      <div class="user-card">
        <div class="user-card-header">
          <div class="user-avatar">${init}</div>
          <div class="user-info">
            <div class="user-name">${u.displayName||'—'} <span class="badge-user">Xã</span></div>
            <div class="user-email">${u.email}</div>
          </div>
        </div>
        <div class="user-meta">
          ${u.xa  ? `<span>📍 ${u.xa}</span>` : ''}
        </div>
        <div class="user-stats">
          <span class="user-stat">🛣️ ${nT} tuyến</span>
          <span class="user-stat">📏 ${nD} đoạn</span>
          <span class="user-stat">🛰️ ${nG} có GPS</span>
        </div>
      </div>`;
  }).join('');
}

function updateAdminStats() {
  if (!S.isAdmin) return;
  const users = S.allUsers.filter(u => u.role !== 'admin');
  const nGps  = S.doan.filter(d => d.coords?.length >= 2).length;
  const set = (id, v) => { const el=qs('#'+id); if(el) el.textContent=v; };
  set('stat-users', users.length);
  set('stat-tuyen', S.tuyen.length);
  set('stat-doan',  S.doan.length);
  set('stat-gps',   nGps);
}

function updateXaFilterOptions() {
  const sel = qs('#filter-xa-select'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="all">🗺️ Toàn tỉnh (tất cả xã)</option>';
  S.allUsers.filter(u => u.role !== 'admin').forEach(u => {
    if (u.xa) sel.appendChild(new Option(`📍 ${u.xa}`, u.id));
  });
  sel.value = cur;
}

window.filterByXa = function(uid) {
  S.filterXa = uid;
  renderMapLayers();
};

// ============================================================
//  LEAFLET MAP
// ============================================================
function initMap() {
  if (S.map) return;
  S.map = L.map('map', { center: [MAP_DEFAULT_CENTER.lat, MAP_DEFAULT_CENTER.lng], zoom: MAP_DEFAULT_ZOOM });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap', maxZoom:19 }).addTo(S.map);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution:'Esri', maxZoom:19 });
  L.control.layers({ '🗺️ Bản đồ': osm, '🛰️ Vệ tinh': sat }, {}).addTo(S.map);
  renderMapLayers();
}

function tuyenStyle(loaiDuong) {
  return LOAI_DUONG[loaiDuong] || { color:'#9e9e9e', weight:4, dash:null };
}

function renderMapLayers() {
  if (!S.map) return;
  Object.values(S.layers).forEach(l => S.map.removeLayer(l)); S.layers = {};

  let doans = S.doan.filter(d => d.coords?.length >= 2);
  if (S.isAdmin && S.filterXa !== 'all') {
    doans = doans.filter(d => d.uid === S.filterXa);
  }

  doans.forEach(doan => {
    const tuyen = S.tuyen.find(t => t.id === doan.tuyenId);
    const style = tuyenStyle(tuyen?.loaiDuong);
    const pl = L.polyline(doan.coords.map(c => [c.lat, c.lng]), {
      color: style.color, weight: style.weight, dashArray: style.dash, opacity: 0.9,
    }).addTo(S.map);
    pl.bindPopup(() => buildDoanPopup(doan, tuyen), { maxWidth: 300 });
    S.layers[doan.id] = pl;
  });
}

function buildDoanPopup(doan, tuyen) {
  const s   = tuyenStyle(tuyen?.loaiDuong);
  const owner = S.allUsers.find(u => u.id === doan.uid);
  const ownerInfo = owner ? `<br><span style="color:#2e7d32;font-size:11px">📍 ${owner.xa||''}</span>` : '';
  return `
    <div style="font-size:12px;line-height:1.7;">
      <b style="font-size:13px;color:${s.color}">${tuyen?.ten||'—'}</b>
      ${ownerInfo}<br>
      <span style="color:#546e7a">${doan.ten||'Đoạn '+(doan.stt||'?')}</span>&nbsp;
      <span style="color:#546e7a">Km${doan.ltTu||0}→${doan.ltDen||0}</span><br>
      ${matBadge(doan.loaiMat)} ${ttBadge(doan.mucDo)}<br>
      🛣️ Nền <b>${doan.rNen||'—'}m</b> · Mặt <b>${doan.rMat||'—'}m</b> · Lề <b>${doan.rLe||'—'}m</b>
      ${doan.loaiHH?`<br>⚠️ ${doan.loaiHH}${doan.dienTich?` (${doan.dienTich}m²)`:''}` : ''}
      ${doan.trungVoi?`<br>🔀 Trùng: <i>${doan.trungVoi}</i>` : ''}
      <div style="display:flex;gap:6px;margin-top:7px;">
        <button class="btn-sm edit" onclick="openEditDoan('${doan.id}')">✏️ Sửa</button>
        <button class="btn-sm del"  onclick="confirmDeleteDoan('${doan.id}')">🗑️ Xoá</button>
      </div>
    </div>`;
}

function flyToDoan(id) {
  const pl = S.layers[id];
  if (!pl) { showToast('Đoạn này chưa có toạ độ GPS'); return; }
  switchTab('map');
  S.map.fitBounds(pl.getBounds(), { padding: [40,40] });
  setTimeout(() => pl.openPopup(), 400);
}

function flyToTuyen(id) {
  const ds = S.doan.filter(d => d.tuyenId === id && S.layers[d.id]);
  if (!ds.length) { showToast('Tuyến này chưa có toạ độ GPS'); return; }
  switchTab('map');
  const g = L.featureGroup(ds.map(d => S.layers[d.id]));
  S.map.fitBounds(g.getBounds(), { padding: [30,30] });
}

// ============================================================
//  ROUTE LIST
// ============================================================
function renderRouteList() {
  const q     = (qs('#search-input')?.value || '').toLowerCase();
  const fLoai = S.filterLoai;

  let routes = S.tuyen.filter(t => {
    const mq    = !q || (t.ten||'').toLowerCase().includes(q) || (t.ma||'').toLowerCase().includes(q) || (t.xa||'').toLowerCase().includes(q);
    const mLoai = fLoai==='all' || t.loaiDuong===fLoai;
    return mq && mLoai;
  });

  qs('#road-count').textContent = routes.length;
  const ul = qs('#route-list'); ul.innerHTML = '';
  if (!routes.length) { ul.innerHTML = '<div class="list-empty">Chưa có tuyến đường nào.<br>Nhấn ＋ để thêm mới.</div>'; return; }

  routes.forEach(tuyen => {
    const style = tuyenStyle(tuyen.loaiDuong);
    const doans = S.doan.filter(d => d.tuyenId===tuyen.id).sort((a,b) => (a.stt||0)-(b.stt||0));
    const nGps  = doans.filter(d => d.coords?.length >= 2).length;
    const owner = S.isAdmin ? S.allUsers.find(u => u.id === tuyen.uid) : null;
    const card  = document.createElement('div');
    card.className = 'route-card'; card.id = 'rc-'+tuyen.id;
    card.innerHTML = `
      <div class="route-header" onclick="toggleRoute('${tuyen.id}')">
        <div class="route-color-bar" style="background:${style.color}"></div>
        <div class="route-info">
          <div class="route-name">${tuyen.ten||'Chưa đặt tên'}</div>
          <div class="route-meta">
            ${loaiBadge(tuyen.loaiDuong)}
            ${tuyen.ma?`<span>🔖 ${tuyen.ma}</span>`:''}
            ${tuyen.xa?`<span>📍 ${tuyen.xa}</span>`:''}
            <span>📏 ${doans.length} đoạn${nGps?` · 🛰️ ${nGps} GPS`:''}
            ${owner?`<span style="color:#e65100;font-size:10px"> · ${owner.xa||owner.email}</span>`:''}
          </div>
        </div>
        <span class="route-expand-icon">▾</span>
      </div>
      <div class="route-actions">
        <button class="btn-sm map"  onclick="flyToTuyen('${tuyen.id}')">🗺️ Bản đồ</button>
        <button class="btn-sm edit" onclick="openEditTuyen('${tuyen.id}')">✏️ Sửa</button>
        <button class="btn-sm del"  onclick="confirmDeleteTuyen('${tuyen.id}')">🗑️ Xoá</button>
      </div>
      <div class="route-segments" id="segs-${tuyen.id}" style="display:none;">
        ${doans.map(d => segHTML(d, style.color)).join('')}
        <button class="add-seg-btn" onclick="openNewDoanForTuyen('${tuyen.id}')">＋ Thêm đoạn tuyến</button>
      </div>`;
    ul.appendChild(card);
  });
}

function segHTML(d, color) {
  const hasGps = d.coords?.length >= 2;
  return `
    <div class="seg-item">
      <div class="seg-num" style="background:${color}22;color:${color}">${d.stt||'?'}</div>
      <div class="seg-info">
        <div class="seg-name">${d.ten||'Đoạn '+(d.stt||'')}</div>
        <div class="seg-meta">
          <span>Km${d.ltTu||0}→${d.ltDen||0}</span>
          ${matBadge(d.loaiMat)} ${ttBadge(d.mucDo)}
          ${d.rMat?`<span>Mặt ${d.rMat}m</span>`:''}
          ${hasGps?`<span style="color:#2e7d32">🛰️GPS</span>`:`<span style="color:#ef9a9a">⚠️Chưa GPS</span>`}
          ${d.trungVoi?`<span style="color:#e65100">🔀${d.trungVoi}</span>`:''}
        </div>
      </div>
      <div class="seg-actions">
        ${hasGps?`<button class="btn-sm map" onclick="flyToDoan('${d.id}')">🗺️</button>`:''}
        <button class="btn-sm edit" onclick="openEditDoan('${d.id}')">✏️</button>
        <button class="btn-sm del"  onclick="confirmDeleteDoan('${d.id}')">🗑️</button>
      </div>
    </div>`;
}

function toggleRoute(id) {
  const segs = qs('#segs-'+id); if (!segs) return;
  const open = segs.style.display !== 'none';
  segs.style.display = open ? 'none' : 'block';
  qs('#rc-'+id)?.classList.toggle('expanded', !open);
}

// ============================================================
//  FORM — Tuyến đường
// ============================================================
function openNewTuyen() {
  S.editTuyenId = null; resetTuyenForm();
  qs('#form-tuyen-title').textContent = 'Thêm tuyến đường mới';
  // Auto-fill xã/huyện từ profile (user thường)
  if (!S.isAdmin && S.profile) {
    qs('#ft-xa').value = S.profile.xa || '';
  }
  switchFormTab('tuyen'); switchTab('form');
}

function openEditTuyen(id) {
  const t = S.tuyen.find(r => r.id===id); if (!t) return;
  S.editTuyenId = id;
  qs('#form-tuyen-title').textContent = 'Chỉnh sửa tuyến đường';
  qs('#ft-ten').value  = t.ten||'';   qs('#ft-ma').value   = t.ma||'';
  qs('#ft-nam').value  = t.nam||'';   qs('#ft-loai').value = t.loaiDuong||'';
  qs('#ft-xa').value   = t.xa||'';
  qs('#ft-dai').value    = t.chieuDai||''; qs('#ft-ghichu').value = t.ghiChu||'';
  updateLoaiPreview(); switchFormTab('tuyen'); switchTab('form');
}

function resetTuyenForm() {
  ['ft-ten','ft-ma','ft-nam','ft-xa','ft-dai','ft-ghichu'].forEach(id => { const el=qs('#'+id); if(el) el.value=''; });
  qs('#ft-loai').value=''; qs('#ft-xa').value=''; qs('#loai-preview').style.display='none';
}

async function submitTuyen() {
  const ten = qs('#ft-ten').value.trim(); if (!ten) { showToast('Vui lòng nhập tên tuyến đường'); return; }
  const loai = qs('#ft-loai').value;       if (!loai) { showToast('Vui lòng chọn loại đường'); return; }
  const data = { ten, loaiDuong:loai, ma:qs('#ft-ma').value.trim(), nam:parseInt(qs('#ft-nam').value)||null,
    xa:qs('#ft-xa').value,
    chieuDai:parseFloat(qs('#ft-dai').value)||null, ghiChu:qs('#ft-ghichu').value.trim() };
  const btn = qs('#btn-save-tuyen'); btn.disabled=true; btn.textContent='Đang lưu…';
  try { await saveTuyen(data); S.editTuyenId=null; resetTuyenForm(); switchTab('list'); }
  catch(e) { showToast('Lỗi: '+e.message); }
  finally { btn.disabled=false; btn.textContent='💾 Lưu tuyến đường'; }
}

window.updateLoaiPreview = function() {
  const loai=qs('#ft-loai').value, prev=qs('#loai-preview'); if (!loai) { prev.style.display='none'; return; }
  const s=LOAI_DUONG[loai]; if (!s) return;
  prev.style.display='flex';
  qs('#loai-preview-line').style.cssText=`background:${s.dash?'none':s.color};border-top:${s.weight}px ${s.dash?'dashed':'solid'} ${s.color};width:60px;`;
  qs('#loai-preview-label').style.color=s.color; qs('#loai-preview-label').textContent=loai;
};

// ============================================================
//  FORM — Đoạn tuyến
// ============================================================
function fillTuyenSelects() {
  ['fd-tuyen','fd-trung'].forEach(id => {
    const el=qs('#'+id); if (!el) return;
    const val=el.value;
    el.innerHTML = id==='fd-tuyen' ? '<option value="">-- Chọn tuyến đường --</option>' : '<option value="">Không trùng tuyến</option>';
    S.tuyen.forEach(t => el.appendChild(new Option(`${t.ten}${t.loaiDuong?' ('+t.loaiDuong+')':''}`, t.id)));
    el.value=val;
  });
}

function openNewDoan() {
  S.editDoanId=null; S.formCoords=[];
  resetDoanForm(); qs('#form-doan-title').textContent='Thêm đoạn tuyến mới';
  updateDoanCoordsBox(); switchFormTab('doan'); switchTab('form');
}

function openNewDoanForTuyen(tuyenId) {
  openNewDoan(); qs('#fd-tuyen').value=tuyenId;
  qs('#fd-stt').value = S.doan.filter(d => d.tuyenId===tuyenId).length + 1;
}

function openEditDoan(id) {
  const d=S.doan.find(x => x.id===id); if (!d) return;
  S.editDoanId=id; S.formCoords=d.coords?[...d.coords]:[];
  qs('#form-doan-title').textContent='Chỉnh sửa đoạn tuyến';
  qs('#fd-tuyen').value=d.tuyenId||'';   qs('#fd-ten').value=d.ten||'';
  qs('#fd-stt').value=d.stt||'';         qs('#fd-lttu').value=d.ltTu||'';
  qs('#fd-ltden').value=d.ltDen||'';     qs('#fd-rnen').value=d.rNen||'';
  qs('#fd-rmat').value=d.rMat||'';       qs('#fd-rle').value=d.rLe||'';
  qs('#fd-mat').value=d.loaiMat||'BTXM'; qs('#fd-nam').value=d.namXD||'';
  qs('#fd-mucdo').value=d.mucDo||'Tốt';  qs('#fd-dientich').value=d.dienTich||'';
  qs('#fd-loaihh').value=d.loaiHH||'';   qs('#fd-trung').value=d.trungVoi||'';
  qs('#fd-ghichu').value=d.ghiChu||'';
  updateDoanCoordsBox(); switchFormTab('doan'); switchTab('form');
}

function resetDoanForm() {
  ['fd-ten','fd-stt','fd-lttu','fd-ltden','fd-rnen','fd-rmat','fd-rle','fd-nam','fd-dientich','fd-loaihh','fd-ghichu']
    .forEach(id => { const el=qs('#'+id); if(el) el.value=''; });
  qs('#fd-mat').value='BTXM'; qs('#fd-mucdo').value='Tốt';
  qs('#fd-tuyen').value=''; qs('#fd-trung').value='';
}

async function submitDoan() {
  const tuyenId=qs('#fd-tuyen').value; if (!tuyenId) { showToast('Vui lòng chọn tuyến đường'); return; }
  let trungVoi = qs('#fd-trung').value;
  if (trungVoi) { const tr=S.tuyen.find(t => t.id===trungVoi); trungVoi=tr?.ten||trungVoi; }
  const data = {
    tuyenId, ten:qs('#fd-ten').value.trim(), stt:parseInt(qs('#fd-stt').value)||1,
    ltTu:parseFloat(qs('#fd-lttu').value)||0, ltDen:parseFloat(qs('#fd-ltden').value)||0,
    rNen:parseFloat(qs('#fd-rnen').value)||null, rMat:parseFloat(qs('#fd-rmat').value)||null, rLe:parseFloat(qs('#fd-rle').value)||null,
    loaiMat:qs('#fd-mat').value||'BTXM', namXD:parseInt(qs('#fd-nam').value)||null,
    mucDo:qs('#fd-mucdo').value||'Tốt', dienTich:parseFloat(qs('#fd-dientich').value)||null,
    loaiHH:qs('#fd-loaihh').value.trim(), trungVoi, ghiChu:qs('#fd-ghichu').value.trim(),
    coords:S.formCoords.length>=2?S.formCoords:null,
  };
  const btn=qs('#btn-save-doan'); btn.disabled=true; btn.textContent='Đang lưu…';
  try { await saveDoan(data); S.editDoanId=null; S.formCoords=[]; resetDoanForm(); switchTab('list'); }
  catch(e) { showToast('Lỗi: '+e.message); }
  finally { btn.disabled=false; btn.textContent='💾 Lưu đoạn tuyến'; }
}

// ============================================================
//  DELETE
// ============================================================
function confirmDeleteTuyen(id) {
  const t=S.tuyen.find(r => r.id===id), n=S.doan.filter(d => d.tuyenId===id).length;
  qs('#modal-msg').textContent=`Xoá tuyến "${t?.ten||'?'}" và ${n} đoạn liên quan?`;
  qs('#modal-overlay').hidden=false;
  qs('#modal-btn-ok').onclick=async()=>{ qs('#modal-overlay').hidden=true; await deleteTuyen(id); };
}
function confirmDeleteDoan(id) {
  const d=S.doan.find(x => x.id===id);
  qs('#modal-msg').textContent=`Xoá đoạn "${d?.ten||'Đoạn '+(d?.stt||'?')}"?`;
  qs('#modal-overlay').hidden=false;
  qs('#modal-btn-ok').onclick=async()=>{ qs('#modal-overlay').hidden=true; await deleteDoan(id); };
}

// ============================================================
//  GPS
// ============================================================
function openTrackSetup() {
  if (!navigator.geolocation) { showToast('Thiết bị không hỗ trợ GPS'); return; }
  // Điền danh sách tuyến vào modal
  const sel = qs('#ts-tuyen');
  sel.innerHTML = '<option value="">-- Chọn tuyến đường --</option>';
  S.tuyen.forEach(t => sel.appendChild(new Option(`${t.ten}${t.loaiDuong?' ('+t.loaiDuong+')':''}`, t.id)));
  // Gợi ý số thứ tự tiếp theo nếu đã chọn tuyến
  sel.onchange = () => {
    if (!sel.value) return;
    const n = S.doan.filter(d => d.tuyenId===sel.value).length;
    qs('#ts-stt').value = n + 1;
  };
  qs('#ts-ten').value = ''; qs('#ts-lttu').value = ''; qs('#ts-stt').value = '';
  qs('#track-setup-modal').hidden = false;
}

function startTracking() {
  const tuyenId = qs('#ts-tuyen').value;
  if (!tuyenId) { showToast('Vui lòng chọn tuyến đường trước'); return; }
  // Lưu thông tin đoạn để tự điền sau khi dừng
  S.trackPreset = {
    tuyenId,
    stt:  qs('#ts-stt').value,
    ltTu: qs('#ts-lttu').value,
    ten:  qs('#ts-ten').value.trim(),
  };
  qs('#track-setup-modal').hidden = true;

  S.trackActive=true; S.trackCoords=[];
  if (S.trackLayer) S.map.removeLayer(S.trackLayer);
  const tuyen = S.tuyen.find(t => t.id===tuyenId);
  const style = tuyenStyle(tuyen?.loaiDuong);
  S.trackLayer = L.polyline([],{color: style.color, weight: style.weight+1, dashArray:'8,4', opacity:0.9}).addTo(S.map);
  S.watchId = navigator.geolocation.watchPosition(onGpsUpdate, e=>showToast('GPS: '+e.message), {enableHighAccuracy:true,maximumAge:0});
  qs('#btn-start-track').disabled=true; qs('#btn-stop-track').disabled=false; qs('#btn-add-pt').disabled=false;
  const tenTuyen = tuyen?.ten || 'tuyến đã chọn';
  updateGpsStatus(`🔴 Đang ghi — ${tenTuyen}`);
  showToast(`▶ Bắt đầu ghi vết: ${tenTuyen}`);
}

function stopTracking() {
  if (S.watchId!=null) { navigator.geolocation.clearWatch(S.watchId); S.watchId=null; }
  S.trackActive=false;
  qs('#btn-start-track').disabled=false; qs('#btn-stop-track').disabled=true; qs('#btn-add-pt').disabled=true;

  if (S.trackCoords.length < 2) {
    updateGpsStatus('Dừng. Chưa đủ điểm GPS.');
    showToast('⚠️ Chưa đủ điểm GPS để lưu');
    return;
  }

  // Tính chiều dài đo được
  let dist = 0;
  for (let i=1; i<S.trackCoords.length; i++) dist += haversine(S.trackCoords[i-1], S.trackCoords[i]);
  const km = (dist/1000).toFixed(3);

  // Điền sẵn form với thông tin đã chọn trước
  S.formCoords = [...S.trackCoords];
  S.editDoanId = null;
  resetDoanForm();
  if (S.trackPreset) {
    qs('#fd-tuyen').value = S.trackPreset.tuyenId || '';
    qs('#fd-stt').value   = S.trackPreset.stt || '';
    qs('#fd-lttu').value  = S.trackPreset.ltTu || '';
    qs('#fd-ten').value   = S.trackPreset.ten || '';
    // Gợi ý lý trình đến = từ + chiều dài
    const ltTu = parseFloat(S.trackPreset.ltTu) || 0;
    qs('#fd-ltden').value = (ltTu + parseFloat(km)).toFixed(3);
  }
  switchFormTab('doan'); switchTab('form'); updateDoanCoordsBox();
  showToast(`✅ Ghi được ${S.trackCoords.length} điểm · ${km} km — điền nốt thông số và lưu`);
  updateGpsStatus('Hoàn tất. Đã chuyển sang form điền thông tin.');
}

function onGpsUpdate(pos) {
  const ll={lat:pos.coords.latitude,lng:pos.coords.longitude};
  S.trackCoords.push(ll); S.trackLayer.addLatLng([ll.lat,ll.lng]); S.map.panTo([ll.lat,ll.lng]);
  if (!S.currentMarker) S.currentMarker=L.circleMarker([ll.lat,ll.lng],{radius:8,color:'#f44336',fillColor:'#f44336',fillOpacity:1}).addTo(S.map);
  else S.currentMarker.setLatLng([ll.lat,ll.lng]);
  updateGpsStatus(`🔴 Đang ghi — ${S.trackCoords.length} điểm | ±${Math.round(pos.coords.accuracy)}m`);
}

function addManualPoint() {
  navigator.geolocation.getCurrentPosition(pos => {
    const ll={lat:pos.coords.latitude,lng:pos.coords.longitude};
    S.trackCoords.push(ll); if (S.trackLayer) S.trackLayer.addLatLng([ll.lat,ll.lng]);
    showToast(`📍 ${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`);
  }, e=>showToast('GPS: '+e.message), {enableHighAccuracy:true});
}

function locateMe() {
  navigator.geolocation.getCurrentPosition(pos => {
    S.map.setView([pos.coords.latitude,pos.coords.longitude],16);
  }, e=>showToast('GPS: '+e.message), {enableHighAccuracy:true});
}

window.gpsForForm = function() {
  navigator.geolocation.getCurrentPosition(pos => {
    const ll={lat:pos.coords.latitude,lng:pos.coords.longitude};
    S.formCoords.push(ll); showToast(`📍 ${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`); updateDoanCoordsBox();
  }, e=>showToast('GPS: '+e.message), {enableHighAccuracy:true});
};

window.clearDoanCoords = function() { S.formCoords=[]; updateDoanCoordsBox(); };

function updateDoanCoordsBox() {
  const box=qs('#fd-coords-box'), n=S.formCoords.length;
  if (!n) { box.textContent='Chưa có toạ độ. Dùng GPS bên dưới hoặc vào tab Bản đồ → Ghi vết.'; return; }
  let dist=0;
  for (let i=1;i<n;i++) dist+=haversine(S.formCoords[i-1],S.formCoords[i]);
  box.innerHTML=`<strong>${n} điểm GPS</strong> — Chiều dài ≈ <strong>${(dist/1000).toFixed(3)} km</strong><br>
    Đầu: ${S.formCoords[0].lat.toFixed(6)}, ${S.formCoords[0].lng.toFixed(6)}<br>
    Cuối: ${S.formCoords[n-1].lat.toFixed(6)}, ${S.formCoords[n-1].lng.toFixed(6)}`;
}

function haversine(a,b) {
  const R=6371000,dLat=(b.lat-a.lat)*Math.PI/180,dLng=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function updateGpsStatus(msg) {
  qs('#gps-status').textContent=msg||(S.trackActive?`🔴 Đang ghi — ${S.trackCoords.length} điểm`:'Nhấn "Ghi vết" để bắt đầu ghi đường');
}

// ============================================================
//  KMZ EXPORT
// ============================================================
async function exportKmz() {
  const btn=qs('#btn-export'),log=qs('#export-log');
  let doans=S.doan.filter(d => d.coords?.length>=2);
  if (S.exportLoai!=='all') {
    const ids=S.tuyen.filter(t => t.loaiDuong===S.exportLoai).map(t => t.id);
    doans=doans.filter(d => ids.includes(d.tuyenId));
  }
  if (!doans.length) { showToast('Không có đoạn nào có GPS để xuất'); return; }
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span> Đang tạo KMZ…';
  log.textContent=`Chuẩn bị xuất ${doans.length} đoạn…\n`;
  try {
    const kml=buildKml(doans);
    log.textContent+=`KML: ${(kml.length/1024).toFixed(1)} KB\n`;
    const zip=new JSZip(); zip.file('doc.kml',kml);
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=`HTGTNT_LaoCai_${dateStr()}.kmz`; a.click();
    URL.revokeObjectURL(url);
    log.textContent+=`✅ Xuất ${doans.length} đoạn thành công!`;
    showToast(`✅ Đã tải file KMZ (${doans.length} đoạn)`);
  } catch(e) { log.textContent+='❌ Lỗi: '+e.message; }
  finally { btn.disabled=false; btn.innerHTML='📤 Xuất file KMZ'; }
}

function buildKml(doans) {
  const folders={};
  doans.forEach(doan => {
    const tuyen=S.tuyen.find(t => t.id===doan.tuyenId);
    const loai=tuyen?.loaiDuong||'Khác';
    if (!folders[loai]) folders[loai]=[];
    folders[loai].push({doan,tuyen});
  });

  const folderKml=Object.entries(folders).map(([loai,items]) => {
    const s=LOAI_DUONG[loai]||{kmlColor:'ff9e9e9e',weight:4};
    const pms=items.map(({doan,tuyen}) => {
      const owner=S.allUsers.find(u => u.id===doan.uid);
      const pts=doan.coords.map(c => `${c.lng},${c.lat},0`).join('\n');
      return `<Placemark>
        <name>${esc(tuyen?.ten||'—')} — ${esc(doan.ten||'Đoạn '+doan.stt)}</name>
        <description><![CDATA[<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px">
          <tr><td><b>Tuyến</b></td><td>${esc(tuyen?.ten||'—')} (${esc(loai)})</td></tr>
          <tr><td><b>Mã hiệu</b></td><td>${esc(tuyen?.ma||'—')}</td></tr>
          <tr><td><b>Xã/Phường</b></td><td>${esc(tuyen?.xa||'—')}</td></tr>
          ${owner?`<tr><td><b>Đơn vị nhập</b></td><td>${esc(owner.xa||owner.email)}</td></tr>`:''}
          <tr><td><b>Lý trình</b></td><td>Km${doan.ltTu||0} — Km${doan.ltDen||0}</td></tr>
          <tr><td><b>Rộng nền</b></td><td>${doan.rNen||'—'} m</td></tr>
          <tr><td><b>Rộng mặt</b></td><td>${doan.rMat||'—'} m</td></tr>
          <tr><td><b>Loại mặt</b></td><td>${doan.loaiMat||'—'}</td></tr>
          <tr><td><b>Năm XD</b></td><td>${doan.namXD||'—'}</td></tr>
          <tr><td><b>Tình trạng</b></td><td>${doan.mucDo||'—'}</td></tr>
          <tr><td><b>Loại HH</b></td><td>${doan.loaiHH||'Không có'}</td></tr>
          <tr><td><b>Diện tích HH</b></td><td>${doan.dienTich||'—'} m²</td></tr>
          ${doan.trungVoi?`<tr><td><b>Trùng tuyến</b></td><td>${esc(doan.trungVoi)}</td></tr>`:''}
        </table>]]></description>
        <Style><LineStyle><color>${s.kmlColor}</color><width>${s.weight}</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>
        <LineString><tessellate>1</tessellate><coordinates>${pts}</coordinates></LineString>
      </Placemark>`;
    }).join('');
    return `<Folder><name>${esc(loai)}</name>${pms}</Folder>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>HTGT Nông thôn — Lào Cai</name>
  <description>Xuất ngày ${new Date().toLocaleDateString('vi-VN')}</description>
  ${folderKml}
</Document></kml>`;
}

// ============================================================
//  BADGE HELPERS & UI
// ============================================================
function loaiBadge(l) {
  const m={'Quốc lộ':'badge-ql','Đường tỉnh':'badge-dt','Đường xã':'badge-xa','Đường đô thị':'badge-dotu','Đường thôn':'badge-thon','Đường ngõ xóm':'badge-ngo'};
  return l?`<span class="badge ${m[l]||''}">${l}</span>`:'';
}
function matBadge(m) {
  const map={'BTXM':'badge-mat-btxm','BTN':'badge-mat-btn','Đá dăm':'badge-mat-da','Đất':'badge-mat-dat'};
  return m?`<span class="badge ${map[m]||''}">${m}</span>`:'';
}
function ttBadge(t) {
  const map={'Tốt':'badge-tt-tot','Trung bình':'badge-tt-tb','Xấu':'badge-tt-xau','Rất xấu':'badge-tt-ratxau'};
  return t?`<span class="badge ${map[t]||''}">${t}</span>`:'';
}

function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  qs(`#tab-${name}`)?.classList.add('active');
  qs(`[data-tab="${name}"]`)?.classList.add('active');
  if (name==='map') { setTimeout(()=>S.map?.invalidateSize(),100); updateGpsStatus(); }
  if (name==='list') renderRouteList();
  if (name==='admin') { renderUserList(); updateAdminStats(); }
}

window.switchFormTab = function(tab) {
  S.formTab=tab;
  qs('#form-tuyen').style.display=tab==='tuyen'?'block':'none';
  qs('#form-doan').style.display =tab==='doan'?'block':'none';
  qs('#ftab-tuyen').classList.toggle('active',tab==='tuyen');
  qs('#ftab-doan').classList.toggle('active',tab==='doan');
  if (tab==='doan') fillTuyenSelects();
};

function updateOnlineStatus() {
  const dot=qs('#sync-dot'); if (!dot) return;
  dot.classList.toggle('offline',!navigator.onLine);
  dot.title=navigator.onLine?'Đang kết nối Firebase':'Offline — lưu cục bộ';
}

function showToast(msg,ms=3200) {
  const t=qs('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),ms);
}

const esc=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const qs=sel=>document.querySelector(sel);
const dateStr=()=>{ const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; };

// ============================================================
//  IMPORT EXCEL
// ============================================================
const IMPORT_COLS = {
  'Tên tuyến':       'ten',
  'Loại đường':      'loaiDuong',
  'Xã/Phường':       'xa',
  'Mã hiệu':         'ma',
  'Năm XD':          'nam',
  'Chiều dài (km)':  'chieuDai',
  'Ghi chú':         'ghiChu',
};
const LOAI_VALID = Object.keys(LOAI_DUONG);
let _importRows = [];

window.downloadExcelTemplate = function() {
  const wb = XLSX.utils.book_new();
  const headers = Object.keys(IMPORT_COLS);
  const example = [
    ['Đường liên xã A - B', 'Đường xã', 'Xã Bảo Thắng', 'ĐX.LC.001', 2018, 2.5, 'Ghi chú mẫu'],
    ['Đường thôn Bắc', 'Đường thôn', 'Xã Phong Hải', '', 2020, 0.8, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...example]);
  // Độ rộng cột
  ws['!cols'] = [22,16,18,12,8,14,20].map(w => ({ wch: w }));
  // Màu header (chỉ hỗ trợ xlsx full)
  XLSX.utils.book_append_sheet(wb, ws, 'Danh sách tuyến');
  XLSX.writeFile(wb, 'Mau_nhap_tuyen_duong.xlsx');
};

window.handleImportFile = function(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      if (!rows.length) { showToast('File không có dữ liệu'); return; }
      _importRows = rows.map((r, i) => {
        const ten      = String(r['Tên tuyến']||'').trim();
        const loai     = String(r['Loại đường']||'').trim();
        const xa       = String(r['Xã/Phường']||'').trim();
        const ma       = String(r['Mã hiệu']||'').trim();
        const nam      = parseInt(r['Năm XD'])||null;
        const chieuDai = parseFloat(r['Chiều dài (km)'])||null;
        const ghiChu   = String(r['Ghi chú']||'').trim();
        const errors   = [];
        if (!ten)  errors.push('Thiếu tên');
        if (!loai) errors.push('Thiếu loại đường');
        else if (!LOAI_VALID.includes(loai)) errors.push(`Loại đường không hợp lệ: "${loai}"`);
        return { stt:i+1, ten, loai, xa, ma, nam, chieuDai, ghiChu, errors };
      });
      renderImportPreview();
    } catch(err) { showToast('Lỗi đọc file: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
};

function renderImportPreview() {
  const ok  = _importRows.filter(r => !r.errors.length);
  const err = _importRows.filter(r => r.errors.length);
  qs('#import-summary').innerHTML =
    `<span style="color:#2e7d32">✅ ${ok.length} tuyến hợp lệ</span>` +
    (err.length ? `&nbsp;&nbsp;<span style="color:#c62828">⚠️ ${err.length} dòng lỗi</span>` : '');

  const tableHtml = `<table class="import-table">
    <thead><tr>
      <th>#</th><th>Tên tuyến</th><th>Loại đường</th><th>Xã/Phường</th>
      <th>Mã hiệu</th><th>Năm XD</th><th>Dài (km)</th><th>Trạng thái</th>
    </tr></thead>
    <tbody>
    ${_importRows.map(r => `<tr class="${r.errors.length?'err-row':'ok-row'}">
      <td>${r.stt}</td>
      <td>${esc(r.ten)||'<i style="color:#999">trống</i>'}</td>
      <td>${esc(r.loai)}</td>
      <td>${esc(r.xa)}</td>
      <td>${esc(r.ma)}</td>
      <td>${r.nam||''}</td>
      <td>${r.chieuDai||''}</td>
      <td>${r.errors.length ? '❌ '+r.errors.join(', ') : '✅'}</td>
    </tr>`).join('')}
    </tbody></table>`;

  qs('#import-preview-table').innerHTML = tableHtml;
  qs('#import-preview').style.display = 'block';
  qs('#btn-do-import').textContent = `⬆️ Nhập ${ok.length} tuyến hợp lệ`;
  qs('#btn-do-import').disabled = ok.length === 0;
}

window.cancelImport = function() {
  _importRows = [];
  qs('#import-preview').style.display = 'none';
  qs('#import-file').value = '';
  qs('#import-result').innerHTML = '';
};

window.doImport = async function() {
  const ok = _importRows.filter(r => !r.errors.length);
  if (!ok.length) return;
  const btn = qs('#btn-do-import');
  btn.disabled = true; btn.textContent = '⏳ Đang nhập…';
  const res = qs('#import-result');
  res.innerHTML = '';
  let success = 0, fail = 0;
  for (const r of ok) {
    try {
      await tuyenCol.add({
        ten: r.ten, loaiDuong: r.loai, xa: r.xa,
        ma: r.ma, nam: r.nam, chieuDai: r.chieuDai, ghiChu: r.ghiChu,
        uid: S.user.uid, createdAt: ts(),
      });
      success++;
    } catch(e) { fail++; }
  }
  res.innerHTML = `<div style="padding:10px;border-radius:8px;background:${fail?'#fff3e0':'#e8f5e9'};color:${fail?'#e65100':'#1b5e20'};font-size:12px;">
    ✅ Đã nhập <b>${success}</b> tuyến thành công${fail?` · ❌ ${fail} lỗi`:''}
  </div>`;
  btn.textContent = '✅ Hoàn tất';
  _importRows = [];
  qs('#import-preview').style.display = 'none';
  qs('#import-file').value = '';
  showToast(`✅ Đã nhập ${success} tuyến đường`);
  setTimeout(() => { btn.disabled=false; btn.textContent='⬆️ Nhập vào hệ thống'; }, 2000);
};

// Drag & drop cho import zone
window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('dragover', e => {
    if (qs('#import-drop-zone')) e.preventDefault();
  });
  document.addEventListener('drop', e => {
    const zone = qs('#import-drop-zone');
    if (!zone) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.xlsx')||file.name.endsWith('.xls'))) {
      const inp = qs('#import-file');
      const dt = new DataTransfer(); dt.items.add(file); inp.files = dt.files;
      handleImportFile(inp);
    }
  });
});

// ============================================================
//  BIND EVENTS
// ============================================================
function bindEvents() {
  qs('#btn-login')?.addEventListener('click', login);
  qs('#inp-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') login(); });
  qs('#btn-logout')?.addEventListener('click', logout);
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
  qs('#btn-start-track')?.addEventListener('click', openTrackSetup);
  qs('#btn-start-confirm')?.addEventListener('click', startTracking);
  qs('#btn-stop-track')?.addEventListener('click',stopTracking);
  qs('#btn-add-pt')?.addEventListener('click',addManualPoint);
  qs('#btn-my-loc')?.addEventListener('click',locateMe);
  qs('#search-input')?.addEventListener('input',renderRouteList);
  document.querySelectorAll('.filter-chip').forEach(chip=>chip.addEventListener('click',()=>{
    chip.closest('div').querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    if (chip.closest('#export-filter-row')) S.exportLoai=chip.dataset.loai;
    else S.filterLoai=chip.dataset.loai;
    renderRouteList();
  }));
  qs('#btn-fab-add')?.addEventListener('click',()=>{ qs('#fab-modal').hidden=false; });
  qs('#btn-export')?.addEventListener('click',exportKmz);
  qs('#modal-overlay')?.addEventListener('click',e=>{ if(e.target===qs('#modal-overlay')) qs('#modal-overlay').hidden=true; });
}

// Expose
window.flyToTuyen=flyToTuyen; window.flyToDoan=flyToDoan;
window.openEditTuyen=openEditTuyen; window.openEditDoan=openEditDoan;
window.openNewDoanForTuyen=openNewDoanForTuyen; window.openNewTuyen=openNewTuyen; window.openNewDoan=openNewDoan;
window.toggleRoute=toggleRoute;
window.confirmDeleteTuyen=confirmDeleteTuyen; window.confirmDeleteDoan=confirmDeleteDoan;
window.submitTuyen=submitTuyen; window.submitDoan=submitDoan;
window.createXaUser=createXaUser;
