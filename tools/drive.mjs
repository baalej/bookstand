/**
 * Drive a page in headless Chrome over CDP: scripted pointer gestures,
 * frame capture, and in-page evaluation.
 *
 * Built because judging a drag from screenshots is guesswork — this dispatches
 * real pointer events with real timing and reads back what the page did.
 *
 *   import { launch } from './tools/drive.mjs';
 *   const page = await launch('http://localhost:5180/');
 *   await page.drag([[900, 200], [400, 260]], { ms: 500 });
 *   await page.shot('/tmp/x.png');
 *   await page.close();
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(url, { width = 1500, height = 900, port = 9330 } = {}) {
  const proc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      `--user-data-dir=/tmp/bookstand-drive-${port}`,
      '--enable-unsafe-swiftshader',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('chrome did not start');

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      logs.push(msg.params.entry.text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(msg.params.exceptionDetails.text ?? 'exception');
    }
  };

  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Page.navigate', { url });
  await sleep(2500);

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return r.result?.result?.value;
  };

  const mouse = (type, x, y, extra = {}) =>
    send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1,
      pointerType: 'mouse',
      ...extra,
    });

  return {
    evaluate,
    logs,

    /**
     * Drag through a list of points over `ms`, interpolating at ~`hz`.
     *
     * Every event carries an explicit CDP timestamp rather than relying on
     * wall-clock spacing. Each dispatch is a round-trip to the browser, so a
     * "90 ms" flick paced by `sleep` actually lands over ~150 ms and arrives
     * at the page with barely half the intended velocity — which silently
     * turns a flick test into a slow-drag test.
     */
    async drag(points, { ms = 500, hz = 60, hold = 0, release = true } = {}) {
      const t0 = Date.now() / 1000;
      const at = (offsetMs) => t0 + offsetMs / 1000;
      const [start] = points;
      await mouse('mousePressed', start[0], start[1], { timestamp: at(0) });

      const steps = Math.max(2, Math.round((ms / 1000) * hz));
      for (let s = 1; s <= steps; s++) {
        const u = (s / steps) * (points.length - 1);
        const i = Math.min(points.length - 2, Math.floor(u));
        const f = u - i;
        const a = points[i];
        const b = points[i + 1];
        await mouse('mouseMoved', a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, {
          timestamp: at((ms * s) / steps),
        });
        // A little real time so rAF can run, decoupled from the gesture clock.
        await sleep(4);
      }
      if (hold) await sleep(hold);
      const end = points[points.length - 1];
      if (release) await mouse('mouseReleased', end[0], end[1], { timestamp: at(ms + hold) });
    },

    /** Release whatever is held, matching the pointer id CDP uses for mouse. */
    async release(x, y) {
      await mouse('mouseReleased', x, y, { timestamp: Date.now() / 1000 });
    },

    /**
     * Held-drag primitives, for inspecting a gesture at chosen positions.
     * `drag` re-presses on every call, which restarts the gesture; use these
     * when you want one continuous press and a screenshot at each waypoint.
     */
    async press(x, y) {
      await mouse('mousePressed', x, y, { timestamp: Date.now() / 1000 });
    },

    /** Move with the button held, easing in over a few events so velocity is sane. */
    async moveTo(x, y, { steps = 6, settle = 140 } = {}) {
      for (let s = 1; s <= steps; s++) {
        await mouse('mouseMoved', x, y, { timestamp: Date.now() / 1000 });
        await sleep(8);
      }
      await sleep(settle);
    },

    async move(x, y) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'none',
        buttons: 0,
        pointerType: 'mouse',
      });
    },

    /**
     * Screenshot. `clip` crops and scales — essential for judging a curl,
     * which is a 20px band on a 700px page and invisible at full frame.
     */
    async shot(path, clip) {
      const r = await send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { scale: 1, ...clip } } : {}),
      });
      writeFileSync(path, Buffer.from(r.result.data, 'base64'));
      return path;
    },

    sleep,

    async close() {
      ws.close();
      proc.kill();
    },
  };
}
