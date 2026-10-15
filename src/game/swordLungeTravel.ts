// The live travel cap is strict (>16), checked after contact. Accumulated
// coordinate roundoff can straddle exactly 16 across hosts; treat sub-nanounit
// overshoot as the boundary without rounding positions or changing hit tests.
export function exceedsSwordLungeTravel(distance: number): boolean {
  return distance > 16 + 1e-9;
}
