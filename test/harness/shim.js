// Development harness: a stand-in for the WebExtensions `browser` API so the built extension
// (background page, content script, sidebar) can run in an ordinary web page in any browser.
// The top window owns the shared state; each frame gets a facade with its own role.
(function () {
  if (window !== window.top) {
    var role = document.documentElement.dataset.grammaidRole || 'content';
    window.browser = window.top.__grammaidMakeBrowser(role, window);
    return;
  }

  var listeners = []; // { role, fn }
  var storageListeners = [];
  var commandListeners = [];
  var menuListeners = [];
  var store = {};
  try {
    store = JSON.parse(localStorage.getItem('grammaid-harness-storage') || '{}');
  } catch (_e) {
    store = {};
  }
  var clone = function (v) {
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  };

  var actionListeners = [];
  var TAB = { id: 1, url: location.href, title: document.title, active: true };
  var frameIds = new WeakMap();
  frameIds.set(window, 0);
  var nextFrameId = 1;

  function dispatch(roles, message, sender, frameId) {
    return new Promise(function (resolve, reject) {
      var pending = false;
      listeners.forEach(function (l) {
        if (roles.indexOf(l.role) === -1 || frameId !== undefined && l.frameId !== frameId) return;
        var out;
        try {
          out = l.fn(clone(message), sender || {});
        } catch (_e) {
          return;
        }
        if (out && typeof out.then === 'function') {
          if (pending) { out.catch(function () {}); return; }
          pending = true;
          out.then(function (v) {
            resolve(clone(v));
          }, reject);
        }
      });
      if (!pending) resolve(undefined);
    });
  }

  window.__grammaidMakeBrowser = function (role, frameWindow) {
    var owner = frameWindow || window;
    if (!frameIds.has(owner)) frameIds.set(owner, nextFrameId++);
    var frameId = frameIds.get(owner);
    return {
      runtime: {
        openOptionsPage: function () { window.open(location.origin + '/options.html', 'grammaid-settings'); return Promise.resolve(); },
        getURL: function (p) {
          return location.origin + '/' + p.replace(/^\//, '');
        },
        sendMessage: function (message) {
          // Like the real API: content scripts have a sender tab, extension pages do not.
          return dispatch(['background'], message, role === 'content' ? { tab: TAB, frameId: frameId } : {});
        },
        onMessage: {
          addListener: function (fn) {
            listeners.push({ role: role, frameId: frameId, fn: fn });
          },
        },
      },
      storage: {
        local: {
          get: function (key) {
            var out = {};
            if (key === undefined || key === null) out = clone(store);
            else if (key in store) out[key] = clone(store[key]);
            return Promise.resolve(out);
          },
          set: function (items) {
            var changes = {};
            Object.keys(items).forEach(function (k) {
              changes[k] = { oldValue: clone(store[k]), newValue: clone(items[k]) };
              store[k] = clone(items[k]);
            });
            localStorage.setItem('grammaid-harness-storage', JSON.stringify(store));
            storageListeners.slice().forEach(function (fn) {
              try {
                fn(clone(changes), 'local');
              } catch (e) {
                console.error(e);
              }
            });
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: function (fn) {
            storageListeners.push(fn);
          },
          removeListener: function (fn) {
            storageListeners = storageListeners.filter(function (f) {
              return f !== fn;
            });
          },
        },
      },
      tabs: {
        create: function (options) { window.open(options.url, '_blank'); return Promise.resolve({ id: 2, url: options.url }); },
        executeScript: async function () {
          var frames = [window];
          document.querySelectorAll('iframe#frame').forEach(function (frame) { if (frame.contentWindow) frames.push(frame.contentWindow); });
          await Promise.all(frames.map(function (frame) { return new Promise(function (resolve, reject) {
            var script = frame.document.createElement('script'); script.src = location.origin + '/content.js'; script.onload = function () { resolve(); script.remove(); }; script.onerror = reject; frame.document.documentElement.append(script);
          }); }));
          return [];
        },
        query: function () {
          TAB.title = document.title;
          return Promise.resolve([TAB]);
        },
        update: function () { return Promise.resolve(TAB); },
        onRemoved: { addListener: function () {} },
        onUpdated: { addListener: function () {} },
        sendMessage: function (_id, message, options) {
          return dispatch(['content'], message, {}, options && options.frameId);
        },
      },
      contentScripts: { register: async function () { return { unregister: async function () {} }; } },
      menus: {
        removeAll: function () {
          return Promise.resolve();
        },
        create: function () {},
        onClicked: {
          addListener: function (fn) {
            menuListeners.push(fn);
          },
        },
      },
      commands: {
        onCommand: {
          addListener: function (fn) {
            commandListeners.push(fn);
          },
        },
      },
      browserAction: {
        onClicked: {
          addListener: function (fn) {
            actionListeners.push(fn);
          },
        },
        setBadgeText: function (d) {
          var b = document.getElementById('gh-badge');
          if (b) b.textContent = d.text ? '[' + d.text + ']' : '[off]';
          return Promise.resolve();
        },
        setTitle: function () {
          return Promise.resolve();
        },
        setBadgeBackgroundColor: function () {
          return Promise.resolve();
        },
      },
      sidebarAction: {
        open: function () {
          document.body.classList.add('sidebar-open');
          return Promise.resolve();
        },
        toggle: function () {
          document.body.classList.toggle('sidebar-open');
          return Promise.resolve();
        },
      },
    };
  };

  window.browser = window.__grammaidMakeBrowser('content');
  // Stands in for a click on the extension's toolbar button.
  window.__grammaidToolbarClick = function () {
    actionListeners.forEach(function (fn) {
      fn(TAB);
    });
  };
  // Lets the harness toolbar stand in for keyboard shortcuts.
  window.__grammaidCommand = function (name) {
    commandListeners.forEach(function (fn) {
      fn(name);
    });
  };
})();
