type SnapshotSocket = Pick<WebSocket, 'readyState' | 'send'>;
const previous = new WeakMap<SnapshotSocket, { key: string; at: number }>();

/** Moving players still publish every rendered frame. Idle snapshots only need
 * a heartbeat; the host clock alone must not force identical poses through the
 * relay and every peer's parser each frame. Action messages bypass this path.
 */
export function sendGameplaySnapshot(
  socket: SnapshotSocket,
  snapshot: Record<string, unknown>,
  now = performance.now(),
): boolean {
  if (socket.readyState !== 1) return false;
  const { gameTime, ...pose } = snapshot;
  const key = JSON.stringify(pose);
  const last = previous.get(socket);
  if (last?.key === key && now >= last.at && now - last.at < 250) return false;
  socket.send(gameTime === undefined ? key : JSON.stringify(snapshot));
  previous.set(socket, { key, at: now });
  return true;
}
