/** First-person action layer: keyboard + stick + injected QA keys. */

export type FpActions = {
  moveX: number;
  moveY: number;
  jump: boolean;
  crouchHeld: boolean;
  interact: boolean;
  sprint: boolean;
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

function THREE_CLAMP(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

export const STICK_SPRINT = 0.72;
const CROUCH_LONG_MS = 500;
const CROUCH_COOL_MS = 380;
const CROUCH_STICKY_MS = 80;

/** Tap vs long-press with sticky release so key-repeat cannot flicker posture. */
export class CrouchHold {
  held = false;
  private downAt = 0;
  private longFired = false;
  private lastAction = 0;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private stickyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onTap: () => void,
    private readonly onLong: () => void,
  ) {}

  setHeld(on: boolean) {
    if (on) this.down();
    else this.up();
  }

  reset() {
    this.clearTimers();
    this.held = false;
    this.longFired = false;
    this.downAt = 0;
  }

  private down() {
    if (this.stickyTimer) {
      clearTimeout(this.stickyTimer);
      this.stickyTimer = null;
      if (this.held) {
        if (!this.longFired) this.armLong();
        return;
      }
    }
    if (this.held) return;
    this.held = true;
    this.downAt = performance.now();
    this.longFired = false;
    this.armLong();
  }

  private armLong() {
    if (this.longTimer) clearTimeout(this.longTimer);
    this.longTimer = setTimeout(() => {
      this.longTimer = null;
      const age = performance.now() - this.downAt;
      if (!this.held || this.longFired) return;
      if (age < 460) return;
      this.longFired = true;
      this.lastAction = performance.now();
      this.onLong();
    }, CROUCH_LONG_MS);
  }

  private up() {
    if (!this.held) return;
    if (this.stickyTimer) return;
    if (this.longTimer) {
      clearTimeout(this.longTimer);
      this.longTimer = null;
    }
    this.stickyTimer = setTimeout(() => this.commitUp(), CROUCH_STICKY_MS);
  }

  private commitUp() {
    this.stickyTimer = null;
    if (!this.held) return;
    this.held = false;
    if (this.longTimer) {
      clearTimeout(this.longTimer);
      this.longTimer = null;
    }
    if (this.longFired) return;
    const now = performance.now();
    if (now - this.lastAction < CROUCH_COOL_MS) return;
    this.lastAction = now;
    this.onTap();
  }

  private clearTimers() {
    if (this.longTimer) {
      clearTimeout(this.longTimer);
      this.longTimer = null;
    }
    if (this.stickyTimer) {
      clearTimeout(this.stickyTimer);
      this.stickyTimer = null;
    }
  }
}

export class FpInput {
  readonly keys = new Set<string>();
  stickX = 0;
  stickY = 0;
  jumpTap = false;
  crouchHold = false;
  interactTap = false;
  gate: CrouchHold | null = null;
  private injected: string[] = [];
  private prevJump = false;
  private prevInteract = false;

  attach() {
    this.prevJump = false;
    this.prevInteract = false;
    this.keys.clear();
    this.injected = [];
    const down = (e: KeyboardEvent) => {
      if (e.repeat) {
        if (GAME_CODES.has(e.code)) e.preventDefault();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      this.keys.add(e.code);
      if (e.code === "KeyC") this.gate?.setHeld(true);
      if (GAME_CODES.has(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      if (e.code === "KeyC") this.gate?.setHeld(false);
    };
    const clear = () => {
      this.keys.clear();
      this.gate?.setHeld(false);
    };
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
    this.gate?.setHeld(codes.includes("KeyC"));
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
    const jump = jumpHeld && !this.prevJump;
    const interactHeld = this.interactTap || held("KeyE") || held("KeyF");
    const interact = interactHeld && !this.prevInteract;
    const stickMag = Math.hypot(this.stickX, this.stickY);
    let padSprint = false;
    let padMag = 0;
    if (pad && pad.mapping === "standard") {
      padSprint = Boolean(pad.buttons[10]?.pressed);
      padMag = Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    }
    const sprint =
      held("ShiftLeft") ||
      held("ShiftRight") ||
      stickMag >= STICK_SPRINT ||
      padSprint ||
      padMag >= 0.88;
    this.prevJump = jumpHeld;
    this.prevInteract = interactHeld;
    this.jumpTap = false;
    this.interactTap = false;
    return {
      moveX: mx,
      moveY: my,
      jump,
      crouchHeld: this.crouchHold || padCrouch || held("KeyC"),
      interact,
      sprint,
    };
  }
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getPitch?: () => number;
      setPitch?: (v: number) => void;
      setLook?: (yaw: number, pitch: number) => void;
      getLookSpeed?: () => number;
      applyLook?: (dx: number, dy: number) => void;
      getSpeed: () => number;
      getSprinting?: () => boolean;
      getPos?: () => [number, number, number];
      getEye?: () => number;
      getCrouch?: () => boolean;
      getProne?: () => boolean;
      setCrouchHeld?: (v: boolean) => void;
      setKeys?: (codes: string[]) => void;
      setStick?: (x: number, y: number) => void;
      setSteer?: (v: number) => void;
      setFirstPerson?: (on: boolean, view?: "observe" | "body") => void;
      warp?: (x: number, y: number, z: number) => void;
      interact?: () => void;
      getDebug?: () => Record<string, unknown>;
    };
  }
}
