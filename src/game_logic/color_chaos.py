import random

# Collection colorDefinitions
COLOR_DEFINITIONS = [
    {"colorId": "ppalgansaek", "hangeul": "빨간색", "hexCode": "#FF0000"},
    {"colorId": "paransaek", "hangeul": "파란색", "hexCode": "#0000FF"},
    {"colorId": "noransaek", "hangeul": "노란색", "hexCode": "#FFFF00"},
    {"colorId": "choroksaek", "hangeul": "초록색", "hexCode": "#008000"},
    {"colorId": "geomjeongsaek", "hangeul": "검정색", "hexCode": "#000000"},
    {"colorId": "hinsek", "hangeul": "흰색", "hexCode": "#FFFFFF"},
    {"colorId": "borasaek", "hangeul": "보라색", "hexCode": "#800080"}, # Purple
    {"colorId": "juhwangsaek", "hangeul": "주황색", "hexCode": "#FFA500"}  # Orange
]

def get_color_chaos_game_data(data):
    """
    Selects a color randomly from COLOR_DEFINITIONS.
    The 'data' input (e.g., {level: 1}) is not used in this version but is kept for API consistency.
    """
    if not COLOR_DEFINITIONS:
        # Handle empty color list case, though tests should catch this via setUp
        return {"error": "No colors defined"}

    selected_color = random.choice(COLOR_DEFINITIONS)

    return {
        "targetColor": selected_color["colorId"],
        "targetHangeul": selected_color["hangeul"]
    }

def submit_color_chaos_results(player_profile, results):
    """
    Calculates rewards, updates user document (player_profile), and manages achievements.

    Args:
        player_profile (dict): The player's current profile.
                               Expected structure: {"mana": int, "stats": {"colorsIdentified": int, "colorChaosHighestCombo": int}, "achievements": list}
        results (dict): The results from the game.
                        Expected structure: {"score": int, "highestCombo": int}

    Returns:
        dict: The updated player_profile.
    """
    # Ensure player_profile and its nested structures exist, initialize if not.
    # This is good practice for functions that modify nested dictionaries.
    if "mana" not in player_profile:
        player_profile["mana"] = 0
    if "stats" not in player_profile:
        player_profile["stats"] = {}
    if "colorsIdentified" not in player_profile["stats"]:
        player_profile["stats"]["colorsIdentified"] = 0
    if "colorChaosHighestCombo" not in player_profile["stats"]:
        player_profile["stats"]["colorChaosHighestCombo"] = 0
    if "achievements" not in player_profile:
        player_profile["achievements"] = []

    # Calculate Mana reward
    mana_per_score_point = 0.1 # As defined in the test
    mana_gain = results.get("score", 0) * mana_per_score_point
    player_profile["mana"] += mana_gain

    # Update stats
    player_profile["stats"]["colorsIdentified"] += results.get("highestCombo", 0)

    current_highest_combo = player_profile["stats"]["colorChaosHighestCombo"]
    new_highest_combo = results.get("highestCombo", 0)
    if new_highest_combo > current_highest_combo:
        player_profile["stats"]["colorChaosHighestCombo"] = new_highest_combo

    # Handle Achievements
    # Example: "Combo Master lvl 1" for combo >= 15
    if results.get("highestCombo", 0) >= 15:
        achievement_name = "Combo Master lvl 1"
        if achievement_name not in player_profile["achievements"]:
            player_profile["achievements"].append(achievement_name)

    return player_profile
