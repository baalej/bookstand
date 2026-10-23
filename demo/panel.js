/**
 * The parameter sidebar. Generated from the library's exported defaults, so
 * every option it has appears here without a second list to keep in step.
 *
 * Demo-only by design: live edits write straight into the book's internal
 * option objects (renderer.options, controller.motion), which is not a
 * supported API — it is what lets a slider repaint the book mid-drag.
 */
import { defaultCurl, defaultLayout, defaultMotion, defaultRender, defaultTextureLimit } from 'bookstand';

/**
 * Read once at construction — layout headroom, the curl mesh, input wiring,
 * the page model — so changing them rebuilds the book. Everything else under
 * render and motion is read every frame and is applied in place.
 */
const REBUILDS = new Set([
  'render.segments',
  'render.focal',
  'render.maxMagnification',
]);
const rebuilds = (path) =>
  REBUILDS.has(path) || !(path.startsWith('render.') || path.startsWith('motion.'));

/** Slider bounds where a default-based guess would mislead. [min, max, step] */
const RANGE = {
  'render.light': [-1, 1, 0.01],
  'render.glare': [-1, 1, 0.01],
  'render.focal': [1, 12, 0.1],
  'render.maxMagnification': [1, 1.3, 0.01],
  'render.segments': [8, 240, 1],
  'render.grainSize': [32, 512, 1],
  'render.ambient': [0, 1, 0.01],
  'render.coverGutter': [0, 1, 0.01],
  'render.gutterFalloff': [0, 20, 0.1],
  'render.gutterCoreTightness': [1, 20, 0.1],
  shininess: [1, 400, 1],
  stiffness: [40, 1500, 1],
  damping: [0, 80, 0.5],
  'motion.maxDuration': [200, 2000, 10],
  'motion.flickVelocity': [0.2, 5, 0.05],
  'motion.peekZone': [0, 1, 0.01],
  'motion.peekDepth': [0, 0.6, 0.01],
  'curl.relaxFrom': [0.3, 0.95, 0.01],
  'curl.minRadius': [0.005, 0.1, 0.001],
  'curl.maxRadius': [0.01, 0.2, 0.001],
  padding: [0, 0.2, 0.005],
  maxDpr: [1, 3, 0.25],
  textureLimit: [4, 32, 1],
};

const VECTOR_LABELS = {
  light: ['x', 'y', 'z'],
  glare: ['x', 'y', 'z'],
  gloss: ['paper', 'ink'],
  segments: ['cols', 'rows'],
};

function rangeFor(path, value) {
  const key = path.split('.').pop();
  const hit = RANGE[path] ?? RANGE[key];
  if (hit) return hit;
  const max = value === 0 ? 1 : Math.abs(value) * 3;
  const step = max <= 1 ? 0.001 : max <= 10 ? 0.01 : 1;
  return [0, +max.toPrecision(2), step];
}

const SECTIONS = [
  {
    id: 'book',
    title: 'Book',
    fields: [
      { path: 'paper', label: 'interior paper', choices: ['uncoated', 'coated'], value: 'uncoated' },
      { path: 'coverPaper', label: 'cover paper', choices: ['coated', 'uncoated'], value: 'coated' },
      { path: 'page3Paper', label: 'page 3 paper', choices: ['coated', 'book default', 'uncoated'], value: 'coated' },
      { path: 'padding', value: defaultLayout.padding },
      { path: 'maxDpr', value: 2 },
      { path: 'textureLimit', value: defaultTextureLimit },
    ],
  },
  { id: 'interactions', title: 'Interactions', root: { drag: true, tap: true, peek: true, keyboard: true } },
  { id: 'render', title: 'Render', root: defaultRender },
  { id: 'motion', title: 'Motion', root: defaultMotion },
  { id: 'curl', title: 'Curl', root: defaultCurl },
];

/** Flatten a defaults object into fields, prefixing paths with its section. */
function fieldsOf(prefix, obj) {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (Array.isArray(value)) out.push({ path, value: [...value], labels: VECTOR_LABELS[key] });
    else if (value && typeof value === 'object') out.push({ group: key, fields: fieldsOf(path, value) });
    else out.push({ path, value });
  }
  return out;
}

const STORAGE = 'bookstand-demo-overrides';

export function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
  } catch {
    return {};
  }
}

function saveOverrides(overrides) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(overrides));
  } catch {
    /* private window or blocked storage: edits just don't persist */
  }
}

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (n, step) => (step >= 1 ? String(Math.round(n)) : String(+n.toFixed(4)));

/**
 * @param aside   the sidebar element to fill
 * @param onEdit  (path, value, overrides, { rebuild }) after any change
 */
export function createPanel(aside, overrides, onEdit) {
  const defaults = new Map();
  const controls = new Map(); // path -> { set(value), row }

  const commit = (path, value) => {
    if (equal(value, defaults.get(path))) delete overrides[path];
    else overrides[path] = value;
    saveOverrides(overrides);
    controls.get(path)?.row.classList.toggle('changed', path in overrides);
    renderOutput();
    onEdit(path, value, overrides, { rebuild: rebuilds(path) });
  };

  const numberControl = (path, value, onInput) => {
    const [min, max, step] = rangeFor(path, value);
    const wrap = document.createElement('span');
    wrap.className = 'num';
    const range = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
    const box = Object.assign(document.createElement('input'), { type: 'number', step });
    const set = (v) => {
      range.value = v;
      box.value = fmt(v, step);
    };
    range.addEventListener('input', () => {
      box.value = fmt(+range.value, step);
      onInput(+range.value, false);
    });
    range.addEventListener('change', () => onInput(+range.value, true));
    box.addEventListener('change', () => {
      if (box.value === '' || Number.isNaN(+box.value)) return set(range.value);
      range.value = box.value;
      onInput(+box.value, true);
    });
    set(value);
    wrap.append(range, box);
    return { el: wrap, set };
  };

  const row = (field) => {
    const { path } = field;
    const current = path in overrides ? overrides[path] : field.value;
    defaults.set(path, field.value);
    const el = document.createElement('div');
    el.className = 'row';
    const label = document.createElement('label');
    label.textContent = field.label ?? path.split('.').pop();
    label.title = path;
    const reset = Object.assign(document.createElement('button'), {
      type: 'button',
      className: 'reset',
      textContent: '↺',
      title: 'Reset to default',
    });
    el.append(label);

    let set;
    if (field.choices) {
      const select = document.createElement('select');
      for (const c of field.choices) select.append(new Option(c, c));
      set = (v) => (select.value = v);
      select.addEventListener('change', () => commit(path, select.value));
      el.append(select);
    } else if (typeof field.value === 'boolean') {
      const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
      set = (v) => (box.checked = v);
      box.addEventListener('change', () => commit(path, box.checked));
      el.append(box);
    } else if (Array.isArray(field.value)) {
      const list = document.createElement('div');
      list.className = 'vector';
      let vec = [...current];
      const parts = field.value.map((_, i) => {
        const sub = document.createElement('div');
        sub.className = 'sub';
        const name = document.createElement('span');
        name.className = 'axis';
        name.textContent = field.labels?.[i] ?? i;
        const c = numberControl(path, vec[i], (v, done) => {
          vec = vec.map((x, j) => (j === i ? v : x));
          // Live paths repaint while dragging; rebuilds wait for release.
          if (done || !rebuilds(path)) commit(path, vec);
        });
        sub.append(name, c.el);
        list.append(sub);
        return c;
      });
      set = (v) => {
        vec = [...v];
        parts.forEach((c, i) => c.set(v[i]));
      };
      el.append(list);
    } else {
      const c = numberControl(path, current, (v, done) => {
        if (done || !rebuilds(path)) commit(path, v);
      });
      set = c.set;
      el.append(c.el);
    }
    set(current);
    el.append(reset);
    reset.addEventListener('click', () => {
      set(field.value);
      commit(path, field.value);
    });
    el.classList.toggle('changed', path in overrides);
    if (rebuilds(path)) el.classList.add('rebuilds');
    controls.set(path, { set, row: el });
    return el;
  };

  const build = (parent, fields) => {
    for (const f of fields) {
      if (f.group) {
        const g = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = f.group;
        g.append(legend);
        build(g, f.fields);
        parent.append(g);
      } else parent.append(row(f));
    }
  };

  aside.textContent = '';
  const head = document.createElement('header');
  head.innerHTML = '<strong>Parameters</strong><span class="hint">↻ rebuilds the book</span>';
  const resetAll = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset all' });
  const close = Object.assign(document.createElement('button'), {
    type: 'button',
    className: 'close',
    textContent: '×',
    ariaLabel: 'Close parameters',
  });
  close.addEventListener('click', () => document.body.classList.remove('panel-open'));
  head.append(resetAll, close);
  aside.append(head);

  for (const section of SECTIONS) {
    const details = document.createElement('details');
    details.open = section.id === 'render' || section.id === 'book';
    const summary = document.createElement('summary');
    summary.textContent = section.title;
    details.append(summary);
    build(details, section.fields ?? fieldsOf(section.id, section.root));
    aside.append(details);
  }

  const outHead = document.createElement('div');
  outHead.className = 'out-head';
  outHead.innerHTML = '<strong>Your options</strong>';
  const copy = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy' });
  outHead.append(copy);
  const output = document.createElement('pre');
  aside.append(outHead, output);

  function renderOutput() {
    output.textContent = JSON.stringify(toOptions(overrides), null, 2);
  }
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.textContent);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select it';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1200);
  });

  resetAll.addEventListener('click', () => {
    for (const key of Object.keys(overrides)) delete overrides[key];
    saveOverrides(overrides);
    for (const [path, c] of controls) {
      c.set(defaults.get(path));
      c.row.classList.remove('changed');
    }
    renderOutput();
    onEdit(null, null, overrides, { rebuild: true });
  });

  renderOutput();
}

/** Flat 'render.papers.coated.gloss' overrides into a nested options object. */
export function toOptions(overrides) {
  const out = {};
  for (const [path, value] of Object.entries(overrides)) {
    if (path === 'coverPaper' || path === 'page3Paper') continue; // demo-only, mapped onto pages
    const keys = path.split('.');
    let node = out;
    for (const k of keys.slice(0, -1)) node = node[k] ??= {};
    node[keys.at(-1)] = value;
  }
  return out;
}

/**
 * Write one value into a live options object. Nested objects and arrays are
 * replaced, never edited: below the top level they are the library's shared
 * defaults (springs.settle, defaultRender.light), and editing one in place
 * would change it for every book and for the exported defaults themselves.
 */
export function setLive(root, keys, value) {
  const [head, ...rest] = keys;
  if (rest.length === 0) {
    root[head] = Array.isArray(value) ? [...value] : value;
    return;
  }
  root[head] = { ...root[head] };
  setLive(root[head], rest, value);
}
