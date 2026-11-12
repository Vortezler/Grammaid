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
  var TAB = { id: 1, url: location.href };

  function dispatch(roles, message, sender) {
    return new Promise(function (resolve, reject) {
      var pending = false;
      listeners.forEach(function (l) {
        if (roles.indexOf(l.role) === -1 || pending) return;
        var out;
        try {
          out = l.fn(clone(message), sender || {});
        } catch (_e) {
          return;
        }
        if (out && typeof out.then === 'function') {
          pending = true;
          out.then(function (v) {
            resolve(clone(v));
          }, reject);
        }
      });
      if (!pending) resolve(undefined);
    });
  }

  window.__grammaidMakeBrowser = function (role) {
    return {
      runtime: {
        getURL: function (p) {
          return location.origin + '/' + p.replace(/^\//, '');
        },
        sendMessage: function (message) {
          // Like the real API: content scripts have a sender tab, extension pages do not.
          return dispatch(['background'], message, role === 'content' ? { tab: TAB } : {});
        },
        onMessage: {
          addListener: function (fn) {
            listeners.push({ role: role, fn: fn });
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
        query: function () {
          return Promise.resolve([TAB]);
        },
        onRemoved: { addListener: function () {} },
        onUpdated: { addListener: function () {} },
        sendMessage: function (_id, message) {
          return dispatch(['content'], message);
        },
      },
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
