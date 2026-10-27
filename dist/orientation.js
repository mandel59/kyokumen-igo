// Unit quaternion [x, y, z, w], taking board coordinates into camera coordinates.
// Camera x points right, y points up, and z points toward the viewer.
export function normalizeOrientation(q) {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) throw new Error('Invalid orientation');
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error('Invalid orientation');
  return q.map(value => value / length);
}

function multiply(a, b) {
  const [x, y, z, w] = a, [X, Y, Z, W] = b;
  return [w*X+x*W+y*Z-z*Y, w*Y-x*Z+y*W+z*X, w*Z+x*Y-y*X+z*W, w*W-x*X-y*Y-z*Z];
}

// The legacy renderer used Rx(rotX) * Ry(rotY), in that exact order.
export function orientationFromEuler(rotX, rotY) {
  if (!Number.isFinite(rotX) || !Number.isFinite(rotY)) throw new Error('Invalid rotation');
  return normalizeOrientation(multiply([Math.sin(rotX/2), 0, 0, Math.cos(rotX/2)], [0, Math.sin(rotY/2), 0, Math.cos(rotY/2)]));
}

// Home view: looking slightly down at the board, symmetric left to right. The sphere faces the
// centre of a cube face; the torus turns so point 0 (present on every size) sits at the front.
// The goban is seen square from in front and above, as a player sitting at it would see it.
export function defaultOrientation(kind = 'sphere') {
  if (kind === 'plane') return orientationFromEuler(.9, 0);
  return kind === 'sphere' ? orientationFromEuler(.35, 0) : orientationFromEuler(.65, -Math.PI / 2);
}

// The pitch and yaw of an orientation built as Rx(pitch) * Ry(yaw), read from the images of the
// board's vertical axis and of its x axis. Any roll in the input is dropped.
export function eulerFromOrientation(orientation) {
  const m = orientationMatrix(orientation);
  return {pitch: Math.atan2(m[7], m[4]), yaw: Math.atan2(m[2], m[0])};
}

// The goban turns like an object on a table: horizontal drags turn it about its own vertical axis
// (yaw), vertical drags tilt it towards the viewer (pitch). With no roll, the board's vertical axis
// always appears vertical on screen. Pitch stops at straight above and straight below.
export function rotateUpright(orientation, dx, dy, sensitivity = .009) {
  if (![dx, dy, sensitivity].every(Number.isFinite)) throw new Error('Invalid drag');
  const {pitch, yaw} = eulerFromOrientation(orientation);
  return orientationFromEuler(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch + dy * sensitivity)), yaw + dx * sensitivity);
}

export function rotateByDrag(orientation, dx, dy, sensitivity = .009) {
  if (![dx, dy, sensitivity].every(Number.isFinite)) throw new Error('Invalid drag');
  const distance = Math.hypot(dx, dy), q = normalizeOrientation(orientation);
  if (!distance) return q;
  const halfAngle = distance * sensitivity / 2, s = Math.sin(halfAngle) / distance;
  const delta = [dy*s, dx*s, 0, Math.cos(halfAngle)];
  // Premultiplication keeps the drag axes fixed to the SCREEN, not the board.
  // A single axis-angle delta also makes straight drags independent of event rate.
  return normalizeOrientation(multiply(delta, q));
}

export function orientationMatrix(orientation) {
  const [x, y, z, w] = normalizeOrientation(orientation);
  return [
    1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w),
    2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w),
    2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y),
  ];
}

export function transformPoint(p, matrix) {
  return {
    x: matrix[0]*p.x + matrix[1]*p.y + matrix[2]*p.z,
    y: matrix[3]*p.x + matrix[4]*p.y + matrix[5]*p.z,
    z: matrix[6]*p.x + matrix[7]*p.y + matrix[8]*p.z,
  };
}
