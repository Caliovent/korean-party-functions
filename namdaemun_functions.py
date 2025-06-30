# Cloud Functions for the Namdaemun Minigame

def submit_namdaemun_results(player_profile, score, items_sold):
    """
    Calculates score, grants rewards, and updates player stats after a Namdaemun game.

    Args:
        player_profile (dict): The player's current profile.
                               Expected structure: {"mana": int, "stats": {"itemsSoldAtMarket": int}, "achievements": list}
        score (int): The score obtained by the player in the minigame.
        items_sold (int): The number of items successfully sold by the player.

    Returns:
        dict: The updated player profile.
    """
    if not isinstance(player_profile, dict):
        raise TypeError("player_profile must be a dictionary.")
    if "mana" not in player_profile or not isinstance(player_profile["mana"], int):
        raise ValueError("player_profile must have 'mana' as an integer.")
    if "stats" not in player_profile or not isinstance(player_profile["stats"], dict):
        raise ValueError("player_profile must have 'stats' as a dictionary.")
    if "itemsSoldAtMarket" not in player_profile["stats"] or not isinstance(player_profile["stats"]["itemsSoldAtMarket"], int):
        raise ValueError("player_profile['stats'] must have 'itemsSoldAtMarket' as an integer.")
    if "achievements" not in player_profile or not isinstance(player_profile["achievements"], list):
        # Ensure achievements list exists, even if empty
        player_profile["achievements"] = []


    # 1. Calculate Mana earned
    mana_earned = score // 20
    player_profile["mana"] += mana_earned

    # 2. Update itemsSoldAtMarket
    # Check if it's the first sale by seeing if itemsSoldAtMarket was 0 before adding new sales
    is_first_sale_session = (player_profile["stats"]["itemsSoldAtMarket"] == 0 and items_sold > 0)

    player_profile["stats"]["itemsSoldAtMarket"] += items_sold

    # 3. Check for ACH_FIRST_SALE achievement
    if is_first_sale_session:
        if "ACH_FIRST_SALE" not in player_profile["achievements"]:
            player_profile["achievements"].append("ACH_FIRST_SALE")

    return player_profile

import random
from firestore_mocks import get_market_item_definitions

def get_namdaemun_game_data():
    """
    Generates a random game set for the Namdaemun minigame.

    Returns:
        dict: A dictionary containing:
            - "correct_item" (dict): The item the player needs to find.
            - "display_items" (list): A list of items (correct + incorrect) to display, shuffled.
                                      Contains 1 correct item and 3 or 4 incorrect items.
    Raises:
        ValueError: If there are not enough items in the definitions to create a game set.
    """
    all_items = get_market_item_definitions()

    if not all_items:
        raise ValueError("No market item definitions found. Cannot generate game data.")

    # Determine the number of incorrect items: 3 or 4
    num_incorrect_items = random.choice([3, 4])
    total_items_needed = 1 + num_incorrect_items

    if len(all_items) < total_items_needed:
        raise ValueError(
            f"Not enough unique items to generate a game set. Need {total_items_needed}, have {len(all_items)}."
        )

    # Shuffle all items to ensure randomness in selection
    random.shuffle(all_items)

    # Select the correct item
    correct_item = all_items[0]

    # Select incorrect items (ensuring they are different from the correct one)
    # The shuffle already helps, we just need to pick from the rest
    incorrect_items = all_items[1:total_items_needed]

    # Prepare the display items list and shuffle it
    display_items = [correct_item] + incorrect_items
    random.shuffle(display_items)

    return {
        "correct_item": correct_item,
        "display_items": display_items
    }
