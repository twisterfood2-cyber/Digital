/* =============================================================================
 * AqaR Digital — Direct PDF Engine (Production)  ·  pdf-lib + fontkit + Cairo
 * -----------------------------------------------------------------------------
 * منقول حرفيًا من النسخة المختبَرة PDF_EXPORT_LAB/pdf-direct-design-match.js (POC + Design Match +
 * Compatibility Gate). يُحمَّل كسولًا من index.html عند أول تصدير PDF فقط (لا يؤثر على تحميل الصفحة).
 *
 * نقطة الدخول الإنتاجية: window.AqarDirectPdf.exportUnit(u, agentName, agentPhone)
 *   - نفس كائن الوحدة ونفس بيانات المسؤول التي تصل إلى generateUnitPDF الحالية.
 *   - الصور من نفس الدالة السيرفرية الإنتاجية google.script.run.getUnitImageBase64(url, getAuthCreds()).
 *   - إعدادات الإنتاج المعتمدة من بوابة التوافق: jpegRecompress:true, quality 0.9, maxPx 1600.
 *   - يعيد true بعد بدء تنزيل ملف PDF صالح، ويرمي استثناءً في أي فشل (index.html يعود تلقائيًا للمحرك القديم).
 * المكتبات والخطوط: pdf-engine/vendor/*.js و pdf-engine/fonts/Cairo-*.ttf (مسارات نسبية لهذا الملف).
 * =============================================================================*/
(function () {
  'use strict';
  const now = () => performance.now();
  const r0 = (x) => Math.round(x);
  // مسار الأصول نسبةً إلى هذا الملف نفسه (يعمل مع أي مسار استضافة)
  const BASE = (function () { try { const s = document.currentScript && document.currentScript.src; return s ? s.slice(0, s.lastIndexOf('/') + 1) : 'pdf-engine/'; } catch (e) { return 'pdf-engine/'; } })();
  const CONFIG = { jpegRecompress: true, jpegQuality: 0.9, maxPx: 1600, coverFit: 'cover', maxImages: 5, timeoutMs: 90000 };

  /* ---------------- تحميل كسول (مرة واحدة) للمكتبات والخطوط ---------------- */
  let libsPromise = null, fontsPromise = null;
  function loadScript(url) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.async = true; s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل ' + url)); document.head.appendChild(s); }); }
  function loadLibs() {
    if (window.PDFLib && window.fontkit) return Promise.resolve(0);
    if (!libsPromise) {
      const t0 = now();
      libsPromise = (async () => {
        if (!window.PDFLib) await loadScript(BASE + 'vendor/pdf-lib.min.js');
        if (!window.fontkit) await loadScript(BASE + 'vendor/fontkit.umd.min.js');
        if (!window.PDFLib || !window.fontkit) throw new Error('مكتبات PDF لم تُحمَّل');
        return r0(now() - t0);
      })().catch((e) => { libsPromise = null; throw e; });
    }
    return libsPromise;
  }
  function loadFonts() {
    if (!fontsPromise) {
      const t0 = now();
      fontsPromise = (async () => {
        const [normal, bold] = await Promise.all([fetch(BASE + 'fonts/Cairo-400.ttf'), fetch(BASE + 'fonts/Cairo-700.ttf')].map((p) => p.then((r) => { if (!r.ok) throw new Error('تعذّر تحميل خط Cairo'); return r.arrayBuffer(); })));
        return { normal, bold, loadMs: r0(now() - t0) };
      })().catch((e) => { fontsPromise = null; throw e; });
    }
    return fontsPromise.then((f) => ({ normal: f.normal, bold: f.bold, loadMs: 0 }));
  }
  const decodeImage = (dataUrl) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = dataUrl; });
  // نفس مصدر الصور الإنتاجي بالضبط (أول 5 صور، بالتوازي، تجاهل الفاشلة) — نفس الجلسة ونفس الأذونات
  async function loadImages(u, max) {
    const urls = String(u['Images'] || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, max || 5);
    const t0 = now(); const per = [];
    const dataUrls = await Promise.all(urls.map((url, i) => new Promise((resolve) => {
      const s = now();
      google.script.run
        .withSuccessHandler((res) => { const ok = res && res.success; per.push({ i, ms: r0(now() - s), ok: !!ok }); resolve(ok ? res.dataUrl : null); })
        .withFailureHandler(() => { per.push({ i, ms: r0(now() - s), ok: false }); resolve(null); })
        .getUnitImageBase64(url, getAuthCreds());
    })));
    return { images: dataUrls.filter(Boolean), totalMs: r0(now() - t0), per: per.sort((a, b) => a.i - b.i), count: urls.length };
  }

  /* ---------------------------------------------------------------------------
   * نظام الإحداثيات: قوالب الإنتاج مبنية بعرض 480px وتُرسم على A4 بهامش 10mm (عرض محتوى 190mm).
   * إذن 1px (قالب) = 190mm/480 = 0.39583mm = 1.12205pt. نكتب التخطيط بوحدات "px القالب" ونحوّل.
   * ------------------------------------------------------------------------- */
  const PT_PER_MM = 72 / 25.4;
  const PAGE_WIDTH = 210 * PT_PER_MM, PAGE_HEIGHT = 297 * PT_PER_MM;   // 595.28 × 841.89
  const MARGIN = 10 * PT_PER_MM;                                        // 28.35pt (نفس هامش jsPDF الحالي)
  const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;                        // 538.58pt ≡ 480px قالب
  const TEMPLATE_W = 480, TEMPLATE_H = 700;                             // px القالب (700px ≡ 277mm ارتفاع المحتوى)
  const K = CONTENT_WIDTH / TEMPLATE_W;                                 // pt لكل px قالب
  const px = (v) => v * K;
  const X = (xpx) => MARGIN + px(xpx);                                  // من يسار القالب
  const Y = (ypx) => PAGE_HEIGHT - MARGIN - px(ypx);                    // من أعلى القالب (يُحوَّل لنظام PDF)

  // ألوان قوالب الإنتاج حرفيًا (= توكنز aqar-tokens.css: --aq-prop-green-deep/-soft/-line/-text/-text-muted/-text-faint/-border/-canvas-2/-accent/--aq-error-fg)
  const HEX = { greenDeep: '#004C43', soft: '#E4EDEA', line: '#BFD8CF', text: '#16211E', muted: '#6E7573', faint: '#8A908E', border: '#E3E6E5', canvas2: '#E7EDED', accent: '#B4FF6C', red: '#B0271F', white: '#FFFFFF', stAvail: '#1e7145', stReserved: '#c9992e', stSold: '#b3261e' };
  const STATUS_COLOR = (s) => (s === 'متاح' ? HEX.stAvail : (s === 'محجوز' ? HEX.stReserved : HEX.stSold));

  // أحجام الخط بالـ px كما في القوالب (تُحوَّل بنفس K) — Cairo أطول رأسيًا من Segoe فنستخدم line-height صريحًا
  const T = { brand: 15, tagline: 11, badge: 11, title: 18, loc: 12, chip: 11, priceOld: 12, discount: 10, price: 22, ppm: 11, payLabel: 10, payValue: 13, pageTitle: 14, row: 12, agent: 12, contact: 9, issued: 10 };

  let P = null;   // حالة الرسم الحالية { doc, page, F, rgb }

  /* ---------------- helpers: ألوان/أشكال ---------------- */
  function rgbHex(hex) { const n = parseInt(hex.slice(1), 16); return P.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
  function fillRect(xpx, ypx, wpx, hpx, hex, opacity) { P.page.drawRectangle({ x: X(xpx), y: Y(ypx + hpx), width: px(wpx), height: px(hpx), color: rgbHex(hex), opacity: opacity == null ? 1 : opacity }); }
  function roundedPath(w, h, r) { r = Math.min(r, w / 2, h / 2); const k = 0.5523 * r; return `M ${r} 0 L ${w - r} 0 C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} L ${w} ${h - r} C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} L ${r} ${h} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} L 0 ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`; }
  function drawRoundedBox(xpx, ypx, wpx, hpx, rpx, hex, opacity) { P.page.drawSvgPath(roundedPath(px(wpx), px(hpx), px(rpx)), { x: X(xpx), y: Y(ypx), color: rgbHex(hex), borderWidth: 0, opacity: opacity == null ? 1 : opacity }); }
  function drawDivider(xpx, ypx, wpx, hex) { P.page.drawLine({ start: { x: X(xpx), y: Y(ypx) }, end: { x: X(xpx + wpx), y: Y(ypx) }, thickness: px(1), color: rgbHex(hex) }); }

  /* ---------------- helpers: نص / bidi ---------------- */
  // حروف عربية فقط (بدون الأرقام العربية-الهندية ٠-٩ / ۰-۹ التي تُعامل كأرقام LTR مثل المتصفح)
  const AR_RE = /[؀-ٟ٪-ۯۺ-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
  const NEUTRAL_RE = /[\s،,.:;()%\-–—/×xX=+*]/;
  // تقسيم النص إلى مقاطع اتجاهية: عربي / غير عربي (لاتيني+أرقام) / فراغات — ثم تقسيم إضافي للمقاطع غير العربية
  // عند فواصل الأرقام (= × / -) حتى تتطابق الرصفة مع خوارزمية bidi في المتصفح (الفواصل بين رقمين تأخذ اتجاه الفقرة).
  function splitBidi(text) {
    const runs = []; let cur = '', curAr = null;
    for (const ch of String(text)) {
      const isAr = AR_RE.test(ch);
      if (NEUTRAL_RE.test(ch) && !/\s/.test(ch) && curAr !== null) { cur += ch; continue; }        // محايد يلتحق بالمقطع الحالي
      if (/\s/.test(ch)) { if (cur) runs.push({ t: cur, ar: !!curAr }); runs.push({ sp: 1 }); cur = ''; curAr = null; continue; }
      if (curAr === null || isAr === curAr) { cur += ch; curAr = isAr; }
      else { runs.push({ t: cur, ar: !!curAr }); cur = ch; curAr = isAr; }
    }
    if (cur) runs.push({ t: cur, ar: !!curAr });
    // فواصل بين رقمين داخل مقطع غير عربي → مقاطع مستقلة (تُرصّ RTL كما يفعل المتصفح)
    const out = [];
    runs.forEach((r) => {
      if (r.sp || r.ar) { out.push(r); return; }
      const parts = r.t.split(/([=×])/).filter(Boolean);
      if (parts.length > 1 && parts.every((p) => /^[=×]$/.test(p) || /[\d]/.test(p))) parts.forEach((p) => out.push({ t: p, ar: false, sep: /^[=×]$/.test(p) }));
      else out.push(r);
    });
    // دمج الفراغات المتتالية، ودمج الكلمات اللاتينية المتتالية (مع فراغاتها) في مقطع LTR واحد
    // حتى لا يُعكس ترتيب كلمات جملة إنجليزية كاملة ("QA Agent" تبقى "QA Agent").
    const merged = out.reduce((acc, r) => { if (r.sp && acc.length && acc[acc.length - 1].sp) acc[acc.length - 1].sp++; else acc.push(Object.assign({}, r)); return acc; }, []);
    const res = [];
    for (let i = 0; i < merged.length; i++) {
      const r = merged[i], prev = res[res.length - 1], prev2 = res[res.length - 2];
      const strong = (t) => /[A-Za-z0-9٠-٩۰-۹]/.test(t);   // كلمات/أرقام فقط تُدمج — علامات محايدة منفردة (مثل " - ") تبقى مقاطع مستقلة تُرصّ باتجاه الفقرة
      if (!r.sp && !r.ar && !r.sep && strong(r.t) && prev && prev.sp && prev2 && !prev2.ar && !prev2.sp && !prev2.sep && strong(prev2.t)) { prev2.t += ' '.repeat(prev.sp) + r.t; res.pop(); }
      else res.push(r);
    }
    return res;
  }
  function fontFor(bold) { return bold ? P.F.bold : P.F.normal; }
  function measure(text, sizePx, bold) {
    const f = fontFor(bold), s = px(sizePx), sp = f.widthOfTextAtSize(' ', s);
    return splitBidi(text).reduce((w, r) => w + (r.sp ? sp * r.sp : f.widthOfTextAtSize(r.t, s)), 0);
  }
  // يرسم سطرًا مختلطًا: المقاطع تُرصّ من اليمين لليسار (فقرة RTL)؛ كل مقطع لاتيني/رقمي يبقى LTR داخليًا.
  // align: 'right' (xpx = الحافة اليمنى) | 'left' (xpx = الحافة اليسرى) | 'center' (xpx = المركز)
  function drawTextRTL(text, xpx, baselinePx, sizePx, hex, opts) {
    opts = opts || {}; const f = fontFor(opts.bold), s = px(sizePx), sp = f.widthOfTextAtSize(' ', s);
    const runs = splitBidi(text); const widths = runs.map((r) => (r.sp ? sp * r.sp : f.widthOfTextAtSize(r.t, s)));
    const total = widths.reduce((a, b) => a + b, 0);
    let cursor = opts.align === 'left' ? X(xpx) + total : (opts.align === 'center' ? X(xpx) + total / 2 : X(xpx));
    const y = Y(baselinePx);
    runs.forEach((r, i) => { cursor -= widths[i]; if (!r.sp) P.page.drawText(r.t, { x: cursor, y, size: s, font: f, color: rgbHex(hex) }); });
    return total;
  }
  // نص لاتيني خالص (LTR) — xpx = الحافة اليسرى
  function drawTextLTR(text, xpx, baselinePx, sizePx, hex, opts) {
    opts = opts || {}; const f = fontFor(opts.bold), s = px(sizePx);
    P.page.drawText(String(text), { x: X(xpx), y: Y(baselinePx), size: s, font: f, color: rgbHex(hex) });
    return f.widthOfTextAtSize(String(text), s);
  }
  function drawMixedText(text, xpx, baselinePx, sizePx, hex, opts) { return AR_RE.test(text) ? drawTextRTL(text, xpx, baselinePx, sizePx, hex, opts) : (opts && opts.align === 'left' ? drawTextLTR(text, xpx, baselinePx, sizePx, hex, opts) : drawTextRTL(text, xpx, baselinePx, sizePx, hex, opts)); }
  // التفاف كلمات بسيط ضمن عرض معيّن (px)
  function wrapText(text, maxWpx, sizePx, bold) {
    const words = String(text).split(/\s+/).filter(Boolean); const lines = []; let cur = '';
    words.forEach((w) => { const t = cur ? cur + ' ' + w : w; if (measure(t, sizePx, bold) > px(maxWpx) && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines.length ? lines : [''];
  }
  // خط الأساس داخل صندوق سطر: Cairo ascender ≈ 0.99em — نضع خط الأساس عند ~72% من ارتفاع السطر
  const baseline = (topPx, lineHpx) => topPx + lineHpx * 0.72;

  /* ---------------- helpers: صور ---------------- */
  function drawImageContain(img, xpx, ypx, wpx, hpx, radiusPx) {
    const s = Math.min(px(wpx) / img.width, px(hpx) / img.height); const w = img.width * s, h = img.height * s;
    const x = X(xpx) + (px(wpx) - w) / 2, y = Y(ypx + hpx) + (px(hpx) - h) / 2;
    if (radiusPx) clipRounded(x, y, w, h, px(radiusPx));
    P.page.drawImage(img, { x, y, width: w, height: h });
    if (radiusPx) P.page.pushOperators(P.ops.popGraphicsState());
  }
  // object-fit: cover (كما في غلاف الإنتاج) — قصّ مركزي عبر clip path
  function drawImageCover(img, xpx, ypx, wpx, hpx) {
    const bw = px(wpx), bh = px(hpx); const s = Math.max(bw / img.width, bh / img.height); const w = img.width * s, h = img.height * s;
    const bx = X(xpx), by = Y(ypx + hpx);
    P.page.pushOperators(P.ops.pushGraphicsState(), P.ops.rectangle(bx, by, bw, bh), P.ops.clip(), P.ops.endPath());
    P.page.drawImage(img, { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, width: w, height: h });
    P.page.pushOperators(P.ops.popGraphicsState());
  }
  function clipRounded(x, y, w, h, r) {
    const o = P.ops, k = 0.5523 * r;
    P.page.pushOperators(o.pushGraphicsState(), o.moveTo(x + r, y), o.lineTo(x + w - r, y), o.appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r), o.lineTo(x + w, y + h - r), o.appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h), o.lineTo(x + r, y + h), o.appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r), o.lineTo(x, y + r), o.appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y), o.closePath(), o.clip(), o.endPath());
  }

  /* ---------------- helpers: عناصر مشتركة (كما في القوالب) ---------------- */
  // شريط علوي للغلاف: 16px 20px، العلامة يمينًا (RTL) وشارة رقم الوحدة يسارًا
  function drawCoverHeader(u) {
    const h = 76; fillRect(0, 0, TEMPLATE_W, h, HEX.greenDeep);   // مقاس مقيس من baseline (76px)
    drawTextLTR('Digital Real Estate', TEMPLATE_W - 20 - measure('Digital Real Estate', T.brand, true) / K, baseline(16, 24), T.brand, HEX.white, { bold: true });
    drawTextRTL('بوابتك الآمنة إلى عالم الاستثمار العقاري', TEMPLATE_W - 20, baseline(42, 18), T.tagline, HEX.line);
    const id = String(u['Unit ID'] || ''); const bw = measure(id, T.badge) / K + 20;
    drawRoundedBox(20, (h - 23) / 2, bw, 23, 6, HEX.white, 0.15);
    drawTextLTR(id, 30, baseline((h - 23) / 2, 23), T.badge, HEX.white);
    return h;
  }
  // شريط عنوان للصفحات الداخلية: 14px 20px، عنوان 14px bold أبيض
  function drawPageTitle(title) { const h = 50; fillRect(0, 0, TEMPLATE_W, h, HEX.greenDeep); drawTextRTL(title, TEMPLATE_W - 20, baseline(14, 22), T.pageTitle, HEX.white, { bold: true }); return h; }   // 50px مقيس من baseline
  // شريط التواصل السفلي: 8px 20px — الاسم/الهاتف يمينًا، "Contact Info" يسارًا
  function drawFooter(topPx, agentName, agentPhone) {
    const h = 34; fillRect(0, topPx, TEMPLATE_W, h, HEX.greenDeep);   // 34px مقيس من baseline
    const name = agentName || 'Digital Real Estate Team';
    let w = drawMixedText(name, TEMPLATE_W - 20, baseline(topPx + 8, 18), T.agent, HEX.white, { bold: true }) / K;
    if (agentPhone) { const sep = ' — '; const ws = measure(sep, T.agent, true) / K; drawTextRTL(sep, TEMPLATE_W - 20 - w, baseline(topPx + 8, 18), T.agent, HEX.white, { bold: true }); drawTextLTR(agentPhone, TEMPLATE_W - 20 - w - ws - measure(agentPhone, T.agent, true) / K, baseline(topPx + 8, 18), T.agent, HEX.accent, { bold: true }); }
    drawTextLTR('Contact Info', 20, baseline(topPx + 11, 12), T.contact, HEX.line);
    return h;
  }
  function drawChip(label, xRightPx, topPx) { const w = measure(label, T.chip) / K + 20, h = 25; drawRoundedBox(xRightPx - w, topPx, w, h, 6, HEX.soft); drawTextRTL(label, xRightPx - 10, baseline(topPx + 5, 15), T.chip, HEX.text); return { w, h }; }
  function drawLabel(text, xRightPx, baselinePx, sizePx) { return drawTextRTL(text, xRightPx, baselinePx, sizePx, HEX.muted); }
  function drawValue(text, xRightPx, baselinePx, sizePx, bold) { return drawTextRTL(text, xRightPx, baselinePx, sizePx, HEX.text, { bold: !!bold }); }

  /* ---------------- الصفحات ---------------- */
  function addPage() { P.page = P.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); return P.page; }
  const fmt = (n) => (typeof fmtNum === 'function' ? fmtNum(n) : String(n));

  function buildCoverPage(u, photo) {
    addPage(); let y = drawCoverHeader(u);
    // منطقة الصورة 220px بخلفية canvas-2، الصورة cover (كما في الإنتاج) أو contain حسب الخيار
    fillRect(0, y, TEMPLATE_W, 220, HEX.canvas2);
    if (photo) (P.coverFit === 'contain' ? drawImageContain : drawImageCover)(photo, 0, y, TEMPLATE_W, 220);
    const st = String(u['Status'] || ''); const sw = measure(st, 11) / K + 24;      // شارة الحالة: top:12 left:12 padding 4px 12px
    drawRoundedBox(12, y + 12, sw, 23, 999, STATUS_COLOR(st)); drawTextRTL(st, 12 + sw - 12, baseline(y + 16, 15), 11, HEX.white);
    y += 220;
    // العنوان والموقع: padding 18px 20px 4px
    y += 18; drawValue(String(u['Property Type'] || '') + (u['Project Name'] ? ' - ' + u['Project Name'] : ''), TEMPLATE_W - 20, baseline(y, 30), T.title, true); y += 30;
    y += 4; drawValue((u['City'] || '') + ' - ' + (u['Area/District'] || ''), TEMPLATE_W - 20, baseline(y, 19), T.loc, true); y += 19;
    y += 4;
    // الشرائح: padding 12px 20px، gap 6px، التفاف من اليمين
    y += 12; const chips = [u['Unit Area (sqm)'] ? u['Unit Area (sqm)'] + ' م²' : '', u['Rooms'] ? u['Rooms'] + ' غرف' : '', u['Bathrooms'] ? u['Bathrooms'] + ' حمام' : '', u['Floor'] ? 'دور ' + u['Floor'] : '', u['Finishing'] || '', u['Garden Area (sqm)'] ? 'حديقة ' + u['Garden Area (sqm)'] + ' م²' : '', u['Terrace Area (sqm)'] ? 'تراس ' + u['Terrace Area (sqm)'] + ' م²' : '', u['Roof Area (sqm)'] ? 'روف ' + u['Roof Area (sqm)'] + ' م²' : ''].filter(Boolean);
    let cx = TEMPLATE_W - 20, rowH = 0;
    chips.forEach((c) => { const w = measure(c, T.chip) / K + 20; if (cx - w < 20) { cx = TEMPLATE_W - 20; y += 25 + 6; } const r = drawChip(c, cx, y); cx -= r.w + 6; rowH = r.h; });
    if (chips.length) y += rowH; y += 12;
    // صندوق السعر: margin 6px 20px 0، padding 14px 16px، radius 10
    y += 6; const hasDisc = Number(u['Discount Percentage']) > 0; const boxH = (hasDisc ? 14 + 20 + 4 + 37 : 14 + 37) + (u['Price per Meter'] ? 16 : 0) + 14;   // ارتفاعات مقيسة من baseline
    drawRoundedBox(20, y, TEMPLATE_W - 40, boxH, 10, HEX.soft);
    let iy = y + 14; const right = TEMPLATE_W - 36;
    if (hasDisc) {
      const old = fmt(u['Price']) + ' جنيه'; const ow = drawTextRTL(old, right, baseline(iy, 20), T.priceOld, HEX.muted) / K;
      drawDivider(right - ow, iy + 11, ow, HEX.muted);
      const dt = 'خصم ' + u['Discount Percentage'] + '%'; const dw = measure(dt, T.discount) / K + 16; drawRoundedBox(right - ow - 8 - dw, iy + 2, dw, 16, 5, HEX.red); drawTextRTL(dt, right - ow - 8 - 8, baseline(iy + 2, 16), T.discount, HEX.white);
      iy += 20 + 4; drawValue(fmt(u['Price After Discount']) + ' جنيه', right, baseline(iy, 37), T.price, true); iy += 37;
    } else { drawValue(fmt(u['Price']) + ' جنيه', right, baseline(iy, 37), T.price, true); iy += 37; }
    if (u['Price per Meter']) { drawLabel(fmt(u['Price per Meter']) + ' جنيه/م²', right, baseline(iy, 16), T.ppm); iy += 16; }
    y += boxH;
    // شبكة الدفع: margin 10px 20px 0، عمودان gap 8، كل صندوق padding 10px 12px، radius 8
    y += 10; const boxes = [];
    boxes.push(u['Down Payment'] ? ['المقدم', u['Down Payment'] + '% = ' + fmt(u['Down Payment Value']) + ' جنيه'] : null);
    boxes.push(u['Monthly Installment'] ? ['القسط الشهري', fmt(u['Monthly Installment']) + ' جنيه'] : null);
    boxes.push(u['Payment Count'] ? ['الدفعات', u['Payment Count'] + ' × ' + fmt(u['Payment Amount Value']) + ' جنيه'] : null);
    boxes.push(u['Monthly Installment'] ? ['القسط الربع سنوي', fmt(Number(u['Monthly Installment']) * 3) + ' جنيه'] : null);
    const bw = (TEMPLATE_W - 40 - 8) / 2, bh = 10 + 15 + 21 + 10;   // 56px مقيس من baseline
    boxes.forEach((b, i) => { if (!b) return; const col = i % 2, row = Math.floor(i / 2); const bx = TEMPLATE_W - 20 - bw - col * (bw + 8), by = y + row * (bh + 8); drawRoundedBox(bx, by, bw, bh, 8, HEX.soft); drawLabel(b[0], bx + bw - 12, baseline(by + 10, 15), T.payLabel); drawValue(b[1], bx + bw - 12, baseline(by + 25, 21), T.payValue, true); });
    const rows = Math.ceil(boxes.filter(Boolean).length ? boxes.length / 2 : 0); if (rows) y += rows * bh + (rows - 1) * 8;
    y += 20; // padding-bottom
    return y;
  }

  function buildDetailsPage(u, agentName, agentPhone) {
    addPage(); let y = drawPageTitle('تفاصيل الوحدة - ' + u['Unit ID']);
    y += 16;
    // نفس الحقول ونفس الترتيب ونفس التسميات حرفيًا كما في generateUnitPDF
    const rows = [['التصنيف', u['Category']], ['نوع العقار', u['Property Type']], ['اسم المشروع', u['Project Name']], ['المدينة', u['City']], ['المنطقة', u['Area/District']], ['مساحة الأرض', u['Land Area (sqm)'] ? u['Land Area (sqm)'] + ' م²' : ''], ['Garden Area', u['Garden Area (sqm)'] ? u['Garden Area (sqm)'] + ' sqm' : ''], ['Terrace Area', u['Terrace Area (sqm)'] ? u['Terrace Area (sqm)'] + ' sqm' : ''], ['Roof Area', u['Roof Area (sqm)'] ? u['Roof Area (sqm)'] + ' sqm' : ''], ['الفيو', u['View']], ['طريقة الدفع', u['Payment Method']], ['موعد الدفعات', u['Payment Schedule']], ['عدد سنوات التقسيط', u['Installment Years']], ['تاريخ التسليم', u['Delivery Date']], ['أنظمة سداد أخرى', u['Other Payment Plans']], ['حالة الوحدة', u['Status']], ['اسم المالك', u['Owner Name']], ['هاتف المالك', u['Owner Phone']], ['ملاحظات', u['Notes']]].filter((r) => r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== '');
    const footerTop = TEMPLATE_H - 34 - 36;   // footer 34 + سطر الإصدار (padding 10 + 16)
    rows.forEach((r) => {
      const labelW = measure(r[0], T.row) / K; const lines = wrapText(String(r[1]), TEMPLATE_W - 40 - labelW - 12, T.row, true);
      const rh = 8 + 20 * lines.length + 8;   // خطوة الصف 36px + فاصل (مقيسة من baseline)
      if (y + rh > footerTop - 4) { drawFooter(footerTop, agentName, agentPhone); addPage(); y = drawPageTitle('تفاصيل الوحدة - ' + u['Unit ID']) + 16; }   // امتداد نادر (القالب الحالي يقصّ الفائض)
      drawLabel(r[0], TEMPLATE_W - 20, baseline(y + 8, 20), T.row);
      lines.forEach((ln, i) => drawMixedText(ln, 20, baseline(y + 8 + i * 20, 20), T.row, HEX.text, { bold: true, align: 'left' }));
      y += rh; drawDivider(20, y, TEMPLATE_W - 40, HEX.border);
    });
    drawFooter(footerTop, agentName, agentPhone);
    drawTextRTL('تم إصدار هذا الملف بتاريخ ' + new Date().toLocaleDateString('ar-EG'), TEMPLATE_W / 2, baseline(footerTop + 34 + 10, 14), T.issued, HEX.faint, { align: 'center' });
  }

  function buildPhotoPage(u, photo, idx, total, agentName, agentPhone) {
    addPage(); const top = drawPageTitle('صورة ' + (idx + 1) + ' من ' + total + ' - ' + u['Unit ID']);
    const footerTop = TEMPLATE_H - 34;
    drawImageContain(photo, 20, top + 16, TEMPLATE_W - 40, footerTop - top - 32, 8);   // padding 16px 20px، radius 8
    drawFooter(footerTop, agentName, agentPhone);
  }

  /* ---------------- المحرك ---------------- */
  async function embedPhotos(doc, dataUrls, opts) {
    const out = [];
    for (const d of dataUrls) {
      const b64 = d.slice(d.indexOf(',') + 1);
      if (opts.jpegRecompress) { const im = await decodeImage(d); const c = document.createElement('canvas'); const s = Math.min(1, (opts.maxPx || 1600) / Math.max(im.naturalWidth, im.naturalHeight)); c.width = r0(im.naturalWidth * s); c.height = r0(im.naturalHeight * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); const jd = c.toDataURL('image/jpeg', opts.jpegQuality || 0.9); out.push(await doc.embedJpg(jd.slice(jd.indexOf(',') + 1))); }
      else out.push(d.indexOf('image/png') !== -1 ? await doc.embedPng(b64) : await doc.embedJpg(b64));
    }
    return out;
  }
  const fileNameFor = (u) => ((u['Property Type'] || 'Unit') + ' - ' + (u['Unit Area (sqm)'] || '') + ' sqm').replace(/[\\/:*?"<>|]/g, '') + '.pdf';   // نفس قاعدة الإنتاج حرفيًا

  /**
   * generateUnitPdfDirect(u, agentName, agentPhone, opts)
   * نفس مدخلات generateUnitPDF (الوحدة + بيانات المسؤول) → { blob, fileName, metrics }. لا يُنزّل تلقائيًا (LAB).
   * opts: { coverFit:'cover'|'contain', jpegRecompress:bool, jpegQuality, maxPx, images:[dataUrl] (اختياري لتخطي الجلب) }
   */
  async function generateUnitPdfDirect(u, agentName, agentPhone, opts) {
    opts = opts || {}; const m = { unitId: u['Unit ID'] }; const t0 = now();
    m.libLoadMs = await loadLibs();
    const fontBytes = await loadFonts(); m.fontLoadMs = fontBytes.loadMs;
    let dataUrls = opts.images;
    if (!dataUrls) { const imgs = await loadImages(u, 5); dataUrls = imgs.images; m.imageLoadMs = imgs.totalMs; m.imageFetches = imgs.per; } else m.imageLoadMs = 0;
    m.imageCount = dataUrls.length; m.imageSrcChars = dataUrls.reduce((a, d) => a + d.length, 0);
    const tGen = now();
    const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, clip, endPath, rectangle, moveTo, lineTo, appendBezierCurve, closePath } = window.PDFLib;
    const doc = await PDFDocument.create(); doc.registerFontkit(window.fontkit);
    doc.setTitle(fileNameFor(u).replace(/\.pdf$/, '')); doc.setProducer('AqaR Digital — Direct PDF Engine'); doc.setLanguage('ar');
    const F = { normal: await doc.embedFont(fontBytes.normal, { subset: true }), bold: await doc.embedFont(fontBytes.bold, { subset: true }) };
    P = { doc, page: null, F, rgb, ops: { pushGraphicsState, popGraphicsState, clip, endPath, rectangle, moveTo, lineTo, appendBezierCurve, closePath }, coverFit: opts.coverFit || 'cover' };
    const tImg = now(); const photos = await embedPhotos(doc, dataUrls, opts); m.imageEmbedMs = r0(now() - tImg);
    const tDraw = now();
    buildCoverPage(u, photos[0]);
    buildDetailsPage(u, agentName, agentPhone);
    photos.forEach((ph, i) => buildPhotoPage(u, ph, i, photos.length, agentName, agentPhone));
    m.drawMs = r0(now() - tDraw);
    const tSave = now(); const bytes = await doc.save({ useObjectStreams: true }); m.saveMs = r0(now() - tSave);
    m.pdfGenerationMs = r0(now() - tGen); m.totalMs = r0(now() - t0);
    m.pdfBytes = bytes.byteLength; m.pages = doc.getPageCount(); m.fileName = fileNameFor(u); m.coverFit = P.coverFit; m.jpegRecompress = !!opts.jpegRecompress;
    P = null;
    return { blob: new Blob([bytes], { type: 'application/pdf' }), fileName: m.fileName, metrics: m };
  }


  /* ---------------- نقطة الدخول الإنتاجية ---------------- */
  function withTimeout(promise, ms, label) {
    let t; const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' تجاوز المهلة (' + ms + 'ms)')), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
  }
  /**
   * exportUnit(u, agentName, agentPhone) → Promise<true>
   * يولّد الملف بالإعدادات الإنتاجية ويتحقق من صلاحيته (توقيع %PDF + صفحتان على الأقل) ثم يبدأ التنزيل
   * بنفس اسم الملف الإنتاجي. أي فشل = استثناء (المتصل يعود للمحرك القديم). لا يلمس حالة الزر.
   */
  async function exportUnit(u, agentName, agentPhone) {
    const t0 = now();
    const res = await withTimeout(generateUnitPdfDirect(u, agentName, agentPhone, { jpegRecompress: CONFIG.jpegRecompress, jpegQuality: CONFIG.jpegQuality, maxPx: CONFIG.maxPx, coverFit: CONFIG.coverFit }), CONFIG.timeoutMs, 'إنشاء PDF');
    const head = new Uint8Array(await res.blob.slice(0, 5).arrayBuffer());
    const sig = String.fromCharCode.apply(null, head);
    if (sig !== '%PDF-' || res.blob.size < 1000 || !(res.metrics.pages >= 2)) throw new Error('ملف PDF غير صالح (' + sig + ', ' + res.blob.size + 'B, ' + res.metrics.pages + 'p)');
    downloadBlob(res.blob, res.fileName);
    AqarDirectPdf.lastExport = { fileName: res.fileName, bytes: res.blob.size, pages: res.metrics.pages, images: res.metrics.imageCount, imageLoadMs: res.metrics.imageLoadMs, pdfGenerationMs: res.metrics.pdfGenerationMs, totalMs: r0(now() - t0), at: new Date().toISOString() };
    return true;
  }
  const AqarDirectPdf = { exportUnit, generate: generateUnitPdfDirect, loadLibs, loadFonts, config: CONFIG, lastExport: null, version: '1.0.0' };
  window.AqarDirectPdf = AqarDirectPdf;
})();
