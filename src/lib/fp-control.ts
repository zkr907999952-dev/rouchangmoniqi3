/** First-person action layer: keyboard + stick + injected QA keys. */

export type FpActions = {
  moveX: number;
  moveY: number;
  jump: boolean;
  crouch: boolean;
  interact: boolean;
};

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyC",
  "KeyE",
  "KeyF",
  "ShiftLeft",
  "ShiftRight",
]);

function radialDeadzone(x: number, y: number, dz = 0.15) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

export class FpInput {
  readonly keys = new Set<string>();
  stickX = 0;
  stickY = 0;
  crouchHold = false;
  jumpTap = false;
  interactTap = false;
  private injected: string[] = [];
  private prevJump = false;
  private prevInteract = false;

  attach() {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (GAME_CODES.has(e.code)) e.preventDefault();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      this.keys.add(e.code);
      if (GAME_CODES.has(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const clear = () => this.keys.clear();
    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up, { capture: true });
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clear();
    });
    this.detach = () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", clear);
      this.keys.clear();
    };
  }

  detach = () => {};

  setKeys(codes: string[]) {
    this.injected = codes.slice();
  }

  poll(): FpActions {
    const held = (code: string) => this.keys.has(code) || this.injected.includes(code);
    let mx = this.stickX;
    let my = this.stickY;
    if (held("KeyD") || held("ArrowRight")) mx += 1;
    if (held("KeyA") || held("ArrowLeft")) mx -= 1;
    if (held("KeyW") || held("ArrowUp")) my += 1;
    if (held("KeyS") || held("ArrowDown")) my -= 1;
    let padCrouch = false;
    const pad = typeof navigator !== "undefined" ? navigator.getGamepads?.()[0] : null;
    if (pad && pad.mapping === "standard") {
      const dz = radialDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0));
      mx += dz.x;
      my += dz.y;
      if (pad.buttons[0]?.pressed) this.jumpTap = true;
      if (pad.buttons[1]?.pressed) padCrouch = true;
      if (pad.buttons[2]?.pressed) this.interactTap = true;
    }
    mx = THREE_CLAMP(mx, -1, 1);
    my = THREE_CLAMP(my, -1, 1);
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    const jumpHeld = this.jumpTap || held("Space");
    const interactHeld = this.interactTap || held("KeyE") || held("KeyF");
    const jump = jumpHeld && !this.prevJump;
    const interact = interactHeld && !this.prevInteract;
    this.prevJump = jumpHeld;
    this.prevInteract = interactHeld;
    this.jumpTap = false;
    this.interactTap = false;
    return {
      moveX: mx,
      moveY: my,
      jump,
      crouch: this.crouchHold || padCrouch || held("KeyC"),
      interact,
    };
  }
}

function THREE_CLAMP(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getPos?: () => [number, number, number];
      getEye?: () => number;
      setKeys?: (codes: string[]) => void;
      setSteer?: (v: number) => void;
    };
  }
}
