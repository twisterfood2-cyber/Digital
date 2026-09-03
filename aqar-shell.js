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

/* ============================================================================
 * Phase 3C — Page Header الموحّد (عرض فقط)
 * ----------------------------------------------------------------------------
 * مصدر واحد للعنوان/الوصف/مسار الصفحة: ROUTE_REGISTRY (title/subtitle/crumbs) عبر
 * window.__aqarRoutes. يُستدعى sync() من route() بعد حسم المسار. لا صلاحيات، لا نداءات سيرفر.
 *   window.__aqarPageHeader.render({ title, subtitle, crumbs, actions })  — رسم مباشر
 *   window.__aqarPageHeader.sync()                                        — من المسار الحالي
 *   window.__aqarPageHeader.setActions(el|null)                           — خانة الإجراءات
 * ==========================================================================*/
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function render(opts) {
    opts = opts || {};
    var root = el('aqPageHeader'); if (!root) return;
    var t = el('aqPageTitle'), st = el('aqPageSubtitle'), cr = el('aqPageCrumbs');
    if (t) t.textContent = opts.title || '';
    if (st) { st.textContent = opts.subtitle || ''; st.hidden = !opts.subtitle; }
    if (cr) {
      cr.textContent = '';
      var crumbs = Array.isArray(opts.crumbs) ? opts.crumbs : [];
      crumbs.forEach(function (c, i) {
        var span = document.createElement('span'); span.className = 'aq-page-crumb'; span.textContent = String(c);
        cr.appendChild(span);
        var sep = document.createElement('span'); sep.className = 'aq-page-crumb-sep'; sep.setAttribute('aria-hidden', 'true'); sep.textContent = '›';
        cr.appendChild(sep);
      });
      if (crumbs.length && opts.title) {
        var cur = document.createElement('span'); cur.className = 'aq-page-crumb is-current'; cur.setAttribute('aria-current', 'page'); cur.textContent = opts.title;
        cr.appendChild(cur);
      }
      cr.hidden = !crumbs.length;
    }
    if (opts.actions !== undefined) setActions(opts.actions);
    root.hidden = !opts.title;
  }
  function setActions(node) {
    var a = el('aqPageActions'); if (!a) return;
    a.textContent = '';
    if (node && node.nodeType === 1) a.appendChild(node);
    a.hidden = !a.childNodes.length;
  }
  function sync() {
    var R = window.__aqarRoutes; if (!R || !R.registry) return;
    var key = (typeof R.current === 'function') ? R.current() : null;
    var r = (key && R.registry[key]) || R.registry.search || null;
    if (!r) return;
    render({ title: r.title || r.label || '', subtitle: r.subtitle || '', crumbs: r.crumbs || [] });
  }
  window.__aqarPageHeader = { render: render, sync: sync, setActions: setActions };
  /* السكربت مؤجَّل (defer) فيُنفَّذ بعد route() الأولى للصفحة → مزامنة أولية هنا؛ بعدها route() تزامن عند كل تغيير. */
  function init() { try { sync(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
