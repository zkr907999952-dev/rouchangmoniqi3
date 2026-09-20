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
type PivotBind = { obj: THREE.Object3D; rest: THREE.Quaternion; axis: "x" | "y" | "z"; sign: number; max: number };

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

function measureCockpit(wrap: THREE.Group, re: RegExp, fallback: { x: number; y: number; z: number }, behind: number, up: number) {
  return measureCockpitObj(wrap, firstNamed(wrap, re), fallback, behind, up);
}

function measureCockpitObj(
  wrap: THREE.Group,
  obj: THREE.Object3D | null,
  fallback: { x: number; y: number; z: number },
  behind: number,
  up: number,
) {
  if (!obj) return fallback;
  wrap.updateMatrixWorld(true);
  _box.setFromObject(obj);
  if (_box.isEmpty()) return fallback;
  _box.getCenter(_center);
  wrap.worldToLocal(_center);
  return { x: _center.x, y: _center.y + up, z: _center.z + behind };
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
  return hubs.map((hub) => ({
    root: hub,
    restPos: hub.position.clone(),
    restQuat: hub.quaternion.clone(),
    steer: Boolean(hub.userData.steer) || hub.position.z < 0,
    axle: (hub.userData.axle as "x" | "z") || "x",
    spinSign: typeof hub.userData.spinSign === "number" ? hub.userData.spinSign : 1,
    offset: { x: hub.position.x, y: hub.position.y, z: hub.position.z },
  }));
}

function bindPivots(root: THREE.Group, items: { re: RegExp; axis: "x" | "y" | "z"; sign: number; max: number }[]): PivotBind[] {
  const out: PivotBind[] = [];
  for (const it of items) {
    for (const obj of findNamed(root, it.re)) {
      out.push({ obj, rest: obj.quaternion.clone(), axis: it.axis, sign: it.sign, max: it.max });
    }
  }
  return out;
}

function applyPivot(b: PivotBind, t: number) {
  _eul.set(0, 0, 0, "XYZ");
  const a = b.sign * b.max * t;
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
    out.push({ obj: pivot, rest: pivot.quaternion.clone(), axis: "z", sign, max: 1.35 });
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
  const originY = 0.48;
  const cockpit = measureCockpit(wrap, /^Steering_wheel$/, { x: -0.38, y: 0.9, z: 0.18 }, 0.52, 0.12);
  cockpit.y -= originY;
  liftOrigin(wrap, originY);
  const hubs = collectHubs(wrap);
  wrap.userData.originY = originY;
  wrap.userData.cockpit = cockpit;
  wrap.userData.faceDbg = root.userData.faceDbg;
  const steer = firstNamed(wrap, /^Steering_wheel$/);
  const glow = [addGlow(wrap, 2.15, 0xff6a22, 4.2), addGlow(wrap, 2.05, 0xffc070, 2.4)];
  return { wrap, wheels: hubs.length ? hubs : wheels, doors, steer, glow, originY, cockpit };
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
  const stick = firstNamed(wrap, /steeringwheel/) ?? firstNamed(wrap, /canopy/);
  const cockpit = measureCockpitObj(wrap, stick, { x: 0, y: 2.62, z: -5.2 }, 0.2, 0.08);
  cockpit.y -= originY;
  cockpit.x *= 0.15;
  cockpit.z = Math.min(-4.15, cockpit.z + 0.85);
  cockpit.y = Math.max(1.42, Math.min(1.62, cockpit.y));
  liftOrigin(wrap, originY);
  const hubs = collectHubs(wrap);
  wrap.userData.originY = originY;
  wrap.userData.cockpit = cockpit;
  wrap.userData.faceDbg = root.userData.faceDbg;
  const doors = bindPivots(wrap, [
    { re: /door_hatch_l/, axis: "z", sign: 1, max: 1.15 },
    { re: /door_hatch_r/, axis: "z", sign: -1, max: 1.15 },
    { re: /door_dside_f/, axis: "z", sign: 1, max: 0.95 },
    { re: /door_pside_f/, axis: "z", sign: -1, max: 0.95 },
  ]);
  const gears = bindPivots(wrap, [
    { re: /^gear_f/, axis: "x", sign: 1, max: 1.45 },
    { re: /^gear_lm1/, axis: "z", sign: -1, max: 1.35 },
    { re: /^gear_rm1/, axis: "z", sign: 1, max: 1.35 },
  ]);
  const gearDoors = bindPivots(wrap, [
    { re: /gear_door_fl/, axis: "x", sign: -1, max: 1.2 },
    { re: /gear_door_fr/, axis: "x", sign: 1, max: 1.2 },
    { re: /gear_door_rl1/, axis: "z", sign: 1, max: 1.1 },
    { re: /gear_door_rr1/, axis: "z", sign: -1, max: 1.1 },
  ]);
  const surfaces = bindPivots(wrap, [
    { re: /aileron_l/, axis: "z", sign: 1, max: 0.45 },
    { re: /aileron_r/, axis: "z", sign: -1, max: 0.45 },
    { re: /elevator_l/, axis: "x", sign: 1, max: 0.4 },
    { re: /elevator_r/, axis: "x", sign: 1, max: 0.4 },
    { re: /^rudder_/, axis: "y", sign: 1, max: 0.45 },
    { re: /wingflap_l/, axis: "x", sign: 1, max: 0.35 },
    { re: /wingflap_r/, axis: "x", sign: 1, max: 0.35 },
  ]);
  const steer = firstNamed(wrap, /steeringwheel/);
  const glow = [addGlow(wrap, 7.6, 0x4ea7ff, 9), addGlow(wrap, 7.2, 0xff7a32, 6)];
  return { wrap, wheels: hubs.length ? hubs : wheels, doors, gears, gearDoors, surfaces, steer, glow, originY, cockpit };
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
            }));
            const steer = firstNamed(wrap, /^Steering_wheel$/);
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

  useFrame(() => {
    if (world !== "city") return;
    for (const vis of visuals) {
      const v = getVehicles().find((o) => o.id === vis.id);
      if (!v) {
        vis.group.visible = false;
        continue;
      }
      vis.group.visible = true;
      vis.group.position.set(v.x, v.y, v.z);
      vis.group.quaternion.set(v.qx, v.qy, v.qz, v.qw);
      vis.wheels.forEach((w, i) => {
        const sag = (v.susp[i] ?? 0.4) - 0.4;
        w.root.position.copy(w.restPos);
        w.root.position.y += sag * 0.2;
        w.root.quaternion.copy(w.restQuat);
        if (w.steer) w.root.rotateY(v.steerAngle * 0.9);
        const spin = v.wheelSpin * (w.spinSign || 1);
        if (w.axle === "z") w.root.rotateZ(spin);
        else w.root.rotateX(spin);
      });
      const doorT = v.door;
      for (const d of vis.doors) applyPivot(d, doorT);
      const gearUp = 1 - v.gear;
      for (const g of vis.gears) applyPivot(g, gearUp);
      for (const g of vis.gearDoors) applyPivot(g, gearUp);
      if (v.kind === "plane") {
        const pitchN = THREE.MathUtils.clamp(v.pitch / 0.4, -1, 1);
        const rollN = THREE.MathUtils.clamp(v.roll / 0.6, -1, 1);
        for (const s of vis.surfaces) {
          const name = s.obj.name;
          let t = 0;
          if (/aileron_l/.test(name)) t = rollN;
          else if (/aileron_r/.test(name)) t = rollN;
          else if (/elevator/.test(name)) t = -pitchN;
          else if (/rudder/.test(name)) t = THREE.MathUtils.clamp(v.steerAngle, -1, 1);
          else if (/wingflap/.test(name)) t = v.gear > 0.4 || v.speed < 50 ? 0.7 : 0;
          applyPivot(s, t);
        }
      }
      if (vis.steerWheel) {
        _eul.set(0, 0, -v.steerAngle * 2.4);
        vis.steerWheel.obj.quaternion.copy(vis.steerWheel.rest).multiply(_q.setFromEuler(_eul));
      }
      vis.glow?.forEach((light, i) => {
        if (v.kind === "car") light.intensity = v.nitro * (i === 0 ? 6.2 : 2.4);
        else light.intensity = v.thrust * (v.airborne ? 1 : 0.35) * (i === 0 ? 8.5 : 5.5 * v.thrust);
      });
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
      <group ref={colRef} />
    </group>
  );
}
