import { BufferAttribute, BufferGeometry } from 'three';

// ---------------------------------------------------------------------------
// Q 版布偶小猫（对照 SMALL_CAT IP 展板）：大头、短身、圆手圆脚。
// 体积用隐式曲面拼出来，再用 surface nets 多边形化：
// 头、腮、身体、四肢、尾巴之间是真的融合，不是几个球互相插着。
// 毛色（灰白分区、额头虎斑、奶油肚皮、腮红）写进顶点色，跟着曲面走。
// ---------------------------------------------------------------------------

const TILE = 0.42;

export const HEAD_CENTER = [0, 1.12, 0.02];

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

// 锥形胶囊：一端粗一端细，用来做腿、手臂、尾巴
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

// ---- 身体：一个胖梨 + 两条短腿 + 两只短手 ----
export function bodySdf(x, y, z) {
  let d = sdEllipsoid(x, y, z, 0, 0.52, 0, 0.315, 0.31, 0.265);
  // 下腹：屁屁再圆一点，坐得住
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.35, 0.0, 0.33, 0.22, 0.27), 0.16);
  // 胸口略收，头才压得住
  d = smin(d, sdEllipsoid(x, y, z, 0, 0.7, 0.01, 0.255, 0.14, 0.225), 0.14);

  for (let s = -1; s <= 1; s += 2) {
    // 短腿：几乎和身体一样粗
    d = smin(d, sdTaperedCapsule(x, y, z, s * 0.165, 0.32, 0.0, s * 0.19, 0.11, 0.03, 0.118, 0.108), 0.03);
    // 脚掌：圆饼，前缘略抬
    d = smin(d, sdEllipsoid(x, y, z, s * 0.19, 0.052, 0.075, 0.118, 0.052, 0.145), 0.03);
    // 短手：从肩膀垂下来，微微外八
    d = smin(d, sdTaperedCapsule(x, y, z, s * 0.275, 0.66, 0.06, s * 0.4, 0.43, 0.12, 0.088, 0.066), 0.02);
    // 手爪
    d = smin(d, sdSphere(x, y, z, s * 0.405, 0.4, 0.14, 0.068), 0.016);
  }

  // 尾巴根：从屁股后方伸出去，尾巴本体会另做动画
  d = smin(d, sdTaperedCapsule(x, y, z, 0.16, 0.32, -0.18, 0.3, 0.26, -0.3, 0.085, 0.07), 0.06);
  return d;
}

// ---- 头：大圆头 + 两团胖腮 + 小口鼻 + 下巴 ----
export function headSdf(x, y, z) {
  const [hx, hy, hz] = HEAD_CENTER;
  let d = sdEllipsoid(x, y, z, hx, hy, hz, 0.4, 0.375, 0.355);
  // 腮：两块胖乎乎的肉，决定这种 Q 版的脸型
  d = smin(d, sdEllipsoid(x, y, z, hx + 0.215, hy - 0.1, hz + 0.1, 0.185, 0.17, 0.16), 0.14);
  d = smin(d, sdEllipsoid(x, y, z, hx - 0.215, hy - 0.1, hz + 0.1, 0.185, 0.17, 0.16), 0.14);
  // 口鼻：小圆包，位置偏低
  let muzzle = sdSphere(x, y, z, hx + 0.045, hy - 0.16, hz + 0.3, 0.1);
  muzzle = smin(muzzle, sdSphere(x, y, z, hx - 0.045, hy - 0.16, hz + 0.3, 0.1), 0.05);
  d = smin(d, muzzle, 0.08);
  // 下巴：把嘴下面填圆，别留个尖
  d = smin(d, sdEllipsoid(x, y, z, hx, hy - 0.245, hz + 0.2, 0.16, 0.09, 0.13), 0.07);
  // 颈桩：伸进身体
  d = smin(d, sdTaperedCapsule(x, y, z, hx, 0.72, hz - 0.02, hx, hy - 0.2, hz, 0.19, 0.215), 0.12);
  return d;
}

// ---- 毛色 ----
const FUR_GRAY = [0.52, 0.51, 0.505];
const FUR_GRAY_DARK = [0.2, 0.19, 0.19];
const FUR_CREAM = [0.82, 0.77, 0.69];
const FUR_CREAM_LIGHT = [0.9, 0.86, 0.79];
const BLUSH = [1, 0.76, 0.74];

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

// 额头虎斑：绕头部竖轴分条，只在眼睛以上、正面才出现
function headStripes(x, y, z) {
  const lx = x - HEAD_CENTER[0];
  const ly = y - HEAD_CENTER[1];
  const lz = z - HEAD_CENTER[2];
  const angle = Math.atan2(lx, lz);
  const band = Math.sin(angle * 5.0);
  const above = smoothstep(0.02, 0.16, ly);
  const front = smoothstep(0.05, 0.32, lz + 0.1);
  return smoothstep(0.2, 0.75, band) * above * front;
}

function bodyTint(x, y, z) {
  let color = FUR_GRAY;
  // 肚皮：正面一大块奶油色
  const bx = x / 0.225;
  const by = (y - 0.47) / 0.235;
  const bz = (z - 0.19) / 0.16;
  const belly = smoothstep(1.15, 0.62, Math.sqrt(bx * bx + by * by + bz * bz));
  color = blend(color, FUR_CREAM_LIGHT, belly);
  // 胸口往上带一点浅色，和头部的奶油口鼻呼应
  const chest = smoothstep(0.52, 0.78, y) * smoothstep(0.05, 0.3, z) * 0.35;
  color = blend(color, FUR_CREAM, chest);
  // 脚掌尖也偏浅
  const pawTip = smoothstep(0.2, 0.05, y) * 0.45;
  color = blend(color, FUR_CREAM, pawTip);
  return color;
}

function headTint(x, y, z) {
  const [hx, hy, hz] = HEAD_CENTER;
  let color = FUR_GRAY;
  // 口鼻与下巴：一大片奶油色，竖椭圆
  const mx = (x - hx) / 0.235;
  const my = (y - (hy - 0.15)) / 0.185;
  const mz = (z - (hz + 0.3)) / 0.2;
  const muzzle = smoothstep(1.15, 0.5, Math.sqrt(mx * mx + my * my + mz * mz));
  color = blend(color, FUR_CREAM_LIGHT, muzzle);
  // 虎斑：展板上只有很淡的几道，缩到 144px 会变成脸上的“折痕”，这里只留一点点
  color = blend(color, FUR_GRAY_DARK, headStripes(x, y, z) * 0.28);
  // 两颊腮红
  for (let s = -1; s <= 1; s += 2) {
    const px = (x - s * 0.255) / 0.115;
    const py = (y - (hy - 0.05)) / 0.075;
    const pz = (z - (hz + 0.24)) / 0.11;
    const d = Math.sqrt(px * px + py * py + pz * pz);
    const k = smoothstep(1.05, 0.15, d) * 0.5;
    if (k > 0) color = blend(color, BLUSH, k);
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

// 拉普拉斯平滑：去掉体素台阶
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

  smoothPositions(positions, indices, 0.34);
  smoothPositions(positions, indices, 0.22);

  const positionArray = new Float32Array(positions);
  const normalArray = new Float32Array(count * 3);
  const uvArray = new Float32Array(count * 2);
  const colorArray = new Float32Array(count * 3);

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

    // 环境遮蔽：缝隙压暗，但别压出脏灰
    let occ = 0;
    let weight = 1;
    for (let k = 1; k <= 5; k += 1) {
      const h = 0.13 * (k / 5);
      const d = sdf(x + nx * h, y + ny * h, z + nz * h);
      occ += Math.max(0, h - d) * weight;
      weight *= 0.72;
    }
    const ao = Math.max(0.78, 1 - occ * 15);

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
    const shade = (0.93 + 0.07 * Math.pow(t, 0.8)) * ao;
    const tint = tintFn ? tintFn(x, y, z) : [1, 0.99, 0.97];
    colorArray[i * 3] = tint[0] * shade;
    colorArray[i * 3 + 1] = tint[1] * shade;
    colorArray[i * 3 + 2] = tint[2] * shade;
  }

  // 用梯度法线把朝内的三角形翻过来
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

export function buildBodyGeometry(voxel = 0.02) {
  return polygonize(bodySdf, [-0.78, -0.02, -0.62], [0.78, 0.94, 0.62], voxel, [0, 0, 0], bodyTint);
}

export function buildHeadGeometry(voxel = 0.014) {
  const [cx, cy, cz] = HEAD_CENTER;
  return polygonize(headSdf, [cx - 0.66, 0.56, cz - 0.56], [cx + 0.66, 1.62, cz + 0.56], voxel, HEAD_CENTER, headTint);
}
