/**
 * Every curated Counterparty collection the explorer indexes, keyed by its
 * tag. Shared by the address badges on a launch page and the Communities
 * section on /stats, so one emoji means one thing everywhere. Ordered by how
 * many of the site's minters created there, which is the order chips appear
 * in on an address.
 */

/** Chip colours by Tailwind family; full class strings so the scanner sees them. */
export const TONE = {
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
  orange: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  yellow: "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  lime: "border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-800 dark:bg-lime-950/40 dark:text-lime-300",
  green: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  purple: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  fuchsia: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  pink: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  slate: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  stone: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300",
} as const;

export interface Collection {
  tag: string;
  emoji: string;
  /** The collection's name, as the explorer lists it. */
  name: string;
  /** What a creator made there, for "Created a …". */
  noun: string;
  tone: keyof typeof TONE;
}

export const COLLECTIONS: Collection[] = [
  { tag: "kaleidoscope", emoji: "🔭", name: "Kaleidoscope", noun: "Kaleidoscope card", tone: "indigo" },
  { tag: "dank-directory", emoji: "🌿", name: "Dank Directory", noun: "Dank Rare", tone: "red" },
  { tag: "fake-commons", emoji: "🃏", name: "Fake Commons", noun: "Fake Common", tone: "emerald" },
  { tag: "fake-rare", emoji: "🎩", name: "Fake Rare", noun: "Fake Rare", tone: "pink" },
  { tag: "bitcorn", emoji: "🌽", name: "Bitcorns", noun: "Bitcorn", tone: "yellow" },
  { tag: "the-pepe-project", emoji: "🗽", name: "The Pepe Project", noun: "Pepe Project card", tone: "red" },
  { tag: "faux-bitcorn", emoji: "🍿", name: "Faux Bitcorn", noun: "Faux Bitcorn", tone: "amber" },
  { tag: "rare-coco", emoji: "🐊", name: "Rare Coco", noun: "Rare Coco", tone: "teal" },
  { tag: "rare-ordinal-directory", emoji: "🟠", name: "Rare Ordinal Directory", noun: "Rare Ordinal", tone: "orange" },
  { tag: "rare-pigeons", emoji: "🐦", name: "Rare Pigeons", noun: "Rare Pigeon", tone: "slate" },
  { tag: "lfg-collection", emoji: "🚀", name: "LFG Collection", noun: "LFG Collection card", tone: "rose" },
  { tag: "the-wojak-way", emoji: "😐", name: "The Wojak Way", noun: "Wojak Way card", tone: "pink" },
  { tag: "rarepenpen", emoji: "🐧", name: "RarePenPen", noun: "RarePenPen", tone: "sky" },
  { tag: "bassmint", emoji: "🐟", name: "Bassmint", noun: "Bassmint card", tone: "orange" },
  { tag: "common-coco", emoji: "🥥", name: "Common Coco", noun: "Common Coco", tone: "cyan" },
  { tag: "rare-gogo", emoji: "🐐", name: "Rare GoGo", noun: "Rare GoGo", tone: "rose" },
  { tag: "the-greypepe-project", emoji: "🩶", name: "The GreyPepe Project", noun: "GreyPepe", tone: "zinc" },
  { tag: "barnyard-club", emoji: "🐷", name: "Barnyard Club", noun: "Barnyard Club card", tone: "red" },
  { tag: "mafia-wars", emoji: "🔫", name: "Mafia Wars", noun: "Mafia Wars card", tone: "stone" },
  { tag: "rare-pepe", emoji: "🐸", name: "Rare Pepe", noun: "Rare Pepe", tone: "green" },
  { tag: "scannable-nfts", emoji: "🔳", name: "Scannable NFTs", noun: "Scannable NFT", tone: "fuchsia" },
  { tag: "unatrare", emoji: "🦄", name: "UNATRARE", noun: "UNATRARE card", tone: "violet" },
  { tag: "fake-ape-club", emoji: "🦧", name: "Fake Ape Club", noun: "Fake Ape", tone: "blue" },
  { tag: "retroxcp", emoji: "👾", name: "RetroXCP", noun: "RetroXCP card", tone: "blue" },
  { tag: "17art", emoji: "🎨", name: "17ART", noun: "17ART card", tone: "red" },
  { tag: "assetic", emoji: "🍑", name: "Assetic", noun: "Assetic card", tone: "orange" },
  { tag: "drooling-ape-bus-club", emoji: "🚌", name: "Drooling Ape Bus Club", noun: "Drooling Ape", tone: "lime" },
  { tag: "faux-sogs", emoji: "🪄", name: "FAUX SOGS", noun: "Faux SOG", tone: "cyan" },
  { tag: "phockheads", emoji: "🗿", name: "PHOCKHEADS", noun: "Phockhead", tone: "purple" },
  { tag: "rare-shadilay", emoji: "🌀", name: "Rare Shadilay", noun: "Rare Shadilay", tone: "blue" },
  { tag: "raresocks", emoji: "🧦", name: "RareSocks", noun: "RareSock", tone: "violet" },
  { tag: "comedianas", emoji: "🎭", name: "Comedianas", noun: "Comedianas card", tone: "stone" },
  { tag: "cubism-nakamoto", emoji: "🧊", name: "Cubism Nakamoto", noun: "Cubism Nakamoto card", tone: "orange" },
  { tag: "fake-munchkin", emoji: "🎲", name: "Fake Munchkin", noun: "Fake Munchkin", tone: "amber" },
  { tag: "memorychain", emoji: "🎌", name: "MemoryChain", noun: "MemoryChain card", tone: "lime" },
  { tag: "notable-pepe", emoji: "📝", name: "Notable Pepe", noun: "Notable Pepe", tone: "rose" },
  { tag: "oasis-mining", emoji: "⛏️", name: "Oasis Mining", noun: "Oasis Mining card", tone: "amber" },
  { tag: "pepe-vote", emoji: "🗳️", name: "Pepe Vote", noun: "Pepe Vote card", tone: "teal" },
  { tag: "phunchkins", emoji: "😾", name: "Phunchkins", noun: "Phunchkin", tone: "orange" },
  { tag: "rare-bobo", emoji: "🐻", name: "Rare Bobo", noun: "Rare Bobo", tone: "orange" },
  { tag: "age-of-chains", emoji: "⚔️", name: "Age of Chains", noun: "Age of Chains card", tone: "slate" },
  { tag: "age-of-rust", emoji: "🤖", name: "Age of Rust", noun: "Age of Rust card", tone: "orange" },
  { tag: "artolin", emoji: "🖌️", name: "Artolin", noun: "Artolin piece", tone: "fuchsia" },
  { tag: "atomo", emoji: "⚛️", name: "AtOMo", noun: "AtOMo collectible", tone: "sky" },
  { tag: "based-intellectuals", emoji: "🧠", name: "Based Intellectuals", noun: "Based Intellectual", tone: "blue" },
  { tag: "bitcoin-war-bonds", emoji: "🎖️", name: "Bitcoin War Bonds", noun: "Bitcoin War Bond", tone: "stone" },
  { tag: "bitgirls", emoji: "👧", name: "Bitgirls", noun: "Bitgirl", tone: "pink" },
  { tag: "community-rewards", emoji: "🎁", name: "Community Rewards", noun: "Community Reward", tone: "green" },
  { tag: "corruptionaires", emoji: "💰", name: "Corruptionaires", noun: "Corruptionaire", tone: "emerald" },
  { tag: "counterparty-bitbowl", emoji: "🏈", name: "Counterparty BitBowl", noun: "BitBowl card", tone: "orange" },
  { tag: "crystalscraft", emoji: "💎", name: "CrystalsCraft", noun: "CrystalsCraft card", tone: "cyan" },
  { tag: "diecast", emoji: "🚗", name: "Diecast", noun: "Diecast card", tone: "slate" },
  { tag: "footballcoin", emoji: "⚽", name: "FootballCoin", noun: "FootballCoin card", tone: "green" },
  { tag: "force-of-will", emoji: "🎴", name: "Force Of Will", noun: "Force of Will card", tone: "violet" },
  { tag: "gameicon", emoji: "🎮", name: "Gameicon", noun: "Gameicon", tone: "indigo" },
  { tag: "hodlpet", emoji: "🐾", name: "HODLPET", noun: "HODLPET", tone: "amber" },
  { tag: "memeable", emoji: "😂", name: "Memeable", noun: "Memeable card", tone: "yellow" },
  { tag: "modern-relics", emoji: "🏺", name: "Modern Relics", noun: "Modern Relic", tone: "amber" },
  { tag: "new-liberty-standard", emoji: "📜", name: "New Liberty Standard", noun: "New Liberty Standard card", tone: "teal" },
  { tag: "npcs", emoji: "🧍", name: "NPCs", noun: "NPC", tone: "zinc" },
  { tag: "penisium", emoji: "🍆", name: "Penisium", noun: "Penisium card", tone: "violet" },
  { tag: "pepe-flags", emoji: "🚩", name: "Pepe Flags", noun: "Pepe Flag", tone: "red" },
  { tag: "potentially-notable-pepe", emoji: "📋", name: "Potentially Notable Pepe", noun: "Potentially Notable Pepe", tone: "rose" },
  { tag: "punk-frens", emoji: "🤘", name: "Punk Frens", noun: "Punk Fren", tone: "fuchsia" },
  { tag: "rarepepecoins", emoji: "🪙", name: "RarePepeCoins", noun: "RarePepeCoin", tone: "yellow" },
  { tag: "rude-relics", emoji: "🪦", name: "Rude Relics", noun: "Rude Relic", tone: "zinc" },
  { tag: "sarutobi-island", emoji: "🏝️", name: "Sarutobi Island", noun: "Sarutobi Island card", tone: "emerald" },
  { tag: "skara", emoji: "🗡️", name: "SKARA", noun: "SKARA card", tone: "red" },
  { tag: "spamgelo", emoji: "🥫", name: "Spamgelo", noun: "Spamgelo piece", tone: "red" },
  { tag: "spells-of-genesis", emoji: "🔮", name: "Spells of Genesis", noun: "Spells of Genesis card", tone: "purple" },
  { tag: "stampunks", emoji: "🧑‍🎤", name: "Stampunks", noun: "Stampunk", tone: "indigo" },
  { tag: "the-counterpart", emoji: "🖼️", name: "The CounterpART", noun: "CounterpART piece", tone: "pink" },
  { tag: "viva-las-stamps", emoji: "🎰", name: "Viva Las Stamps", noun: "Viva Las Stamps card", tone: "rose" },
  { tag: "xcpinata", emoji: "🪅", name: "XCPinata", noun: "XCPinata card", tone: "lime" },
];

const BY_TAG = new Map(COLLECTIONS.map((c) => [c.tag, c]));

export function collectionByTag(tag: string): Collection | undefined {
  return BY_TAG.get(tag);
}
