import { BufferAttribute, BufferGeometry } from 'three';

// ---------------------------------------------------------------------------
// 用隐式曲面（SDF）雕出猫的躯干和头，再用 surface nets 多边形化。
// 肩、胸、腿、腮、口鼻之间是真正的体积融合，不是几块几何体互相穿插。
// 生成后做一次拉普拉斯平滑去掉体素台阶，并按 SDF 梯度校正三角形绕序。
// ---------------------------------------------------------------------------

const TILE = 0.42;

export const HEAD_CENTER = [0, 1.44, 0.02];

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}


function sdSphere(px, py, pz, cx, cy, cz, r) {
  const x = px - cx;
  const y = py - cy;
  const z = pz - cz;
  return Math.sqrt(x * x + y * y + z * z) - r;
}

function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx;
  const y = (py - cy) / ry;
  const z = (pz - cz) / rz;
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const nx = x / rx;
  const ny = y / ry;
  const nz = z / rz;
  const k1 = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-6;
  return (k0 * (k0 - 1)) / k1;
}

function sdRoundBox(px, py, pz, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const qz = Math.abs(pz - cz) - hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
}

// 锥形胶囊：底部粗、末端细
function sdTaperedCapsule(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-6;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2));
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (r1 + (r2 - r1) * t);
}

// ---- 躯干：臀、腰、胸、肩、前腿、脚掌、脚趾 ----
export function bodySdf(x, y, z) {
  // 坐姿的躯干：下宽上窄的两个大椭球，融合得很软，没有收腰
  let d = sdEllipsoid(x, y, z, 0, 0.42, 0, 0.4, 0.44, 0.4);
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.72, 0.02, 0.32, 0.34, 0.33), 0.26);
  // 后蹲
  d = smin(d, sdSphere(x, y, z, 0.3, 0.25, 0.03, 0.225), 0.13);
  d = smin(d, sdSphere(x, y, z, -0.3, 0.25, 0.03, 0.225), 0.13);
  // 胸
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.63, 0.2, 0.255, 0.26, 0.2), 0.12);
  // 颈根：收细一点，头和身体之间才有脖子
  d = smin(d, sdSphere(x, y, z, 0, 1.0, 0.03, 0.185), 0.1);
  // 尾根
  d = smin(d, sdSphere(x, y, z, 0.28, 0.26, -0.3, 0.115), 0.07);

  // 前腿与脚掌
  for (let s = -1; s <= 1; s += 2) {
    d = smin(d, sdTaperedCapsule(x, y, z, s * 0.18, 0.66, 0.22, s * 0.2, 0.1, 0.3, 0.11, 0.092), 0.045);
    d = smin(d, sdEllipsoid(x, y, z, s * 0.2, 0.055, 0.33, 0.128, 0.062, 0.16), 0.035);
    // 脚趾分瓣
    for (let t = -1; t <= 1; t += 1) {
      d = smin(d, sdSphere(x, y, z, s * 0.2 + t * 0.052, 0.045, 0.415, 0.036), 0.014);
    }
  }
  return d;
}

// ---- 头：颅、腮、下颌、口鼻、鼻梁、下巴、颈桩 ----
export function headSdf(x, y, z) {
  const [hx, hy, hz] = HEAD_CENTER;
  // 颅用圆角盒：顶部略平、两侧饱满，比纯椭球更像猫
  let d = sdRoundBox(x, y, z, hx, hy + 0.02, hz, 0.135, 0.092, 0.118, 0.23);
  // 额与鼻梁
  d = smin(d, sdEllipsoid(x, y, z, hx, hy + 0.07, hz + 0.1, 0.26, 0.2, 0.24), 0.12);
  d = smin(d, sdEllipsoid(x, y, z, hx, hy - 0.06, hz + 0.26, 0.075, 0.13, 0.09), 0.07);
  // 腮：只做一点点鼓，位置抬高到眼睛下方，别坠成腮帮子
  d = smin(d, sdSphere(x, y, z, hx + 0.25, hy - 0.062, hz + 0.085, 0.122), 0.14);
  d = smin(d, sdSphere(x, y, z, hx - 0.25, hy - 0.062, hz + 0.085, 0.122), 0.14);
  // 下颌：收窄，让下巴是弧线而不是方下巴
  d = smin(d, sdSphere(x, y, z, hx + 0.15, hy - 0.185, hz + 0.19, 0.088), 0.075);
  d = smin(d, sdSphere(x, y, z, hx - 0.15, hy - 0.185, hz + 0.19, 0.088), 0.075);
  // 口鼻：两瓣嘴垫 + 一点下巴。体积压扁、融合半径加大，让口鼻贴着脸上，
  // 不在鼻子周围留出深沟——那圈阴影在小尺寸下会变成「胡茬」。
  let muzzle = sdSphere(x, y, z, hx + 0.05, hy - 0.188, hz + 0.3, 0.06);
  muzzle = smin(muzzle, sdSphere(x, y, z, hx - 0.05, hy - 0.188, hz + 0.3, 0.06), 0.05);
  muzzle = smin(muzzle, sdSphere(x, y, z, hx, hy - 0.235, hz + 0.252, 0.05), 0.05);
  d = smin(d, muzzle, 0.055);
  // 颈桩：伸进躯干，转头时不露缝
  d = smin(d, sdTaperedCapsule(x, y, z, hx, 0.96, hz - 0.01, hx, hy - 0.12, hz, 0.15, 0.178), 0.09);
  return d;
}

// ---- 毛色：白猫。整体接近纯白，靠极淡的暖灰把体积托出来 ----
// 纯白在白色页面上会糊成一片，所以底色调到带一点暖灰的白。
const CREAM_BODY = [0.878, 0.868, 0.852];
const CREAM_HEAD = [0.9, 0.892, 0.876];
const WHITE = [1, 0.993, 0.978];

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function blend(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function bodyTint(x, y, z) {
  let mask = 0;
  const cx = x / 0.26;
  const cy = (y - 0.55) / 0.34;
  const cz = (z - 0.24) / 0.3;
  mask = Math.max(mask, smoothstep(1.03, 0.66, Math.sqrt(cx * cx + cy * cy + cz * cz)));
  for (let s = -1; s <= 1; s += 2) {
    const px = (x - s * 0.2) / 0.16;
    const py = (y - 0.05) / 0.1;
    const pz = (z - 0.32) / 0.18;
    mask = Math.max(mask, smoothstep(1.05, 0.68, Math.sqrt(px * px + py * py + pz * pz)));
  }
  return blend(CREAM_BODY, WHITE, mask * 0.92);
}

function headTint(x, y, z) {
  // 白猫：整张脸几乎是同一个白，只留极轻的暖灰让轮廓有层次
  let color = blend(CREAM_HEAD, WHITE, 0.42);
  // 腮红直接写进顶点色：跟着曲面走，不会像贴片那样陷进脸里或翻转朝外
  for (let s = -1; s <= 1; s += 2) {
    const px = (x - s * 0.212) / 0.1;
    const py = (y - 1.283) / 0.062;
    const pz = (z - 0.33) / 0.085;
    const d = Math.sqrt(px * px + py * py + pz * pz);
    const k = smoothstep(1.05, 0.15, d) * 0.72;
    if (k > 0) color = blend(color, [1, 0.76, 0.79], k);
  }
  return color;
}

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// 拉普拉斯平滑：去掉体素化的台阶感
function smoothPositions(positions, indices, factor = 0.32) {
  const count = positions.length / 3;
  const sum = new Float32Array(positions.length);
  const deg = new Float32Array(count);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    for (const [u, v] of [[a, b], [a, c], [b, a], [b, c], [c, a], [c, b]]) {
      sum[u * 3] += positions[v * 3];
      sum[u * 3 + 1] += positions[v * 3 + 1];
      sum[u * 3 + 2] += positions[v * 3 + 2];
      deg[u] += 1;
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (!deg[i]) continue;
    for (let k = 0; k < 3; k += 1) {
      const avg = sum[i * 3 + k] / deg[i];
      positions[i * 3 + k] += (avg - positions[i * 3 + k]) * factor;
    }
  }
}

function polygonize(sdf, min, max, voxel, origin, tintFn) {
  const nx = Math.ceil((max[0] - min[0]) / voxel);
  const ny = Math.ceil((max[1] - min[1]) / voxel);
  const nz = Math.ceil((max[2] - min[2]) / voxel);
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const field = new Float32Array(sx * sy * sz);

  for (let k = 0; k < sz; k += 1) {
    const wz = min[2] + k * voxel;
    for (let j = 0; j < sy; j += 1) {
      const wy = min[1] + j * voxel;
      for (let i = 0; i < sx; i += 1) {
        field[i + sx * (j + sy * k)] = sdf(min[0] + i * voxel, wy, wz);
      }
    }
  }

  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const positions = [];
  const cellAt = (i, j, k) => i + nx * (j + ny * k);

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const v = new Array(8);
        let mask = 0;
        for (let c = 0; c < 8; c += 1) {
          const co = CORNERS[c];
          const value = field[(i + co[0]) + sx * ((j + co[1]) + sy * (k + co[2]))];
          v[c] = value;
          if (value < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let ax = 0;
        let ay = 0;
        let az = 0;
        let cnt = 0;
        for (let e = 0; e < 12; e += 1) {
          const a = EDGES[e][0];
          const b = EDGES[e][1];
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          const ca = CORNERS[a];
          const cb = CORNERS[b];
          ax += ca[0] + (cb[0] - ca[0]) * t;
          ay += ca[1] + (cb[1] - ca[1]) * t;
          az += ca[2] + (cb[2] - ca[2]) * t;
          cnt += 1;
        }
        if (!cnt) continue;

        cellVert[cellAt(i, j, k)] = positions.length / 3;
        positions.push(
          min[0] + (i + ax / cnt) * voxel - origin[0],
          min[1] + (j + ay / cnt) * voxel - origin[1],
          min[2] + (k + az / cnt) * voxel - origin[2],
        );
      }
    }
  }

  const indices = [];
  const pushQuad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (a === b || b === c || c === d || a === d) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };

  for (let k = 1; k < nz; k += 1) {
    for (let j = 1; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const a = field[i + sx * (j + sy * k)];
        const b = field[(i + 1) + sx * (j + sy * k)];
        if ((a < 0) === (b < 0)) continue;
        pushQuad(
          cellVert[cellAt(i, j - 1, k - 1)], cellVert[cellAt(i, j, k - 1)],
          cellVert[cellAt(i, j, k)], cellVert[cellAt(i, j - 1, k)], a >= 0,
        );
      }
    }
  }
  for (let k = 1; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 1; i < nx; i += 1) {
        const a = field[i + sx * (j + sy * k)];
        const b = field[i + sx * ((j + 1) + sy * k)];
        if ((a < 0) === (b < 0)) continue;
        pushQuad(
          cellVert[cellAt(i - 1, j, k - 1)], cellVert[cellAt(i, j, k - 1)],
          cellVert[cellAt(i, j, k)], cellVert[cellAt(i - 1, j, k)], a >= 0,
        );
      }
    }
  }
  for (let k = 0; k < nz; k += 1) {
    for (let j = 1; j < ny; j += 1) {
      for (let i = 1; i < nx; i += 1) {
        const a = field[i + sx * (j + sy * k)];
        const b = field[i + sx * (j + sy * (k + 1))];
        if ((a < 0) === (b < 0)) continue;
        pushQuad(
          cellVert[cellAt(i - 1, j - 1, k)], cellVert[cellAt(i, j - 1, k)],
          cellVert[cellAt(i, j, k)], cellVert[cellAt(i - 1, j, k)], a >= 0,
        );
      }
    }
  }

  const count = positions.length / 3;
  if (!count) return null;

  smoothPositions(positions, indices);

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(count * 3);
  const uvArray = new Float32Array(count * 2);
  const colorArray = new Float32Array(count * 3);

  // 法线用 SDF 梯度解析求
  const eps = voxel * 0.6;
  const yMin = min[1] - origin[1];
  const ySpan = Math.max(1e-4, max[1] - min[1]);

  for (let i = 0; i < count; i += 1) {
    const x = positionArray[i * 3] + origin[0];
    const y = positionArray[i * 3 + 1] + origin[1];
    const z = positionArray[i * 3 + 2] + origin[2];
    let nx = sdf(x + eps, y, z) - sdf(x - eps, y, z);
    let ny = sdf(x, y + eps, z) - sdf(x, y - eps, z);
    let nz = sdf(x, y, z + eps) - sdf(x, y, z - eps);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    normalArray[i * 3] = nx;
    normalArray[i * 3 + 1] = ny;
    normalArray[i * 3 + 2] = nz;

    // SDF 环境遮蔽：沿法线采样，靠得越近说明越处在褶皱里
    let occ = 0;
    let weight = 1;
    for (let k = 1; k <= 5; k += 1) {
      const h = 0.14 * (k / 5);
      const d = sdf(x + nx * h, y + ny * h, z + nz * h);
      occ += Math.max(0, h - d) * weight;
      weight *= 0.72;
    }
    const ao = Math.max(0.84, 1 - occ * 13);

    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u;
    let v;
    if (ax >= ay && ax >= az) { u = z; v = y; }
    else if (ay >= az) { u = x; v = z; }
    else { u = x; v = y; }
    uvArray[i * 2] = u / TILE;
    uvArray[i * 2 + 1] = v / TILE;

    const t = Math.max(0, Math.min(1, (positionArray[i * 3 + 1] - yMin) / ySpan));
    const shade = (0.9 + 0.1 * Math.pow(t, 0.8)) * ao;
    const tint = tintFn ? tintFn(x, y, z) : [1, 0.99, 0.97];
    colorArray[i * 3] = tint[0] * shade;
    colorArray[i * 3 + 1] = tint[1] * shade * 0.994;
    colorArray[i * 3 + 2] = tint[2] * shade * 0.984;
  }

  // 用梯度法线把朝内的三角形翻过来，避免被背面剔除
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const ax = positionArray[ia * 3];
    const ay = positionArray[ia * 3 + 1];
    const az = positionArray[ia * 3 + 2];
    const ux = positionArray[ib * 3] - ax;
    const uy = positionArray[ib * 3 + 1] - ay;
    const uz = positionArray[ib * 3 + 2] - az;
    const vx = positionArray[ic * 3] - ax;
    const vy = positionArray[ic * 3 + 1] - ay;
    const vz = positionArray[ic * 3 + 2] - az;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const gx = normalArray[ia * 3] + normalArray[ib * 3] + normalArray[ic * 3];
    const gy = normalArray[ia * 3 + 1] + normalArray[ib * 3 + 1] + normalArray[ic * 3 + 1];
    const gz = normalArray[ia * 3 + 2] + normalArray[ib * 3 + 2] + normalArray[ic * 3 + 2];
    if (fx * gx + fy * gy + fz * gz < 0) {
      indices[t + 1] = ic;
      indices[t + 2] = ib;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positionArray, 3));
  geometry.setAttribute('normal', new BufferAttribute(normalArray, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvArray, 2));
  geometry.setAttribute('color', new BufferAttribute(colorArray, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildBodyGeometry(voxel = 0.026) {
  return polygonize(bodySdf, [-0.94, -0.03, -0.6], [0.94, 1.26, 0.56], voxel, [0, 0, 0], bodyTint);
}

export function buildHeadGeometry(voxel = 0.019) {
  const [cx, cy, cz] = HEAD_CENTER;
  return polygonize(headSdf, [cx - 0.62, 1.0, cz - 0.52], [cx + 0.62, 1.92, cz + 0.52], voxel, HEAD_CENTER, headTint);
}
