/**
 * Mixamo → VELA clip baker.
 *
 * Dance import rules — breaking these warped the whole body:
 *  1. AIM SWING only (setFromUnitVectors). Forearm twist ±0.55 extra.
 *     Do not match Mixamo's full orthonormal frame (adds bind roll).
 *  2. Do not cap per-frame angular velocity.
 *  3. Hip yaw is local on C_Hip_a only. Children worldQ uses pre-yaw hip.
 *  4. Store dance as unit quaternions with sign continuity; runtime slerps.
 *     Euler lerp on overhead arms is the dance 4/5 twitch.
 *  5. Hands = wrist aim (Hand→Middle1). No extra finger chains.
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const SRC = "/tmp/mixamo";
const OUT = path.resolve("src/lib/softbody/loco-clips.json");
const FRAMES = 12;

const FILES = {
  walk: "Walking.fbx",
  walkBack: "Walking_Backwards.fbx",
  walkLeft: "Walk_Strafe_Left.fbx",
  walkRight: "Walk_Strafe_Right.fbx",
  crouchIdle: "Crouch_Idle.fbx",
  crouchWalk: "Crouch_Walk_Forward.fbx",
  crouchBack: "Crouch_Walk_Back.fbx",
  crouchLeft: "Crouch_Walk_Strafe_Left.fbx",
  crouchRight: "Crouch_Walk_Strafe_Right.fbx",
  crawl: "Crawling.fbx",
  proneIdle: "Prone_Idle.fbx",
  proneWalk: "Prone_Forward.fbx",
  jump: "Jump.fbx",
};

const CHAINS = [
  { mix: ["mixamorigHips", "mixamorigSpine"], ours: "C_Hip_a", child: "C_Spine_a" },
  { mix: ["mixamorigSpine", "mixamorigSpine1"], ours: "C_Spine_a", child: "C_Spine_b" },
  { mix: ["mixamorigSpine1", "mixamorigSpine2"], ours: "C_Spine_b", child: "C_Spine_c" },
  { mix: ["mixamorigSpine2", "mixamorigNeck"], ours: "C_Spine_c", child: "C_Spine_d" },
  { mix: ["mixamorigLeftUpLeg", "mixamorigLeftLeg"], ours: "L_UpperLeg_a", child: "L_Foreleg_a" },
  { mix: ["mixamorigRightUpLeg", "mixamorigRightLeg"], ours: "R_UpperLeg_a", child: "R_Foreleg_a" },
  { mix: ["mixamorigLeftLeg", "mixamorigLeftFoot"], ours: "L_Foreleg_a", child: "L_Foot_a" },
  { mix: ["mixamorigRightLeg", "mixamorigRightFoot"], ours: "R_Foreleg_a", child: "R_Foot_a" },
  { mix: ["mixamorigLeftFoot", "mixamorigLeftToeBase"], ours: "L_Foot_a", child: "L_Toe_a" },
  { mix: ["mixamorigRightFoot", "mixamorigRightToeBase"], ours: "R_Foot_a", child: "R_Toe_a" },
  { mix: ["mixamorigLeftArm", "mixamorigLeftForeArm"], ours: "L_UpperArm_a", child: "L_Forearm_a" },
  { mix: ["mixamorigRightArm", "mixamorigRightForeArm"], ours: "R_UpperArm_a", child: "R_Forearm_a" },
  { mix: ["mixamorigLeftForeArm", "mixamorigLeftHand"], ours: "L_Forearm_a", child: "L_Hand_a" },
  { mix: ["mixamorigRightForeArm", "mixamorigRightHand"], ours: "R_Forearm_a", child: "R_Hand_a" },
];

const PARENT = {
  C_Hip_a: null,
  C_Spine_a: "C_Hip_a",
  C_Spine_b: "C_Spine_a",
  C_Spine_c: "C_Spine_b",
  C_Spine_d: "C_Spine_c",
  L_UpperLeg_a: "C_Hip_a",
  R_UpperLeg_a: "C_Hip_a",
  L_Foreleg_a: "L_UpperLeg_a",
  R_Foreleg_a: "R_UpperLeg_a",
  L_Foot_a: "L_Foreleg_a",
  R_Foot_a: "R_Foreleg_a",
  L_Shoulder_a: "C_Spine_d",
  R_Shoulder_a: "C_Spine_d",
  L_UpperArm_a: "L_Shoulder_a",
  R_UpperArm_a: "R_Shoulder_a",
  L_Forearm_a: "L_UpperArm_a",
  R_Forearm_a: "R_UpperArm_a",
  L_Hand_a: "L_Forearm_a",
  R_Hand_a: "R_Forearm_a",
  C_Neck_a: "C_Spine_d",
};

const DANCE_FILES = {
  dance1: "Dancing_Twerk.fbx",
  dance2: "Samba_Dancing.fbx",
  dance3: "Jazz_Dancing.fbx",
  dance4: "Dancing_Maraschino_Step.fbx",
  dance5: "Snake_Hip_Hop_Dance.fbx",
  dance6: "Breakdance_Footwork_1.fbx",
  dance7: "Northern_Soul_Spin_Combo.fbx",
  dance8: "Breakdance_Footwork_To_Idle.fbx",
};
const DANCE = new Set(Object.keys(DANCE_FILES));
const ONLY_DANCE = process.argv.includes("dance");

const DANCE_CHAINS = [
  { mix: ["mixamorigLeftShoulder", "mixamorigLeftArm"], ours: "L_Shoulder_a", child: "L_UpperArm_a" },
  { mix: ["mixamorigRightShoulder", "mixamorigRightArm"], ours: "R_Shoulder_a", child: "R_UpperArm_a" },
  { mix: ["mixamorigNeck", "mixamorigHead"], ours: "C_Neck_a", child: "C_Head_a" },
  { mix: ["mixamorigLeftHand", "mixamorigLeftHandMiddle1"], ours: "L_Hand_a", child: "L_Middle_a" },
  { mix: ["mixamorigRightHand", "mixamorigRightHandMiddle1"], ours: "R_Hand_a", child: "R_Middle_a" },
];

const TWIST_BONES = new Set(["L_Forearm_a", "R_Forearm_a"]);
const RECUMBENT = new Set(["proneIdle", "proneWalk", "crawl"]);


const native = JSON.parse(fs.readFileSync("src/lib/softbody/nude-rig-data.json", "utf8")).bones;
const restPos = Object.fromEntries(native.map((b) => [b.name, new THREE.Vector3(b.x, b.y, b.z)]));

function restDir(ours, child) {
  const a = restPos[ours];
  const b = restPos[child];
  if (!a || !b) throw new Error(`missing rest ${ours}→${child}`);
  return b.clone().sub(a).normalize();
}

function restSide(dir) {
  const up = Math.abs(dir.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(up, dir).normalize();
}

function parseFbx(file) {
  const buf = fs.readFileSync(path.join(SRC, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new FBXLoader().parse(ab, "");
}

function poseAt(obj, t) {
  const clip = obj.animations[0];
  if (!obj.userData._mixer) {
    obj.userData._mixer = new THREE.AnimationMixer(obj);
    obj.userData._mixer.clipAction(clip).play();
  }
  obj.userData._mixer.setTime(Math.min(Math.max(t, 0), clip.duration * 0.999));
  obj.updateMatrixWorld(true);
}

const Y_UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _mx = new THREE.Vector3();
const _my = new THREE.Vector3();
const _mz = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

function mixDirRaw(obj, from, to) {
  const a = obj.getObjectByName(from);
  const b = obj.getObjectByName(to);
  if (!a || !b) return null;
  a.getWorldPosition(_pa);
  b.getWorldPosition(_pb);
  return _pb.sub(_pa).normalize().clone();
}

function standHipY(obj) {
  const clip = obj.animations[0];
  const hipTrack = clip.tracks.find((t) => t.name === "mixamorigHips.position");
  if (!hipTrack) return 98;
  const y0 = hipTrack.createInterpolant().evaluate(0)[1] ?? 98;
  return y0 > 70 ? y0 : 98;
}

function facingCancel(obj, hipTrack, dur, name) {
  // Recumbent clips: thighs point toward the feet, so knee-average facing
  // yaws the whole body ~180° and turns belly-down into a backbend.
  if (RECUMBENT.has(name)) {
    const hips = obj.getObjectByName("mixamorigHips");
    const head =
      obj.getObjectByName("mixamorigHead") ||
      obj.getObjectByName("mixamorigNeck") ||
      obj.getObjectByName("mixamorigSpine2");
    if (hips && head) {
      hips.getWorldPosition(_pa);
      head.getWorldPosition(_pb);
      _f.copy(_pb).sub(_pa);
      _f.y = 0;
      if (_f.lengthSq() > 1e-4) {
        _f.normalize();
        return -Math.atan2(_f.x, _f.z);
      }
    }
  }
  const L = mixDirRaw(obj, "mixamorigLeftUpLeg", "mixamorigLeftLeg");
  const R = mixDirRaw(obj, "mixamorigRightUpLeg", "mixamorigRightLeg");
  let travel = 0;
  if (hipTrack) {
    const p0 = hipTrack.createInterpolant().evaluate(0);
    const p1 = hipTrack.createInterpolant().evaluate(dur * 0.99);
    travel = Math.hypot((p1[0] ?? 0) - (p0[0] ?? 0), (p1[2] ?? 0) - (p0[2] ?? 0));
  }
  if (travel < 25 && L && R) {
    _f.copy(L).add(R);
    _f.y = 0;
    if (_f.lengthSq() > 1e-4) {
      _f.normalize();
      return -Math.atan2(_f.x, _f.z);
    }
  }
  const hips = obj.getObjectByName("mixamorigHips");
  hips.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q);
  _f.y = 0;
  if (_f.lengthSq() < 1e-8) return 0;
  _f.normalize();
  return -Math.atan2(_f.x, _f.z);
}

function toOurSpace(v, yaw) {
  v.applyAxisAngle(Y_UP, yaw);
  return v;
}

function mixDir(obj, from, to, yaw) {
  const a = obj.getObjectByName(from);
  const b = obj.getObjectByName(to);
  if (!a || !b) return null;
  a.getWorldPosition(_pa);
  b.getWorldPosition(_pb);
  const d = _pb.sub(_pa);
  if (d.lengthSq() < 1e-8) return null;
  return toOurSpace(d.normalize(), yaw);
}

function mixSide(obj, from, aim, yaw) {
  const bone = obj.getObjectByName(from);
  if (!bone) return null;
  bone.matrixWorld.extractBasis(_mx, _my, _mz);
  let best = _mx;
  let score = -1;
  for (const c of [_mx, _mz]) {
    const s = 1 - Math.abs(c.dot(aim));
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return toOurSpace(best.clone().normalize(), yaw);
}

function swingTwist(restAim, restLat, targetAim, targetLat, useTwist) {
  const swing = new THREE.Quaternion().setFromUnitVectors(restAim, targetAim);
  if (!useTwist || !targetLat || targetLat.lengthSq() < 1e-6) return swing;
  const side1 = restLat.clone().applyQuaternion(swing);
  const n = targetAim;
  const a = side1.addScaledVector(n, -side1.dot(n));
  const b = targetLat.clone().addScaledVector(n, -targetLat.dot(n));
  if (a.lengthSq() < 1e-6 || b.lengthSq() < 1e-6) return swing;
  a.normalize();
  b.normalize();
  let ang = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  const cr = new THREE.Vector3().crossVectors(a, b);
  if (cr.dot(n) < 0) ang = -ang;
  ang = THREE.MathUtils.clamp(ang, -0.55, 0.55);
  return new THREE.Quaternion().setFromAxisAngle(n, ang).multiply(swing);
}

function ancestorWorld(name, worldQ) {
  let p = PARENT[name];
  while (p) {
    if (worldQ[p]) return worldQ[p].clone();
    p = PARENT[p];
  }
  return new THREE.Quaternion();
}

function hipFacingTheta(obj) {
  const hips = obj.getObjectByName("mixamorigHips");
  if (!hips) return 0;
  hips.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q);
  _f.y = 0;
  if (_f.lengthSq() < 1e-8) return 0;
  _f.normalize();
  return Math.atan2(_f.x, _f.z);
}

function unwrapYaw(prev, now) {
  let d = now - prev;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return prev + d;
}

function qFlip(q) {
  q.x = -q.x;
  q.y = -q.y;
  q.z = -q.z;
  q.w = -q.w;
  return q;
}

function chainsFor(name) {
  if (!DANCE.has(name)) return CHAINS;
  return [
    ...CHAINS.slice(0, 4),
    ...DANCE_CHAINS.filter((c) => /Shoulder/.test(c.ours)),
    ...CHAINS.slice(4),
    ...DANCE_CHAINS.filter((c) => !/Shoulder/.test(c.ours)),
  ];
}

const restAim = {};
const restLat = {};
for (const c of [...CHAINS, ...DANCE_CHAINS]) {
  restAim[c.ours] = restDir(c.ours, c.child);
  restLat[c.ours] = restSide(restAim[c.ours]);
}

function bakeOne(name, file) {
  const obj = parseFbx(file);
  const clip = obj.animations[0];
  const hipTrack = clip.tracks.find((t) => t.name === "mixamorigHips.position");
  const dur = clip.duration;
  const isDance = DANCE.has(name);
  const bindY = name === "jump" ? 99 : 98;
  const nFrames = isDance
    ? Math.max(24, Math.round(dur * 8))
    : name === "jump" || name === "proneWalk"
      ? 16
      : FRAMES;
  const chainList = chainsFor(name);
  poseAt(obj, 0);
  const theta0 = hipFacingTheta(obj);
  let yawAcc = 0;
  const bones = {};
  const hipY = [];
  const prevQ = {};
  for (let i = 0; i < nFrames; i++) {
    const t = (i / nFrames) * dur;
    poseAt(obj, t);
    const yaw = isDance ? -theta0 : facingCancel(obj, hipTrack, dur, name);
    if (isDance) yawAcc = unwrapYaw(yawAcc, hipFacingTheta(obj) - theta0);
    const hip = hipTrack ? hipTrack.createInterpolant().evaluate(t) : [0, bindY, 0];
    let hy = ((hip[1] ?? bindY) - bindY) * 0.01;
    if (name === "jump") hy = Math.min(0, hy);
    hipY.push(+hy.toFixed(4));

    const worldQ = {};
    for (const chain of chainList) {
      const targetAim = mixDir(obj, chain.mix[0], chain.mix[1], yaw);
      if (!targetAim) continue;
      const targetLat = mixSide(obj, chain.mix[0], targetAim, yaw);
      const R = swingTwist(
        restAim[chain.ours],
        restLat[chain.ours],
        targetAim,
        targetLat,
        TWIST_BONES.has(chain.ours),
      );
      const Pw = ancestorWorld(chain.ours, worldQ);
      const poseQ = Pw.clone().invert().multiply(R);
      worldQ[chain.ours] = Pw.clone().multiply(poseQ);
      _e.setFromQuaternion(poseQ, "XYZ");
      let x = _e.x;
      let y = _e.y;
      let z = _e.z;
      if (chain.ours === "C_Hip_a") y = isDance ? yawAcc : 0;
      if (RECUMBENT.has(name) && chain.ours === "C_Hip_a") {
        x = Math.abs(x);
        if (name === "proneIdle") x = Math.max(x, 1.2);
        else if (name === "proneWalk") x = Math.max(x, 1.05);
        else x = Math.max(x, 0.88);
      }
      if (/UpperArm/.test(chain.ours) && name !== "jump" && !isDance) {
        y = THREE.MathUtils.clamp(y, -0.22, 0.22);
        z = THREE.MathUtils.clamp(z, -0.42, 0.42);
      }
      if (!bones[chain.ours]) bones[chain.ours] = [];
      if (isDance) {
        const q = new THREE.Quaternion().setFromEuler(_e.set(x, y, z, "XYZ"));
        if (prevQ[chain.ours] && q.dot(prevQ[chain.ours]) < 0) qFlip(q);
        prevQ[chain.ours] = q.clone();
        bones[chain.ours].push([+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)]);
      } else {
        bones[chain.ours].push([+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)]);
      }
    }
  }
  let stride = 1.2;
  if (hipTrack) {
    const p0 = hipTrack.createInterpolant().evaluate(0);
    const p1 = hipTrack.createInterpolant().evaluate(dur * 0.99);
    stride = Math.hypot((p1[0] ?? 0) - (p0[0] ?? 0), (p1[2] ?? 0) - (p0[2] ?? 0)) * 0.01;
  }
  if (isDance) stride = 0;
  else if (stride < 0.28) {
    stride =
      name === "proneWalk" || name === "proneIdle" || name === "crawl"
        ? 0.7
        : name.startsWith("crouch")
          ? 0.72
          : name === "jump"
            ? 0
            : 1.35;
  }
  if (name.startsWith("crouch")) stride = THREE.MathUtils.clamp(stride, 0.5, 1.05);
  if (name === "crawl") stride = THREE.MathUtils.clamp(stride, 0.4, 0.75);
  if (name === "proneWalk") stride = THREE.MathUtils.clamp(stride, 0.45, 0.95);
  if (name === "jump") stride = 0;
  clips[name] = {
    dur: +dur.toFixed(4),
    n: nFrames,
    stride: +stride.toFixed(3),
    hipY,
    bones,
    fmt: isDance ? "quat" : "eul",
  };
  console.log(
    "baked",
    name.padEnd(12),
    "dur",
    dur.toFixed(2),
    "n",
    nFrames,
    "stride",
    stride.toFixed(3),
    "hipY0",
    hipY[0],
    "hipX0",
    bones.C_Hip_a?.[0],
    "Lleg",
    bones.L_UpperLeg_a?.[0],
    "Larm",
    bones.L_UpperArm_a?.[0],
  );
}

const clips = ONLY_DANCE && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")).clips : {};
if (!ONLY_DANCE) {
  for (const [name, file] of Object.entries(FILES)) bakeOne(name, file);
}
for (const [name, file] of Object.entries(DANCE_FILES)) bakeOne(name, file);

fs.writeFileSync(
  OUT,
  JSON.stringify({
    source:
      "Mixamo aim-swing retarget; dance = unit quaternions of the same poses (runtime slerp); loco = euler swing",
    bind: "character-space child-from-parent directions, hip yaw cancelled, mesh faces +Z; recumbent facing = hips→head; dance keeps hip yaw + unclamped arms",
    clips,
  }),
);
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
