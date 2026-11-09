/* Love Bank service worker: shows love-note alerts and opens the thread when one is tapped.
   It deliberately does no caching, so the app always loads the latest version. */
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch(_){ d = { body: e.data ? e.data.text() : "" }; }
  var jobs = [
    self.registration.showNotification(d.title || "Love Bank 💌", {
      body: d.body || "New love note",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: d.tag || "love-note",
      renotify: true,
      data: { url: d.url || "./#notes" }
    })
  ];
  if(d.badge && self.navigator && self.navigator.setAppBadge){ jobs.push(self.navigator.setAppBadge(d.badge).catch(function(){})); }
  e.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || "./#notes", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
    for(var i = 0; i < list.length; i++){
      var c = list[i];
      if("focus" in c){ c.postMessage({ type: "open-notes" }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
