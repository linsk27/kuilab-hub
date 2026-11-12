import React, { useEffect, useRef } from 'react';
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  BoxGeometry, SphereGeometry, CylinderGeometry, Shape, ShapeGeometry,
  CircleGeometry, PlaneGeometry, BufferGeometry, BufferAttribute,
  Vector3, CatmullRomCurve3, MathUtils, Color,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial,
  CanvasTexture, SRGBColorSpace, EquirectangularReflectionMapping, PMREMGenerator,
  RepeatWrapping, ACESFilmicToneMapping,
  HemisphereLight, DirectionalLight,
} from 'three';
import { buildBodyGeometry, buildHeadGeometry, HEAD_CENTER } from './catSculpt';

// ---------------------------------------------------------------------------
// 这套模型不依赖外部资产：形状、贴图、环境全部运行时生成。
// 分三层，和之前拆解的那类“手搓 3D 网页”同构：
//   1. 几何层：圆角盒（细分盒夹核心 + 偏移归一化）、CatmullRom 变半径管、实例化尾巴
//   2. 表面层：一套噪声同时驱动颜色 / 粗糙度 / 凹凸，UV 按物理尺寸铺
//   3. 反馈层：带速度的弹簧 + 时间轴反应，替代线性插值
// ---------------------------------------------------------------------------

const TILE = 0.42; // 一张绒毛贴图覆盖的世界尺寸，决定颗粒密度

const clamp = MathUtils.clamp;
const lerp = MathUtils.lerp;

// 圆角盒：把细分盒的每个顶点夹到“内部核心盒”，剩余向量归一化后乘圆角半径。
// 倒角连续，光照下不会出现盒体的死边。
function roundedBox(width, height, depth, radius, segments = 5) {
  const geometry = new BoxGeometry(width, height, depth, segments, segments, segments);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const r = Math.min(radius, hx, hy, hz);
  const cx = hx - r;
  const cy = hy - r;
  const cz = hz - r;
  const v = new Vector3();
  const core = new Vector3();
  const offset = new Vector3();
  const n = new Vector3();
  const uv = new Float32Array(position.count * 2);

  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    core.set(clamp(v.x, -cx, cx), clamp(v.y, -cy, cy), clamp(v.z, -cz, cz));
    offset.subVectors(v, core);
    const length = offset.length();
    if (length > 1e-6) {
      offset.multiplyScalar(r / length);
      v.copy(core).add(offset);
      position.setXYZ(i, v.x, v.y, v.z);
    }
    // 物理尺度 UV：按原始盒面朝向选投影平面，颗粒密度跟真实尺寸绑定
    n.fromBufferAttribute(normal, i);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    let u;
    let w;
    if (ax >= ay && ax >= az) { u = v.z; w = v.y; }
    else if (ay >= az) { u = v.x; w = v.z; }
    else { u = v.x; w = v.y; }
    uv[i * 2] = u / TILE;
    uv[i * 2 + 1] = w / TILE;
  }

  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

// 给几何体写入统一色调 + 高度渐变，配合 material.vertexColors 使用
function tintGeometry(geometry, tint, bottom = 0.86) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const span = Math.max(1e-5, box.max.y - box.min.y);
  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) - box.min.y) / span;
    const f = bottom + (1 - bottom) * Math.pow(t, 0.8);
    colors[i * 3] = tint[0] * f;
    colors[i * 3 + 1] = tint[1] * f;
    colors[i * 3 + 2] = tint[2] * f;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

// 变半径管：胡须、嘴线。半径沿曲线变化，UV 按物理长度计算。
function taperedTube(curve, radiusAt, tubularSegments = 16, radialSegments = 5) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const total = curve.getLength();
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new Vector3();
  let ringLength = 0;

  for (let i = 0; i <= tubularSegments; i += 1) {
    const u = i / tubularSegments;
    curve.getPointAt(u, point);
    const radius = radiusAt(u);
    ringLength = 2 * Math.PI * radius;
    const nrm = frames.normals[i];
    const bin = frames.binormals[i];
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = -Math.cos(angle);
      positions.push(
        point.x + radius * (nrm.x * cos + bin.x * sin),
        point.y + radius * (nrm.y * cos + bin.y * sin),
        point.z + radius * (nrm.z * cos + bin.z * sin),
      );
      uvs.push((u * total) / TILE, ((j / radialSegments) * ringLength) / TILE);
    }
  }
  for (let i = 1; i <= tubularSegments; i += 1) {
    for (let j = 1; j <= radialSegments; j += 1) {
      const a = (radialSegments + 1) * (i - 1) + (j - 1);
      const b = (radialSegments + 1) * i + (j - 1);
      const c = (radialSegments + 1) * i + j;
      const d = (radialSegments + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  return geometry;
}

// 一套噪声规则，同时供颜色、粗糙度、凹凸使用。
function makeFurCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(0, 0, size, size);

  // 低频：毛色不匀
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 36;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.48;
    g.addColorStop(0, dark ? 'rgba(146,126,110,0.055)' : 'rgba(255,255,255,0.075)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 中频：短绒毛，方向略微发散
  ctx.lineCap = 'round';
  for (let i = 0; i < 2200; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 2 + Math.random() * 5;
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;
    ctx.strokeStyle = `rgba(118,98,80,${0.02 + Math.random() * 0.055})`;
    ctx.lineWidth = 0.7 + Math.random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // 高频：逐像素微噪声
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() + Math.random() - 1) * 9;
    data[i] = clamp(data[i] + noise, 0, 255);
    data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
    data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function makeRoughCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 6;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(180,180,180,0.14)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

// 柔和接触阴影：外圈散、内圈实
function makeBlobTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.88)');
  g.addColorStop(0.38, 'rgba(0,0,0,0.46)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

function makeBlushTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(230,146,160,0.5)');
  g.addColorStop(0.55, 'rgba(230,146,160,0.22)');
  g.addColorStop(1, 'rgba(230,146,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// 程序天空：暖白棚拍感，给眼睛和铃铛一层环境反射
function makeEnvironment(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 64);
  sky.addColorStop(0, '#fffaf3');
  sky.addColorStop(0.42, '#f8efe4');
  sky.addColorStop(0.56, '#f0e5d8');
  sky.addColorStop(1, '#e3d6c7');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 128, 64);

  const windowLight = ctx.createRadialGradient(30, 16, 1, 30, 16, 34);
  windowLight.addColorStop(0, 'rgba(255,255,255,1)');
  windowLight.addColorStop(0.45, 'rgba(255,252,245,0.55)');
  windowLight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = windowLight;
  ctx.fillRect(0, 0, 128, 64);

  const cool = ctx.createRadialGradient(104, 46, 1, 104, 46, 30);
  cool.addColorStop(0, 'rgba(214,228,240,0.6)');
  cool.addColorStop(1, 'rgba(214,228,240,0)');
  ctx.fillStyle = cool;
  ctx.fillRect(0, 0, 128, 64);

  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return env;
}

// 带速度的弹簧，固定 8ms 子步，避免不同帧率下手感不一致
function springStep(current, velocity, target, stiffness, damping, dt) {
  let c = current;
  let v = velocity;
  let remain = Math.min(dt, 0.05);
  const h = 0.008;
  while (remain > 0.0001) {
    const step = Math.min(h, remain);
    const accel = (target - c) * stiffness - v * damping;
    v += accel * step;
    c += v * step;
    remain -= step;
  }
  return [c, v];
}

// 三平面投影：雕刻网格的 UV 是断的，用三向投影取噪声就不会被撕开。
// 只做颜色层的轻微起伏，不改变几何。
function applyTriplanar(material, texture, scale = 2.2, strength = 1.5) {
  material.onBeforeCompile = shader => {
    shader.uniforms.triMap = { value: texture };
    shader.uniforms.triScale = { value: scale };
    shader.uniforms.triStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNormal = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D triMap;\nuniform float triScale;\nuniform float triStrength;\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 triW = pow(abs(normalize(vTriNormal)), vec3(6.0));
        triW /= max(triW.x + triW.y + triW.z, 1e-4);
        vec3 triP = vTriPos * triScale;
        float triFur = texture2D(triMap, triP.zy).r * triW.x
                     + texture2D(triMap, triP.xz).r * triW.y
                     + texture2D(triMap, triP.xy).r * triW.z;
        diffuseColor.rgb *= 1.0 + (triFur - 0.95) * triStrength;
      `);
  };
  material.customProgramCacheKey = () => 'cat-triplanar';
  material.needsUpdate = true;
  return material;
}

export default function PetCat3D({ onPet, petSignal = 0, onUnavailable }) {
  const hostRef = useRef(null);
  const onPetRef = useRef(onPet);
  const signalRef = useRef(petSignal);
  const unavailableRef = useRef(onUnavailable);

  useEffect(() => { onPetRef.current = onPet; }, [onPet]);
  useEffect(() => { signalRef.current = petSignal; }, [petSignal]);
  useEffect(() => { unavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let width = host.clientWidth || 132;
    let height = host.clientHeight || 152;

    let renderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      unavailableRef.current?.();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, width / height, 0.1, 60);
    camera.position.set(0.2, 1.34, 5.1);
    camera.lookAt(0, 1.05, 0);

    // ---- 表面层 ----
    const furCanvas = makeFurCanvas();
    const furMap = new CanvasTexture(furCanvas);
    furMap.colorSpace = SRGBColorSpace;
    const furBump = new CanvasTexture(furCanvas);
    const furRough = new CanvasTexture(makeRoughCanvas());
    [furMap, furBump, furRough].forEach(texture => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    });

    const blobTexture = makeBlobTexture();
    const blushTexture = makeBlushTexture();

    function furMaterial(color, options = {}) {
      const base = {
        color: new Color(color),
        bumpScale: options.bump ?? 0.019,
        roughness: options.roughness ?? 1,
        metalness: 0,
        vertexColors: true,
        envMapIntensity: options.env ?? 0.42,
      };
      // 雕刻网格的 UV 不连续，贴图会被撕开；这类表面用哑光纯色更干净
      if (options.doubleSide) base.side = 2;
      if (options.textured !== false) {
        base.map = furMap;
        base.roughnessMap = furRough;
        base.bumpMap = furBump;
      }
      return new MeshStandardMaterial(base);
    }

    const materials = [];
    // 毛色改由顶点色承载：底色接近白，白斑与身体色都写进顶点
    const matBody = applyTriplanar(furMaterial('#ffffff', { textured: false, roughness: 0.94, env: 0.22 }), furMap, 15.0, 2.6);
    const matHead = applyTriplanar(furMaterial('#ffffff', { textured: false, roughness: 0.94, env: 0.22 }), furMap, 19.0, 1.9);
    const matPink = furMaterial('#e8a7b1', { bump: 0.006, roughness: 0.9 });
    const matNose = new MeshPhysicalMaterial({
      color: '#d48792', roughness: 0.42, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.3,
    });
    const matMouth = new MeshStandardMaterial({ color: '#a97f70', roughness: 0.7, metalness: 0 });
    const matWhisker = new MeshStandardMaterial({
      color: '#c2ad99', roughness: 0.85, metalness: 0, transparent: true, opacity: 0.55,
    });
    const matEye = new MeshPhysicalMaterial({
      color: '#3c2d26', roughness: 0.16, metalness: 0, clearcoat: 0.55,
      clearcoatRoughness: 0.1, envMapIntensity: 0.9,
    });
    const matHighlight = new MeshBasicMaterial({ color: '#fffdfa' });
    const matCollar = new MeshStandardMaterial({ color: '#d3a6a8', roughness: 0.72, metalness: 0 });
    const matBell = new MeshStandardMaterial({ color: '#d9b26a', roughness: 0.34, metalness: 0.7, envMapIntensity: 1.1 });
    const matBellSlit = new MeshStandardMaterial({ color: '#8c6f3d', roughness: 0.5, metalness: 0.35 });
    const matShadow = new MeshBasicMaterial({ map: blobTexture, transparent: true, opacity: 1, depthWrite: false, color: '#6d5747' });
    materials.push(
      matBody, matHead, matPink, matNose, matMouth, matWhisker,
      matEye, matHighlight, matCollar, matBell, matBellSlit, matShadow,
    );

    // ---- 光源 + 环境 ----
    scene.add(new HemisphereLight(0xfff7ee, 0xd8c7b4, 0.36));
    const keyLight = new DirectionalLight(0xfff2e2, 2.35);
    keyLight.position.set(2.1, 3.6, 2.6);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0xdfe9f5, 0.45);
    fillLight.position.set(-2.8, 1.6, -1.4);
    scene.add(fillLight);
    const bounceLight = new DirectionalLight(0xffeeda, 0.22);
    bounceLight.position.set(0.4, -1.2, 2.2);
    scene.add(bounceLight);

    const environment = makeEnvironment(renderer);
    scene.environment = environment;

    const cat = new Group();
    cat.position.y = 0.02;
    scene.add(cat);

    const bounceGroup = new Group();
    cat.add(bounceGroup);

    // 接触阴影单独挂在场景上，不跟着猫旋转
    const shadow = new Mesh(new PlaneGeometry(1.7, 1.36), matShadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.012, 0.03);
    scene.add(shadow);

    // ---- 身体与头：先定义体积，再多边形化，交界处是融合而非拼接 ----
    const bodyMesh = new Mesh(buildBodyGeometry(0.023), matBody);
    bounceGroup.add(bodyMesh);

    const head = new Group();
    head.position.set(HEAD_CENTER[0], HEAD_CENTER[1], HEAD_CENTER[2]);
    bounceGroup.add(head);

    const headMesh = new Mesh(buildHeadGeometry(0.0175), matHead);
    head.add(headMesh);

    const nose = new Mesh(roundedBox(0.088, 0.062, 0.048, 0.022, 2), matNose);
    nose.position.set(0, -0.128, 0.392);
    nose.rotation.x = -0.26;
    head.add(nose);

    // 嘴线：从鼻子下方分叉的两条细管
    [-1, 1].forEach(side => {
      const mouthCurve = new CatmullRomCurve3([
        new Vector3(0, -0.185, 0.378),
        new Vector3(side * 0.03, -0.212, 0.372),
        new Vector3(side * 0.072, -0.214, 0.352),
      ]);
      head.add(new Mesh(taperedTube(mouthCurve, () => 0.009, 8, 4), matMouth));
    });

    // ---- 眼睛：每只眼单独成组，眨眼时绕自身中心压扁 ----
    const eyeGeo = new SphereGeometry(1, 20, 16);
    const highlightGeo = new SphereGeometry(1, 10, 8);
    const eyeRigs = [];
    [-1, 1].forEach(side => {
      const rig = new Group();
      rig.position.set(side * 0.208, 0.03, 0.3);
      head.add(rig);

      const eye = new Mesh(eyeGeo, matEye);
      eye.scale.set(0.117, 0.128, 0.088);
      rig.add(eye);

      const spec = new Mesh(highlightGeo, matHighlight);
      spec.position.set(side * 0.032, 0.052, 0.062);
      spec.scale.setScalar(0.02);
      rig.add(spec);

      const spark = new Mesh(highlightGeo, matHighlight);
      spark.position.set(side * -0.028, -0.032, 0.055);
      spark.scale.setScalar(0.01);
      rig.add(spark);

      eyeRigs.push(rig);
    });

    // ---- 腮红：带渐变的贴片，边缘自然消融 ----
    const blushGeo = new CircleGeometry(0.115, 24);
    const matBlush = new MeshBasicMaterial({ map: blushTexture, transparent: true, depthWrite: false, opacity: 0.9 });
    materials.push(matBlush);
    [-1, 1].forEach(side => {
      const blush = new Mesh(blushGeo, matBlush);
      blush.position.set(side * 0.305, -0.075, 0.25);
      blush.rotation.y = side * 0.7;
      blush.rotation.z = side * 0.1;
      blush.scale.set(1, 0.72, 1);
      head.add(blush);
    });

    // ---- 耳朵：变半径管做锥形，底部圆润、尖端收细，仍可独立抖动 ----
    const ears = [];
    [-1, 1].forEach(side => {
      const spine = new CatmullRomCurve3([
        new Vector3(0, 0, 0),
        new Vector3(side * 0.06, 0.27, -0.006),
        new Vector3(side * 0.15, 0.52, -0.018),
      ]);
      const pivot = new Group();
      pivot.position.set(side * 0.198, 0.1, -0.03);
      pivot.rotation.z = side * -0.16;
      pivot.rotation.x = -0.04;
      head.add(pivot);

      const ear = new Mesh(
        tintGeometry(taperedTube(spine, u => lerp(0.2, 0.015, Math.pow(u, 0.78)), 20, 14), [0.93, 0.85, 0.78]),
        matHead,
      );
      ear.scale.z = 0.5;
      pivot.add(ear);

      const innerShape = new Shape();
      innerShape.moveTo(-0.092, 0.055);
      innerShape.lineTo(0.092, 0.055);
      innerShape.lineTo(side * 0.122, 0.415);
      innerShape.closePath();
      const innerGeo = tintGeometry(new ShapeGeometry(innerShape, 4), [1, 1, 1]);
      const inner = new Mesh(innerGeo, matPink);
      inner.position.set(0, 0, 0.082);
      inner.rotation.x = 0.19;
      pivot.add(inner);

      ears.push({ pivot, side, angle: 0, velocity: 0, next: 0 });
    });

    // ---- 项圈：贴着颈部的一圈窄带；铃铛挂在正前方 ----
    const collar = new Mesh(new CylinderGeometry(0.208, 0.232, 0.07, 40, 1, true), matCollar);
    collar.position.set(0, 1.09, 0.03);
    bounceGroup.add(collar);

    const bellPivot = new Group();
    bellPivot.position.set(0, 1.015, 0.245);
    bounceGroup.add(bellPivot);
    const bell = new Mesh(new SphereGeometry(0.066, 18, 14), matBell);
    bell.position.y = -0.055;
    bellPivot.add(bell);
    const bellSlit = new Mesh(new BoxGeometry(0.011, 0.04, 0.011), matBellSlit);
    bellSlit.position.set(0, -0.078, 0.06);
    bellPivot.add(bellSlit);

    // ---- 尾巴：逐帧变形的管状几何，半径连续、法线解析，一个 draw call ----
    const tailPoints = [
      new Vector3(0.3, 0.26, -0.32),
      new Vector3(0.6, 0.14, -0.34),
      new Vector3(0.84, 0.16, -0.16),
      new Vector3(0.9, 0.34, 0.04),
      new Vector3(0.84, 0.5, 0.2),
      new Vector3(0.72, 0.57, 0.3),
    ];
    const tailCurve = new CatmullRomCurve3(tailPoints, false, 'catmullrom', 0.5);
    const TAIL_TUBULAR = 36;
    const TAIL_RADIAL = 10;
    const tailMat = new MeshStandardMaterial({
      color: '#ffffff', map: furMap, roughnessMap: furRough, bumpMap: furBump,
      bumpScale: 0.01, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.42,
    });
    materials.push(tailMat);

    const tailCount = (TAIL_TUBULAR + 1) * (TAIL_RADIAL + 1);
    const tailPositions = new Float32Array(tailCount * 3);
    const tailNormals = new Float32Array(tailCount * 3);
    const tailUvs = new Float32Array(tailCount * 2);
    const tailColors = new Float32Array(tailCount * 3);
    const tailIndices = [];
    const tailColorA = new Color('#e9d6c6');
    const tailColorB = new Color('#fffaf4');
    const tailTint = new Color();
    for (let i = 0; i <= TAIL_TUBULAR; i += 1) {
      const u = i / TAIL_TUBULAR;
      tailTint.copy(tailColorA).lerp(tailColorB, u > 0.58 ? (u - 0.58) / 0.42 : 0);
      for (let j = 0; j <= TAIL_RADIAL; j += 1) {
        const index = i * (TAIL_RADIAL + 1) + j;
        tailUvs[index * 2] = u * 3.4;
        tailUvs[index * 2 + 1] = (j / TAIL_RADIAL) * 2;
        tailColors[index * 3] = tailTint.r;
        tailColors[index * 3 + 1] = tailTint.g;
        tailColors[index * 3 + 2] = tailTint.b;
      }
    }
    for (let i = 0; i < TAIL_TUBULAR; i += 1) {
      for (let j = 0; j < TAIL_RADIAL; j += 1) {
        const a = i * (TAIL_RADIAL + 1) + j;
        const b = (i + 1) * (TAIL_RADIAL + 1) + j;
        tailIndices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const tailGeo2 = new BufferGeometry();
    tailGeo2.setIndex(tailIndices);
    tailGeo2.setAttribute('position', new BufferAttribute(tailPositions, 3));
    tailGeo2.setAttribute('normal', new BufferAttribute(tailNormals, 3));
    tailGeo2.setAttribute('uv', new BufferAttribute(tailUvs, 2));
    tailGeo2.setAttribute('color', new BufferAttribute(tailColors, 3));
    const tail = new Mesh(tailGeo2, tailMat);
    tail.frustumCulled = false;
    bounceGroup.add(tail);

    // 尾尖封口，避免看到空心截面
    const tipGeo = new SphereGeometry(1, 12, 10);
    const tipColors = new Float32Array(tipGeo.attributes.position.count * 3);
    for (let i = 0; i < tipColors.length; i += 3) {
      tipColors[i] = 1; tipColors[i + 1] = 0.985; tipColors[i + 2] = 0.965;
    }
    tipGeo.setAttribute('color', new BufferAttribute(tipColors, 3));
    const tailTip = new Mesh(tipGeo, tailMat);
    tailTip.scale.setScalar(0.045);
    bounceGroup.add(tailTip);

    const tailCenter = new Vector3();
    const tailA = new Vector3();
    const tailB = new Vector3();
    const tailTangent = new Vector3();
    const tailNormal = new Vector3();
    const tailBinormal = new Vector3();
    const tailUp = new Vector3(0, 0, 1);

    function updateTail(time) {
      for (let i = 0; i <= TAIL_TUBULAR; i += 1) {
        const u = i / TAIL_TUBULAR;
        const wave = Math.sin(time * 1.25 - u * 2.1) * 0.03 * u;
        tailCurve.getPoint(u, tailCenter);
        tailCenter.x += wave * 0.7;
        tailCenter.y += wave;
        tailCenter.z += Math.sin(time * 0.9 - u * 1.4) * 0.018 * u;
        tailCurve.getPoint(Math.max(0, u - 0.02), tailA);
        tailCurve.getPoint(Math.min(1, u + 0.02), tailB);
        tailTangent.subVectors(tailB, tailA).normalize();
        tailNormal.crossVectors(tailTangent, tailUp);
        if (tailNormal.lengthSq() < 1e-4) tailNormal.set(1, 0, 0);
        tailNormal.normalize();
        tailBinormal.crossVectors(tailTangent, tailNormal).normalize();
        const radius = lerp(0.125, 0.055, Math.pow(u, 0.92));
        for (let j = 0; j <= TAIL_RADIAL; j += 1) {
          const angle = (j / TAIL_RADIAL) * Math.PI * 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = tailNormal.x * cos + tailBinormal.x * sin;
          const ny = tailNormal.y * cos + tailBinormal.y * sin;
          const nz = tailNormal.z * cos + tailBinormal.z * sin;
          const index = (i * (TAIL_RADIAL + 1) + j) * 3;
          tailPositions[index] = tailCenter.x + nx * radius;
          tailPositions[index + 1] = tailCenter.y + ny * radius;
          tailPositions[index + 2] = tailCenter.z + nz * radius;
          tailNormals[index] = nx;
          tailNormals[index + 1] = ny;
          tailNormals[index + 2] = nz;
        }
      }
      tailGeo2.attributes.position.needsUpdate = true;
      tailGeo2.attributes.normal.needsUpdate = true;
      tailCurve.getPoint(1, tailTip.position);
      tailTip.position.x += Math.sin(time * 1.25 - 2.1) * 0.021;
      tailTip.position.y += Math.sin(time * 1.25 - 2.1) * 0.03;
      tailTip.position.z += Math.sin(time * 0.9 - 1.4) * 0.018;
    }

    // ---- 胡须 ----
    [-1, 1].forEach(side => {
      for (let i = 0; i < 3; i += 1) {
        const startY = -0.135 - i * 0.018;
        const curve = new CatmullRomCurve3([
          new Vector3(side * 0.095, startY, 0.363),
          new Vector3(side * 0.26, startY + 0.012 - i * 0.004, 0.35),
          new Vector3(side * 0.42, startY - 0.012 - i * 0.012, 0.3),
        ]);
        head.add(new Mesh(taperedTube(curve, u => lerp(0.0042, 0.0011, u), 12, 4), matWhisker));
      }
    });

    // ---- 交互状态 ----
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let dragTargetY = 0;
    let dragTargetX = 0;
    let rotY = 0;
    let rotYV = 0;
    let rotX = 0;
    let rotXV = 0;
    let lookX = 0;
    let lookXV = 0;
    let lookY = 0;
    let lookYV = 0;
    let jumpY = 0;
    let jumpV = 0;
    let squash = 0;
    let squashV = 0;
    let petBoost = 0;
    const pointer = { x: 0, y: 0 };
    let seenSignal = signalRef.current;
    let blinkStart = -1000;
    let nextBlink = performance.now() + 2200 + Math.random() * 2600;
    let lastInteract = performance.now();
    let petAt = -1;
    let launched = false;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 反应按时间轴走：先蓄力压扁，55ms 后起跳，落地再补一次形变。
    function triggerPet(now) {
      petAt = now;
      launched = false;
      squashV -= 1.0;
      petBoost = 1;
      blinkStart = now;
      nextBlink = now + 2600 + Math.random() * 3600;
      const ear = ears[now % 2 > 1 ? 0 : 1];
      if (ear) ear.velocity += 5.2;
      lastInteract = now;
    }

    function onPointerDown(event) {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      lastInteract = performance.now();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
    }
    function onPointerMove(event) {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      dragTargetY = clamp(dragTargetY + dx * 0.011, -1.15, 1.15);
      dragTargetX = clamp(dragTargetX + dy * 0.006, -0.26, 0.26);
      lastX = event.clientX;
      lastY = event.clientY;
      lastInteract = performance.now();
    }
    function onPointerUp(event) {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
      if (moved < 6) onPetRef.current?.();
    }
    function onWindowMove(event) {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    }
    function onKeyDown(event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onPetRef.current?.();
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointermove', onWindowMove, { passive: true });
    host.addEventListener('keydown', onKeyDown);

    const resizeObserver = new ResizeObserver(() => {
      width = host.clientWidth || width;
      height = host.clientHeight || height;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(host);

    let raf = 0;
    let running = true;
    let last = performance.now();
    const start = last;

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }

      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const time = (now - start) / 1000;

      // 指针跟随先过弹簧，再分给头和身体
      [lookX, lookXV] = springStep(lookX, lookXV, pointer.x, 26, 8, dt);
      [lookY, lookYV] = springStep(lookY, lookYV, pointer.y, 26, 8, dt);

      // 松手后回正，带一点过冲
      if (!dragging && now - lastInteract > 1500) {
        [dragTargetY, rotYV] = springStep(dragTargetY, rotYV, 0, 6.5, 4.4, dt);
        [dragTargetX, rotXV] = springStep(dragTargetX, rotXV, 0, 7, 4.6, dt);
      }
      [rotY, rotYV] = springStep(rotY, rotYV, dragTargetY, dragging ? 120 : 42, dragging ? 14 : 11, dt);
      [rotX, rotXV] = springStep(rotX, rotXV, dragTargetX, dragging ? 120 : 42, dragging ? 14 : 11, dt);

      cat.rotation.y = rotY + Math.sin(time * 0.33) * 0.016;
      cat.rotation.x = rotX * 0.5;
      cat.rotation.z = Math.sin(time * 0.42) * 0.008;

      // 反应时间轴：蓄力 → 起跳 → 落地
      if (petAt >= 0) {
        const reaction = now - petAt;
        if (!launched && reaction >= 55) {
          launched = true;
          jumpV += 4.0;
        }
        if (reaction > 1400) petAt = -1;
      }

      // 跳跃与落地挤压
      const previousJump = jumpY;
      [jumpY, jumpV] = springStep(jumpY, jumpV, 0, 128, 8.0, dt);
      if (previousJump > 0 && jumpY < 0) {
        jumpY = 0;
        if (jumpV < -0.45) squashV += 0.6;
        jumpV *= -0.24;
      }
      jumpY = Math.max(0, jumpY);
      [squash, squashV] = springStep(squash, squashV, 0, 210, 13.5, dt);
      bounceGroup.position.y = jumpY;
      const sy = 1 + squash;
      const sxz = 1 - squash * 0.55;
      bounceGroup.scale.set(sxz, sy, sxz);

      // 呼吸：整个躯干轻微起伏，头再单独浮一点
      const breath = Math.sin(time * 1.45);
      bodyMesh.scale.set(1 + breath * 0.006, 1 + breath * 0.012, 1 + breath * 0.008);
      head.position.y = HEAD_CENTER[1] + breath * 0.006 + jumpV * 0.004;

      // 头部朝向
      const headTargetY = dragging ? 0 : lookX * 0.5;
      const headTargetX = dragging ? 0 : -lookY * 0.26;
      head.rotation.y += (headTargetY - head.rotation.y) * Math.min(1, dt * 6.2);
      head.rotation.x += (headTargetX - head.rotation.x) * Math.min(1, dt * 5.4);
      head.rotation.z = 0.015 + Math.sin(time * 0.7) * 0.01;

      // 眨眼
      let blink = 0;
      if (now >= nextBlink) {
        blinkStart = now;
        nextBlink = now + 2600 + Math.random() * 4200;
      }
      const bp = (now - blinkStart) / 135;
      if (bp >= 0 && bp < 1) blink = Math.sin(bp * Math.PI);
      eyeRigs.forEach(rig => { rig.scale.y = 1 - blink * 0.9; });

      // 耳朵：偶尔自己抖一下，被摸时也会动
      ears.forEach((ear, index) => {
        if (!ear.next) ear.next = now + 3200 + index * 1400;
        if (now > ear.next) {
          ear.velocity += (Math.random() > 0.5 ? 1 : -1) * (1.6 + Math.random() * 1.4);
          ear.next = now + 4200 + Math.random() * 5200;
        }
        [ear.angle, ear.velocity] = springStep(ear.angle, ear.velocity, 0, 160, 9, dt);
        ear.pivot.rotation.z = ear.side * -0.26 + ear.angle * 0.09;
        ear.pivot.rotation.x = -0.06 + ear.angle * 0.05;
      });

      // 尾巴：按曲线摆放实例，刚被摸过时摆得更欢
      updateTail(time + petBoost * 0.5);
      petBoost *= Math.exp(-1.8 * dt);

      // 铃铛
      bellPivot.rotation.z = Math.sin(time * 2.1) * 0.05 + clamp(jumpV * 0.09, -0.35, 0.35);
      bellPivot.rotation.x = clamp(-jumpV * 0.05, -0.25, 0.25);

      // 阴影随高度变淡、变大
      const lift = clamp(jumpY * 0.9, 0, 0.5);
      matShadow.opacity = 0.9 - lift * 0.85;
      shadow.scale.setScalar(1 + lift * 0.35);

      if (signalRef.current !== seenSignal) {
        seenSignal = signalRef.current;
        triggerPet(now);
      }

      renderer.render(scene, camera);
    }

    if (reduceMotion) {
      updateTail(0);
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointermove', onWindowMove);
      host.removeEventListener('keydown', onKeyDown);
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose?.();
      });
      materials.forEach(material => material.dispose?.());
      furMap.dispose();
      furBump.dispose();
      furRough.dispose();
      blobTexture.dispose();
      blushTexture.dispose();
      environment.dispose?.();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div className="pet-3d" ref={hostRef} role="button" tabIndex={0}
    aria-label="摸摸这只立体小猫，可以拖动旋转" />;
}
