import { Bookstand, type BookstandOptions } from './bookstand.js';

/**
 * `<book-stand>` — the library with no JavaScript to write.
 *
 * ```html
 * <book-stand src="/book.json" style="max-width:70rem;margin:0 auto"></book-stand>
 * <script type="module" src="/bookstand.js"></script>
 * ```
 *
 * Importing this module registers the element. That is a side effect, and
 * `package.json` lists this file under `sideEffects` so a bundler cannot
 * helpfully delete the one line that makes the tag work.
 *
 * Sizing is CSS on the element itself — width, `max-width`, margin, a grid
 * area, whatever. The book is fitted inside whatever box it is given, and if
 * no height is given it keeps itself at the spread's own ratio.
 */

/** The JSON accepted by `src`, or by an inline `<script type="application/json">`. */
export interface BookstandConfig extends BookstandOptions {}

const TAG = 'book-stand';

/**
 * A custom element is `display: inline` until told otherwise, which gives it
 * no box to measure and no height to fill.
 *
 * Injected as a plain `<style>` at the very top of `<head>` rather than set
 * inline, so that author CSS — which comes later in the cascade at equal
 * specificity — wins. An inline style would be unanswerable, and the author
 * has to be able to say `display: grid` or `display: none`.
 *
 * Constructable stylesheets would be the modern way and land in Safari 16.4;
 * §9 of the plan commits to 13.1.
 */
let styled = false;
function installDefaultStyle(doc: Document): void {
  if (styled || doc.getElementById('bookstand-default-style')) return;
  styled = true;
  const style = doc.createElement('style');
  style.id = 'bookstand-default-style';
  style.textContent = `${TAG}{display:block}${TAG}>script{display:none}`;
  doc.head.insertBefore(style, doc.head.firstChild);
}

/**
 * `start-at="cover" | "first-spread" | <spread index>`.
 *
 * Returns undefined for anything else rather than guessing, so a typo falls
 * back to the configured default instead of silently opening at page 0 —
 * `Number('')` is 0, and an empty attribute is the likeliest typo of all.
 */
export function parseStartAt(value: string): BookstandOptions['startAt'] | undefined {
  if (value === 'cover' || value === 'first-spread') return value;
  const index = Number(value);
  return value.trim() !== '' && Number.isFinite(index) ? index : undefined;
}

export class BookStandElement extends HTMLElement {
  static readonly observedAttributes = ['src', 'start-at'];

  /** The live instance, for callers that want the imperative API. */
  book: Bookstand | null = null;

  /** Guards against a slow fetch landing after the element has moved on. */
  private token = 0;

  connectedCallback(): void {
    installDefaultStyle(this.ownerDocument);
    this.mount();
  }

  disconnectedCallback(): void {
    this.token++; // any fetch in flight no longer owns this element
    this.book?.destroy();
    this.book = null;
  }

  attributeChangedCallback(_name: string, before: string | null, after: string | null): void {
    if (before !== after && this.isConnected) this.mount();
  }

  private async mount(): Promise<void> {
    const mine = ++this.token;
    this.book?.destroy();
    this.book = null;

    let declared: BookstandConfig | null;
    try {
      declared = await this.readConfig();
    } catch (cause) {
      this.fail('Bookstand: could not load the book.', cause);
      return;
    }
    if (mine !== this.token || !this.isConnected) return;
    if (!declared) return; // nothing declared yet; an attribute change will retry

    const attribute = this.getAttribute('start-at');
    const startAt = attribute === null ? undefined : parseStartAt(attribute);
    const config: BookstandConfig = startAt === undefined ? declared : { ...declared, startAt };

    try {
      this.book = new Bookstand(this, config);
      this.book.on('change', (payload) => {
        // Composed, so it crosses a shadow boundary if the host page has one.
        this.dispatchEvent(new CustomEvent('change', { detail: payload, bubbles: true, composed: true }));
      });
    } catch (cause) {
      // A context that cannot be created, most likely. The images stay in the
      // DOM and the page keeps working; it just is not a book.
      this.fail('Bookstand: the renderer could not start.', cause);
    }
  }

  /**
   * Config comes from `src`, or from an inline `<script type="application/json">`.
   *
   * The inline form exists because a static page usually knows its own pages at
   * build time, and one fewer request before anything can render is worth more
   * than the tidiness of a separate file.
   */
  private async readConfig(): Promise<BookstandConfig | null> {
    const src = this.getAttribute('src');
    if (src) {
      const response = await fetch(src, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${src}`);
      return (await response.json()) as BookstandConfig;
    }

    const inline = await this.inlineScript();
    if (!inline) return null;
    return JSON.parse(inline.textContent ?? '') as BookstandConfig;
  }

  /**
   * An element upgrades as its start tag is parsed, so its own children may not
   * exist yet — `connectedCallback` on a page still streaming sees an empty
   * element. Waiting for `DOMContentLoaded` is what makes the inline form work
   * for the ordinary case of markup in the document.
   */
  private async inlineScript(): Promise<HTMLScriptElement | null> {
    const find = (): HTMLScriptElement | null =>
      this.querySelector('script[type="application/json"]');

    const found = find();
    if (found || this.ownerDocument.readyState !== 'loading') return found;

    await new Promise<void>((resolve) => {
      this.ownerDocument.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
    return find();
  }

  private fail(message: string, cause: unknown): void {
    this.setAttribute('data-bookstand-error', '');
    this.dispatchEvent(new CustomEvent('error', { detail: cause, bubbles: true, composed: true }));
    console.error(message, cause);
  }
}

// Idempotent: importing this module twice, or alongside a page that already
// registered the tag, must not throw and take the page down with it.
if (typeof customElements !== 'undefined' && !customElements.get(TAG)) {
  customElements.define(TAG, BookStandElement);
}
