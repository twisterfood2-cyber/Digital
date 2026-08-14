// Service Worker بسيط - الهدف الأساسي إنه يخلي المتصفح يعتبر
// الموقع "تطبيق قابل للتثبيت" رسميًا (شرط أساسي عند كروم خصوصًا).
// مش بيعمل تخزين مؤقت معقد، بس بيمرر كل الطلبات عادي للنت.

const CACHE_NAME = 'digital-re-v1';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  // تمرير كل الطلبات عادي للنت (بدون تخزين مؤقت معقد حاليًا)
  event.respondWith(fetch(event.request));
});
