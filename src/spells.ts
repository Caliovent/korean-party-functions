/**
 * spells.ts
 * Ce fichier centralise la définition des sorts du jeu.
 * Il sert de "base de données" pour les propriétés des sorts.
 */

export type SpellId = "BLESSING_OF_HANGEUL" | "KIMCHIS_MALICE";

interface SpellDefinition {
  id: SpellId;
  manaCost: number;
}

export const SPELL_DEFINITIONS: Record<SpellId, SpellDefinition> = {
  BLESSING_OF_HANGEUL: {
    id: "BLESSING_OF_HANGEUL",
    manaCost: 15,
  },
  KIMCHIS_MALICE: {
    id: "KIMCHIS_MALICE",
    manaCost: 20,
  },
};
