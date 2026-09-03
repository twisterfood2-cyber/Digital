/* ============================================================================
 * AqaR Digital — App Shell behavior (Phase 2A)
 * ----------------------------------------------------------------------------
 * طبقة عرض فقط:
 *   - رسم هوية المستخدم (اسم/دور/صورة) في الهيدر والسايدبار من window.__currentUser
 *   - فتح/غلق drawer الموبايل
 * لا مصادقة، لا صلاحيات، لا نداءات سيرفر — الحسم كله يبقى في الطبقات القائمة
 * (setCurrentUserFromLogin / applyRoleUiVisibility / الباك-إند).
 * ==========================================================================*/
(function () {
  'use strict';

  var ROLE_AR = { OWNER: 'مالك', MANAGER: 'مدير', DATA_ENTRY: 'إدخال بيانات', SALES: 'مبيعات' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initialsOf(name) {
    var t = String(name || '').trim();
    return t ? t.slice(0, 1) : '؟';
  }

  /* صورة المستخدم: نفس مرجع Drive المستخدم في البروفايل الحالي (photo = رابط أو id) */
  function photoSrc(u) {
    var p = String((u && u.photo) || '').trim();
    if (!p) return '';
    if (/^https?:\/\//i.test(p)) return p;
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(p) + '&sz=w80';
  }

  function paintOne(rootId, u) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var nameEl = root.querySelector('.aq-id-name');
    var roleEl = root.querySelector('.aq-id-role');
    var avEl = root.querySelector('.aq-avatar');
    var role = String((u && u.role) || '').toUpperCase();
    if (nameEl) nameEl.textContent = (u && u.name) || (u && u.email) || '';
    if (roleEl) roleEl.textContent = (u && u.roleConfirmed && ROLE_AR[role]) ? ROLE_AR[role] : '';
    if (avEl) {
      var src = photoSrc(u);
      if (src) avEl.innerHTML = '<img src="' + esc(src) + '" alt="" onerror="this.remove()">' ;
      else avEl.textContent = initialsOf(u && u.name);
    }
  }

  /* تُستدعى من applyRoleUiVisibility (hook سطر واحد) وبعد تحميل الصفحة */
  window.__aqarShellIdentity = function () {
    var u = window.__currentUser || null;
    paintOne('aqHeaderIdentity', u);
    paintOne('aqSideIdentity', u);
  };

  function closeDrawer() { document.body.classList.remove('aq-drawer-open'); }
  function toggleDrawer() { document.body.classList.toggle('aq-drawer-open'); }

  function wire() {
    var toggle = document.getElementById('aqMenuToggle');
    var overlay = document.getElementById('aqShellOverlay');
    var sidebar = document.getElementById('aqSidebar');
    var logoutBtn = document.getElementById('aqSideLogoutBtn');

    if (toggle) toggle.addEventListener('click', toggleDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    /* اختيار أي عنصر تنقّل داخل السايدبار يغلق الـ drawer على الموبايل */
    if (sidebar) sidebar.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.app-nav-btn, a') : null;
      if (t) closeDrawer();
    });

    /* الخروج: نفس المسار الموحّد القائم من Phase 1B — بلا أي منطق إضافي */
    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      if (typeof window.__aqarLogout === 'function') window.__aqarLogout();
    });

    try { window.__aqarShellIdentity(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
