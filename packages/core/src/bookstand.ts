import { buildBook, resolveStartState, type Book } from './model/book.js';
import { FlipController, defaultMotion, type ControllerEvents, type MotionOptions } from './flip-controller.js';
import { defaultCurl, type CurlOptions } from './geom/fold.js';
import { computeLayout, defaultLayout, type Layout } from './layout.js';
import type { RenderOptions } from './render/webgl-renderer.js';
import { WebGLRenderer, defaultRender } from './render/webgl-renderer.js';
import { TextureStore } from './render/textures.js';
import { PointerInput } from './input/pointer.js';
import { gesture } from './motion/tokens.js';
import type { BookInput, FlipCorner } from './types.js';

export interface BookstandOptions extends BookInput {
  startAt?: 'cover' | 'first-spread' | number;
  /** Page width ÷ height. Defaults to the first page's intrinsic ratio, else 0.7. */
  aspect?: number;
  padding?: number;
  motion?: Partial<MotionOptions>;
  curl?: Partial<CurlOptions>;
  render?: Partial<RenderOptions>;
  /** Cap on device pixel ratio. 2 is plenty for scans and halves the fill cost on 3× phones. */
  maxDpr?: number;
  interactions?: {
    /** Grab a page and turn it by hand. The reason this library exists. */
    drag?: boolean;
    /** Tap a half to turn. */
    tap?: boolean;
    /** Corner lift under a hovering cursor. Fine pointers only. */
    peek?: boolean;
    keyboard?: boolean;
  };
}

export class Bookstand {
  readonly book: Book;
  private readonly controller: FlipController;
  private readonly renderer: WebGLRenderer;
  private readonly textures: TextureStore;
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver;
  private readonly pointer: PointerInput;
  private readonly options: Required<Pick<BookstandOptions, 'aspect' | 'maxDpr'>> & {
    padding: number;
    headroom: number;
  };
  private layout: Layout;
  private raf = 0;
  private lastFrameTime = 0;
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    options: BookstandOptions,
  ) {
    this.book = buildBook(options);

    const first = this.book.faces.find((f) => f !== null);
    const intrinsic =
      first?.image.width && first.image.height ? first.image.width / first.image.height : undefined;

    const render: RenderOptions = { ...defaultRender, ...options.render };

    this.options = {
      aspect: options.aspect ?? intrinsic ?? defaultLayout.aspect,
      maxDpr: options.maxDpr ?? 2,
      padding: options.padding ?? defaultLayout.padding,
      // Derived from the renderer, never configured separately: if these two
      // drift apart the sheet clips against the canvas edge mid-flip.
      headroom: render.maxMagnification,
    };

    this.canvas = document.createElement('canvas');
    // touch-action is set by PointerInput, which owns the gesture contract.
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(this.canvas);

    this.renderer = new WebGLRenderer(this.canvas, render);
    this.textures = new TextureStore(this.renderer.gl, () => this.schedule());

    this.layout = this.measure();
    this.controller = new FlipController(
      this.book,
      { width: this.layout.pageWidth, height: this.layout.pageHeight },
      { ...defaultMotion, ...options.motion },
      { ...defaultCurl, ...options.curl },
      resolveStartState(this.book, options.startAt),
    );

    this.applyAccessibility();
    this.observer = new ResizeObserver(() => this.onResize());
    this.observer.observe(host);

    const interactions = options.interactions ?? {};
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.pointer = new PointerInput(
      this.canvas,
      this.controller,
      () => this.layout,
      {
        drag: interactions.drag !== false,
        tap: interactions.tap !== false,
        // Reduced motion keeps drag — it is direct manipulation under the
        // reader's own hand, not autonomous motion — but drops the peek,
        // which is an unrequested animation.
        peek: (interactions.peek ?? true) && !reduced,
        intentLockPx: gesture.intentLockPx,
        onChange: () => this.schedule(),
      },
    );

    if (interactions.keyboard !== false) host.addEventListener('keydown', this.onKeyDown);

    this.controller.on('change', () => {
      this.prefetch();
      this.applyAccessibility();
    });

    this.prefetch();
    this.schedule();
  }

  // ---- public surface -------------------------------------------------

  get stateIndex(): number {
    return this.controller.stateIndex;
  }

  next(corner: FlipCorner = 'top'): boolean {
    const started = this.controller.goNext(corner);
    if (started) this.schedule();
    return started;
  }

  prev(corner: FlipCorner = 'top'): boolean {
    const started = this.controller.goPrev(corner);
    if (started) this.schedule();
    return started;
  }

  goTo(index: number, options?: { animate?: boolean }): void {
    this.controller.goTo(index, options ?? {});
    this.schedule();
  }

  on<K extends keyof ControllerEvents>(
    event: K,
    fn: (payload: ControllerEvents[K]) => void,
  ): () => void {
    return this.controller.on(event, fn);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.pointer.destroy();
    this.host.removeEventListener('keydown', this.onKeyDown);
    this.controller.destroy();
    this.textures.destroy();
    this.renderer.destroy();
    this.canvas.remove();
  }

  // ---- internals ------------------------------------------------------

  private measure(): Layout {
    const rect = this.host.getBoundingClientRect();
    return computeLayout(rect.width, rect.height, {
      aspect: this.options.aspect,
      padding: this.options.padding,
      headroom: this.options.headroom,
    });
  }

  private onResize(): void {
    this.layout = this.measure();
    this.controller.setMetrics({
      width: this.layout.pageWidth,
      height: this.layout.pageHeight,
    });
    this.schedule();
  }

  /** Load the current spread and its immediate neighbours. Phase 5 widens this. */
  private prefetch(): void {
    const i = this.controller.stateIndex;
    const wanted = [];
    for (let s = i - 1; s <= i + 1; s++) {
      const state = this.book.states[s];
      if (state) wanted.push(state.left, state.right);
    }
    this.textures.request(wanted);
  }

  /**
   * Demand-driven rAF: one frame per request, and a follow-up only while
   * something is still moving. An untouched book costs nothing — the bug that
   * makes StPageFlip's render loop spin forever.
   */
  private schedule(): void {
    if (this.raf !== 0 || this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (time: number): void => {
    this.raf = 0;
    const dt = this.lastFrameTime ? time - this.lastFrameTime : 1000 / 60;
    this.lastFrameTime = time;

    const moving = this.controller.tick(dt);
    const dpr = Math.min(window.devicePixelRatio || 1, this.options.maxDpr);
    this.renderer.resize(this.canvas.clientWidth, this.canvas.clientHeight, dpr);
    this.renderer.draw(this.controller.frame(), this.layout, this.textures);

    if (moving) this.schedule();
    else this.lastFrameTime = 0;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const handled = (): void => {
      event.preventDefault();
    };
    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp':
        handled();
        this.prev();
        break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        handled();
        this.next();
        break;
      case 'Home':
        handled();
        this.goTo(this.book.firstState, { animate: false });
        break;
      case 'End':
        handled();
        this.goTo(this.book.lastState, { animate: false });
        break;
      default:
        break;
    }
  };

  /** Minimal for now; the live region and per-page alt wiring is Phase 6. */
  private applyAccessibility(): void {
    const state = this.book.states[this.controller.stateIndex];
    const names = [state?.left?.image.alt, state?.right?.image.alt].filter(Boolean);
    this.host.setAttribute('role', 'region');
    this.host.setAttribute('tabindex', this.host.getAttribute('tabindex') ?? '0');
    this.host.setAttribute('aria-label', names.length ? names.join(' and ') : 'Book');
  }
}
