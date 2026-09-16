import * as THREE from "three";

export const CITY_URL = "/models/city.glb";
export const CITY_BYTES = 8_037_544;
/** Sketchfab already bakes 0.01 (cm→m). Keep 1. */
export const CITY_SCALE = 1;

export const HOME_EXIT = { x: -1.62, y: 0, z: 0.12, r: 1.05 };
export const HOME_RETURN_SPAWN = { x: -1.12, y: 0, z: 0.12, yaw: -Math.PI / 2, pitch: -0.08 };

type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

type CityRuntime = {
  group: THREE.Group | null;
  solids: Aabb[];
  hash: Map<number, number[]>;
  heights: Map<number, number>;
  spawn: { x: number; y: number; z: number; yaw: number; pitch: number };
  portal: { x: number; z: number; r: number };
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  ready: boolean;
};

const CELL = 8;
const HCELL = 4;
const PLAYER_R = 0.32;

const city: CityRuntime = {
  group: null,
  solids: [],
  hash: new Map(),
  heights: new Map(),
  spawn: { x: 42.5, y: 0, z: 40.2, yaw: 0, pitch: -0.06 },
  portal: { x: 42.5, z: 40.2, r: 1.8 },
  minX: -1800,
  maxX: 1300,
  minZ: -1500,
  maxZ: 1550,
  ready: false,
};

export function getCityRuntime() {
  return city;
}

export function getCitySpawn() {
  return city.spawn;
}

function cellKey(ix: number, iz: number) {
  return ((ix + 32768) << 16) | (iz + 32768);
}

function kindOf(name: string): "ground" | "solid" | "skip" {
  const n = name.toLowerCase();
  if (/water/.test(n) && !/ground/.test(n)) return "skip";
  if (/grass|green_|garden|ground|boulevard_ground|docks_ground|island_ground|hotel_ground|richarea|businessdistrict|sidewalk/.test(n)) {
    return "ground";
  }
  if (/palm|tree|parasol|flag|golf|lightpole|radar|crane/.test(n)) return "skip";
  return "solid";
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

function pushHeight(x: number, z: number, y: number) {
  const ix = Math.floor(x / HCELL);
  const iz = Math.floor(z / HCELL);
  const k = cellKey(ix, iz);
  const prev = city.heights.get(k);
  if (prev === undefined || y > prev) city.heights.set(k, y);
}

function fillHeightBox(b: Aabb, y: number) {
  const x0 = Math.floor(b.minX / HCELL);
  const x1 = Math.floor(b.maxX / HCELL);
  const z0 = Math.floor(b.minZ / HCELL);
  const z1 = Math.floor(b.maxZ / HCELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = cellKey(ix, iz);
      const prev = city.heights.get(k);
      if (prev === undefined || y > prev) city.heights.set(k, y);
    }
  }
}

function addSolid(b: Aabb) {
  const i = city.solids.length;
  city.solids.push(b);
  const x0 = Math.floor(b.minX / CELL);
  const x1 = Math.floor(b.maxX / CELL);
  const z0 = Math.floor(b.minZ / CELL);
  const z1 = Math.floor(b.maxZ / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const k = cellKey(ix, iz);
      let list = city.hash.get(k);
      if (!list) {
        list = [];
        city.hash.set(k, list);
      }
      list.push(i);
    }
  }
}

function mergeBoxes(list: Aabb[]): Aabb | null {
  if (!list.length) return null;
  const b = { ...list[0]! };
  for (let i = 1; i < list.length; i++) {
    const n = list[i]!;
    b.minX = Math.min(b.minX, n.minX);
    b.minY = Math.min(b.minY, n.minY);
    b.minZ = Math.min(b.minZ, n.minZ);
    b.maxX = Math.max(b.maxX, n.maxX);
    b.maxY = Math.max(b.maxY, n.maxY);
    b.maxZ = Math.max(b.maxZ, n.maxZ);
  }
  return b;
}

export function bakeCityCollision(root: THREE.Group) {
  city.group = root;
  city.solids = [];
  city.hash = new Map();
  city.heights = new Map();
  city.ready = false;
  root.updateMatrixWorld(true);

  const _box = new THREE.Box3();
  const houseBoxes: Aabb[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

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
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    _box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (!Number.isFinite(_box.min.x) || _box.isEmpty()) return;
    const aabb: Aabb = {
      minX: _box.min.x,
      minY: _box.min.y,
      minZ: _box.min.z,
      maxX: _box.max.x,
      maxY: _box.max.y,
      maxZ: _box.max.z,
    };
    minX = Math.min(minX, aabb.minX);
    maxX = Math.max(maxX, aabb.maxX);
    minZ = Math.min(minZ, aabb.minZ);
    maxZ = Math.max(maxZ, aabb.maxZ);
    const w = aabb.maxX - aabb.minX;
    const h = aabb.maxY - aabb.minY;
    const d = aabb.maxZ - aabb.minZ;
    const name = collectName(mesh);
    const kind = kindOf(name);
    if (kind === "ground") {
      fillHeightBox(aabb, aabb.maxY);
      return;
    }
    if (kind === "skip") return;
    if (h < 0.48 && aabb.maxY < 0.7) {
      fillHeightBox(aabb, aabb.maxY);
      return;
    }
    if (h < 0.55 && Math.max(w, d) < 0.7) return;
    addSolid(aabb);
    if (/\bHouse_2B\b/.test(name) && !/fence/i.test(name)) houseBoxes.push(aabb);
  });

  city.minX = Number.isFinite(minX) ? minX + 4 : -1800;
  city.maxX = Number.isFinite(maxX) ? maxX - 4 : 1300;
  city.minZ = Number.isFinite(minZ) ? minZ + 4 : -1500;
  city.maxZ = Number.isFinite(maxZ) ? maxZ - 4 : 1550;

  const home = mergeBoxes(houseBoxes);
  if (home) {
    const cx = (home.minX + home.maxX) * 0.5;
    const cz = home.maxZ + 3.4;
    const gy = cityGroundY(cx, cz);
    city.spawn = { x: cx, y: gy, z: cz, yaw: 0, pitch: -0.06 };
    city.portal = { x: cx, z: cz, r: 1.85 };
  } else {
    city.spawn.y = cityGroundY(city.spawn.x, city.spawn.z);
    city.portal.x = city.spawn.x;
    city.portal.z = city.spawn.z;
  }
  city.ready = true;
}

export function cityGroundY(x: number, z: number) {
  const ix = Math.floor(x / HCELL);
  const iz = Math.floor(z / HCELL);
  let best = Number.NEGATIVE_INFINITY;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const y = city.heights.get(cellKey(ix + dx, iz + dz));
      if (y !== undefined && y > best) best = y;
    }
  }
  if (best === Number.NEGATIVE_INFINITY) return 0;
  return best;
}

export function cityResolve(x: number, y: number, z: number, radius = PLAYER_R) {
  x = THREE.MathUtils.clamp(x, city.minX, city.maxX);
  z = THREE.MathUtils.clamp(z, city.minZ, city.maxZ);
  const ix0 = Math.floor((x - radius) / CELL);
  const ix1 = Math.floor((x + radius) / CELL);
  const iz0 = Math.floor((z - radius) / CELL);
  const iz1 = Math.floor((z + radius) / CELL);
  const seen = new Set<number>();
  const head = y + 1.55;
  const feet = y + 0.12;
  for (let pass = 0; pass < 3; pass++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const list = city.hash.get(cellKey(ix, iz));
        if (!list) continue;
        for (const i of list) {
          if (pass === 0 && seen.has(i)) continue;
          seen.add(i);
          const b = city.solids[i]!;
          if (head < b.minY || feet > b.maxY) continue;
          const nx = THREE.MathUtils.clamp(x, b.minX, b.maxX);
          const nz = THREE.MathUtils.clamp(z, b.minZ, b.maxZ);
          const dx = x - nx;
          const dz = z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          if (d2 < 1e-8) {
            const left = x - b.minX;
            const right = b.maxX - x;
            const back = z - b.minZ;
            const fwd = b.maxZ - z;
            const m = Math.min(left, right, back, fwd);
            if (m === left) x = b.minX - radius;
            else if (m === right) x = b.maxX + radius;
            else if (m === back) z = b.minZ - radius;
            else z = b.maxZ + radius;
          } else {
            const d = Math.sqrt(d2);
            const k = (radius - d) / d;
            x += dx * k;
            z += dz * k;
          }
        }
      }
    }
  }
  x = THREE.MathUtils.clamp(x, city.minX, city.maxX);
  z = THREE.MathUtils.clamp(z, city.minZ, city.maxZ);
  return { x, z };
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
