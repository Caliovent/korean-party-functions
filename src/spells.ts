/**
 * spells.ts
 * Ce fichier centralise la définition des sorts du jeu.
 * Il sert de "base de données" pour les propriétés des sorts.
 */

export type SpellId =
  | "BLESSING_OF_HANGEUL"
  | "KIMCHIS_MALICE"
  | "RUNE_TRAP"
  | "MANA_SHIELD"
  | "ASTRAL_SWAP"
  | "MEMORY_FOG"
  | "KARMIC_SWAP"
  | "DOKKAEBI_MISCHIEF";

interface SpellDefinition {
  id: SpellId;
  name: string;
  manaCost: number;
  type: "TERRAIN" | "DEFENSIVE" | "STRATEGIC" | "OFFENSIVE" | "CHAOS" | "TRAP";
  description: string;
  requiresTarget?: 'player' | 'tile'; // Added for spells needing specific targets
  effectDetails?: Record<string, any>; // Added for specific effect parameters
}

export const SPELL_DEFINITIONS: Record<SpellId, SpellDefinition> = {
  // Existing Spells - Updated (ensure consistency if needed, e.g. RUNE_TRAP might be TRAP type)
  BLESSING_OF_HANGEUL: {
    id: "BLESSING_OF_HANGEUL",
    name: "Blessing of Hangeul",
    manaCost: 15,
    type: "OFFENSIVE",
    description: "Grants a small amount of mana to the target.",
    requiresTarget: 'player', // Assuming it targets another player or self
  },
  KIMCHIS_MALICE: {
    id: "KIMCHIS_MALICE",
    name: "Kimchi's Malice",
    manaCost: 20,
    type: "OFFENSIVE",
    description: "Reduces the target's mana.",
    requiresTarget: 'player', // Assuming it targets another player
  },
  RUNE_TRAP: {
    id: "RUNE_TRAP",
    name: "Piège Runique",
    manaCost: 35,
    type: "TRAP", // Changed from TERRAIN to TRAP for consistency with new spell type
    description: "Pose un piège sur une case. Le prochain joueur à s'y arrêter perd 50 Mana.",
    requiresTarget: 'tile',
    effectDetails: { manaLoss: 50 }, // Added for clarity on effect
  },
  MANA_SHIELD: {
    id: "MANA_SHIELD",
    name: "Bouclier de Mana",
    manaCost: 50, // Mission doc for Memory Fog is 25, this is different. Keeping existing.
    type: "DEFENSIVE",
    description: "Annule le prochain sort négatif qui vous cible. Dure 1 tour.",
    effectDetails: { duration: 1 }, // Assuming "1 tour" means 1 application or 1 round for the caster
  },
  ASTRAL_SWAP: { // This is similar to Karmic Swap
    id: "ASTRAL_SWAP",
    name: "Échange Astral",
    manaCost: 90, // Mission doc for Karmic Swap is 40. Keeping existing.
    type: "STRATEGIC", // Could be CHAOS if that's the desired categorization
    description: "Échangez votre position avec celle d'un autre joueur.",
    requiresTarget: 'player',
  },

  // New Spells as per Mission "Art de l'Enchantement"
  MEMORY_FOG: {
    id: "MEMORY_FOG",
    name: "Brouillard Mnémonique", // Using direct name as per existing structure
    manaCost: 25,
    type: "DEFENSIVE",
    description: "Vous protège du prochain sort négatif lancé contre vous.", // Using direct description
    effectDetails: { duration: 1 }, // Protects against 1 spell
  },
  KARMIC_SWAP: {
    id: "KARMIC_SWAP",
    name: "Échange Karmique",
    manaCost: 40,
    type: "CHAOS",
    description: "Échangez votre position sur le plateau avec un autre joueur.",
    requiresTarget: 'player',
  },
  DOKKAEBI_MISCHIEF: {
    id: "DOKKAEBI_MISCHIEF",
    name: "Malice du Dokkaebi",
    manaCost: 30,
    type: "TRAP",
    description: "Placez un piège invisible sur une case. Le prochain joueur à s'y arrêter perd 15 Mana.",
    requiresTarget: 'tile',
    effectDetails: { manaLoss: 15 },
  },
};
