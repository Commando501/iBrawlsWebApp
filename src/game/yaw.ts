export function getYawForHeading(headingX: number, headingZ: number): number {
  if (headingX * headingX + headingZ * headingZ < 1e-12) {
    return 0;
  }
  return Math.atan2(-headingX, -headingZ);
}

export function getForwardHeadingForYaw(yaw: number): { x: number; z: number } {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}
