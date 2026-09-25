import { Bookstand } from '@bookstand/core';

const stage = document.getElementById('stage');
const status = document.getElementById('status');
const prevButton = document.getElementById('prev');
const nextButton = document.getElementById('next');

// 624 × 907 scans: cover, three interior spreads, back cover.
const config = {
  cover: '/cover.jpg',
  spreads: [
    ['/page_1.jpg', '/page_2.jpg'],
    ['/page_3.jpg', '/page_4.jpg'],
    ['/page_5.jpg', '/page_6.jpg'],
  ],
  backCover: '/backcover.jpg',
  aspect: 624 / 907,
  startAt: 'cover',
};

let book = null;

function describe() {
  const state = book.book.states[book.stateIndex];
  const name = (slot) => slot?.image.alt ?? '—';
  status.textContent = `${book.stateIndex} · ${name(state.left)} | ${name(state.right)}`;
  prevButton.disabled = book.stateIndex <= book.book.firstState;
  nextButton.disabled = book.stateIndex >= book.book.lastState;
}

function mount() {
  book?.destroy();
  book = new Bookstand(stage, config);
  book.on('change', describe);
  describe();
  // Handy in the console, and it lets the screenshot harness pause a flip at
  // an exact progress instead of guessing with timers.
  window.bookstand = book;
}

mount();

prevButton.addEventListener('click', () => book.prev());
nextButton.addEventListener('click', () => book.next());

stage.focus();
