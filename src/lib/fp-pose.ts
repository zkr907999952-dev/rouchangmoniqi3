/** Shared first-person locomotion written every frame; figure/camera read it. */

export type FpViewMode = "observe" | "body";

export const fpLive = {
  active: false,
  view: "observe" as FpViewMode,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  crouched: false,
  prone: false,
  eyeX: 0,
  eyeY: 1.48,
  eyeZ: 0.22,
  chestX: 0,
  chestY: 1.12,
  chestZ: 0.12,
  headReady: false,
  moveFwd: 0,
  moveSide: 0,
  speedMps: 1.65,
  stepDist: 0,
  grounded: true,
  airTime: 0,
  velY: 0,
};
