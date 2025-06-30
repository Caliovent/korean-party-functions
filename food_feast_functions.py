# Cloud Functions for the Festin des Mots (Food Feast) Minigame
import random
from food_mocks import get_all_food_items

MIN_OPTIONS = 3 # Minimum number of options for a question (1 correct + 2 incorrect)
MAX_OPTIONS = 4 # Maximum number of options for a question (1 correct + 3 incorrect)

def get_food_game_data(options_input):
    """
    Generates game data for the Food Feast minigame based on the requested mode.

    Args:
        options_input (dict): Contains options like mode. E.g., {"mode": "recognition"}

    Returns:
        dict: Game data structured for the client.
              For 'recognition' mode:
              {
                  "question": {"imageUrl": "...", "id": "..."},
                  "options": [{"hangeul": "...", "id": "..."}, ...],
                  "correct_answer_id": "..."
              }
              Returns an error structure or raises an error if data cannot be generated.
    Raises:
        ValueError: If not enough unique food items are available for the game mode.
    """
    mode = options_input.get("mode")

    if mode == "recognition":
        all_items = get_all_food_items()

        num_options_to_generate = random.randint(MIN_OPTIONS, MAX_OPTIONS)

        if len(all_items) < num_options_to_generate:
            raise ValueError(
                f"Not enough unique food items ({len(all_items)}) to generate a recognition game "
                f"with {num_options_to_generate} options."
            )

        # Shuffle items and pick a set for question and options
        random.shuffle(all_items)

        selected_items_for_game = all_items[:num_options_to_generate]
        correct_item = selected_items_for_game[0] # First one after shuffle is the correct one

        # Prepare question (image of the correct item)
        question_data = {
            "imageUrl": correct_item.get("imageUrl"),
            "id": correct_item.get("id") # Including ID might be useful for client-side logic/tracking
        }

        # Prepare options (Hangeul names)
        # Options should also be shuffled so the correct one isn't always first in the options list
        random.shuffle(selected_items_for_game) # Shuffle again for options order

        options_data = []
        for item in selected_items_for_game:
            options_data.append({
                "hangeul": item.get("hangeul"),
                "id": item.get("id") # Client can send back the ID of the chosen option
            })

        return {
            "question": question_data,
            "options": options_data,
            "correct_answer_id": correct_item.get("id")
            # Sending correct_answer_id for the client to know, though the TDD test
            # was looking for correct_answer_kr. The test will need adjustment.
            # Alternatively, the client can derive correct_answer_hangeul from correct_answer_id and options.
        }
    else:
        # Placeholder for other modes or error handling
        return {"error": f"Mode '{mode}' not implemented."}

# Constants for submit_food_game_results, can be tuned or moved to a config
MAX_SCORE_POINTS = 1000
TIME_PENALTY_PER_SECOND = 2
MANA_CONVERSION_FACTOR = 10 # 10 score points = 1 Mana
XP_CONVERSION_FACTOR = 5    # 5 score points = 1 XP (example)


def submit_food_game_results(player_profile, game_results_input):
    """
    Calculates score, updates player Mana, XP, and stats based on game results.

    Args:
        player_profile (dict): The player's current profile.
                               Expected: {"mana": int, "xp": int, "stats": {"foodItemsIdentified": int}}
        game_results_input (dict): Results from the game.
                                   Expected: {"correctAnswers": int, "totalQuestions": int, "timeTaken": int}

    Returns:
        dict: {"score": calculated_score, "updated_profile": player_profile}
    """
    if not player_profile or not isinstance(player_profile.get("stats"), dict):
        # Basic validation, can be expanded
        raise ValueError("Invalid player_profile structure.")
    if not game_results_input:
        raise ValueError("game_results_input is required.")

    correct_answers = game_results_input.get("correctAnswers", 0)
    total_questions = game_results_input.get("totalQuestions", 0)
    time_taken = game_results_input.get("timeTaken", 0)

    if total_questions == 0: # Avoid division by zero
        calculated_score = 0
    else:
        base_score = (correct_answers / total_questions) * MAX_SCORE_POINTS
        penalty = time_taken * TIME_PENALTY_PER_SECOND
        calculated_score = base_score - penalty

    calculated_score = max(0, int(calculated_score)) # Ensure score is not negative and is an integer

    # Update player profile
    player_profile["mana"] = player_profile.get("mana", 0) + (calculated_score // MANA_CONVERSION_FACTOR)
    player_profile["xp"] = player_profile.get("xp", 0) + (calculated_score // XP_CONVERSION_FACTOR)

    current_items_identified = player_profile["stats"].get("foodItemsIdentified", 0)
    player_profile["stats"]["foodItemsIdentified"] = current_items_identified + correct_answers

    # Placeholder for achievement checking logic
    # check_food_feast_achievements(player_profile, game_results_input, calculated_score)

    return {
        "score": calculated_score,
        "updated_profile": player_profile
    }
