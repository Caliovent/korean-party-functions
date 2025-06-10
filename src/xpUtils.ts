/**
 * xpUtils.ts
 * This file contains utility functions related to player experience (XP) and leveling.
 */

/**
 * Calculates the total XP required to reach a given level.
 * Formula: XP_requis = 100 * (level ^ 1.5)
 *
 * @param level The level for which to calculate the XP requirement.
 * @returns The total XP needed to reach that level.
 */
export const getXpForLevel = (level: number): number => {
  if (level <= 0) {
    return 0; // Or throw an error, depending on desired behavior for invalid levels
  }
  // For level 1, XP required is 0, but the formula gives 100.
  // Let's adjust so level 1 needs 0, level 2 needs 100*(2^1.5) - 100*(1^1.5) effectively.
  // Or, more simply, the XP displayed is "XP towards next level".
  // The formula usually means "total XP accumulated to *reach* this level".
  // Let's assume the mission implies the total XP to reach level L from level 1.
  // So, XP for level 1 is 100 * (1^1.5) = 100. XP for level 2 is 100 * (2^1.5) approx 282.
  // The XP to get from level 1 to level 2 would be 282 - 100 = 182.

  // The issue states: "XP_requis = 100 * (niveau ^ 1.5))"
  // This is typically the XP needed to *complete* that level and advance to the next.
  // So, to get from level 1 to level 2, you need 100 * (1 ^ 1.5) = 100 XP.
  // To get from level 2 to level 3, you need 100 * (2 ^ 1.5) approx 283 XP.

  return Math.floor(100 * Math.pow(level, 1.5));
};
