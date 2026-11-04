/** URL query parameters (spec §8). */
export interface UrlParams {
  /** Always false — S模式已取消（0.5.12）。 */
  modeS: boolean;
  qc: boolean;
  seed: number | null;
  cpu: string[] | null;
  sim: number | null;
  a: string[] | null;
  b: string[] | null;
  charge: [number, number] | null;
  /** Teacher spectate room code (?spectate=ROOM). */
  spectate: string | null;
  /** Host room code for broadcasting (?room=CODE). */
  room: string | null;
}

const ids = (v: string | null) =>
  v
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

export function parseParams(search = window.location.search): UrlParams {
  const q = new URLSearchParams(search);
  const seedRaw = q.get('seed');
  const seed = seedRaw !== null && seedRaw.trim() !== '' && Number.isFinite(Number(seedRaw)) ? Number(seedRaw) >>> 0 : null;
  const simRaw = q.get('sim');
  const sim = simRaw !== null && Number(simRaw) > 0 ? Math.floor(Number(simRaw)) : null;
  const chargeParts = ids(q.get('charge'))?.map(Number);
  const charge =
    chargeParts && chargeParts.length === 2 && chargeParts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
      ? ([chargeParts[0], chargeParts[1]] as [number, number])
      : null;
  const spectateRaw = (q.get('spectate') || '').trim().toUpperCase();
  const roomRaw = (q.get('room') || '').trim().toUpperCase();
  return {
    modeS: false,
    qc: q.get('qc') === '1',
    seed,
    cpu: ids(q.get('cpu')),
    sim,
    a: ids(q.get('a')),
    b: ids(q.get('b')),
    charge,
    spectate: spectateRaw || null,
    room: roomRaw || null,
  };
}
