/**
 * spells.ts
 * Ce fichier centralise la définition des sorts du jeu.
 * Il sert de "base de données" pour les propriétés des sorts.
 */

export type SpellId = "BLESSING_OF_HANGEUL" | "KIMCHIS_MALICE" | "RUNE_TRAP" | "MANA_SHIELD" | "ASTRAL_SWAP";

interface SpellDefinition {
  id: SpellId;
  name: string; // Added
  manaCost: number;
  type: 'TERRAIN' | 'DEFENSIVE' | 'STRATEGIC' | 'OFFENSIVE'; // Added
  description: string; // Added
}

export const SPELL_DEFINITIONS: Record<SpellId, SpellDefinition> = {
  // Existing Spells - Updated
  BLESSING_OF_HANGEUL: {
    id: "BLESSING_OF_HANGEUL",
    name: "Blessing of Hangeul", // Added
    manaCost: 15,
    type: "OFFENSIVE", // Assuming, adjust if different logic applies
    description: "Grants a small amount of mana to the target.", // Added
  },
  KIMCHIS_MALICE: {
    id: "KIMCHIS_MALICE",
    name: "Kimchi's Malice", // Added
    manaCost: 20,
    type: "OFFENSIVE", // Assuming
    description: "Reduces the target's mana.", // Added
  },
  // New Spells
  RUNE_TRAP: {
    id: 'RUNE_TRAP',
    name: 'Piège Runique',
    manaCost: 35,
    type: 'TERRAIN',
    description: 'Pose un piège sur une case. Le prochain joueur à s\'y arrêter perd 50 Mana.',
  },
  MANA_SHIELD: {
    id: 'MANA_SHIELD',
    name: 'Bouclier de Mana',
    manaCost: 50,
    type: 'DEFENSIVE',
    description: 'Annule le prochain sort négatif qui vous cible. Dure 1 tour.',
  },
  ASTRAL_SWAP: {
    id: 'ASTRAL_SWAP',
    name: 'Échange Astral',
    manaCost: 90,
    type: 'STRATEGIC',
    description: 'Échangez votre position avec celle d\'un autre joueur.',
  },
};
