import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

export const CITY_URL = "/models/city.glb";
export const CITY_BYTES = 8_037_544;
export const CITY_SCALE = 1;
export const CITY_BAKE_ID = "house-v10";

export const HOME_EXIT = { x: -3.58, y: 0, z: 0.12, r: 0.92 };
export const HOME_RETURN_SPAWN = { x: -1.22, y: 0, z: 0.12, yaw: -Math.PI / 2, pitch: -0.08 };

export const PLAYER_R = 0.3;
export const CITY_MAP_H_MIN = 36;
export const CITY_MAP_H_MAX = 1600;
export const CITY_MAP_H_DEFAULT = 120;

type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxZ: number; maxY: number };

type Collider = {
  mesh: THREE.Mesh;
  box: Aabb;
  bvh: MeshBVH;
  scratch: THREE.BufferGeometry | null;
  world: boolean;
  scale: number;
};

type CityRuntime = {
  group: THREE.Group | null;
  colliders: Collider[];
  hash: Map<number, Collider[]>;
  spawn: { x: number; y: number; z: number; yaw: number; pitch: number };
  portal: { x: number; z: number; r: number };
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  ready: boolean;
  mapUrl: string;
  mapCx: number;
  mapCz: number;
  mapHalf: number;
  skipped: number;
  bakeId: string;
  houseCount: number;
  probeN: number;
  probeY: number | null;
  sampleV: number[];
  sampleBB: number[];
};

const CELL = 16;
const MAX_EXTRACT_VERTS = 900_000;

const city: CityRuntime = {
  group: null,
  colliders: [],
  hash: new Map(),
  spawn: { x: 42.5, y: 0, z: 40.2, yaw: 0, pitch: -0.06 },
  portal: { x: 42.5, z: 40.2, r: 1.8 },
  minX: -1800,
  maxX: 1300,
  minY: -8,
  maxY: 220,
  minZ: -1500,
  maxZ: 1550,
  ready: false,
  mapUrl: "",
  mapCx: 0,
  mapCz: 0,
  mapHalf: 1600,
  skipped: 0,
  bakeId: "",
  houseCount: 0,
  probeN: 0,
  probeY: null,
  sampleV: [],
  sampleBB: [],
};

export function getCityRuntime() {
  return city;
}

export function getCitySpawn() {
  return city.spawn;
}

function cellKey(ix: number, iz: number) {
  return (ix + 20000) * 40000 + (iz + 20000);
}

function collectName(obj: THREE.Object3D) {
  const parts: string[] = [];
  let o: THREE.Object3D | null = obj;
  while (o) {
    if (o.name) parts.push(o.name);
    o = o.parent;
  }
  return parts.join(" ");
}

/** Plants / leaves / tree canopies — no collision. Buildings, ground, props stay. */
function isFoliage(name: string) {
  const n = name.toLowerCase();
  if (/mat_trees|_trees_|palm|foliage|leaves|\bleaf\b|bush|hedge|\bplants?\b|flower|fern|weed/.test(n)) {
    if (/miami_ground|boulevard_ground|docks_ground|island_ground|hotel_ground|sidewalk|pavement|asphalt|road/.test(n)) {
      return false;
    }
    return true;
  }
  return false;
}

function addToHash(col: Collider) {
  const x0 = Math.floor(col.box.minX / CELL);
  const x1 = Math.floor(col.box.maxX / CELL);
  const z0 = Math.floor(col.box.minZ / CELL);
  const z1 = Math.floor(col.box.maxZ / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = cellKey(ix, iz);
      let list = city.hash.get(k);
      if (!list) {
        list = [];
        city.hash.set(k, list);
      }
      list.push(col);
    }
  }
}

function gatherColliders(minX: number, maxX: number, minZ: number, maxZ: number, out: Collider[]) {
  out.length = 0;
  const seen = new Set<Collider>();
  const x0 = Math.floor(minX / CELL);
  const x1 = Math.floor(maxX / CELL);
  const z0 = Math.floor(minZ / CELL);
  const z1 = Math.floor(maxZ / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const list = city.hash.get(cellKey(ix, iz));
      if (!list) continue;
      for (const c of list) {
        if (seen.has(c)) continue;
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

function disposeColliders() {
  for (const col of city.colliders) {
    if (col.scratch) {
      col.scratch.boundsTree = undefined;
      col.scratch.dispose();
    }
  }
  city.colliders = [];
  city.hash = new Map();
}

const _tv = new THREE.Vector3();

/** Copy verts through matrixWorld into a fresh non-interleaved buffer. Meshopt/interleaved clone+applyMatrix4 is a no-op. */
function extractWorldGeometry(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  const src = mesh.geometry;
  const pos = src.getAttribute("position");
  if (!pos || pos.count < 3) return null;
  const idx = src.getIndex();
  const triVerts = idx ? idx.count : pos.count;
  if (triVerts > MAX_EXTRACT_VERTS) return null;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const m = mesh.matrixWorld;
  for (let i = 0; i < n; i++) {
    _tv.fromBufferAttribute(pos, i).applyMatrix4(m);
    const o = i * 3;
    arr[o] = _tv.x;
    arr[o + 1] = _tv.y;
    arr[o + 2] = _tv.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  if (idx) {
    const ic = idx.count;
    const ia = new Uint32Array(ic);
    for (let i = 0; i < ic; i++) ia[i] = idx.getX(i);
    g.setIndex(new THREE.BufferAttribute(ia, 1));
  }
  g.computeBoundingBox();
  return g;
}

function meshScale(mesh: THREE.Mesh) {
  const e = mesh.matrixWorld.elements;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  return Math.max(1e-6, Math.min(Math.abs(sx), Math.abs(sy), Math.abs(sz)));
}

export function bakeCityCollision(root: THREE.Group) {
  city.group = root;
  disposeColliders();
  city.ready = false;
  city.mapUrl = "";
  city.sampleV = [];
  city.sampleBB = [];
  root.updateMatrixWorld(true);

  const _box3 = new THREE.Box3();
  const houseBoxes: Aabb[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  let skipped = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if ("envMapIntensity" in std) std.envMapIntensity = 0.55;
      if (std.transparent && (std.opacity ?? 1) > 0.92 && !std.alphaMap) {
        std.transparent = false;
        std.depthWrite = true;
      }
    }
    const geom = mesh.geometry;
    if (!geom?.attributes?.position) return;
    if (!geom.boundingBox) geom.computeBoundingBox();
    _box3.copy(geom.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (!Number.isFinite(_box3.min.x) || _box3.isEmpty()) return;
    const aabb: Aabb = {
      minX: _box3.min.x,
      minY: _box3.min.y,
      minZ: _box3.min.z,
      maxX: _box3.max.x,
      maxY: _box3.max.y,
      maxZ: _box3.max.z,
    };
    minX = Math.min(minX, aabb.minX);
    maxX = Math.max(maxX, aabb.maxX);
    minY = Math.min(minY, aabb.minY);
    maxY = Math.max(maxY, aabb.maxY);
    minZ = Math.min(minZ, aabb.minZ);
    maxZ = Math.max(maxZ, aabb.maxZ);
    const name = collectName(mesh);
    if (
      /House_2B_MAT_Boulevard_Havana/.test(name) &&
      !/House_2B_1/.test(name) &&
      !/House_2B__1_/.test(name)
    ) {
      houseBoxes.push(aabb);
    }
    if (isFoliage(name)) return;
    const h = aabb.maxY - aabb.minY;
    const w = aabb.maxX - aabb.minX;
    const d = aabb.maxZ - aabb.minZ;
    if (w < 0.04 && d < 0.04 && h < 0.04) return;
    try {
      const worldGeom = extractWorldGeometry(mesh);
      let bvh: MeshBVH;
      let scratch: THREE.BufferGeometry | null = null;
      let world = true;
      let scale = 1;
      if (worldGeom) {
        bvh = new MeshBVH(worldGeom, { maxLeafTris: 12, setBoundingBox: true });
        worldGeom.boundsTree = bvh;
        scratch = worldGeom;
        if (city.sampleV.length === 0 && aabb.minX < 50 && aabb.maxX > 35 && aabb.minZ < 35 && aabb.maxZ > 25) {
          const pr = worldGeom.getAttribute("position");
          city.sampleV = [pr.getX(0), pr.getY(0), pr.getZ(0)];
          city.sampleBB = [aabb.minX, aabb.minY, aabb.minZ, aabb.maxX, aabb.maxY, aabb.maxZ];
        }
      } else {
        if (!geom.boundsTree) geom.boundsTree = new MeshBVH(geom, { maxLeafTris: 12 });
        bvh = geom.boundsTree as MeshBVH;
        world = false;
        scale = meshScale(mesh);
        skipped++;
      }
      const col: Collider = { mesh, box: aabb, bvh, scratch, world, scale };
      city.colliders.push(col);
      addToHash(col);
    } catch {
      skipped++;
    }
  });
  city.skipped = skipped;

  city.minX = Number.isFinite(minX) ? minX + 2 : -1800;
  city.maxX = Number.isFinite(maxX) ? maxX - 2 : 1300;
  city.minY = Number.isFinite(minY) ? minY : -8;
  city.maxY = Number.isFinite(maxY) ? maxY : 220;
  city.minZ = Number.isFinite(minZ) ? minZ + 2 : -1500;
  city.maxZ = Number.isFinite(maxZ) ? maxZ - 2 : 1550;
  city.mapCx = (city.minX + city.maxX) * 0.5;
  city.mapCz = (city.minZ + city.maxZ) * 0.5;
  city.mapHalf = Math.max(city.maxX - city.minX, city.maxZ - city.minZ) * 0.5 + 24;

  city.ready = true;
  city.bakeId = CITY_BAKE_ID;
  city.houseCount = houseBoxes.length;
  const fx = 40.97;
  const fz = 30.6;
  let sx = fx;
  let sz = fz;
  let sy = cityLowestSurface(fx, fz);
  const probes: [number, number][] = [
    [0, 0],
    [0, 4],
    [4, 0],
    [-3, 2],
    [0, -3],
    [2, 3.4],
    [-2, 3.4],
  ];
  for (const [dx, dz] of probes) {
    const y = cityLowestSurface(fx + dx, fz + dz);
    if (y > 0.08 && y < 1.8) {
      sx = fx + dx;
      sz = fz + dz;
      sy = y;
      break;
    }
  }
  city.spawn = { x: sx, y: sy, z: sz, yaw: 0, pitch: -0.06 };
  city.portal = { x: sx, z: sz, r: 1.85 };
  gatherColliders(sx - 3, sx + 3, sz - 3, sz + 3, _query);
  city.probeN = _query.length;
  city.probeY = cityRayDown(sx, city.maxY + 80, sz, city.maxY + 220);
}

const _ray = new THREE.Ray();
const _dirN = new THREE.Vector3();
const _query: Collider[] = [];
const _inv = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _hitP = new THREE.Vector3();
const _worldDir = new THREE.Vector3();
const _origin = new THREE.Vector3();

function prepareRay(col: Collider, origin: THREE.Vector3, dir: THREE.Vector3) {
  if (col.world) {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir).normalize();
    return 1;
  }
  _world.copy(col.mesh.matrixWorld);
  _inv.copy(_world).invert();
  _ray.origin.copy(origin).applyMatrix4(_inv);
  _ray.direction.copy(dir).transformDirection(_inv).normalize();
  return col.scale || meshScale(col.mesh);
}

function hitToWorld(col: Collider, hit: THREE.Intersection, origin: THREE.Vector3, dir: THREE.Vector3, scale: number) {
  if (hit.point) {
    if (col.world) _hitP.copy(hit.point);
    else _hitP.copy(hit.point).applyMatrix4(col.mesh.matrixWorld);
  } else {
    _hitP.copy(origin).addScaledVector(dir, hit.distance * scale);
  }
  return _hitP;
}

export function cityRayDown(x: number, fromY: number, z: number, maxDist: number): number | null {
  if (!city.colliders.length) return null;
  gatherColliders(x - 2.5, x + 2.5, z - 2.5, z + 2.5, _query);
  if (!_query.length) return null;
  let best = maxDist + 1;
  let hitY: number | null = null;
  _dirN.set(0, -1, 0);
  const origin = _origin.set(x, fromY, z);
  for (const col of _query) {
    if (fromY < col.box.minY - 0.02) continue;
    if (fromY - maxDist > col.box.maxY + 0.02) continue;
    const s = prepareRay(col, origin, _dirN);
    const far = col.world ? maxDist : maxDist / s;
    const hit = col.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
    if (!hit || hit.distance < 0) continue;
    hitToWorld(col, hit, origin, _dirN, s);
    const distW = fromY - _hitP.y;
    if (distW < -0.02 || distW > maxDist || distW >= best) continue;
    if (Math.abs(_hitP.x - x) > 1.6 || Math.abs(_hitP.z - z) > 1.6) continue;
    best = distW;
    hitY = _hitP.y;
  }
  return hitY;
}

/** Lowest solid surface under (x,z) — lawn rather than an overhanging roof. */
export function cityLowestSurface(x: number, z: number, minY = 0.04, maxY = 8) {
  const top = Math.max(city.maxY + 80, 80);
  const span = top - city.minY + 40;
  if (!city.colliders.length) return 0;
  gatherColliders(x - 2.5, x + 2.5, z - 2.5, z + 2.5, _query);
  _dirN.set(0, -1, 0);
  const origin = _origin.set(x, top, z);
  let lowest: number | null = null;
  for (const col of _query) {
    if (col.box.maxY < minY - 0.02) continue;
    const s = prepareRay(col, origin, _dirN);
    const hits = col.bvh.raycast(_ray, THREE.DoubleSide, 0, col.world ? span : span / s);
    for (const hit of hits) {
      if (!hit) continue;
      hitToWorld(col, hit, origin, _dirN, s);
      const y = _hitP.y;
      if (y < minY || y > maxY) continue;
      if (Math.abs(_hitP.x - x) > 1.8 || Math.abs(_hitP.z - z) > 1.8) continue;
      if (lowest == null || y < lowest) lowest = y;
    }
  }
  if (lowest != null) return lowest;
  const y = cityRayDown(x, top, z, span);
  return y != null ? y : 0;
}

export function citySurfaceAt(x: number, z: number) {
  const top = Math.max(city.maxY + 120, 120);
  const span = top - city.minY + 80;
  const y = cityRayDown(x, top, z, span);
  if (y != null) return y;
  const offsets: [number, number][] = [
    [0, 2],
    [2, 0],
    [0, -2],
    [-2, 0],
    [4, 0],
    [0, 4],
    [-4, 0],
    [0, -4],
  ];
  for (const [dx, dz] of offsets) {
    const alt = cityRayDown(x + dx, top, z + dz, span);
    if (alt != null) return alt;
  }
  return 0;
}

export function cityGroundY(x: number, z: number) {
  return citySurfaceAt(x, z);
}

export function cityRayPick(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDist = 4000,
): { x: number; y: number; z: number } | null {
  if (!city.ready || !city.colliders.length) return null;
  _dirN.copy(direction);
  if (_dirN.lengthSq() < 1e-10) return null;
  _dirN.normalize();
  const endX = origin.x + _dirN.x * maxDist;
  const endZ = origin.z + _dirN.z * maxDist;
  gatherColliders(
    Math.min(origin.x, endX) - 4,
    Math.max(origin.x, endX) + 4,
    Math.min(origin.z, endZ) - 4,
    Math.max(origin.z, endZ) + 4,
    _query,
  );
  let best = maxDist + 1;
  let point: { x: number; y: number; z: number } | null = null;
  for (const col of _query) {
    const s = prepareRay(col, origin, _dirN);
    const far = col.world ? maxDist : maxDist / s;
    const hit = col.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
    if (!hit || hit.distance < 0) continue;
    hitToWorld(col, hit, origin, _dirN, s);
    const distW = origin.distanceTo(_hitP);
    if (distW > maxDist || distW >= best) continue;
    best = distW;
    point = { x: _hitP.x, y: _hitP.y, z: _hitP.z };
  }
  return point;
}

const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _dir = new THREE.Vector3();

export type CapsuleHit = { x: number; y: number; z: number; grounded: boolean };

/** Push a vertical capsule out of city triangles. Feet at (x,y,z). */
export function cityMoveCapsule(
  px: number,
  py: number,
  pz: number,
  radius: number,
  height: number,
  dx: number,
  dy: number,
  dz: number,
  snapGround = true,
): CapsuleHit {
  let x = px + dx;
  let y = py + dy;
  let z = pz + dz;
  x = THREE.MathUtils.clamp(x, city.minX, city.maxX);
  z = THREE.MathUtils.clamp(z, city.minZ, city.maxZ);
  if (!city.ready || !city.colliders.length) return { x, y, z, grounded: y <= city.minY + 0.04 };

  const capH = Math.max(height, radius * 2.08);
  const pad = radius + Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dy)) + 0.45;
  gatherColliders(x - pad, x + pad, z - pad, z + pad, _query);

  let grounded = false;
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (const col of _query) {
      const b = col.box;
      if (y + capH < b.minY - 0.02 || y > b.maxY + 0.02) continue;
      if (x + radius < b.minX - 0.02 || x - radius > b.maxX + 0.02) continue;
      if (z + radius < b.minZ - 0.02 || z - radius > b.maxZ + 0.02) continue;

      let localR = radius;
      if (col.world) {
        _seg.start.set(x, y + radius, z);
        _seg.end.set(x, y + capH - radius, z);
      } else {
        _world.copy(col.mesh.matrixWorld);
        _inv.copy(_world).invert();
        const s = col.scale || meshScale(col.mesh);
        localR = radius / s;
        _seg.start.set(x, y + radius, z).applyMatrix4(_inv);
        _seg.end.set(x, y + capH - radius, z).applyMatrix4(_inv);
      }
      _box.makeEmpty();
      _box.expandByPoint(_seg.start);
      _box.expandByPoint(_seg.end);
      _box.min.addScalar(-localR);
      _box.max.addScalar(localR);
      let hit = false;
      col.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(_box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
          if (dist < localR) {
            const depth = localR - dist;
            _dir.copy(_capPoint).sub(_triPoint);
            if (_dir.lengthSq() < 1e-12) tri.getNormal(_dir);
            else _dir.normalize();
            _seg.start.addScaledVector(_dir, depth);
            _seg.end.addScaledVector(_dir, depth);
            hit = true;
            if (col.world) {
              if (_dir.y > 0.55) grounded = true;
            } else {
              _worldDir.copy(_dir).transformDirection(col.mesh.matrixWorld);
              if (_worldDir.y > 0.55) grounded = true;
            }
          }
          return false;
        },
      });
      if (!hit) continue;
      if (col.world) {
        x = _seg.start.x;
        y = _seg.start.y - radius;
        z = _seg.start.z;
      } else {
        _seg.start.applyMatrix4(col.mesh.matrixWorld);
        x = _seg.start.x;
        y = _seg.start.y - radius;
        z = _seg.start.z;
      }
      moved = true;
    }
    if (!moved) break;
  }

  x = THREE.MathUtils.clamp(x, city.minX, city.maxX);
  z = THREE.MathUtils.clamp(z, city.minZ, city.maxZ);

  if (dy < 0 && snapGround) {
    const gy = cityRayDown(x, y + Math.max(capH, 1.35), z, Math.max(capH + 0.85, 2.2));
    if (gy != null && y - gy <= 0.55 && y - gy >= -0.4) {
      y = gy;
      grounded = true;
    }
  }

  if (y < city.minY) {
    y = city.minY;
    grounded = true;
  }

  return { x, y, z, grounded };
}

/** Horizontal-only helper used by older call sites. */
export function cityResolve(x: number, y: number, z: number, radius = PLAYER_R) {
  const hit = cityMoveCapsule(x, y, z, radius, 1.6, 0, 0, 0);
  return { x: hit.x, z: hit.z };
}

export function worldToMapUV(x: number, z: number) {
  const u = 0.5 + (x - city.mapCx) / (2 * city.mapHalf);
  const v = 0.5 + (z - city.mapCz) / (2 * city.mapHalf);
  return { u, v };
}

export function mapUVToWorld(u: number, v: number) {
  const x = city.mapCx + (u - 0.5) * 2 * city.mapHalf;
  const z = city.mapCz + (v - 0.5) * 2 * city.mapHalf;
  return { x, z };
}

export function bakeCityMinimap(_renderer: THREE.WebGLRenderer, _scene: THREE.Scene) {
  /* live map camera replaces the baked JPEG */
}

export type CityDebugBox = Aabb & { kind: "solid" };

export function getCityDebugAabbs(x: number, z: number, radius = 22, maxN = 56): CityDebugBox[] {
  if (!city.ready) return [];
  gatherColliders(x - radius, x + radius, z - radius, z + radius, _query);
  const scored: { col: Collider; d: number }[] = [];
  for (const col of _query) {
    const cx = (col.box.minX + col.box.maxX) * 0.5;
    const cz = (col.box.minZ + col.box.maxZ) * 0.5;
    const dx = cx - x;
    const dz = cz - z;
    scored.push({ col, d: dx * dx + dz * dz });
  }
  scored.sort((a, b) => a.d - b.d);
  const out: CityDebugBox[] = [];
  for (let i = 0; i < scored.length && out.length < maxN; i++) {
    out.push({ ...scored[i]!.col.box, kind: "solid" });
  }
  return out;
}

export function nearHomeExit(x: number, z: number) {
  const dx = x - HOME_EXIT.x;
  const dz = z - HOME_EXIT.z;
  return dx * dx + dz * dz <= HOME_EXIT.r * HOME_EXIT.r;
}

export function nearCityPortal(x: number, z: number) {
  const dx = x - city.portal.x;
  const dz = z - city.portal.z;
  const r = city.portal.r;
  return dx * dx + dz * dz <= r * r;
}
