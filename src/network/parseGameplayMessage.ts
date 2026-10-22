// The lobby, loading gate, and simulation listen to the same MessageEvent.
// Share its decoded packet without retaining it after the event is released.
const packets = new WeakMap<MessageEvent, unknown>();

export function parseGameplayMessage(event: MessageEvent): any {
  if (packets.has(event)) return packets.get(event);
  const packet: unknown = JSON.parse(event.data);
  packets.set(event, packet);
  return packet;
}
