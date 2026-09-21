import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { loadVehicleModels } from "@/lib/load-models";
import { useStudio } from "@/lib/studio-store";
import { applyCockpit, applyWheelLayout, getVehicles, resetVehicles, spawnVehicles, vehLive } from "@/lib/vehicle-sim";
import { getCityRuntime } from "@/lib/world-map";

type WheelBind = {
  root: THREE.Object3D;
  restPos: THREE.Vector3;
  restQuat: THREE.Quaternion;
  steer: boolean;
  axle: "x" | "z";
  spinSign: number;
  offset: { x: number; y: number; z: number };
};
type PivotKind = "door" | "canopy" | "gear" | "gearDoor" | "aileronL" | "aileronR" | "elevator" | "nozzle" | "nozzleL" | "nozzleR" | "rudder" | "flap";
type PivotBind = {
  obj: THREE.Object3D;
  rest: THREE.Quaternion;
  axis: "x" | "y" | "z";
  sign: number;
  max: number;
  kind?: PivotKind;
};

type ExhaustBits = {
  group: THREE.Group;
  core: THREE.Mesh;
  mid: THREE.Mesh;
  glow: THREE.Mesh;
  diamonds: THREE.Mesh[];
  light: THREE.PointLight;
};

type Contrail = {
  mesh: THREE.Mesh;
  hist: THREE.Vector3[];
  pos: Float32Array;
  col: Float32Array;
  n: number;
};

type Visual = {
  id: string;
  kind: "car" | "plane";
  group: THREE.Group;
  wheels: WheelBind[];
  doors: PivotBind[];
  gears: PivotBind[];
  gearDoors: PivotBind[];
  surfaces: PivotBind[];
  steerWheel: { obj: THREE.Object3D; rest: THREE.Quaternion } | null;
  glow: THREE.PointLight[];
  flapT: number;
  exhausts: ExhaustBits[];
  trails: Contrail[];
};

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _eul = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _scale = new THREE.Vector3();

function findNamed(root: THREE.Object3D, re: RegExp) {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (re.test(o.name)) out.push(o);
  });
  return out;
}

function firstNamed(root: THREE.Object3D, re: RegExp) {
  return findNamed(root, re)[0] ?? null;
}

function markerCenterZ(root: THREE.Object3D, re: RegExp) {
  const obj = firstNamed(root, re);
  if (!obj) return null;
  _box.setFromObject(obj);
  if (_box.isEmpty()) return null;
  return (_box.min.z + _box.max.z) * 0.5;
}

function normalizeFacing(root: THREE.Group, targetLen: number, tailName: RegExp, noseName: RegExp) {
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  if (_box.isEmpty()) return;
  _box.getSize(_size);
  const longest = Math.max(_size.x, _size.y, _size.z);
  if (longest > 0.01) root.scale.multiplyScalar(targetLen / longest);
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getSize(_size);
  if (_size.x > _size.z * 1.12) root.rotation.y += Math.PI / 2;
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getCenter(_center);
  const tailZ = markerCenterZ(root, tailName);
  const noseZ = markerCenterZ(root, noseName);
  let flip = false;
  if (noseZ != null) flip = noseZ > _center.z;
  else if (tailZ != null) flip = tailZ < _center.z;
  if (flip) root.rotation.y += Math.PI;
  root.userData.faceDbg = { tailZ, noseZ, centerZ: _center.z, flip };
  root.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getCenter(_center);
  root.position.x -= _center.x;
  root.position.y -= _box.min.y;
  root.position.z -= _center.z;
  root.updateMatrixWorld(true);
}

function liftOrigin(wrap: THREE.Group, originY: number) {
  wrap.updateMatrixWorld(true);
  for (const ch of wrap.children) ch.position.y -= originY;
  wrap.updateMatrixWorld(true);
}

function localPoint(wrap: THREE.Object3D, world: THREE.Vector3) {
  return wrap.worldToLocal(world.clone());
}

function measureCarCockpit(wrap: THREE.Group, originY: number) {
  wrap.updateMatrixWorld(true);
  const wheel = firstNamed(wrap, /^Steering_wheel$/);
  const seat = firstNamed(wrap, /^Seat$/);
  let x = -0.34;
  let y = 1.08;
  let z = 0.08;
  let wheelP: THREE.Vector3 | null = null;
  if (wheel) {
    _box.setFromObject(wheel);
    _box.getCenter(_center);
    wheelP = localPoint(wrap, _center);
    x = wheelP.x;
    y = wheelP.y + 0.12;
    z = wheelP.z + 0.2;
  }
  if (seat) {
    _box.setFromObject(seat);
    const midY = (_box.min.y + _box.max.y) * 0.5;
    const top = localPoint(wrap, new THREE.Vector3((_box.min.x + _box.max.x) * 0.5, midY, (_box.min.z + _box.max.z) * 0.5));
    y = Math.min(y, top.y + 0.28);
    if (wheelP) z = THREE.MathUtils.lerp(wheelP.z + 0.18, top.z, 0.38);
    else z = top.z + 0.06;
  }
  return { x, y: THREE.MathUtils.clamp(y - originY, 0.5, 0.7), z };
}

function measurePlaneCockpit(wrap: THREE.Group, originY: number) {
  wrap.updateMatrixWorld(true);
  const stick = firstNamed(wrap, /steeringwheel/);
  const canopy = firstNamed(wrap, /^door_dside_f/) ?? firstNamed(wrap, /^window_lf/);
  let x = 0;
  let y = 2.58;
  let z = -6.05;
  if (stick) {
    _box.setFromObject(stick);
    _box.getCenter(_center);
    const p = localPoint(wrap, _center);
    x = p.x * 0.2;
    y = p.y + 0.42;
    z = p.z + 0.4;
  }
  if (canopy) {
    _box.setFromObject(canopy);
    const min = localPoint(wrap, _box.min.clone());
    const max = localPoint(wrap, _box.max.clone());
    const y0 = Math.min(min.y, max.y);
    const y1 = Math.max(min.y, max.y);
    const z0 = Math.min(min.z, max.z);
    const z1 = Math.max(min.z, max.z);
    y = THREE.MathUtils.clamp(y, y0 + (y1 - y0) * 0.42, y1 - 0.16);
    z = THREE.MathUtils.clamp(z, z0 + 0.7, z1 - 0.45);
  }
  return { x, y: y - originY + 0.16, z };
}

function localThinAxis(obj: THREE.Object3D): "x" | "y" | "z" {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 280));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      mesh.localToWorld(v);
      obj.worldToLocal(v);
      box.expandByPoint(v);
    }
  });
  if (box.isEmpty()) return "z";
  box.getSize(_size);
  if (_size.x <= _size.y && _size.x <= _size.z) return "x";
  if (_size.y <= _size.x && _size.y <= _size.z) return "y";
  return "z";
}

function makeGlass(root: THREE.Object3D, re: RegExp, opacity: number) {
  const meshes = new Set<THREE.Mesh>();
  for (const node of findNamed(root, re)) {
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) meshes.add(mesh);
    });
  }
  for (const mesh of meshes) {
    if (/headlight|taillight|tail_light|daylight/i.test(mesh.name)) continue;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((raw) => {
      const src = (raw as THREE.MeshStandardMaterial).clone();
      src.transparent = true;
      src.opacity = opacity;
      src.depthWrite = false;
      src.side = THREE.DoubleSide;
      src.alphaTest = 0;
      if ("metalness" in src) src.metalness = 0.02;
      if ("roughness" in src) src.roughness = 0.06;
      if ("envMapIntensity" in src) src.envMapIntensity = 0.55;
      if (src.map) src.map = null;
      src.color.setHex(0x8ec4e6);
      src.needsUpdate = true;
      return src;
    });
    mesh.material = next.length === 1 ? next[0]! : next;
  }
}

function mountWheels(wrap: THREE.Group, nameRe: RegExp): WheelBind[] {
  wrap.updateMatrixWorld(true);
  const objs = findNamed(wrap, nameRe).filter((o) => !/_hub$/i.test(o.name) && !o.name.includes("Hub"));
  const wheels: WheelBind[] = [];
  for (const obj of objs) {
    if (obj.parent && /^WheelHub/.test(obj.parent.name)) continue;
    const worldPos = obj.getWorldPosition(new THREE.Vector3());
    _box.setFromObject(obj);
    _box.getSize(_size);
    const axle: "x" | "z" = _size.x <= _size.z ? "x" : "z";
    obj.getWorldScale(_scale);
    const spinSign = Math.sign(_scale.x) || 1;
    const hub = new THREE.Group();
    hub.name = `WheelHub_${obj.name}`;
    wrap.add(hub);
    wrap.worldToLocal(_p.copy(worldPos));
    hub.position.copy(_p);
    hub.quaternion.identity();
    hub.scale.set(1, 1, 1);
    wrap.attach(obj);
    hub.attach(obj);
    const off = hub.position.clone();
    const steer = off.z < 0;
    hub.userData.steer = steer;
    hub.userData.axle = axle;
    hub.userData.spinSign = spinSign;
    hub.userData.offset = { x: off.x, y: off.y, z: off.z };
    wheels.push({
      root: hub,
      restPos: hub.position.clone(),
      restQuat: hub.quaternion.clone(),
      steer,
      axle,
      spinSign,
      offset: { x: off.x, y: off.y, z: off.z },
    });
  }
  wheels.sort((a, b) => a.offset.z - b.offset.z || a.offset.x - b.offset.x);
  return wheels;
}

function collectHubs(wrap: THREE.Group): WheelBind[] {
  const hubs = findNamed(wrap, /^WheelHub_/);
  return hubs.map((hub) => {
    const stored = hub.userData.offset as { x: number; y: number; z: number } | undefined;
    const offset = stored ?? { x: hub.position.x, y: hub.position.y, z: hub.position.z };
    return {
      root: hub,
      restPos: hub.position.clone(),
      restQuat: hub.quaternion.clone(),
      steer: Boolean(hub.userData.steer) || offset.z < 0,
      axle: (hub.userData.axle as "x" | "z") || "x",
      spinSign: typeof hub.userData.spinSign === "number" ? hub.userData.spinSign : 1,
      offset,
    };
  });
}

function worldAabb(obj: THREE.Object3D) {
  _box.setFromObject(obj);
  return {
    minX: _box.min.x,
    minY: _box.min.y,
    minZ: _box.min.z,
    maxX: _box.max.x,
    maxY: _box.max.y,
    maxZ: _box.max.z,
    cx: (_box.min.x + _box.max.x) * 0.5,
    cy: (_box.min.y + _box.max.y) * 0.5,
    cz: (_box.min.z + _box.max.z) * 0.5,
  };
}

function mountHinge(
  wrap: THREE.Group,
  obj: THREE.Object3D,
  hinge: { x: number; y: number; z: number },
  axis: "x" | "y" | "z",
  sign: number,
  max: number,
  kind: PivotKind,
  extras: THREE.Object3D[] = [],
): PivotBind {
  const hub = new THREE.Group();
  hub.name = `Hinge_${kind}_${obj.name}`;
  wrap.add(hub);
  hub.position.set(hinge.x, hinge.y, hinge.z);
  hub.quaternion.identity();
  hub.scale.set(1, 1, 1);
  wrap.updateMatrixWorld(true);
  wrap.attach(obj);
  hub.attach(obj);
  for (const ex of extras) {
    if (!ex || ex === obj) continue;
    wrap.attach(ex);
    hub.attach(ex);
  }
  hub.userData.axis = axis;
  hub.userData.sign = sign;
  hub.userData.max = max;
  hub.userData.kind = kind;
  return { obj: hub, rest: hub.quaternion.clone(), axis, sign, max, kind };
}

function applyPivot(b: PivotBind, t: number) {
  _eul.set(0, 0, 0, "XYZ");
  const a = b.sign * b.max * THREE.MathUtils.clamp(t, -1, 1);
  if (b.axis === "x") _eul.x = a;
  if (b.axis === "y") _eul.y = a;
  if (b.axis === "z") _eul.z = a;
  _q.setFromEuler(_eul);
  b.obj.quaternion.copy(b.rest).multiply(_q);
}

type DoorVol = { xAbs: number; minY: number; maxY: number; minZ: number; maxZ: number };

function splitTriangles(
  mesh: THREE.Mesh,
  wrap: THREE.Object3D,
  pred: (x: number, y: number, z: number) => boolean,
): THREE.BufferGeometry | null {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = src.getAttribute("position");
  if (!pos) return null;
  mesh.updateMatrixWorld(true);
  wrap.updateMatrixWorld(true);
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let k = 0; k < 3; k++) {
      _p.fromBufferAttribute(pos as THREE.BufferAttribute, i + k);
      mesh.localToWorld(_p);
      wrap.worldToLocal(_p);
      sx += _p.x;
      sy += _p.y;
      sz += _p.z;
    }
    if (pred(sx / 3, sy / 3, sz / 3)) keep.push(i, i + 1, i + 2);
  }
  if (keep.length < 24) return null;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const attr = src.getAttribute(name) as THREE.BufferAttribute;
    const dim = attr.itemSize;
    const data = new Float32Array(keep.length * dim);
    let o = 0;
    for (const vi of keep) {
      for (let k = 0; k < dim; k++) data[o++] = attr.array[vi * dim + k] as number;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, dim));
  }
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}

function makeHalfMesh(mesh: THREE.Mesh, geo: THREE.BufferGeometry, side: "L" | "R") {
  const half = new THREE.Mesh(geo, mesh.material);
  half.castShadow = false;
  half.receiveShadow = false;
  half.name = `${mesh.name}_${side}`;
  mesh.updateMatrixWorld(true);
  half.quaternion.copy(mesh.getWorldQuaternion(_q));
  half.position.copy(mesh.getWorldPosition(_center));
  half.scale.copy(mesh.getWorldScale(_size));
  return half;
}

function punchMesh(mesh: THREE.Mesh, wrap: THREE.Object3D, drop: (x: number, y: number, z: number) => boolean) {
  const kept = splitTriangles(mesh, wrap, (x, y, z) => !drop(x, y, z));
  if (!kept) return;
  const old = mesh.geometry;
  mesh.geometry = kept;
  if (old !== mesh.geometry) {
    /* original stays GPU-resident if shared; leave it */
  }
}

function makeScissorDoors(wrap: THREE.Group): PivotBind[] {
  wrap.updateMatrixWorld(true);
  const interior = firstNamed(wrap, /^Interior_doors$/);
  const extras: THREE.Object3D[] = [];
  for (const re of [/^Right&Left_windows$/, /^Right&Left_window_2$/, /^Mirrors$/]) {
    const o = firstNamed(wrap, re);
    if (o) extras.push(o);
  }
  const hood = firstNamed(wrap, /Hood075_Body_0$/) ?? firstNamed(wrap, /^Hood075$/);
  let vol: DoorVol = { xAbs: 0.52, minY: 0.14, maxY: 0.92, minZ: -1.02, maxZ: 0.42 };
  if (interior) {
    _box.setFromObject(interior);
    if (!_box.isEmpty()) {
      vol = {
        xAbs: Math.max(0.48, Math.min(Math.abs(_box.min.x), Math.abs(_box.max.x)) * 0.58),
        minY: _box.min.y - 0.05,
        maxY: _box.max.y + 0.14,
        minZ: _box.min.z - 0.06,
        maxZ: _box.max.z + 0.1,
      };
    }
  }
  const inDoor = (x: number, y: number, z: number) =>
    Math.abs(x) >= vol.xAbs && y >= vol.minY && y <= vol.maxY && z >= vol.minZ && z <= vol.maxZ;
  const sources = [interior, ...extras].filter(Boolean) as THREE.Object3D[];
  const out: PivotBind[] = [];
  for (const side of ["L", "R"] as const) {
    const pivot = new THREE.Group();
    pivot.name = `Scissor_${side}`;
    wrap.add(pivot);
    const made: THREE.Mesh[] = [];
    const sidePred = (x: number, y: number, z: number) => inDoor(x, y, z) && (side === "L" ? x < 0 : x >= 0);
    for (const src of sources) {
      const meshes: THREE.Mesh[] = [];
      src.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) meshes.push(m);
      });
      for (const mesh of meshes) {
        const geo = splitTriangles(mesh, wrap, sidePred);
        if (!geo) continue;
        const half = makeHalfMesh(mesh, geo, side);
        wrap.attach(half);
        made.push(half);
      }
    }
    if (hood) {
      const meshes: THREE.Mesh[] = [];
      hood.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) meshes.push(m);
      });
      for (const mesh of meshes) {
        const geo = splitTriangles(mesh, wrap, sidePred);
        if (!geo) continue;
        const half = makeHalfMesh(mesh, geo, side);
        wrap.attach(half);
        made.push(half);
      }
    }
    if (!made.length) {
      wrap.remove(pivot);
      continue;
    }
    _box.makeEmpty();
    for (const m of made) _box.expandByObject(m);
    const outerX = side === "L" ? _box.min.x : _box.max.x;
    const hx = outerX * 0.72;
    const hy = _box.max.y - 0.02;
    const hz = _box.min.z + 0.08;
    pivot.position.set(hx, hy, hz);
    wrap.updateMatrixWorld(true);
    for (const half of made) pivot.attach(half);
    const sign = side === "L" ? -1 : 1;
    pivot.userData.axis = "z";
    pivot.userData.sign = sign;
    pivot.userData.max = 1.35;
    out.push({ obj: pivot, rest: pivot.quaternion.clone(), axis: "z", sign, max: 1.35, kind: "door" });
  }
  if (out.length) {
    for (const src of sources) src.visible = false;
    if (hood) {
      const meshes: THREE.Mesh[] = [];
      hood.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) meshes.push(m);
      });
      for (const mesh of meshes) punchMesh(mesh, wrap, inDoor);
    }
  }
  return out;
}

function addGlow(wrap: THREE.Group, z: number, color: number, dist: number) {
  const light = new THREE.PointLight(color, 0, dist, 2);
  light.position.set(0, 0.05, z);
  wrap.add(light);
  return light;
}

function flameMat(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function makeJetExhaust(): ExhaustBits {
  const group = new THREE.Group();
  group.name = "JetExhaust";
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.11, 1, 14, 1, true), flameMat(0xd8f6ff, 0.72));
  core.rotation.x = -Math.PI / 2;
  const mid = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 14, 1, true), flameMat(0x3ec7ff, 0.38));
  mid.rotation.x = -Math.PI / 2;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), flameMat(0x9ad4ff, 0.45));
  const diamonds: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), flameMat(0xffe6b0, 0.0));
    diamonds.push(d);
    group.add(d);
  }
  const light = new THREE.PointLight(0x66e0ff, 0, 14, 2);
  group.add(core, mid, glow, light);
  return { group, core, mid, glow, diamonds, light };
}

function setExhaust(fx: ExhaustBits, thrust: number, time: number) {
  const cr = THREE.MathUtils.clamp(thrust / 0.8, 0, 1);
  const ab = THREE.MathUtils.clamp((thrust - 0.8) / 0.2, 0, 1);
  const flicker = 1 + Math.sin(time * (38 + ab * 90)) * (0.045 + ab * 0.14);
  const len = (0.28 + cr * 1.35 + ab * 5.6) * flicker;
  const r = 0.07 + cr * 0.05 + ab * 0.09;
  fx.core.scale.set(r * 10, len, r * 10);
  fx.core.position.z = len * 0.5;
  fx.mid.scale.set(r * 16, len * 1.18, r * 16);
  fx.mid.position.z = len * 0.52;
  fx.glow.scale.setScalar(0.55 + cr * 0.5 + ab * 1.4);
  fx.glow.position.z = 0.12;
  const coreMat = fx.core.material as THREE.MeshBasicMaterial;
  const midMat = fx.mid.material as THREE.MeshBasicMaterial;
  const glowMat = fx.glow.material as THREE.MeshBasicMaterial;
  if (ab > 0.02) {
    coreMat.color.setHex(0xfff4d6);
    midMat.color.setHex(0xff7a18);
    glowMat.color.setHex(0xffc14d);
    fx.light.color.setHex(0xff9a32);
  } else {
    coreMat.color.setHex(0xe8fbff);
    midMat.color.setHex(0x3ec7ff);
    glowMat.color.setHex(0x8ad8ff);
    fx.light.color.setHex(0x66e0ff);
  }
  coreMat.opacity = (0.22 + cr * 0.45 + ab * 0.4) * flicker;
  midMat.opacity = (0.12 + cr * 0.28 + ab * 0.38) * flicker;
  glowMat.opacity = 0.15 + cr * 0.25 + ab * 0.4;
  fx.light.intensity = cr * 4.2 + ab * 22;
  fx.light.distance = 8 + ab * 18;
  fx.group.visible = thrust > 0.02;
  for (let i = 0; i < fx.diamonds.length; i++) {
    const d = fx.diamonds[i]!;
    const on = ab > 0.12;
    d.visible = on;
    if (!on) continue;
    const z = 0.55 + i * (0.55 + ab * 0.55) * flicker;
    d.position.z = z;
    d.scale.setScalar((0.55 + (1 - i / 4) * 0.55) * (0.7 + ab * 0.7) * flicker);
    (d.material as THREE.MeshBasicMaterial).opacity = (0.18 + ab * 0.45) * (1 - i * 0.16);
  }
}

function makeContrail(): Contrail {
  const n = 52;
  const pos = new Float32Array(n * 2 * 3);
  const col = new Float32Array(n * 2 * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, hist: [], pos, col, n };
}

const _trailSide = new THREE.Vector3();
const _trailFwd = new THREE.Vector3();
const _upTmp = new THREE.Vector3(0, 1, 0);
const _tipL = new THREE.Vector3();
const _tipR = new THREE.Vector3();

function updateContrail(tr: Contrail, tip: THREE.Vector3, emit: boolean) {
  if (emit) {
    if (!tr.hist.length || tr.hist[0]!.distanceToSquared(tip) > 2.4) {
      tr.hist.unshift(tip.clone());
      if (tr.hist.length > tr.n) tr.hist.pop();
    } else {
      tr.hist[0]!.copy(tip);
    }
  } else if (tr.hist.length > 2) {
    tr.hist.pop();
  }
  const n = tr.n;
  const h = tr.hist.length;
  tr.mesh.visible = h > 2;
  if (h < 2) return;
  for (let i = 0; i < n; i++) {
    const p = tr.hist[Math.min(i, h - 1)]!;
    const q = tr.hist[Math.min(i + 1, h - 1)]!;
    _trailFwd.subVectors(p, q);
    if (_trailFwd.lengthSq() < 1e-6) _trailFwd.set(0, 0, 1);
    _trailSide.crossVectors(_trailFwd, _upTmp).normalize();
    if (_trailSide.lengthSq() < 1e-6) _trailSide.set(1, 0, 0);
    const a = i / (n - 1);
    const w = 0.22 + a * 1.15;
    const fade = h < 3 ? 0 : Math.pow(1 - a, 1.15) * 0.38 * Math.min(1, (h - 2) / 8);
    const o = i * 6;
    tr.pos[o] = p.x - _trailSide.x * w;
    tr.pos[o + 1] = p.y - _trailSide.y * w;
    tr.pos[o + 2] = p.z - _trailSide.z * w;
    tr.pos[o + 3] = p.x + _trailSide.x * w;
    tr.pos[o + 4] = p.y + _trailSide.y * w;
    tr.pos[o + 5] = p.z + _trailSide.z * w;
    const c = i * 8;
    for (let k = 0; k < 2; k++) {
      tr.col[c + k * 4] = 0.92;
      tr.col[c + k * 4 + 1] = 0.96;
      tr.col[c + k * 4 + 2] = 1;
      tr.col[c + k * 4 + 3] = fade;
    }
  }
  const geo = tr.mesh.geometry;
  (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  geo.computeBoundingSphere();
}

function attachExhaust(hub: THREE.Object3D, z = 0.55) {
  const fx = makeJetExhaust();
  fx.group.position.set(0, 0, z);
  hub.add(fx.group);
  return fx;
}

function prepareCar(src: THREE.Group) {
  const root = src.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = true;
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
  normalizeFacing(root, 4.82, /Exhaust_1$|Tail_light$|Rear_part_1$/, /Hood|Front_part_1$|Daylight$|Headlight$/);
  const wrap = new THREE.Group();
  wrap.name = "CarVisual";
  wrap.add(root);
  wrap.updateMatrixWorld(true);
  const wheels = mountWheels(wrap, /^Wheel_(FL|FR|BL|BR)$/);
  const doors = makeScissorDoors(wrap);
  makeGlass(wrap, /Windshield|Rear_window|Right&Left_window|Windows/i, 0.18);
  const originY = 0.48;
  const cockpit = measureCarCockpit(wrap, originY);
  liftOrigin(wrap, originY);
  const hubs = collectHubs(wrap);
  wrap.userData.originY = originY;
  wrap.userData.cockpit = cockpit;
  wrap.userData.faceDbg = root.userData.faceDbg;
  const steer = firstNamed(wrap, /^Steering_wheel$/);
  if (steer) steer.userData.steerAxis = localThinAxis(steer);
  const glow = [addGlow(wrap, 2.15, 0xff6a22, 4.2), addGlow(wrap, 2.05, 0xffc070, 2.4)];
  return { wrap, wheels: hubs.length ? hubs : wheels, doors, steer, glow, originY, cockpit };
}

function matchGearWheel(wheels: WheelBind[], gear: THREE.Object3D): THREE.Object3D[] {
  const a = worldAabb(gear);
  const extras: THREE.Object3D[] = [];
  for (const w of wheels) {
    const wx = w.root.getWorldPosition(_p).x;
    const wz = _p.z;
    const nearX = Math.abs(wx - a.cx) < Math.max(1.6, (a.maxX - a.minX) * 0.9 + 0.55);
    const nearZ = Math.abs(wz - a.cz) < Math.max(1.4, (a.maxZ - a.minZ) * 0.9 + 0.7);
    if (nearX && nearZ) extras.push(w.root);
  }
  return extras;
}

function snapshotWheelOffsets(wrap: THREE.Group, wheels: WheelBind[]) {
  wrap.updateMatrixWorld(true);
  for (const w of wheels) {
    w.root.getWorldPosition(_p);
    wrap.worldToLocal(_p);
    const off = { x: _p.x, y: _p.y, z: _p.z };
    w.offset = off;
    w.root.userData.offset = off;
  }
}

function refreshWheelRests(wheels: WheelBind[]) {
  for (const w of wheels) {
    w.restPos.copy(w.root.position);
    w.restQuat.copy(w.root.quaternion);
  }
}

function preparePlane(src: THREE.Group) {
  const root = src.clone(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.frustumCulled = true;
      m.castShadow = false;
    }
  });
  normalizeFacing(root, 18.6, /^elevator_l|^rudder_/, /^gear_f$|bonnet|nose|wheel_lfchild/i);
  const wrap = new THREE.Group();
  wrap.name = "PlaneVisual";
  wrap.add(root);
  wrap.updateMatrixWorld(true);
  const wheels = mountWheels(wrap, /^wheel_l[fr]/i);
  const originY = 1.28;
  const cockpit = measurePlaneCockpit(wrap, originY);
  liftOrigin(wrap, originY);
  wrap.updateMatrixWorld(true);
  snapshotWheelOffsets(wrap, wheels);

  const gears: PivotBind[] = [];
  const noseGear = firstNamed(wrap, /^gear_f/);
  if (noseGear) {
    const a = worldAabb(noseGear);
    gears.push(
      mountHinge(
        wrap,
        noseGear,
        { x: a.cx, y: a.maxY - 0.02, z: a.cz },
        "x",
        1,
        1.42,
        "gear",
        matchGearWheel(wheels, noseGear),
      ),
    );
  }
  const leftGear = firstNamed(wrap, /^gear_lm1/);
  if (leftGear) {
    const a = worldAabb(leftGear);
    gears.push(
      mountHinge(
        wrap,
        leftGear,
        { x: a.cx + 0.12, y: a.maxY - 0.02, z: a.cz },
        "z",
        -1,
        1.48,
        "gear",
        matchGearWheel(wheels, leftGear),
      ),
    );
  }
  const rightGear = firstNamed(wrap, /^gear_rm1/);
  if (rightGear) {
    const a = worldAabb(rightGear);
    gears.push(
      mountHinge(
        wrap,
        rightGear,
        { x: a.cx - 0.12, y: a.maxY - 0.02, z: a.cz },
        "z",
        1,
        1.48,
        "gear",
        matchGearWheel(wheels, rightGear),
      ),
    );
  }
  refreshWheelRests(wheels);

  const gearDoors: PivotBind[] = [];
  for (const obj of findNamed(wrap, /^gear_door_f[lr]/)) {
    const a = worldAabb(obj);
    const left = a.cx < 0;
    gearDoors.push(
      mountHinge(wrap, obj, { x: left ? a.minX : a.maxX, y: a.maxY, z: a.cz }, "z", left ? -1 : 1, 1.25, "gearDoor"),
    );
  }
  for (const obj of findNamed(wrap, /^gear_door_r[lr]/)) {
    const a = worldAabb(obj);
    const left = a.cx < 0;
    gearDoors.push(
      mountHinge(wrap, obj, { x: left ? a.maxX : a.minX, y: a.maxY, z: a.cz }, "z", left ? -1 : 1, 1.18, "gearDoor"),
    );
  }

  const surfaces: PivotBind[] = [];
  for (const obj of findNamed(wrap, /^aileron_l/)) {
    const a = worldAabb(obj);
    surfaces.push(mountHinge(wrap, obj, { x: a.cx, y: a.cy, z: a.minZ + 0.04 }, "x", 1, 0.42, "aileronL"));
  }
  for (const obj of findNamed(wrap, /^aileron_r/)) {
    const a = worldAabb(obj);
    surfaces.push(mountHinge(wrap, obj, { x: a.cx, y: a.cy, z: a.minZ + 0.04 }, "x", 1, 0.42, "aileronR"));
  }
  for (const obj of findNamed(wrap, /^elevator_l/)) {
    const a = worldAabb(obj);
    surfaces.push(mountHinge(wrap, obj, { x: a.cx, y: a.cy, z: a.minZ + 0.06 }, "x", 1, 0.38, "elevator"));
  }
  const nozzleSrc = firstNamed(wrap, /^elevator_r/);
  if (nozzleSrc) {
    wrap.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    nozzleSrc.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    const halves: { side: "L" | "R"; made: THREE.Mesh[] }[] = [
      { side: "L", made: [] },
      { side: "R", made: [] },
    ];
    for (const side of ["L", "R"] as const) {
      const pred = (x: number, _y: number, _z: number) => (side === "L" ? x < -0.04 : x > 0.04);
      for (const mesh of meshes) {
        const geo = splitTriangles(mesh, wrap, pred);
        if (!geo) continue;
        const half = makeHalfMesh(mesh, geo, side);
        wrap.attach(half);
        halves.find((h) => h.side === side)!.made.push(half);
      }
    }
    if (halves[0]!.made.length && halves[1]!.made.length) {
      nozzleSrc.visible = false;
      for (const mesh of meshes) mesh.visible = false;
      for (const h of halves) {
        _box.makeEmpty();
        for (const m of h.made) _box.expandByObject(m);
        const cx = (_box.min.x + _box.max.x) * 0.5;
        const cy = (_box.min.y + _box.max.y) * 0.5;
        const cz = (_box.min.z + _box.max.z) * 0.5;
        const main = h.made[0]!;
        surfaces.push(
          mountHinge(wrap, main, { x: cx, y: cy, z: cz }, "x", 1, 0.48, h.side === "L" ? "nozzleL" : "nozzleR", h.made.slice(1)),
        );
      }
    } else {
      for (const h of halves) for (const m of h.made) wrap.remove(m);
      const a = worldAabb(nozzleSrc);
      surfaces.push(mountHinge(wrap, nozzleSrc, { x: a.cx, y: a.cy, z: a.minZ + 0.04 }, "x", 1, 0.48, "nozzle"));
    }
  }
  for (const obj of findNamed(wrap, /^rudder/)) {
    const a = worldAabb(obj);
    surfaces.push(mountHinge(wrap, obj, { x: a.cx, y: a.minY + 0.15, z: a.minZ + 0.06 }, "y", 1, 0.46, "rudder"));
  }
  for (const obj of findNamed(wrap, /^wingflap_/)) {
    const a = worldAabb(obj);
    surfaces.push(mountHinge(wrap, obj, { x: a.cx, y: a.cy, z: a.minZ + 0.05 }, "x", 1, 0.36, "flap"));
  }

  const canopyParts = [...findNamed(wrap, /^door_dside_f/), ...findNamed(wrap, /^window_lf/)];
  const doors: PivotBind[] = [];
  if (canopyParts.length) {
    const main = canopyParts[0]!;
    wrap.updateMatrixWorld(true);
    _box.makeEmpty();
    for (const p of canopyParts) _box.expandByObject(p);
    doors.push(
      mountHinge(
        wrap,
        main,
        { x: (_box.min.x + _box.max.x) * 0.5, y: _box.max.y - 0.04, z: _box.max.z - 0.08 },
        "x",
        1,
        1.12,
        "canopy",
        canopyParts.slice(1),
      ),
    );
  }

  const hubs = collectHubs(wrap);
  wrap.userData.originY = originY;
  wrap.userData.cockpit = cockpit;
  wrap.userData.faceDbg = root.userData.faceDbg;
  const steer = firstNamed(wrap, /steeringwheel/);
  if (steer) steer.userData.steerAxis = localThinAxis(steer);
  makeGlass(wrap, /window_lf|door_dside_f/i, 0.1);
  const exhausts: ExhaustBits[] = [];
  for (const s of surfaces) {
    if (s.kind === "nozzleL" || s.kind === "nozzleR" || s.kind === "nozzle") {
      exhausts.push(attachExhaust(s.obj, 0.62));
    }
  }
  if (!exhausts.length) {
    const l = new THREE.Group();
    const r = new THREE.Group();
    l.position.set(-0.72, 0.08, 5.35);
    r.position.set(0.72, 0.08, 5.35);
    wrap.add(l, r);
    exhausts.push(attachExhaust(l, 0.15), attachExhaust(r, 0.15));
  }
  const glow = [addGlow(wrap, 7.6, 0x4ea7ff, 9), addGlow(wrap, 7.2, 0xff7a32, 6)];
  return { wrap, wheels: hubs.length ? hubs : wheels, doors, gears, gearDoors, surfaces, steer, glow, originY, cockpit, exhausts };
}

function layoutFromWheels(wheels: WheelBind[], kind: "car" | "plane") {
  const pts = wheels.map((w) => w.offset);
  if (!pts.length) {
    return kind === "plane"
      ? { wheels: [{ x: 0, y: 0.4, z: -4, steer: true }], halfL: 8.4, halfW: 2, height: 2.6, wheelR: 0.4 }
      : { wheels: [{ x: -0.9, y: 0.34, z: -1.4, steer: true }], halfL: 2.3, halfW: 1.05, height: 1.15, wheelR: 0.34 };
  }
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity,
    minY = Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    minY = Math.min(minY, p.y);
  }
  return {
    wheels: wheels.map((w) => ({ x: w.offset.x, y: w.offset.y, z: w.offset.z, steer: w.offset.z < 0 })),
    halfL: Math.max(2.1, (Math.abs(minZ) + Math.abs(maxZ)) * 0.5 + (kind === "plane" ? 3.2 : 0.85)),
    halfW: Math.max(0.9, (Math.abs(minX) + Math.abs(maxX)) * 0.5 + (kind === "plane" ? 0.4 : 0.18)),
    height: kind === "plane" ? 2.7 : 1.16,
    wheelR: Math.max(0.22, Math.abs(minY)),
  };
}

export function VehicleWorld() {
  const world = useStudio((s) => s.worldMap);
  const showCol = useStudio((s) => s.showCollision);
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const colRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (world !== "city") {
      setVisuals([]);
      resetVehicles();
      vehLive.ready = false;
      vehLive.vehicles = [];
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const models = await loadVehicleModels();
        if (cancelled) return;
        let n = 0;
        while (!getCityRuntime().ready && n++ < 80) await new Promise((r) => setTimeout(r, 50));
        if (cancelled || !getCityRuntime().ready) return;
        spawnVehicles();
        const carPrep = prepareCar(models.car);
        const planePrep = preparePlane(models.plane);
        (window as unknown as { __faceDbg?: unknown }).__faceDbg = {
          car: carPrep.wrap.userData.faceDbg,
          plane: planePrep.wrap.userData.faceDbg,
          carEye: carPrep.cockpit,
          planeEye: planePrep.cockpit,
          planeHinges: {
            gears: planePrep.gears.map((g) => g.obj.name),
            gearDoors: planePrep.gearDoors.map((g) => g.obj.name),
            surfaces: planePrep.surfaces.map((s) => `${s.kind}:${s.obj.name}`),
            doors: planePrep.doors.map((d) => d.obj.name),
            wheels: planePrep.wheels.map((w) => `${w.root.name}@${w.root.parent?.name ?? ""}`),
          },
        };
        const list: Visual[] = [];
        for (const v of getVehicles()) {
          if (v.kind === "car") {
            const wrap = carPrep.wrap.clone(true);
            const wheels = collectHubs(wrap);
            const lay = layoutFromWheels(wheels.length ? wheels : carPrep.wheels, "car");
            applyWheelLayout(v.id, lay.wheels, lay.halfL, lay.halfW, lay.height, lay.wheelR);
            const cock = (wrap.userData.cockpit as { x: number; y: number; z: number } | undefined) ?? carPrep.cockpit;
            applyCockpit(v.id, cock, carPrep.originY);
            const doors = findNamed(wrap, /^Scissor_[LR]$/).map((obj) => ({
              obj,
              rest: obj.quaternion.clone(),
              axis: (obj.userData.axis as "x" | "y" | "z") || "z",
              sign: typeof obj.userData.sign === "number" ? obj.userData.sign : /_L$/.test(obj.name) ? -1 : 1,
              max: typeof obj.userData.max === "number" ? obj.userData.max : 1.35,
              kind: "door" as const,
            }));
            const steer = firstNamed(wrap, /^Steering_wheel$/);
            if (steer && !steer.userData.steerAxis) steer.userData.steerAxis = localThinAxis(steer);
            const glow: THREE.PointLight[] = [];
            wrap.traverse((o) => {
              const l = o as THREE.PointLight;
              if (l.isPointLight) glow.push(l);
            });
            list.push({
              id: v.id,
              kind: "car",
              group: wrap,
              wheels: wheels.length ? wheels : carPrep.wheels,
              doors: doors.length ? doors : carPrep.doors,
              gears: [],
              gearDoors: [],
              surfaces: [],
              steerWheel: steer ? { obj: steer, rest: steer.quaternion.clone() } : null,
              glow,
              flapT: 0,
              exhausts: [],
              trails: [],
            });
          } else {
            const prep = planePrep;
            const lay = layoutFromWheels(prep.wheels, "plane");
            applyWheelLayout(v.id, lay.wheels, lay.halfL, lay.halfW, lay.height, lay.wheelR);
            applyCockpit(v.id, prep.cockpit, prep.originY);
            list.push({
              id: v.id,
              kind: "plane",
              group: prep.wrap,
              wheels: prep.wheels,
              doors: prep.doors,
              gears: prep.gears,
              gearDoors: prep.gearDoors,
              surfaces: prep.surfaces,
              steerWheel: prep.steer ? { obj: prep.steer, rest: prep.steer.quaternion.clone() } : null,
              glow: prep.glow,
              flapT: 0,
              exhausts: prep.exhausts,
              trails: [makeContrail(), makeContrail()],
            });
          }
        }
        if (!cancelled) setVisuals(list);
      } catch (err) {
        console.warn("[vehicles]", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [world]);

  useFrame((state, dt) => {
    if (world !== "city") return;
    const d = Math.min(0.05, Math.max(0.001, dt));
    const now = state.clock.elapsedTime;
    for (const vis of visuals) {
      const v = getVehicles().find((o) => o.id === vis.id);
      if (!v) {
        vis.group.visible = false;
        continue;
      }
      vis.group.visible = true;
      vis.group.position.set(v.x, v.y, v.z);
      vis.group.quaternion.set(v.qx, v.qy, v.qz, v.qw);
      const gearDown = v.kind === "plane" ? v.gear : 1;
      vis.wheels.forEach((w, i) => {
        const inBay = v.kind === "plane" && gearDown < 0.18;
        w.root.visible = !inBay;
        if (inBay) {
          w.root.position.copy(w.restPos);
          w.root.quaternion.copy(w.restQuat);
          return;
        }
        const sag = gearDown > 0.35 ? ((v.susp[i] ?? 0.4) - 0.4) : 0;
        w.root.position.copy(w.restPos);
        w.root.position.y += sag * 0.2;
        w.root.quaternion.copy(w.restQuat);
        if (w.steer && gearDown > 0.4) w.root.rotateY(v.steerAngle * 0.9);
        const spin = v.wheelSpin * (w.spinSign || 1);
        if (w.axle === "z") w.root.rotateZ(spin);
        else w.root.rotateX(spin);
      });
      const doorT = v.door;
      for (const d of vis.doors) applyPivot(d, doorT);
      const gearUp = 1 - v.gear;
      for (const g of vis.gears) applyPivot(g, gearUp);
      const doorClose = gearUp < 0.68 ? 0 : (gearUp - 0.68) / 0.32;
      for (const g of vis.gearDoors) applyPivot(g, doorClose);
      if (v.kind === "plane") {
        const pitchC = THREE.MathUtils.clamp(v.ctrlPitch, -1, 1);
        const rollC = THREE.MathUtils.clamp(v.ctrlRoll, -1, 1);
        const yawC = THREE.MathUtils.clamp(v.ctrlYaw || v.steerAngle * 1.6, -1, 1);
        for (const s of vis.surfaces) {
          let t = 0;
          switch (s.kind) {
            case "aileronL":
              t = -rollC;
              break;
            case "aileronR":
              t = rollC;
              break;
            case "elevator":
              t = -pitchC;
              break;
            case "nozzle":
              t = -pitchC * 0.95 - v.thrust * 0.12;
              break;
            case "nozzleL":
              t = -pitchC * 0.9 - rollC * 0.7 - v.thrust * 0.1;
              break;
            case "nozzleR":
              t = -pitchC * 0.9 + rollC * 0.7 - v.thrust * 0.1;
              break;
            case "rudder":
              t = -yawC;
              break;
            case "flap": {
              const want = !v.airborne && (Math.abs(v.speed) > 6.5 || v.thrust > 0.2) ? 0.88 : 0;
              vis.flapT += (want - vis.flapT) * (1 - Math.exp(-3.4 * d));
              t = vis.flapT;
              break;
            }
            default:
              t = 0;
          }
          applyPivot(s, t);
        }
      }
      if (vis.steerWheel) {
        const axis = (vis.steerWheel.obj.userData.steerAxis as "x" | "y" | "z") || "z";
        _eul.set(0, 0, 0);
        const ang = -v.steerAngle * 2.6;
        if (axis === "x") _eul.x = ang;
        else if (axis === "y") _eul.y = ang;
        else _eul.z = ang;
        vis.steerWheel.obj.quaternion.copy(vis.steerWheel.rest).multiply(_q.setFromEuler(_eul));
      }
      vis.glow?.forEach((light, i) => {
        if (v.kind === "car") light.intensity = v.nitro * (i === 0 ? 6.2 : 2.4);
        else light.intensity = 0;
      });
      for (const fx of vis.exhausts) setExhaust(fx, v.thrust, now);
      if (vis.trails.length >= 2) {
        vis.group.updateMatrixWorld(true);
        const emit = v.airborne && v.speed > 52 && v.y > 18;
        _tipL.set(-4.6, 0.15, 0.35).applyMatrix4(vis.group.matrixWorld);
        _tipR.set(4.6, 0.15, 0.35).applyMatrix4(vis.group.matrixWorld);
        updateContrail(vis.trails[0]!, _tipL, emit);
        updateContrail(vis.trails[1]!, _tipR, emit);
      }
    }
    const g = colRef.current;
    if (g) {
      g.visible = showCol && world === "city";
      if (g.visible) {
        const list = getVehicles();
        const want = list.length * 4;
        while (g.children.length < want) {
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshBasicMaterial({ color: 0x7ad0ff, transparent: true, opacity: 0.16, depthWrite: false }),
          );
          g.add(m);
        }
        let slot = 0;
        const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, on: boolean) => {
          const mesh = g.children[slot++] as THREE.Mesh | undefined;
          if (!mesh) return;
          mesh.visible = on;
          if (!on) return;
          mesh.position.set(x, y, z);
          mesh.scale.set(sx, sy, sz);
          mesh.rotation.set(0, yaw, 0);
        };
        for (const v of list) {
          place(v.x, v.y, v.z, v.halfW * 2, v.height, v.halfL * 2, v.yaw, true);
          if (v.kind === "plane") {
            place(v.x + v.rx * -v.halfW * 2.6, v.y, v.z + v.rz * -v.halfW * 2.6, 4.8, 0.35, 2.6, v.yaw, true);
            place(v.x + v.rx * v.halfW * 2.6, v.y, v.z + v.rz * v.halfW * 2.6, 4.8, 0.35, 2.6, v.yaw, true);
            place(v.x - v.fx * v.halfL * 0.7, v.y, v.z - v.fz * v.halfL * 0.7, v.halfW * 1.2, 0.4, 3.2, v.yaw, true);
          } else {
            place(v.x - v.fx * v.halfL * 0.55, v.y, v.z - v.fz * v.halfL * 0.55, v.halfW * 1.7, v.height * 0.72, v.halfL * 0.7, v.yaw, true);
            place(v.x + v.fx * v.halfL * 0.5, v.y, v.z + v.fz * v.halfL * 0.5, v.halfW * 1.85, v.height * 0.78, v.halfL * 0.72, v.yaw, true);
            place(v.x, v.y + 0.02, v.z, v.halfW * 1.9, 0.18, v.halfL * 1.9, v.yaw, true);
          }
        }
        while (slot < g.children.length) {
          (g.children[slot++] as THREE.Mesh).visible = false;
        }
      }
    }
  });

  return (
    <group visible={world === "city"}>
      {visuals.map((v) => (
        <primitive key={v.id} object={v.group} />
      ))}
      {visuals.flatMap((v) =>
        v.trails.map((t, i) => <primitive key={`${v.id}-trail-${i}`} object={t.mesh} />),
      )}
      <group ref={colRef} />
    </group>
  );
}
