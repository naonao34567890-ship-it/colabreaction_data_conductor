// Rigidly fit the optimized coordinates to the original, without reflection.
export function alignGeometry(original, optimized, anchor = -1) {
  const count = original.length / 3;
  function origin(coordinates) {
    if (anchor >= 0) return coordinates.slice(3 * anchor, 3 * anchor + 3);
    const center = [0, 0, 0];
    for (let i = 0; i < coordinates.length; i++) center[i % 3] += coordinates[i] / count;
    return center;
  }
  const start = origin(original);
  const end = origin(optimized);
  const covariance = Array.from({length: 3}, () => [0, 0, 0]);
  for (let i = 0; i < original.length; i += 3) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        covariance[row][col] += (optimized[i + row] - end[row]) * (original[i + col] - start[col]);
      }
    }
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = covariance;
  const matrix = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, yy - xx - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, zz - xx - yy],
  ];
  const [w, x, y, z] = bestQuaternion(matrix);
  const rotation = [
    [1 - 2*(y*y + z*z), 2*(x*y - w*z), 2*(x*z + w*y)],
    [2*(x*y + w*z), 1 - 2*(x*x + z*z), 2*(y*z - w*x)],
    [2*(x*z - w*y), 2*(y*z + w*x), 1 - 2*(x*x + y*y)],
  ];
  return optimized.map((_, i) => {
    const axis = i % 3;
    return rotation[axis].reduce((value, factor, col) =>
      value + factor * (optimized[i - axis + col] - end[col]), start[axis]);
  });
}

// Jacobi diagonalization of Horn's symmetric quaternion matrix.
function bestQuaternion(matrix) {
  const vectors = matrix.map((row, i) => row.map((_, j) => Number(i === j)));
  for (let sweep = 0; sweep < 16; sweep++) {
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        const cross = matrix[p][q];
        if (cross === 0) continue;
        const angle = 0.5 * Math.atan2(2 * cross, matrix[q][q] - matrix[p][p]);
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        for (const rows of [matrix, vectors]) {
          for (const row of rows) {
            const [a, b] = [row[p], row[q]];
            row[p] = c*a - s*b;
            row[q] = s*a + c*b;
          }
        }
        for (let i = 0; i < 4; i++) {
          const [a, b] = [matrix[p][i], matrix[q][i]];
          matrix[p][i] = c*a - s*b;
          matrix[q][i] = s*a + c*b;
        }
        matrix[p][q] = matrix[q][p] = 0;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) {
    if (matrix[i][i] > matrix[best][best]) best = i;
  }
  return vectors.map(row => row[best]);
}
