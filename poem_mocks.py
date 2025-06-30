# Mock data for poemPuzzles collection

MOCK_POEM_PUZZLES = {
    "POEM_01": {
        "id": "POEM_01", # Ensure ID is part of the puzzle data itself for consistency
        "title": "Le Chant des Étoiles",
        "author": "Mysticus",
        "text": ["Les étoiles dans le ciel ", None, " leur douce mélodie, / Mon cœur écoute en ", None, ", cette pure harmonie. / Dans le ", None, " de la nuit, mes ", None, " prennent leur envol."],
        "solutions": {
            "blank_1": "chantent", # Corresponds to the first None
            "blank_2": "silence",  # Corresponds to the second None
            "blank_3": "calme",    # Corresponds to the third None
            "blank_4": "rêves"     # Corresponds to the fourth None
        },
        "choices": ["chantent", "silence", "calme", "rêves", "murmurent", "paix", "vent", "espoirs", "volent", "dansent", "crient", "regardent"],
        "reward": {"xp": 75, "mana": 50}, # XP and Mana for perfect completion
        "max_score": 100 # Max score for this specific poem
    },
    "POEM_02": {
        "id": "POEM_02",
        "title": "L'Aube Nouvelle",
        "author": "Clarté",
        "text": ["Le ", None, " se lève, chassant l'ombre et la peur, / Un ", None, " nouveau se dessine, plein de ", None, " et de fleurs."],
        "solutions": {
            "blank_1": "soleil",
            "blank_2": "chemin",
            "blank_3": "joie"
        },
        "choices": ["soleil", "chemin", "joie", "jour", "sentier", "peine", "lune", "tracé", "bonheur"],
        "reward": {"xp": 50, "mana": 35},
        "max_score": 75
    }
}

def get_poem_puzzle_by_id(poem_id):
    """
    Simulates fetching a specific poem puzzle by its ID from Firestore.
    Returns a copy of the poem data if found, otherwise None.
    """
    if poem_id in MOCK_POEM_PUZZLES:
        return MOCK_POEM_PUZZLES[poem_id].copy() # Return a copy to prevent accidental modification
    return None

def get_all_poem_puzzles():
    """
    Simulates fetching all poem puzzles.
    Returns a list of all poem puzzle data.
    """
    return list(MOCK_POEM_PUZZLES.values())

if __name__ == '__main__':
    poem1 = get_poem_puzzle_by_id("POEM_01")
    if poem1:
        print("Found POEM_01:", poem1)

    all_poems = get_all_poem_puzzles()
    print(f"\nTotal poems available: {len(all_poems)}")
    for poem in all_poems:
        print(f"- {poem['title']} by {poem['author']}")
