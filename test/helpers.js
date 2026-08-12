/* Shared plumbing for the test suites: assertions, a test server, and page loaders. */
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT) || 5178;
const BASE = 'http://localhost:' + PORT + '/';

/* Collects results so run.js can report a single total. */
function reporter(suiteName) {
  const r = {
    suite: suiteName,
    passes: 0,
    failures: [],
    section(name) {
      console.log('\n  ' + name);
    },
    ok(cond, msg) {
      if (cond) {
        r.passes++;
        console.log('    \x1b[32m✓\x1b[0m ' + msg);
      } else {
        r.failures.push(msg);
        console.log('    \x1b[31m✗ ' + msg + '\x1b[0m');
      }
      return !!cond;
    },
    note(msg) {
      console.log('      \x1b[2m' + msg + '\x1b[0m');
    },
  };
  return r;
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000);
  return new Promise((resolve, reject) => {
    (function attempt() {
      const req = http.get(BASE, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error('server did not start'));
        setTimeout(attempt, 120);
      });
    })();
  });
}

async function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore',
  });
  await waitForServer();
  return {
    stop() {
      return new Promise((resolve) => {
        child.on('exit', resolve);
        child.kill('SIGKILL');
        setTimeout(resolve, 1500);
      });
    },
  };
}

/* Load the app's own scripts into a bare Node context — no DOM, for pure logic. */
function loadHeadless() {
  const fresh = {};
  global.window = fresh;
  delete require.cache[require.resolve(path.join(ROOT, 'js/state.js'))];
  delete require.cache[require.resolve(path.join(ROOT, 'js/layout.js'))];
  require(path.join(ROOT, 'js/state.js'));
  require(path.join(ROOT, 'js/layout.js'));
  return fresh.FT;
}

/* Load the real served page in jsdom. */
async function loadPage(url, opts) {
  const { JSDOM } = require('jsdom');
  const options = opts || {};
  const errors = [];
  const dom = await JSDOM.fromURL(url || BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.setPointerCapture = function () {};
      w.HTMLElement.prototype.releasePointerCapture = function () {};
      w.Element.prototype.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700,
      });
      // jsdom ships no fetch; real browsers do.
      w.fetch = (u, o) => globalThis.fetch(new URL(u, BASE), o);
      // Stand in for a browser that suppresses dialogs: confirm() returns false
      // without asking anyone. Anything gated on it would silently do nothing,
      // so the app must not use it at all. Counted so tests can assert that.
      w.__confirmCalls = 0;
      w.confirm = () => {
        w.__confirmCalls++;
        return false;
      };
      w.addEventListener('error', (e) => errors.push(String((e.error && e.error.stack) || e.message)));
      w.addEventListener('unhandledrejection', (e) => errors.push('unhandled rejection: ' + e.reason));
      if (options.beforeParse) options.beforeParse(w);
    },
  });
  await wait(options.settle || 900);
  dom.errors = errors;
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { ROOT, PORT, BASE, reporter, startServer, loadHeadless, loadPage, wait };
