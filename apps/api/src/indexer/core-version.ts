/**
 * Which Counterparty Core release must have parsed a block before this index
 * trusts it.
 *
 * A protocol change activates at a height, and a node still running the
 * release before it keeps parsing past that height under the old rules: its
 * ledger is simply wrong from there on (Core 11.5's own notes call such a node
 * one that "stayed on v11.4.0 past them"). Indexing from it would write that
 * wrong ledger into D1, so the indexer pauses instead until the node is
 * upgraded, and the ledger-hash check rolls back anything it already took.
 *
 * One line per activation. Heights are mainnet's, from Core's
 * protocol_changes.json.
 */
export const CORE_ACTIVATIONS: readonly { change: string; block: number; version: string }[] = [
  // Inscription reveals count only when signed by the commit's funder.
  { change: "require_reveal_source_signature", block: 969_320, version: "11.5.0" },
  // MPMA's address table carries P2TR and P2WSH recipients.
  { change: "mpma_taproot_support", block: 971_700, version: "11.4.0" },
];

type Version = [number, number, number];

/** `11.5.0`, `v11.5.0` or `11.5.0rc1` → [11, 5, 0]; null when it is not a release number. */
export function parseCoreVersion(raw: string | null | undefined): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw?.trim() ?? "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function atLeast(have: Version, need: Version): boolean {
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i]! > need[i]!;
  }
  return true;
}

export type CoreVersionGate =
  | { ok: true }
  | { ok: false; change: string; block: number; required: string; version: string | null };

/**
 * Whether a node reporting `version` may be indexed at `height`. An
 * unreadable version fails closed once any activation is behind the tip.
 */
export function coreVersionGate(version: string | null, height: number): CoreVersionGate {
  const have = parseCoreVersion(version);
  for (const activation of CORE_ACTIVATIONS) {
    if (height < activation.block) continue;
    const need = parseCoreVersion(activation.version)!;
    if (!have || !atLeast(have, need)) {
      return { ok: false, change: activation.change, block: activation.block, required: activation.version, version };
    }
  }
  return { ok: true };
}
