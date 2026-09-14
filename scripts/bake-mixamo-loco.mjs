/**
 * Bake Mixamo locomotion by matching bone AIM directions in character space.
 * Mixamo local eulers cannot be copied: bind axes ≠ our identity rest.
 */
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

const SRC = "/tmp/mixamo";
const OUT = path.resolve("src/lib/softbody/loco-clips.json");
const FRAMES = 12;
const STAND_HIP_Y = 98;

const FILES = {
  walk: "Walking.fbx",
  walkBack: "Walking_Backwards.fbx",
  walkLeft: "Walking.fbx",
  walkRight: "Walking.fbx",
  crouchIdle: "Crouch_Idle.fbx",
  crouchWalk: "Crouch_Walk_Forward.fbx",
  crouchBack: "Crouch_Walk_Back.fbx",
  crouchLeft: "Crouch_Walk_Forward.fbx",
  crouchRight: "Crouch_Walk_Forward.fbx",
  crawl: "Crawling.fbx",
  proneIdle: "Prone_Idle.fbx",
};

const AIM_SPIN = {
  walkLeft: Math.PI / 2,
  walkRight: -Math.PI / 2,
  crouchLeft: Math.PI / 2,
  crouchRight: -Math.PI / 2,
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
  { mix: ["mixamorigLeftHand", "mixamorigLeftHandMiddle1"], ours: "L_Hand_a", child: "L_Middle_a" },
  { mix: ["mixamorigRightHand", "mixamorigRightHandMiddle1"], ours: "R_Hand_a", child: "R_Middle_a" },
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
};

const TWIST_BONES = new Set(["L_Forearm_a", "R_Forearm_a", "L_Hand_a", "R_Hand_a"]);

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
  const mixer = new THREE.AnimationMixer(obj);
  mixer.clipAction(clip).play();
  mixer.setTime(Math.min(Math.max(t, 0), clip.duration * 0.999));
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

function facingCancel(obj, hipTrack, dur) {
  const L = mixDirRaw(obj, "mixamorigLeftUpLeg", "mixamorigLeftLeg");
  const R = mixDirRaw(obj, "mixamorigRightUpLeg", "mixamorigRightLeg");
  let travel = 0;
  if (hipTrack) {
    const p0 = hipTrack.createInterpolant().evaluate(0);
    const p1 = hipTrack.createInterpolant().evaluate(dur * 0.99);
    travel = Math.hypot((p1[0] ?? 0) - (p0[0] ?? 0), (p1[2] ?? 0) - (p0[2] ?? 0));
  }
  // Stationary clips (crouch idle): hips yaw often doesn't match the knees.
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

const restAim = {};
const restLat = {};
for (const c of CHAINS) {
  restAim[c.ours] = restDir(c.ours, c.child);
  restLat[c.ours] = restSide(restAim[c.ours]);
}

const clips = {};
for (const [name, file] of Object.entries(FILES)) {
  const obj = parseFbx(file);
  const clip = obj.animations[0];
  const hipTrack = clip.tracks.find((t) => t.name === "mixamorigHips.position");
  const dur = clip.duration;
  const bones = {};
  const hipY = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = (i / FRAMES) * dur;
    poseAt(obj, t);
    const yaw = facingCancel(obj, hipTrack, dur);
    const hip = hipTrack ? hipTrack.createInterpolant().evaluate(t) : [0, STAND_HIP_Y, 0];
    hipY.push(+(((hip[1] ?? STAND_HIP_Y) - STAND_HIP_Y) * 0.01).toFixed(4));

    const worldQ = {};
    for (const chain of CHAINS) {
      const targetAim = mixDir(obj, chain.mix[0], chain.mix[1], yaw);
      if (!targetAim) continue;
      const targetLat = mixSide(obj, chain.mix[0], targetAim, yaw);
      const spin = AIM_SPIN[name] || 0;
      if (spin) {
        targetAim.applyAxisAngle(Y_UP, spin);
        if (targetLat) targetLat.applyAxisAngle(Y_UP, spin);
      }
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
      if (chain.ours === "C_Hip_a") y = 0;
      if (!bones[chain.ours]) bones[chain.ours] = [];
      bones[chain.ours].push([+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)]);
    }
  }
  clips[name] = { dur: +dur.toFixed(4), n: FRAMES, hipY, bones };
  console.log(
    "baked",
    name.padEnd(12),
    "dur",
    dur.toFixed(2),
    "hipY0",
    hipY[0],
    "Lleg",
    bones.L_UpperLeg_a?.[0],
    "Larm",
    bones.L_UpperArm_a?.[0],
    "Lhand",
    bones.L_Hand_a?.[0],
  );
}

fs.writeFileSync(
  OUT,
  JSON.stringify({
    source: "Mixamo aim-retarget (Walking, Crouch Idle, Crouch Walk Forward, Walk Strafe, Crawling)",
    bind: "character-space child-from-parent directions, hip yaw cancelled, mesh faces +Z",
    clips,
  }),
);
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes");
