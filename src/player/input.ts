/**
 * Mouse and keyboard. The mouse does the hunting: look, draw, aim, loose.
 * Keys move, crouch and swap what is in hand.
 */
export class Input {
  /** Mouse movement since the last frame, in pixels. */
  dx = 0;
  dy = 0;
  wheel = 0;
  left = false;
  right = false;
  locked = false;
  /** Focus or the pointer was lost this frame: anything held was let go without meaning to be. */
  interrupted = false;
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  sensitivity = 0.0022;

  constructor(private readonly element: HTMLElement) {
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) this.releaseAll();
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      // Some browsers report a wild jump on the first event after locking.
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    element.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.left = true;
      if (e.button === 2) this.right = true;
      if (e.button === 1) this.pressed.add("Mouse3");
      e.preventDefault();
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.left = false;
      if (e.button === 2) this.right = false;
    });
    element.addEventListener("contextmenu", (e) => e.preventDefault());
    element.addEventListener("wheel", (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === "Tab" || e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.releaseAll());
  }

  lock(): void {
    const req = this.element.requestPointerLock() as unknown;
    if (req instanceof Promise) req.catch(() => undefined);
  }

  held(code: string): boolean {
    return this.keys.has(code);
  }

  /** True once per press. */
  tapped(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.pressed.clear();
    this.interrupted = false;
  }

  private releaseAll(): void {
    this.interrupted = true;
    this.keys.clear();
    this.left = false;
    this.right = false;
  }
}
