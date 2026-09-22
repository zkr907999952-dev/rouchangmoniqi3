/** Arcade-sim hybrid vehicles on the city MeshBVH (GTA / racing / 6DOF flight). */

import * as THREE from "three";
import { useStudio } from "@/lib/studio-store";
import { fpLive } from "@/lib/fp-pose";
import {
  cityLowestSurface,
  cityIsOutdoors,
  cityMoveCapsule,
  cityRayDown,
  cityRayHit,
  citySurfaceAt,
  getAirportSpawn,
  getAirportPlaneSpawns,
  getCityRuntime,
  getCitySpawn,
  sampleRoadPoints,
} from "@/lib/world-map";

export type VehKind = "car" | "plane";

export type VehInput = {
  throttle: number;
  steer: number;
  pitch: number;
  roll: number;
  yaw: number;
  nitro: boolean;
  handbrake: boolean;
  thrustUp: boolean;
  thrustDown: boolean;
  thrustSlider: number | null;
  mapOpen: boolean;
  gearToggle: boolean;
};

export type Vehicle = {
  id: string;
  kind: VehKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  fx: number;
  fy: number;
  fz: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  speed: number;
  lat: number;
  vx: number;
  vy: number;
  vz: number;
  thrust: number;
  nitro: number;
  steerAngle: number;
  wheelSpin: number;
  susp: number[];
  suspVel: number[];
  visPitch: number;
  visRoll: number;
  pitchRate: number;
  rollRate: number;
  ctrlPitch: number;
  ctrlRoll: number;
  ctrlYaw: number;
  speedBrake: number;
  gear: number;
  door: number;
  doorTarget: number;
  occupyPhase: number;
  occupied: boolean;
  airborne: boolean;
  gearManual: boolean;
  gearWant: number;
  halfL: number;
  halfW: number;
  height: number;
  wheelR: number;
  originY: number;
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  wheels: { x: number; y: number; z: number; steer: boolean }[];
};

export const vehLive = {
  ready: false,
  inVehicle: false,
  id: "",
  kind: "car" as VehKind,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  fx: 0,
  fy: 0,
  fz: -1,
  rx: 1,
  ry: 0,
  rz: 0,
  ux: 0,
  uy: 1,
  uz: 0,
  visPitch: 0,
  visRoll: 0,
  speed: 0,
  thrust: 0,
  nitro: false,
  drifting: false,
  gear: 1,
  door: 0,
  airborne: false,
  camDist: 7.4,
  camHeight: 2.2,
  eyeX: -0.38,
  eyeY: 0.42,
  eyeZ: 0.22,
  steerIn: 0,
  hint: "",
  vehicles: [] as Vehicle[],
  snapYaw: null as number | null,
};

const CAR_ACCEL = 24;
const CAR_BRAKE = 38;
const CAR_REV = 13;
const CAR_MAX = 38;
const CAR_NITRO = 56;
const CAR_DRAG = 0.38;
const CAR_TURN = 1.85;
const CAR_GRIP = 11.5;
const CAR_DRIFT_GRIP = 1.7;
const CAR_MASS = 1420;
const CAR_G = 22;
const SPRING_K = 64000;
const DAMPER_C = 5400;
const I_PITCH = 2200;
const I_ROLL = 900;
const PLANE_THRUST_RATE = 0.62;
export const PLANE_TAKEOFF = 36;
export const PLANE_TAKEOFF_KMH = Math.round(PLANE_TAKEOFF * 3.6);
export const PLANE_CRUISE = 0.8;
export const PLANE_MAX = 468;
const PLANE_TAXI = 52;
const PLANE_THRUST = 72;
const PLANE_LIFT_K = 0.00115;
const PLANE_DRAG = 0.048;
const GRAV = 18.5;
const SUSP_TRAVEL = 0.32;

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qDelta = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();

let hudClock = 0;
let doorTimer = 0;

export function getVehicles() {
  return vehLive.vehicles;
}

export function getOccupied(): Vehicle | null {
  if (!vehLive.inVehicle) return null;
  return vehLive.vehicles.find((v) => v.id === vehLive.id) ?? null;
}

export function nearestVehicle(x: number, y: number, z: number): Vehicle | null {
  let best: Vehicle | null = null;
  let bestD = 1e9;
  for (const v of vehLive.vehicles) {
    if (v.occupied) continue;
    const r = v.kind === "plane" ? 8.4 : 4.2;
    const dx = x - v.x;
    const dz = z - v.z;
    const dy = y - v.y;
    const d = dx * dx + dz * dz + dy * dy * 0.25;
    if (d < r * r && d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

export function resetVehicles() {
  for (const v of vehLive.vehicles) {
    v.occupied = false;
    v.doorTarget = 0;
    v.occupyPhase = 0;
    v.speed = 0;
    v.lat = 0;
    v.vx = 0;
    v.vy = 0;
    v.vz = 0;
    v.nitro = 0;
    v.pitch = 0;
    v.roll = 0;
    v.pitchRate = 0;
    v.rollRate = 0;
    v.airborne = false;
    writeQuatFromEuler(v);
    updateBasis(v);
  }
  vehLive.inVehicle = false;
  vehLive.id = "";
  vehLive.hint = "";
  useStudio.setState({ inVehicle: false, vehicleKind: null });
}

export function tryEnterVehicle(x: number, y: number, z: number): boolean {
  if (vehLive.inVehicle) return false;
  const v = nearestVehicle(x, y, z);
  if (!v) return false;
  v.occupied = true;
  v.doorTarget = 1;
  v.occupyPhase = 1;
  doorTimer = 0.72;
  vehLive.inVehicle = true;
  vehLive.id = v.id;
  vehLive.kind = v.kind;
  vehLive.snapYaw = v.yaw;
  useStudio.setState({
    inVehicle: true,
    vehicleKind: v.kind,
    fpCrouch: false,
    fpProne: false,
    fpCrouchHeld: false,
    portalHint: "",
  });
  return true;
}

export function tryExitVehicle(): boolean {
  const v = getOccupied();
  if (!v) return false;
  if (v.occupyPhase < 0) return true;
  v.doorTarget = 1;
  v.occupyPhase = -1;
  doorTimer = 0.52;
  return true;
}

function finishExit(v: Vehicle) {
  const side = v.kind === "plane" ? 4.4 : 2.15;
  let x = v.x - v.rx * side;
  let z = v.z - v.rz * side;
  const y = cityLowestSurface(x, z, -2, 16);
  const pushed = cityMoveCapsule(x, y, z, 0.3, 1.64, 0, 0, 0, true);
  x = pushed.x;
  z = pushed.z;
  v.occupied = false;
  v.occupyPhase = 0;
  v.doorTarget = 0;
  v.speed *= 0.35;
  v.lat = 0;
  vehLive.inVehicle = false;
  vehLive.id = "";
  useStudio.setState({ inVehicle: false, vehicleKind: null });
  useStudio.getState().warpFp(x, pushed.y, z);
  fpLive.x = x;
  fpLive.y = pushed.y;
  fpLive.z = z;
  fpLive.yaw = v.yaw + Math.PI * 0.5;
}

export function approachVehicle(kind?: VehKind): { x: number; y: number; z: number; id: string; kind: VehKind } | null {
  const v = kind ? vehLive.vehicles.find((o) => o.kind === kind) : vehLive.vehicles[0];
  if (!v) return null;
  const side = v.kind === "plane" ? 4.6 : 2.4;
  const x = v.x - v.rx * side;
  const z = v.z - v.rz * side;
  const y = cityLowestSurface(x, z, -2, 16);
  return { x, y, z, id: v.id, kind: v.kind };
}

export function spawnVehicles() {
  const rt = getCityRuntime();
  if (!rt.ready) return;
  vehLive.vehicles = [];
  const sp = getCitySpawn();
  const avoid = [{ x: sp.x, z: sp.z, r: 6 }];
  const near: { x: number; y: number; z: number; yaw: number }[] = [];
  const rings: [number, number][] = [
    [8.4, 3.2],
    [10.2, -3.6],
    [-8.8, 4.4],
    [4.6, 9.5],
    [-6.5, -8.2],
    [22.5, 6.2],
    [-20.8, 5.4],
    [8.2, 21.5],
  ];
  for (const [dx, dz] of rings) {
    const x = sp.x + dx;
    const z = sp.z + dz;
    const y = cityIsOutdoors(x, z);
    if (y == null) continue;
    const yaw = Math.atan2(sp.x - x, sp.z - z);
    near.push({ x, y, z, yaw });
    avoid.push({ x, z, r: 8 });
    if (near.length >= 2) break;
  }
  const extra = sampleRoadPoints(4, avoid);
  const carSpawns = [...near, ...extra].slice(0, 6);
  if (!carSpawns.length) {
    carSpawns.push({ x: sp.x + 6.5, y: sp.y, z: sp.z + 1.4, yaw: 0 });
  }
  carSpawns.forEach((p, i) => {
    vehLive.vehicles.push(makeCar(`car-${i}`, p.x, p.y, p.z, p.yaw));
  });
  const planes = getAirportPlaneSpawns();
  if (planes.length) {
    planes.forEach((p, i) => {
      vehLive.vehicles.push(makePlane(`plane-${i}`, p.x, p.y, p.z, p.yaw));
    });
  } else {
    const x = sp.x + 80;
    const z = sp.z - 40;
    vehLive.vehicles.push(makePlane("plane-0", x, cityLowestSurface(x, z, -2, 16), z, -Math.PI / 2));
  }
  vehLive.ready = true;
}

let spawnSeq = 0;
let gearKeyPrev = false;

export function spawnVehicleInFront(kind: VehKind) {
  const yaw = fpLive.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let dist = kind === "plane" ? 18 : 7.4;
  let x = fpLive.x + fx * dist;
  let z = fpLive.z + fz * dist;
  const minD = kind === "plane" ? 22 : 9;
  for (let i = 0; i < 8; i++) {
    const hit = vehLive.vehicles.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < minD * minD);
    if (!hit) break;
    dist += kind === "plane" ? 8 : 4;
    x = fpLive.x + fx * dist;
    z = fpLive.z + fz * dist;
  }
  const y = cityLowestSurface(x, z, -2, 20);
  spawnSeq += 1;
  const id = `${kind}-user-${spawnSeq}`;
  const v = kind === "car" ? makeCar(id, x, y, z, yaw) : makePlane(id, x, y, z, yaw);
  vehLive.vehicles.push(v);
  vehLive.ready = true;
  return v;
}

function blankMotion(): Pick<
  Vehicle,
  | "pitch"
  | "roll"
  | "qx"
  | "qy"
  | "qz"
  | "qw"
  | "fx"
  | "fy"
  | "fz"
  | "rx"
  | "ry"
  | "rz"
  | "ux"
  | "uy"
  | "uz"
  | "speed"
  | "lat"
  | "vx"
  | "vy"
  | "vz"
  | "thrust"
  | "nitro"
  | "steerAngle"
  | "wheelSpin"
  | "susp"
  | "suspVel"
  | "visPitch"
  | "visRoll"
  | "pitchRate"
  | "rollRate"
  | "ctrlPitch"
  | "ctrlRoll"
  | "ctrlYaw"
  | "speedBrake"
  | "gear"
  | "door"
  | "doorTarget"
  | "occupyPhase"
  | "occupied"
  | "airborne"
  | "gearManual"
  | "gearWant"
> {
  return {
    pitch: 0,
    roll: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    fx: 0,
    fy: 0,
    fz: -1,
    rx: 1,
    ry: 0,
    rz: 0,
    ux: 0,
    uy: 1,
    uz: 0,
    speed: 0,
    lat: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    thrust: 0,
    nitro: 0,
    steerAngle: 0,
    wheelSpin: 0,
    susp: [0.5, 0.5, 0.5, 0.5],
    suspVel: [0, 0, 0, 0],
    visPitch: 0,
    visRoll: 0,
    pitchRate: 0,
    rollRate: 0,
    ctrlPitch: 0,
    ctrlRoll: 0,
    ctrlYaw: 0,
    speedBrake: 0,
    gear: 1,
    door: 0,
    doorTarget: 0,
    occupyPhase: 0,
    occupied: false,
    airborne: false,
    gearManual: false,
    gearWant: 1,
  };
}

function makeCar(id: string, x: number, y: number, z: number, yaw: number): Vehicle {
  const v: Vehicle = {
    id,
    kind: "car",
    x,
    y,
    z,
    yaw,
    ...blankMotion(),
    halfL: 2.38,
    halfW: 1.08,
    height: 1.18,
    wheelR: 0.34,
    originY: 0.48,
    eyeX: -0.38,
    eyeY: 0.42,
    eyeZ: 0.22,
    wheels: [
      { x: -0.92, y: 0.34, z: -1.42, steer: true },
      { x: 0.92, y: 0.34, z: -1.42, steer: true },
      { x: -0.95, y: 0.34, z: 1.38, steer: false },
      { x: 0.95, y: 0.34, z: 1.38, steer: false },
    ],
  };
  v.y += v.originY;
  writeQuatFromEuler(v);
  updateBasis(v);
  return v;
}

function makePlane(id: string, x: number, y: number, z: number, yaw: number): Vehicle {
  const v: Vehicle = {
    id,
    kind: "plane",
    x,
    y,
    z,
    yaw,
    ...blankMotion(),
    thrust: 0,
    halfL: 8.6,
    halfW: 2.1,
    height: 2.8,
    wheelR: 0.42,
    originY: 1.32,
    eyeX: 0,
    eyeY: 1.28,
    eyeZ: -5.15,
    wheels: [
      { x: 0, y: 0.42, z: -4.1, steer: true },
      { x: -1.85, y: 0.42, z: 1.4, steer: false },
      { x: 1.85, y: 0.42, z: 1.4, steer: false },
    ],
  };
  v.y += v.originY;
  writeQuatFromEuler(v);
  updateBasis(v);
  return v;
}

export function applyWheelLayout(
  id: string,
  wheels: { x: number; y: number; z: number; steer: boolean }[],
  halfL: number,
  halfW: number,
  height: number,
  wheelR: number,
) {
  const v = vehLive.vehicles.find((o) => o.id === id);
  if (!v) return;
  v.wheels = wheels;
  v.halfL = halfL;
  v.halfW = halfW;
  v.height = height;
  v.wheelR = wheelR;
}

export function applyCockpit(id: string, eye: { x: number; y: number; z: number }, originY?: number) {
  const v = vehLive.vehicles.find((o) => o.id === id);
  if (!v) return;
  v.eyeX = eye.x;
  v.eyeY = eye.y;
  v.eyeZ = eye.z;
  if (originY != null && Number.isFinite(originY)) v.originY = originY;
}

function writeQuatFromEuler(v: Vehicle) {
  _eul.set(v.pitch, v.yaw, v.roll, "YXZ");
  _q.setFromEuler(_eul);
  v.qx = _q.x;
  v.qy = _q.y;
  v.qz = _q.z;
  v.qw = _q.w;
}

function readEulerFromQuat(v: Vehicle) {
  _q.set(v.qx, v.qy, v.qz, v.qw);
  _eul.setFromQuaternion(_q, "YXZ");
  v.pitch = _eul.x;
  v.yaw = _eul.y;
  v.roll = _eul.z;
}

function updateBasis(v: Vehicle) {
  _q.set(v.qx, v.qy, v.qz, v.qw);
  _fwd.set(0, 0, -1).applyQuaternion(_q);
  _up.set(0, 1, 0).applyQuaternion(_q);
  _right.set(1, 0, 0).applyQuaternion(_q);
  v.fx = _fwd.x;
  v.fy = _fwd.y;
  v.fz = _fwd.z;
  v.ux = _up.x;
  v.uy = _up.y;
  v.uz = _up.z;
  v.rx = _right.x;
  v.ry = _right.y;
  v.rz = _right.z;
}

function applyLocalRates(v: Vehicle, pitchRate: number, yawRate: number, rollRate: number, dt: number) {
  _q.set(v.qx, v.qy, v.qz, v.qw);
  _eul.set(pitchRate * dt, yawRate * dt, rollRate * dt, "YXZ");
  _qDelta.setFromEuler(_eul);
  _q.multiply(_qDelta);
  _q.normalize();
  v.qx = _q.x;
  v.qy = _q.y;
  v.qz = _q.z;
  v.qw = _q.w;
  readEulerFromQuat(v);
  updateBasis(v);
}

function bodyPoint(v: Vehicle, lx: number, ly: number, lz: number, out: THREE.Vector3) {
  out.set(
    v.x + v.rx * lx + v.ux * ly - v.fx * lz,
    v.y + v.ry * lx + v.uy * ly - v.fy * lz,
    v.z + v.rz * lx + v.uz * ly - v.fz * lz,
  );
  return out;
}

function hullPoints(v: Vehicle): [number, number, number][] {
  const hl = v.halfL;
  const hw = v.halfW;
  if (v.kind === "plane") {
    return [
      [0, 0.15, -hl * 0.92],
      [0, 0.05, -hl * 0.55],
      [0, 0.2, 0],
      [0, 0.15, hl * 0.42],
      [0, 0.35, hl * 0.78],
      [-hw * 2.55, 0.08, -hl * 0.08],
      [hw * 2.55, 0.08, -hl * 0.08],
      [-hw * 1.4, 0.05, hl * 0.12],
      [hw * 1.4, 0.05, hl * 0.12],
      [0, 0.85, -hl * 0.22],
      [0, -0.35, -hl * 0.4],
    ];
  }
  return [
    [0, 0.12, -hl * 0.95],
    [0, 0.18, hl * 0.92],
    [-hw * 0.92, 0.08, -hl * 0.62],
    [hw * 0.92, 0.08, -hl * 0.62],
    [-hw * 0.92, 0.08, hl * 0.55],
    [hw * 0.92, 0.08, hl * 0.55],
    [-hw * 0.88, 0.22, 0],
    [hw * 0.88, 0.22, 0],
    [0, 0.52, -hl * 0.15],
    [0, 0.48, hl * 0.2],
    [0, -0.22, 0],
  ];
}

function groundY(x: number, fromY: number, z: number, span: number) {
  const hit = cityRayDown(x, fromY, z, span);
  if (hit != null) return hit;
  return citySurfaceAt(x, z);
}

function sweptMove(v: Vehicle, dx: number, dy: number, dz: number) {
  const dist = Math.hypot(dx, dy, dz);
  const skin = v.kind === "plane" ? 0.55 : 0.28;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let tHit = 1;
  if (dist > 1e-5) {
    const inv = 1 / dist;
    const dirx = dx * inv;
    const diry = dy * inv;
    const dirz = dz * inv;
    _dir.set(dirx, diry, dirz);
    const pts = hullPoints(v);
    for (const [lx, ly, lz] of pts) {
      bodyPoint(v, lx, ly, lz, _origin);
      const hit = cityRayHit(_origin, _dir, dist + skin + 0.15);
      if (!hit) continue;
      const t = (hit.dist - skin) / dist;
      if (t < tHit) {
        tHit = t;
        nx = hit.nx;
        ny = hit.ny;
        nz = hit.nz;
      }
    }
  }
  const use = THREE.MathUtils.clamp(tHit, 0, 1);
  v.x += dx * use;
  v.y += dy * use;
  v.z += dz * use;
  let blocked = tHit < 0.995;
  if (blocked && dist > 1e-5) {
    const rem = 1 - use;
    let sdx = dx * rem;
    let sdy = dy * rem;
    let sdz = dz * rem;
    const vn = sdx * nx + sdy * ny + sdz * nz;
    if (vn < 0) {
      sdx -= nx * vn;
      sdy -= ny * vn;
      sdz -= nz * vn;
    }
    v.x += sdx;
    v.y += sdy;
    v.z += sdz;
    const velN = v.vx * nx + v.vy * ny + v.vz * nz;
    if (velN < 0) {
      const bounce = v.kind === "plane" && v.airborne ? 0.18 : 0.02;
      v.vx -= nx * velN * (1 + bounce);
      v.vy -= ny * velN * (1 + bounce);
      v.vz -= nz * velN * (1 + bounce);
      if (velN < -16) {
        v.vx *= 0.45;
        v.vy *= 0.45;
        v.vz *= 0.45;
        v.speed *= 0.45;
      }
    }
    if (v.kind === "car" || !v.airborne) {
      v.speed = v.vx * v.fx + v.vy * v.fy + v.vz * v.fz;
      v.lat = v.vx * v.rx + v.vy * v.ry + v.vz * v.rz;
      if (ny < 0.45) {
        v.speed *= 0.82;
        v.lat *= 0.55;
      }
    }
  }
  const r = v.kind === "plane" ? 1.15 : 0.72;
  const h = v.kind === "plane" ? 1.85 : 0.95;
  const samples =
    v.kind === "plane"
      ? [
          [0, 0],
          [0, -v.halfL * 0.7],
          [0, v.halfL * 0.45],
          [-v.halfW * 2.4, 0.1],
          [v.halfW * 2.4, 0.1],
        ]
      : [
          [0, 0],
          [0, -v.halfL * 0.7],
          [0, v.halfL * 0.62],
          [-v.halfW * 0.75, -v.halfL * 0.2],
          [v.halfW * 0.75, -v.halfL * 0.2],
          [-v.halfW * 0.75, v.halfL * 0.25],
          [v.halfW * 0.75, v.halfL * 0.25],
        ];
  let ax = 0;
  let ay = 0;
  let az = 0;
  const feetY = v.y - v.originY * 0.35;
  for (const [lx, lz] of samples) {
    const ox = v.x + v.rx * lx - v.fx * lz;
    const oz = v.z + v.rz * lx - v.fz * lz;
    const pr = v.kind === "plane" && Math.abs(lx) > v.halfW ? r * 0.5 : r;
    const hit = cityMoveCapsule(ox, feetY, oz, pr, h, 0, 0, 0, false);
    ax += hit.x - ox;
    az += hit.z - oz;
    ay += hit.y - feetY;
  }
  const n = samples.length;
  const px = ax / n;
  const pz = az / n;
  const py = ay / n;
  if (Math.hypot(px, pz) > 0.012) {
    v.x += px;
    v.z += pz;
    blocked = true;
    if (v.kind === "car") {
      v.speed *= 0.88;
      v.lat *= 0.7;
    }
  }
  if (py > 0.04 && (v.kind === "car" || !v.airborne || v.vy < 2)) {
    v.y += py * 0.65;
    if (v.vy < 0) v.vy *= 0.2;
  }
  return blocked;
}

function stepCarSuspension(v: Vehicle, dt: number, throttle: number, brake: boolean) {
  updateBasis(v);
  const travel = Math.max(0.24, SUSP_TRAVEL);
  const attach = 0.1;
  const restLen = v.originY + attach + 0.12;
  let Fy = 0;
  let torquePitch = 0;
  let torqueRoll = 0;
  let hits = 0;
  v.wheels.forEach((w, i) => {
    const ax = v.x + v.rx * w.x + v.ux * attach - v.fx * w.z;
    const ay = v.y + v.ry * w.x + v.uy * attach - v.fy * w.z;
    const az = v.z + v.rz * w.x + v.uz * attach - v.fz * w.z;
    _origin.set(ax, ay, az);
    _dir.set(-v.ux, -v.uy, -v.uz);
    const hit = cityRayHit(_origin, _dir, restLen + travel + 0.4);
    let comp = 0;
    if (hit && hit.ny > 0.32) {
      comp = THREE.MathUtils.clamp(restLen - hit.dist, 0, travel);
      hits++;
    }
    const frac = comp / travel;
    const prev = v.susp[i] ?? 0.4;
    const vel = (frac - prev) / Math.max(dt, 1e-4);
    v.suspVel[i] = vel;
    v.susp[i] = THREE.MathUtils.lerp(prev, frac, 1 - Math.exp(-18 * dt));
    const force = Math.max(0, SPRING_K * comp + DAMPER_C * vel * travel);
    Fy += force;
    torquePitch += force * w.z;
    torqueRoll += force * w.x;
  });
  const transfer = THREE.MathUtils.clamp(throttle, -1, 1) * CAR_MASS * 1.6;
  torquePitch += transfer * 0.9;
  if (brake) torquePitch -= CAR_MASS * 2.2;
  const ay = Fy / CAR_MASS - CAR_G;
  v.vy += ay * dt;
  v.vy *= hits >= 2 ? Math.max(0, 1 - 3.2 * dt) : 1;
  v.y += v.vy * dt;
  v.pitchRate += (-torquePitch / I_PITCH) * dt;
  v.rollRate += (torqueRoll / I_ROLL) * dt;
  v.pitchRate *= Math.max(0, 1 - 6.5 * dt);
  v.rollRate *= Math.max(0, 1 - 7.2 * dt);
  v.pitch += v.pitchRate * dt;
  v.roll += v.rollRate * dt;
  v.pitch = THREE.MathUtils.clamp(v.pitch, -0.38, 0.32);
  v.roll = THREE.MathUtils.clamp(v.roll, -0.42, 0.42);
  if (hits < 2) {
    v.airborne = true;
    v.vy -= CAR_G * 0.35 * dt;
  } else {
    v.airborne = false;
    const gy = groundY(v.x, v.y + 6, v.z, 18);
    const minY = gy + v.originY * 0.62;
    const maxY = gy + v.originY + travel * 0.7;
    if (v.y < minY) {
      v.y = minY;
      if (v.vy < 0) v.vy = 0;
    }
    if (v.y > maxY) v.y = THREE.MathUtils.lerp(v.y, maxY, 0.25);
  }
  v.visPitch = v.pitch;
  v.visRoll = v.roll;
  writeQuatFromEuler(v);
  updateBasis(v);
  return hits;
}

function stepCar(v: Vehicle, dt: number, input: VehInput, driven: boolean) {
  const throttle = driven && !input.mapOpen ? input.throttle : 0;
  const steerIn = driven && !input.mapOpen ? input.steer : 0;
  const nitro = driven && input.nitro;
  const brake = driven && input.handbrake;
  const max = nitro ? CAR_NITRO : CAR_MAX;
  if (throttle > 0.04) {
    v.speed += throttle * (nitro ? CAR_ACCEL * 1.55 : CAR_ACCEL) * dt;
  } else if (throttle < -0.04) {
    if (v.speed > 0.8) v.speed += throttle * CAR_BRAKE * dt;
    else v.speed += throttle * CAR_REV * dt;
  } else {
    v.speed *= Math.max(0, 1 - CAR_DRAG * 1.6 * dt);
  }
  v.speed = THREE.MathUtils.clamp(v.speed, -12, max);
  v.speed *= Math.max(0, 1 - CAR_DRAG * dt);
  if (brake) v.speed *= Math.max(0, 1 - 1.85 * dt);
  const speedF = THREE.MathUtils.clamp(Math.abs(v.speed) / 11, 0, 1);
  const reverse = v.speed >= 0 ? 1 : -1;
  const turn = steerIn * CAR_TURN * (0.22 + 0.78 * speedF) * (1 - Math.abs(v.speed) / (max * 2.4));
  v.yaw += turn * reverse * dt;
  v.steerAngle = THREE.MathUtils.lerp(v.steerAngle, steerIn * 0.55, 1 - Math.exp(-10 * dt));
  const grip = brake ? CAR_DRIFT_GRIP : CAR_GRIP;
  const slide = brake ? 0.62 : 0.2;
  v.lat += -steerIn * Math.abs(v.speed) * slide * dt;
  if (brake && Math.abs(steerIn) > 0.15) v.lat += -steerIn * Math.abs(v.speed) * 0.28 * dt;
  v.lat *= Math.max(0, 1 - grip * dt);
  v.nitro = THREE.MathUtils.lerp(v.nitro, nitro ? 1 : 0, 1 - Math.exp(-8 * dt));
  const fxh = -Math.sin(v.yaw);
  const fzh = -Math.cos(v.yaw);
  const rxh = Math.cos(v.yaw);
  const rzh = -Math.sin(v.yaw);
  writeQuatFromEuler(v);
  updateBasis(v);
  v.vx = fxh * v.speed + rxh * v.lat;
  v.vz = fzh * v.speed + rzh * v.lat;
  sweptMove(v, v.vx * dt, 0, v.vz * dt);
  v.speed = v.vx * fxh + v.vz * fzh;
  v.lat = v.vx * rxh + v.vz * rzh;
  stepCarSuspension(v, dt, throttle, brake);
  v.wheelSpin -= (v.speed / Math.max(0.2, v.wheelR)) * dt;
}

function stepPlane(v: Vehicle, dt: number, input: VehInput, driven: boolean) {
  if (driven && !input.mapOpen) {
    if (input.thrustSlider != null) v.thrust = THREE.MathUtils.clamp(input.thrustSlider, 0, 1);
    else {
      if (input.thrustDown) v.thrust = Math.max(0, v.thrust - PLANE_THRUST_RATE * dt);
      else if (input.thrustUp) v.thrust = Math.min(1, v.thrust + PLANE_THRUST_RATE * dt);
      if (!input.thrustUp && v.thrust > PLANE_CRUISE) {
        v.thrust = Math.max(PLANE_CRUISE, v.thrust - PLANE_THRUST_RATE * 2.4 * dt);
      }
    }
  } else if (!driven) {
    v.thrust = THREE.MathUtils.lerp(v.thrust, 0, dt * 0.4);
  }
  v.nitro = THREE.MathUtils.clamp((v.thrust - PLANE_CRUISE) / (1 - PLANE_CRUISE), 0, 1);
  const gy = groundY(v.x, v.y + 14, v.z, 48);
  const agl = v.y - v.originY - gy;
  const pitchIn = driven && !input.mapOpen ? input.pitch : 0;
  const rollIn = driven && !input.mapOpen ? input.roll : 0;
  const yawIn = driven && !input.mapOpen ? input.yaw : 0;
  const follow = 1 - Math.exp(-14 * dt);
  v.ctrlPitch = THREE.MathUtils.lerp(v.ctrlPitch, pitchIn, follow);
  v.ctrlRoll = THREE.MathUtils.lerp(v.ctrlRoll, rollIn, follow);
  v.ctrlYaw = THREE.MathUtils.lerp(v.ctrlYaw, yawIn, follow);
  const wantBrake = driven && !input.mapOpen && input.thrustDown ? 1 : 0;
  v.speedBrake = THREE.MathUtils.lerp(v.speedBrake, wantBrake, 1 - Math.exp(-10 * dt));
  const gearTap = driven && !input.mapOpen && input.gearToggle && !gearKeyPrev;
  gearKeyPrev = driven && input.gearToggle;
  if (gearTap) {
    v.gearManual = true;
    v.gearWant = v.gear > 0.5 ? 0 : 1;
  }
  if (v.gearManual) {
    const dir = Math.sign(v.gearWant - v.gear);
    if (dir) v.gear = THREE.MathUtils.clamp(v.gear + dir * dt * 1.55, 0, 1);
  } else if (v.airborne) {
    if (agl > 3.4) v.gear = Math.max(0, v.gear - dt * 1.4);
    else if (agl < 2.6 && v.pitch < 0.22 && v.pitch > -0.35) v.gear = Math.min(1, v.gear + dt * 1.6);
  } else {
    v.gear = Math.min(1, v.gear + dt * 2);
  }

  if (v.airborne) {

    const as = Math.max(v.speed, 1);
    const ctrl = THREE.MathUtils.clamp(as / 42, 0.22, 1.55);
    v.pitchRate = pitchIn * 1.45 * ctrl;
    v.rollRate = rollIn * 2.15 * ctrl;
    applyLocalRates(v, v.pitchRate, yawIn * 0.62, v.rollRate, dt);

    const velFwd = v.vx * v.fx + v.vy * v.fy + v.vz * v.fz;
    const velUp = v.vx * v.ux + v.vy * v.uy + v.vz * v.uz;
    const aoa = Math.atan2(-velUp, Math.max(4, velFwd));
    const stall = Math.abs(aoa) > 0.55 ? Math.max(0.12, 1 - (Math.abs(aoa) - 0.55) * 2.4) : 1;
    const liftAcc = GRAV * THREE.MathUtils.clamp(v.speed / 40, 0, 1.22) * (1 + aoa * 1.35) * stall + v.speed * v.speed * PLANE_LIFT_K * aoa;
    const dragAcc = (PLANE_DRAG + 0.045 * aoa * aoa) * v.speed + 0.00016 * v.speed * v.speed;
    const thrustAcc = v.thrust * PLANE_THRUST * (v.thrust > PLANE_CRUISE ? 1.22 : 1);
    const invSpd = 1 / Math.max(v.speed, 1);
    v.vx += (v.fx * thrustAcc + v.ux * liftAcc - v.vx * dragAcc * invSpd) * dt;
    v.vy += (v.fy * thrustAcc + v.uy * liftAcc - v.vy * dragAcc * invSpd - GRAV) * dt;
    v.vz += (v.fz * thrustAcc + v.uz * liftAcc - v.vz * dragAcc * invSpd) * dt;

    const track = 1 - Math.exp(-dt * (0.28 + v.speed * 0.014));
    const spd = Math.hypot(v.vx, v.vy, v.vz);
    v.vx += (v.fx * spd - v.vx) * track * 0.62;
    v.vy += (v.fy * spd - v.vy) * track * 0.62;
    v.vz += (v.fz * spd - v.vz) * track * 0.62;
    v.speed = Math.min(PLANE_MAX, Math.hypot(v.vx, v.vy, v.vz));
    if (v.speed > 1e-3) {
      const s = v.speed / Math.hypot(v.vx, v.vy, v.vz);
      v.vx *= s;
      v.vy *= s;
      v.vz *= s;
    }

    sweptMove(v, v.vx * dt, v.vy * dt, v.vz * dt);
    v.speed = Math.hypot(v.vx, v.vy, v.vz);

    if (agl < 0.7 && v.uy > 0.55 && v.vy <= 6 && Math.abs(v.roll) < 0.85) {
      v.airborne = false;
      v.y = gy + v.originY;
      v.vy = 0;
      v.vx = v.fx * v.speed;
      v.vz = v.fz * v.speed;
      v.pitch *= 0.25;
      v.roll *= 0.12;
      if (!v.gearManual) v.gear = 1;
      writeQuatFromEuler(v);
      updateBasis(v);
    }
    v.visPitch = v.pitch;
    v.visRoll = v.roll;
  } else {
    const steerIn = yawIn;
    const max = PLANE_TAXI * (0.35 + v.thrust * 0.9);
    if (v.thrust > 0.04) v.speed += v.thrust * 24 * dt;
    else v.speed *= Math.max(0, 1 - 0.9 * dt);
    v.speed = THREE.MathUtils.clamp(v.speed, 0, max);
    const speedF = THREE.MathUtils.clamp(Math.abs(v.speed) / 8, 0, 1);
    v.yaw += steerIn * 1.15 * speedF * dt;
    v.steerAngle = THREE.MathUtils.lerp(v.steerAngle, 0, 0.2);
    if (pitchIn > 0.25 && v.speed > PLANE_TAKEOFF * 0.82) {
      v.pitch = THREE.MathUtils.lerp(v.pitch, 0.15, 0.12);
    } else {
      v.pitch = THREE.MathUtils.lerp(v.pitch, 0, 0.2);
    }
    v.roll = THREE.MathUtils.lerp(v.roll, 0, 0.22);
    writeQuatFromEuler(v);
    updateBasis(v);
    v.vx = v.fx * v.speed;
    v.vz = v.fz * v.speed;
    v.vy = 0;
    sweptMove(v, v.vx * dt, 0, v.vz * dt);
    const g2 = groundY(v.x, v.y + 8, v.z, 24);
    v.y = THREE.MathUtils.lerp(v.y, g2 + v.originY, 0.45);
    v.vy = 0;
    if (v.speed > PLANE_TAKEOFF && pitchIn > 0.28 && v.thrust > 0.45) {
      v.airborne = true;
      v.vy = 7.2;
      v.vx = v.fx * v.speed;
      v.vy += v.fy * v.speed * 0.15;
      v.vz = v.fz * v.speed;
      v.pitch = Math.max(v.pitch, 0.16);
      v.y += 0.35;
      writeQuatFromEuler(v);
      updateBasis(v);
    }
    v.wheelSpin += (v.speed / Math.max(0.2, v.wheelR)) * dt;
    v.visPitch = v.pitch;
    v.visRoll = v.roll;
  }
}

function collideVehicles() {
  const vs = vehLive.vehicles;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i]!;
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j]!;
      if (Math.abs(a.y - b.y) > Math.max(a.height, b.height) + 1.4) continue;
      const aLen = a.halfL * (a.kind === "plane" ? 0.82 : 1);
      const bLen = b.halfL * (b.kind === "plane" ? 0.82 : 1);
      const ar = a.kind === "plane" ? a.halfW * 2.15 + 0.7 : a.halfW + 0.32;
      const br = b.kind === "plane" ? b.halfW * 2.15 + 0.7 : b.halfW + 0.32;
      const ta = THREE.MathUtils.clamp((b.x - a.x) * a.fx + (b.z - a.z) * a.fz, -aLen, aLen);
      const tb = THREE.MathUtils.clamp((a.x - b.x) * b.fx + (a.z - b.z) * b.fz, -bLen, bLen);
      const ax = a.x + a.fx * ta;
      const az = a.z + a.fz * ta;
      const bx = b.x + b.fx * tb;
      const bz = b.z + b.fz * tb;
      const dx = bx - ax;
      const dz = bz - az;
      const dist = Math.hypot(dx, dz);
      const min = ar + br;
      if (dist >= min || dist < 1e-5) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const pen = min - dist;
      const aOcc = a.occupied ? 0.28 : 0.5;
      const bOcc = b.occupied ? 0.28 : 0.5;
      const sum = aOcc + bOcc;
      a.x -= nx * pen * (aOcc / sum);
      a.z -= nz * pen * (aOcc / sum);
      b.x += nx * pen * (bOcc / sum);
      b.z += nz * pen * (bOcc / sum);
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) {
        const bounce = 0.18 - rel * 0.04;
        a.vx -= nx * bounce;
        a.vz -= nz * bounce;
        b.vx += nx * bounce;
        b.vz += nz * bounce;
        a.speed = a.vx * a.fx + a.vz * a.fz;
        b.speed = b.vx * b.fx + b.vz * b.fz;
        a.lat = a.vx * a.rx + a.vz * a.rz;
        b.lat = b.vx * b.rx + b.vz * b.rz;
      }
    }
  }
}

export function stepVehicles(dt: number, input: VehInput) {
  if (!vehLive.ready) return;
  const d = Math.min(0.05, Math.max(0.001, dt));
  const occupied = getOccupied();
  for (const v of vehLive.vehicles) {
    const driven = occupied === v;
    v.door += (v.doorTarget - v.door) * (1 - Math.exp(-8 * d));
    if (v.occupyPhase !== 0) {
      doorTimer -= d;
      if (v.occupyPhase > 0 && doorTimer <= 0) v.doorTarget = 0;
      if (v.occupyPhase < 0 && doorTimer <= 0) finishExit(v);
    }
    const spd = Math.hypot(v.speed, v.lat, v.vy);
    const sub = Math.max(1, Math.min(8, Math.ceil((spd * d) / 0.16) || 1));
    const step = d / sub;
    for (let i = 0; i < sub; i++) {
      if (v.kind === "car") stepCar(v, step, input, driven);
      else stepPlane(v, step, input, driven);
    }
  }
  collideVehicles();
  const v = getOccupied();
  if (v) {
    vehLive.x = v.x;
    vehLive.y = v.y;
    vehLive.z = v.z;
    vehLive.yaw = v.yaw;
    vehLive.pitch = v.pitch;
    vehLive.roll = v.roll;
    vehLive.qx = v.qx;
    vehLive.qy = v.qy;
    vehLive.qz = v.qz;
    vehLive.qw = v.qw;
    vehLive.fx = v.fx;
    vehLive.fy = v.fy;
    vehLive.fz = v.fz;
    vehLive.rx = v.rx;
    vehLive.ry = v.ry;
    vehLive.rz = v.rz;
    vehLive.ux = v.ux;
    vehLive.uy = v.uy;
    vehLive.uz = v.uz;
    vehLive.visPitch = v.visPitch;
    vehLive.visRoll = v.visRoll;
    vehLive.speed = v.speed;
    vehLive.thrust = v.thrust;
    vehLive.nitro = v.kind === "plane" ? v.nitro > 0.15 : v.nitro > 0.4;
    vehLive.drifting = v.kind === "car" && input.handbrake && Math.abs(v.speed) > 6;
    vehLive.gear = v.gear;
    vehLive.door = v.door;
    vehLive.airborne = v.airborne;
    vehLive.kind = v.kind;
    vehLive.eyeX = v.eyeX;
    vehLive.eyeY = v.eyeY;
    vehLive.eyeZ = v.eyeZ;
    vehLive.steerIn = input.steer;
    vehLive.camDist = v.kind === "plane" ? 14.8 + Math.min(6.5, Math.abs(v.speed) * 0.02) : 7.3 + Math.min(2.4, Math.abs(v.speed) * 0.04);
    vehLive.camHeight = v.kind === "plane" ? 3.55 : 2.15;
    fpLive.x = v.x;
    fpLive.y = v.y - v.originY * 0.4;
    fpLive.z = v.z;
    fpLive.grounded = !v.airborne;
    fpLive.sprinting = false;
    fpLive.moveFwd = 0;
    fpLive.moveSide = 0;
    fpLive.stepDist = 0;
    fpLive.velY = v.vy;
  }
  hudClock += d;
  if (hudClock > 0.12) {
    hudClock = 0;
    const s = useStudio.getState();
    if (s.inVehicle !== vehLive.inVehicle || Math.abs(s.vehicleSpeed - Math.abs(vehLive.speed) * 3.6) > 0.8 || s.vehicleThrust !== vehLive.thrust) {
      useStudio.setState({
        inVehicle: vehLive.inVehicle,
        vehicleKind: vehLive.inVehicle ? vehLive.kind : null,
        vehicleSpeed: Math.abs(vehLive.speed) * 3.6,
        vehicleThrust: vehLive.thrust,
        vehicleNitro: vehLive.nitro,
        vehicleAirborne: vehLive.airborne,
        vehicleGear: vehLive.gear > 0.5,
      });
    }
  }
}

export function pushPlayerFromVehicles(x: number, y: number, z: number, r: number) {
  let ox = x;
  let oz = z;
  for (const v of vehLive.vehicles) {
    if (v.occupied) continue;
    const dx = ox - v.x;
    const dz = oz - v.z;
    const localX = dx * v.rx + dz * v.rz;
    const localZ = -(dx * v.fx + dz * v.fz);
    const hx = v.halfW + r;
    const hz = v.halfL + r;
    if (Math.abs(localX) > hx || Math.abs(localZ) > hz) continue;
    const feet = v.y - v.originY;
    if (y > feet + v.height + 1.2 || y + 1.6 < feet) continue;
    const px = hx - Math.abs(localX);
    const pz = hz - Math.abs(localZ);
    if (px < pz) {
      const s = Math.sign(localX) || 1;
      ox += v.rx * px * s;
      oz += v.rz * px * s;
    } else {
      const s = Math.sign(localZ) || 1;
      ox += -v.fx * pz * s;
      oz += -v.fz * pz * s;
    }
  }
  return { x: ox, z: oz };
}

export function vehicleHintAt(x: number, y: number, z: number) {
  if (vehLive.inVehicle) return "";
  const v = nearestVehicle(x, y, z);
  if (!v) return "";
  return v.kind === "plane" ? "按 F / 互动 进入战机" : "按 F / 互动 上车";
}
