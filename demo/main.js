import { Bookstand } from 'bookstand';
import { createPanel, loadOverrides, setLive, toOptions } from './panel.js';

const stage = document.getElementById('stage');
const status = document.getElementById('status');
const prevButton = document.getElementById('prev');
const nextButton = document.getElementById('next');
const panelButton = document.getElementById('panel-toggle');
const aside = document.getElementById('panel');

const overrides = loadOverrides();

// 624 × 907 scans: cover, three interior spreads, back cover.
function config(startAt) {
  const coverPaper = overrides.coverPaper ?? 'coated';
  const page3 = overrides.page3Paper ?? 'coated';
  return {
    ...toOptions(overrides),
    cover: { src: '/cover.jpg', paper: coverPaper },
    spreads: [
      ['/page_1.jpg', '/page_2.jpg'],
      // One of each stock, side by side under the same light.
      [page3 === 'book default' ? '/page_3.jpg' : { src: '/page_3.jpg', paper: page3 }, '/page_4.jpg'],
      ['/page_5.jpg', '/page_6.jpg'],
    ],
    backCover: { src: '/backcover.jpg', paper: coverPaper },
    aspect: 624 / 907,
    startAt,
  };
}

let book = null;

function describe() {
  const state = book.book.states[book.stateIndex];
  const name = (slot) => slot?.image.alt ?? '—';
  status.textContent = `${book.stateIndex} · ${name(state.left)} | ${name(state.right)}`;
  prevButton.disabled = book.stateIndex <= book.book.firstState;
  nextButton.disabled = book.stateIndex >= book.book.lastState;
}

function mount() {
  const at = book ? book.stateIndex : 'cover';
  book?.destroy();
  book = new Bookstand(stage, config(at));
  book.on('change', describe);
  describe();
  // Handy in the console, and it lets the screenshot harness pause a flip at
  // an exact progress instead of guessing with timers.
  window.bookstand = book;
}

mount();

let rebuild = 0;
createPanel(aside, overrides, (path, value, _all, { rebuild: needsRebuild }) => {
  if (needsRebuild || path === null) {
    clearTimeout(rebuild);
    rebuild = setTimeout(mount, 120);
    return;
  }
  // Read every frame, so written in place and repainted — no rebuild, which
  // is what lets a slider move the book while it is being dragged.
  const [section, ...keys] = path.split('.');
  const live = section === 'render' ? book.renderer.options : book.controller.motion;
  setLive(live, keys, value);
  book.schedule();
});

prevButton.addEventListener('click', () => book.prev());
nextButton.addEventListener('click', () => book.next());

const narrow = matchMedia('(max-width: 820px)');
document.body.classList.toggle('panel-open', !narrow.matches);
panelButton.addEventListener('click', () => document.body.classList.toggle('panel-open'));

stage.focus();
