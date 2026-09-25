import { Bookstand } from '@bookstand/core';

const ASPECT = 624 / 907;

// Same page size for both, so the comparison is about feel and not scale.
const mount = document.querySelector('#stpf').parentElement;
const H = Math.min(mount.clientHeight - 16, 520);
const PAGE_H = H;
const PAGE_W = Math.round(PAGE_H * ASPECT);

const pageFlip = new window.St.PageFlip(document.getElementById('stpf'), {
  width: PAGE_W,
  height: PAGE_H,
  size: 'fixed',
  showCover: true,
  usePortrait: false,
  autoSize: false,
  maxShadowOpacity: 0.5,
  mobileScrollSupport: false,
});
pageFlip.loadFromHTML(document.querySelectorAll('#stpf-src .page'));

const ours = new Bookstand(document.getElementById('ours'), {
  cover: '/cover.jpg',
  spreads: [
    ['/page_1.jpg', '/page_2.jpg'],
    ['/page_3.jpg', '/page_4.jpg'],
    ['/page_5.jpg', '/page_6.jpg'],
  ],
  backCover: '/backcover.jpg',
  aspect: ASPECT,
  startAt: 'cover',
});

window.pageFlip = pageFlip;
window.bookstand = ours;

document.getElementById('reset').addEventListener('click', () => {
  pageFlip.turnToPage(0);
  ours.goTo(0, { animate: false });
});

// Trace: sample the reference's internal flip state each frame so we can see
// exactly what it does with a drag, rather than guessing from the pixels.
const traceEl = document.getElementById('trace');
const traceToggle = document.getElementById('trace-on');
const samples = [];
window.flipTrace = samples;

traceToggle.addEventListener('change', () => {
  traceEl.hidden = !traceToggle.checked;
  samples.length = 0;
  if (traceToggle.checked) requestAnimationFrame(sample);
});

function sample() {
  if (!traceToggle.checked) return;
  const flip = pageFlip.getFlipController?.() ?? pageFlip.flipController;
  const calc = flip?.getCalculation?.();
  if (calc) {
    samples.push({
      t: performance.now(),
      state: pageFlip.getState(),
      progress: calc.getFlippingProgress(),
      corner: calc.getCorner(),
      angle: calc.getAngle(),
      pos: calc.getPosition(),
    });
    const last = samples[samples.length - 1];
    traceEl.textContent =
      `samples ${samples.length}\n` +
      `state    ${last.state}\n` +
      `progress ${last.progress.toFixed(1)}\n` +
      `angle    ${last.angle.toFixed(3)}\n` +
      `pos      ${last.pos.x.toFixed(0)}, ${last.pos.y.toFixed(0)}`;
  }
  requestAnimationFrame(sample);
}
