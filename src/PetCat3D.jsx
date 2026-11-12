import React, { useEffect, useRef } from 'react';
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh,
  BoxGeometry, SphereGeometry, CylinderGeometry, Shape, ShapeGeometry,
  CircleGeometry, PlaneGeometry, BufferGeometry, BufferAttribute, ExtrudeGeometry, LatheGeometry,
  Vector2, Vector3, CatmullRomCurve3, MathUtils, Color,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial,
  CanvasTexture, SRGBColorSpace, EquirectangularReflectionMapping, PMREMGenerator,
  RepeatWrapping, ACESFilmicToneMapping,
  HemisphereLight, DirectionalLight,
} from 'three';
import { buildBodyGeometry, buildHeadGeometry, headSdf, HEAD_CENTER } from './catSculpt';

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

// 布偶眼贴图：给球面用的“正面投影”图。
// 球的前半球按法线 x/y 直接映射到这张图的圆内，所以中心是虹膜、外圈是眼球边缘。
function makeEyeCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  // 整张填深色：四角会落到眼球侧面，不能留透明
  ctx.fillStyle = '#0d0b0a';
  ctx.fillRect(0, 0, size, size);

  // 眼球：中心暖褐，往外迅速收深，形成玻璃珠的体积
  const ball = ctx.createRadialGradient(c, c * 0.94, c * 0.04, c, c, c * 1.06);
  ball.addColorStop(0, '#6b5646');
  ball.addColorStop(0.22, '#4a3b31');
  ball.addColorStop(0.46, '#2a211c');
  ball.addColorStop(0.72, '#171210');
  ball.addColorStop(1, '#0b0908');
  ctx.fillStyle = ball;
  ctx.fillRect(0, 0, size, size);

  // 虹膜里的一点点纹理，别让中心太干净
  for (let i = 0; i < 70; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r0 = c * (0.08 + Math.random() * 0.1);
    const r1 = r0 + c * 0.1;
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '160,132,108' : '20,16,14'},${0.05 + Math.random() * 0.08})`;
    ctx.lineWidth = 0.8 + Math.random();
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }

  // 主高光（偏左上），边缘柔一点
  const hi = ctx.createRadialGradient(c * 0.72, c * 0.74, 0, c * 0.72, c * 0.74, c * 0.2);
  hi.addColorStop(0, 'rgba(255,255,255,1)');
  hi.addColorStop(0.5, 'rgba(255,255,255,0.92)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.arc(c * 0.72, c * 0.74, c * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // 副高光（右下）
  ctx.fillStyle = 'rgba(255,250,242,0.8)';
  ctx.beginPath();
  ctx.arc(c * 1.26, c * 1.28, c * 0.075, 0, Math.PI * 2);
  ctx.fill();

  // 底部反光
  const bounce = ctx.createRadialGradient(c * 1.05, c * 1.55, 0, c * 1.05, c * 1.55, c * 0.42);
  bounce.addColorStop(0, 'rgba(214,196,180,0.28)');
  bounce.addColorStop(1, 'rgba(214,196,180,0)');
  ctx.fillStyle = bounce;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

// 一套噪声规则，同时供颜色、粗糙度、凹凸使用。
// 白猫的毛要“顺”：主体是极细的竖向毛丝，方向一致、对比很低，
// 只提供柔光下的丝绒质感，不能出现深色斑点（那会让白猫显脏）。
function makeFurCanvas(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf8';
  ctx.fillRect(0, 0, size, size);

  // 每笔都在 3×3 个平移位各画一次，跨过边界的毛丝才能接上，
  // 否则贴图铺开后会看到一条条横向拼缝。
  const tiled = draw => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        ctx.save();
        ctx.translate(dx * size, dy * size);
        draw();
        ctx.restore();
      }
    }
  };

  // 低频：极淡的明暗起伏，让毛面有厚薄
  for (let i = 0; i < 70; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 14 + Math.random() * 44;
    const dark = Math.random() > 0.5;
    tiled(() => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? 'rgba(206,196,186,0.05)' : 'rgba(255,255,255,0.09)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 主频：细长、略斜的毛丝。4 道覆盖，接缝处自然叠化
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < 900; i += 1) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const len = 20 + Math.random() * 26;
      const lean = (Math.random() - 0.5) * 0.55;
      const alpha = 0.05 + Math.random() * 0.09;
      const width = 0.7 + Math.random() * 0.8;
      tiled(() => {
        ctx.strokeStyle = `rgba(176,164,152,${alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * len * 0.4, y + len * 0.5, x + lean * len, y + len);
        ctx.stroke();
      });
    }
  }

  // 高频：极轻的逐像素颗粒，避免面上一片死白
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 5;
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
    renderer.toneMappingExposure = 0.86;

    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, width / height, 0.1, 60);
    // 取景按新比例重算：猫总高约 1.7，视线落在胸口
    camera.position.set(0.12, 1.02, 4.25);
    camera.lookAt(0, 0.88, 0);

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

    function furMaterial(color, options = {}) {
      const base = {
        color: new Color(color),
        bumpScale: options.bump ?? 0.007,
        roughness: options.roughness ?? 1,
        metalness: 0,
        vertexColors: true,
        envMapIntensity: options.env ?? 0.3,
        // sheen 是织物/绒毛的掠射光：白毛在逆光边缘会亮出一层柔光，
        // 这是“塑料感”和“毛茸茸”之间最关键的一层
        sheen: options.sheen ?? 0.12,
        sheenRoughness: options.sheenRough ?? 0.72,
        sheenColor: new Color(options.sheenColor ?? '#fff6ec'),
      };
      // 雕刻网格的 UV 不连续，贴图会被撕开；这类表面用哑光纯色更干净
      if (options.doubleSide) base.side = 2;
      if (options.textured !== false) {
        base.map = furMap;
        base.roughnessMap = furRough;
        base.bumpMap = furBump;
      }
      return new MeshPhysicalMaterial(base);
    }

    // 绒毛外壳：同一份雕刻网格沿法线外扩一点点，只在掠射角透出一层极薄的柔光。
    // 之前用噪声镂空做毛边，放大看是碎的；布偶要的是“干净边缘 + 一点点柔化”。
    function makeFuzzShell(geometry, offset, strength) {
      const material = new MeshPhysicalMaterial({
        color: new Color('#e8dfd2'),
        roughness: 1,
        metalness: 0,
        transparent: true,
        depthWrite: false,
        opacity: 1,
        sheen: 1,
        sheenRoughness: 0.9,
        sheenColor: new Color('#fffdf8'),
      });
      material.onBeforeCompile = shader => {
        shader.uniforms.fuzzOffset = { value: offset };
        shader.uniforms.fuzzStrength = { value: strength };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float fuzzOffset;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(objectNormal) * fuzzOffset;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float fuzzStrength;')
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float fuzzRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
            gl_FragColor.a *= smoothstep(0.55, 1.0, fuzzRim) * fuzzStrength;
          `);
      };
      material.customProgramCacheKey = () => `cat-fuzz-${offset.toFixed(3)}`;
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = 2;
      return mesh;
    }

    const materials = [];
    // 毛色改由顶点色承载：底色是暖白，靠 AO 与外壳绒毛托出体积
    const matBody = applyTriplanar(furMaterial('#ffffff', { textured: false, roughness: 0.98, env: 0.16 }), furMap, 8.5, 0.95);
    const matHead = applyTriplanar(furMaterial('#ffffff', { textured: false, roughness: 0.98, env: 0.16 }), furMap, 10.5, 0.8);
    const matPink = furMaterial('#f2c6cd', { bump: 0.005, roughness: 0.94, sheen: 0.4, sheenColor: '#ffeef1' });
    const matNose = new MeshPhysicalMaterial({
      color: '#e6a2ad', roughness: 0.45, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35,
    });
    const matMouth = new MeshStandardMaterial({ color: '#7a5b4d', roughness: 0.85, metalness: 0 });
    const eyeTexture = new CanvasTexture(makeEyeCanvas());
    eyeTexture.colorSpace = SRGBColorSpace;
    // 眼球是真正的球：贴图按「物体法线 x/y」做正面投影，所以从哪个角度看，
    // 虹膜都朝向前方，而不是一张贴纸浮在脸上。
    const matEye = new MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.42, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5,
      envMapIntensity: 0.12,
    });
    matEye.onBeforeCompile = shader => {
      shader.uniforms.eyeMap = { value: eyeTexture };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEyeNormal;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvEyeNormal = normalize(objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D eyeMap;\nvarying vec3 vEyeNormal;')
        .replace('#include <map_fragment>', `
          vec2 eyeUv = clamp(vEyeNormal.xy * 0.5 + 0.5, vec2(0.001), vec2(0.999));
          vec4 eyeTex = texture2D(eyeMap, eyeUv);
          diffuseColor.rgb *= eyeTex.rgb;
        `);
    };
    matEye.customProgramCacheKey = () => 'cat-eye-proj';
    const matHighlight = new MeshBasicMaterial({ color: '#fffdfa' });
    // 帽子与叶子：米色帆布 + 橄榄绿
    const matHat = new MeshStandardMaterial({ color: '#c9b48f', roughness: 0.95, metalness: 0, vertexColors: false });
    const matHatBand = new MeshStandardMaterial({ color: '#b5a077', roughness: 0.95, metalness: 0 });
    const matLeaf = new MeshStandardMaterial({ color: '#8b9752', roughness: 0.75, metalness: 0 });
    const matShadow = new MeshBasicMaterial({ map: blobTexture, transparent: true, opacity: 0.55, depthWrite: false, color: '#8a7a6c' });
    materials.push(
      matBody, matHead, matPink, matNose, matMouth,
      matEye, matHighlight, matHat, matHatBand, matLeaf, matShadow,
    );

    // ---- 光源 + 环境 ----
    scene.add(new HemisphereLight(0xfff7ee, 0xd8c7b4, 0.3));
    const keyLight = new DirectionalLight(0xfff2e2, 0.6);
    keyLight.position.set(2.1, 3.6, 2.6);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0xdfe9f5, 0.2);
    fillLight.position.set(-2.8, 1.6, -1.4);
    scene.add(fillLight);
    const bounceLight = new DirectionalLight(0xffeeda, 0.22);
    bounceLight.position.set(0.4, -1.2, 2.2);
    scene.add(bounceLight);
    // 背光勾边：白猫压在白色页面上，靠这层冷调轮廓光把剪影与绒毛边缘提出来
    const rimLight = new DirectionalLight(0xe8f0ff, 0.22);
    rimLight.position.set(-1.6, 2.0, -2.8);
    scene.add(rimLight);

    const environment = makeEnvironment(renderer);
    scene.environment = environment;

    const cat = new Group();
    cat.position.y = 0.02;
    scene.add(cat);

    const bounceGroup = new Group();
    cat.add(bounceGroup);

    // 接触阴影单独挂在场景上，不跟着猫旋转
    const shadow = new Mesh(new PlaneGeometry(1.7, 1.3), matShadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.012, 0.04);
    scene.add(shadow);

    // ---- 身体：短身圆肚，四肢是融合出来的，不是插上去的 ----
    const bodyGeo = buildBodyGeometry(0.013);
    const bodyMesh = new Mesh(bodyGeo, matBody);
    bounceGroup.add(bodyMesh);
    bounceGroup.add(makeFuzzShell(bodyGeo, 0.006, 0.3));
    bounceGroup.add(makeFuzzShell(bodyGeo, 0.016, 0.12));

    // ---- 头：比身子还大的圆头 ----
    const head = new Group();
    head.position.set(HEAD_CENTER[0], HEAD_CENTER[1], HEAD_CENTER[2]);
    bounceGroup.add(head);

    const headGeo = buildHeadGeometry(0.0105);
    const headMesh = new Mesh(headGeo, matHead);
    head.add(headMesh);
    head.add(makeFuzzShell(headGeo, 0.005, 0.28));
    head.add(makeFuzzShell(headGeo, 0.014, 0.11));

    // 沿 -Z 方向探到头部的表面深度：眼睛、鼻子这类贴面物件靠它贴准
    function headSurfaceZ(localX, localY) {
      const wx = HEAD_CENTER[0] + localX;
      const wy = HEAD_CENTER[1] + localY;
      for (let z = 0.75; z > -0.2; z -= 0.003) {
        if (headSdf(wx, wy, HEAD_CENTER[2] + z) < 0) return z;
      }
      return 0.3;
    }
    function headSurfacePoint(localX, localY) {
      const z = headSurfaceZ(localX, localY);
      const wx = HEAD_CENTER[0] + localX;
      const wy = HEAD_CENTER[1] + localY;
      const wz = HEAD_CENTER[2] + z;
      const e = 0.004;
      const normal = new Vector3(
        headSdf(wx + e, wy, wz) - headSdf(wx - e, wy, wz),
        headSdf(wx, wy + e, wz) - headSdf(wx, wy - e, wz),
        headSdf(wx, wy, wz + e) - headSdf(wx, wy, wz - e),
      ).normalize();
      return { z, normal };
    }

    // ---- 鼻子：小圆三角，粉色 ----
    const noseShape = new Shape();
    noseShape.moveTo(-0.036, 0.017);
    noseShape.quadraticCurveTo(-0.036, 0.026, -0.024, 0.023);
    noseShape.quadraticCurveTo(0, 0.018, 0.024, 0.023);
    noseShape.quadraticCurveTo(0.036, 0.026, 0.036, 0.017);
    noseShape.quadraticCurveTo(0.036, -0.003, 0.009, -0.02);
    noseShape.quadraticCurveTo(0.003, -0.025, 0, -0.025);
    noseShape.quadraticCurveTo(-0.003, -0.025, -0.009, -0.02);
    noseShape.quadraticCurveTo(-0.036, -0.003, -0.036, 0.017);
    const noseGeo = new ExtrudeGeometry(noseShape, {
      depth: 0.009, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 3, curveSegments: 10,
    });
    noseGeo.center();
    const noseY = -0.168;
    const nose = new Mesh(noseGeo, matNose);
    nose.position.set(0, noseY, headSurfaceZ(0, noseY) + 0.012);
    nose.rotation.x = -0.16;
    head.add(nose);

    // 人中 + 嘴：一个很小的 w
    const philtrum = new CatmullRomCurve3([
      new Vector3(0, noseY - 0.035, headSurfaceZ(0, noseY - 0.035) + 0.006),
      new Vector3(0, noseY - 0.052, headSurfaceZ(0, noseY - 0.052) + 0.005),
    ]);
    head.add(new Mesh(taperedTube(philtrum, u => lerp(0.0036, 0.0028, u), 6, 4), matMouth));
    [-1, 1].forEach(side => {
      const mouthCurve = new CatmullRomCurve3([
        new Vector3(0, noseY - 0.052, headSurfaceZ(0, noseY - 0.052) + 0.005),
        new Vector3(side * 0.028, noseY - 0.06, headSurfaceZ(side * 0.028, noseY - 0.06) + 0.004),
        new Vector3(side * 0.052, noseY - 0.05, headSurfaceZ(side * 0.052, noseY - 0.05) + 0.003),
      ]);
      head.add(new Mesh(taperedTube(mouthCurve, () => 0.0036, 10, 4), matMouth));
    });

    // ---- 眼睛：Q 版的大圆眼，深色玻璃珠 + 两颗高光 ----
    function buildEyeGeometry(r) {
      const geo = new CircleGeometry(1, 40);
      const position = geo.attributes.position;
      for (let i = 0; i < position.count; i += 1) {
        const px = position.getX(i) * r;
        const py = position.getY(i) * r;
        position.setX(i, px);
        position.setY(i, py);
        position.setZ(i, -(px * px + py * py) / 0.8);
      }
      position.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    }
    const eyeGeo = new SphereGeometry(1, 36, 26);
    const eyeRigs = [];
    [-1, 1].forEach(side => {
      const ex = side * 0.172;
      const ey = 0.0;
      const surface = headSurfacePoint(ex, ey);
      const rig = new Group();
      rig.position.set(
        ex + surface.normal.x * -0.026,
        ey + surface.normal.y * -0.026,
        surface.z + surface.normal.z * -0.026,
      );
      head.add(rig);

      const eye = new Mesh(eyeGeo, matEye);
      eye.scale.set(0.085, 0.085, 0.078);
      eye.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), surface.normal);
      rig.add(eye);

      eyeRigs.push(rig);
    });

    // ---- 耳朵：厚三角，耳根埋在头里，可单独抖 ----
    const ears = [];
    [-1, 1].forEach(side => {
      const spine = new CatmullRomCurve3([
        new Vector3(0, 0, 0),
        new Vector3(side * 0.085, 0.2, -0.006),
        new Vector3(side * 0.155, 0.345, -0.018),
      ]);
      const pivot = new Group();
      pivot.position.set(side * 0.235, 0.285, -0.02);
      pivot.rotation.z = side * -0.26;
      pivot.rotation.x = -0.05;
      head.add(pivot);

      const blade = new Group();
      blade.scale.set(1, 0.95, 1);
      pivot.add(blade);

      const ear = new Mesh(
        tintGeometry(taperedTube(spine, u => lerp(0.215, 0.03, Math.pow(u, 0.7)), 26, 16), [0.32, 0.313, 0.31]),
        matHead,
      );
      ear.scale.z = 0.78;
      blade.add(ear);

      const innerShape = new Shape();
      innerShape.moveTo(-0.07, 0.045);
      innerShape.lineTo(0.07, 0.045);
      innerShape.lineTo(side * 0.1, 0.245);
      innerShape.closePath();
      const inner = new Mesh(tintGeometry(new ShapeGeometry(innerShape, 4), [1, 1, 1]), matPink);
      inner.position.set(0, -0.01, 0.098);
      inner.rotation.x = 0.16;
      blade.add(inner);

      ears.push({ pivot, side, angle: 0, velocity: 0, next: 0 });
    });

    // ---- 米色渔夫帽：帽冠 + 软帽檐 + 帽带 + 两片叶子 ----
    const hat = new Group();
    hat.position.set(0, 0.3, 0.03);
    hat.rotation.z = 0.07;
    hat.rotation.x = -0.06;
    head.add(hat);

    // 帽体用一条车削母线一次成型：帽顶、帽墙、帽檐、檐口卷边都是连续曲面，
    // 不再是“圆柱 + 圆盘”两块硬边拼起来。
    // 帽冠：一条母线车削，帽顶到帽墙根部连续
    const crownProfile = [
      [0.0, 0.25], [0.07, 0.247], [0.13, 0.236], [0.17, 0.215],
      [0.192, 0.185], [0.203, 0.135], [0.207, 0.075], [0.21, 0.02], [0.212, 0.004],
    ];
    const hatGeo = new LatheGeometry(crownProfile.map(([r, y]) => new Vector2(r, y)), 64);
    hatGeo.computeVertexNormals();
    const hatBody = new Mesh(hatGeo, matHat);
    hat.add(hatBody);

    // 帽檐：不是正圆盘。两侧（耳朵所在方向）收窄并向上翻，
    // 前后（z 方向）放开成正常的宽檐——这样帽檐正好绕开耳朵，不会穿模。
    function buildBrimGeometry(innerR, outerFront, outerSide, dropFront, liftSide, thickness) {
      const SEGMENTS = 72;
      const RINGS = 5;
      const positions = [];
      const indices = [];
      const radiusAt = theta => {
        const s = Math.abs(Math.sin(theta));
        return outerSide + (outerFront - outerSide) * Math.pow(s, 0.8);
      };
      const heightAt = theta => {
        const s = Math.abs(Math.sin(theta));
        return -liftSide - (dropFront - liftSide) * Math.pow(s, 1.2);
      };
      // 上表面 + 下表面
      for (let side = 0; side < 2; side += 1) {
        const yOffset = side === 0 ? 0 : -thickness;
        for (let i = 0; i <= SEGMENTS; i += 1) {
          const theta = (i / SEGMENTS) * Math.PI * 2;
          const rOuter = radiusAt(theta);
          const yOuter = heightAt(theta);
          for (let j = 0; j <= RINGS; j += 1) {
            const t = j / RINGS;
            const r = innerR + (rOuter - innerR) * t;
            // 檐口略微上卷
            const y = yOuter * Math.pow(t, 1.15) + 0.002 * Math.sin(t * Math.PI) + yOffset;
            positions.push(Math.cos(theta) * r, y, Math.sin(theta) * r);
          }
        }
      }
      const stride = (SEGMENTS + 1) * (RINGS + 1);
      for (let side = 0; side < 2; side += 1) {
        for (let i = 0; i < SEGMENTS; i += 1) {
          for (let j = 0; j < RINGS; j += 1) {
            const a = side * stride + i * (RINGS + 1) + j;
            const b = a + RINGS + 1;
            if (side === 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
            else indices.push(a, a + 1, b, b, a + 1, b + 1);
          }
        }
      }
      // 檐口外沿把上下两片缝起来
      for (let i = 0; i < SEGMENTS; i += 1) {
        const topA = i * (RINGS + 1) + RINGS;
        const topB = (i + 1) * (RINGS + 1) + RINGS;
        const botA = stride + topA;
        const botB = stride + topB;
        indices.push(topA, botA, topB, topB, botA, botB);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }
    const brimMesh = new Mesh(buildBrimGeometry(0.205, 0.335, 0.335, 0.07, 0.07, 0.022), matHat);
    hat.add(brimMesh);

    // 帽带：贴在帽墙上的一圈窄带，半径与帽墙一致，不再像套了个呼啦圈
    const bandProfile = [
      [0.196, 0.07], [0.203, 0.064], [0.205, 0.05], [0.203, 0.034], [0.196, 0.028],
    ];
    const bandGeo = new LatheGeometry(bandProfile.map(([r, y]) => new Vector2(r, y)), 48);
    const band = new Mesh(bandGeo, matHatBand);
    hat.add(band);

    // 叶子：两片扁椭球，从帽带右侧探出来
    [0.0, 1.0].forEach((k) => {
      const leaf = new Mesh(new SphereGeometry(1, 14, 10), matLeaf);
      leaf.scale.set(0.085, 0.028, 0.045);
      leaf.position.set(0.2 + k * 0.03, 0.05 + k * 0.045, 0.1 + k * 0.02);
      leaf.rotation.set(k * 0.5 - 0.2, -0.5 + k * 0.4, 0.5 - k * 0.9);
      hat.add(leaf);
    });
    // ---- 尾巴：逐帧变形的管状几何，半径连续、法线解析，一个 draw call ----
    const tailPoints = [
      new Vector3(0.18, 0.33, -0.22),
      new Vector3(0.38, 0.29, -0.33),
      new Vector3(0.52, 0.36, -0.3),
      new Vector3(0.58, 0.48, -0.18),
      new Vector3(0.54, 0.56, -0.04),
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
    // 尾巴跟身体同色，带几道深色环纹
    const tailColorA = new Color('#a09c99');
    const tailColorB = new Color('#7d7877');
    const tailTint = new Color();
    for (let i = 0; i <= TAIL_TUBULAR; i += 1) {
      const u = i / TAIL_TUBULAR;
      // 环纹：沿尾巴长度方向交替
      const ring = 0.5 + 0.5 * Math.sin(u * Math.PI * 5.2 - 0.6);
      tailTint.copy(tailColorA).lerp(tailColorB, ring * 0.85);
      // 尾尖提亮一点，别糊成一根棍
      if (u > 0.82) tailTint.lerp(new Color('#bdb6b0'), (u - 0.82) / 0.18 * 0.5);
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
        const radius = lerp(0.135, 0.016, Math.pow(u, 1.9));
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
    }

    // ---- 胡须：整组去掉 ----
    // 白猫的胡须在 144px 下只会糊成嘴边一圈灰影（就是之前那个“络腮胡”），
    // 嘴部留干净的口鼻体积 + 极淡嘴线，反而更像白猫。

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
      environment.dispose?.();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div className="pet-3d" ref={hostRef} role="button" tabIndex={0}
    aria-label="摸摸这只立体小猫，可以拖动旋转" />;
}
