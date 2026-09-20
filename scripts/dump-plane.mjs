import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { readFileSync, writeFileSync } from "fs";

// Stub browser bits GLTFLoader may need
if (!globalThis.document) {
  globalThis.document = { createElementNS: () => ({ style: {} }) };
}

const buf = readFileSync("/workspace/public/models/plane.glb");
const loader = new GLTFLoader();
const ready = MeshoptDecoder.ready;
if (ready) await ready;
loader.setMeshoptDecoder(MeshoptDecoder);

const gltf = await new Promise((resolve, reject) => {
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "/models/", resolve, reject);
});

const scene = gltf.scene;
scene.updateMatrixWorld(true);

const rows = [];
const box = new THREE.Box3();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
const eul = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const q = new THREE.Quaternion();

scene.traverse((o) => {
  box.setFromObject(o);
  if (!box.isEmpty()) {
    box.getSize(size);
    box.getCenter(center);
  } else {
    size.set(0,0,0);
    center.set(0,0,0);
  }
  o.getWorldPosition(p);
  o.getWorldScale(s);
  o.getWorldQuaternion(q);
  eul.setFromQuaternion(q, "XYZ");
  const parent = o.parent ? o.parent.name : "";
  rows.push({
    name: o.name,
    type: o.type,
    parent,
    depth: 0,
    pos: [o.position.x, o.position.y, o.position.z].map(n => +n.toFixed(4)),
    eul: [o.rotation.x, o.rotation.y, o.rotation.z].map(n => +n.toFixed(4)),
    scale: [o.scale.x, o.scale.y, o.scale.z].map(n => +n.toFixed(4)),
    wpos: [p.x, p.y, p.z].map(n => +n.toFixed(4)),
    weul: [eul.x, eul.y, eul.z].map(n => +n.toFixed(4)),
    wscale: [s.x, s.y, s.z].map(n => +n.toFixed(4)),
    aabbC: [center.x, center.y, center.z].map(n => +n.toFixed(4)),
    aabbS: [size.x, size.y, size.z].map(n => +n.toFixed(4)),
    children: o.children.map(c => c.name),
  });
});

// compute depth
function depthOf(name, parent) {
  let d = 0;
  let cur = parent;
  const map = new Map(rows.map(r => [r.name + "|" + r.parent, r]));
  // simpler: just from traverse later
  return d;
}

writeFileSync("/tmp/plane-nodes.json", JSON.stringify(rows, null, 2));

const interesting = /wheel|gear|aileron|elevator|rudder|flap|canopy|hatch|door|nozzle|vector|engine|exhaust|wing|stab|tail|fuselage|cockpit|bonnet|nose|thrust|afterburn/i;
console.log("TOTAL", rows.length);
console.log("\n=== INTERESTING ===");
for (const r of rows) {
  if (interesting.test(r.name) || interesting.test(r.parent)) {
    console.log(
      r.name.padEnd(32),
      r.type.padEnd(10),
      "par=" + String(r.parent).slice(0,24).padEnd(24),
      "pos", r.pos.join(","),
      "eul", r.eul.join(","),
      "aabbC", r.aabbC.join(","),
      "aabbS", r.aabbS.join(","),
      "ch", r.children.slice(0,6).join("|")
    );
  }
}

console.log("\n=== TOP NAMES ===");
for (const r of rows.filter(r => r.type !== "Mesh").slice(0, 80)) {
  console.log(r.name, r.type, "parent="+r.parent, "ch="+r.children.length);
}
