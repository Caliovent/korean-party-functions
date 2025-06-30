# Cloud Functions for the Poème Perdu Minigame
from poem_mocks import get_poem_puzzle_by_id

def submit_poem_results(player_profile, poem_id, user_answers):
    """
    Processes the user's submission for a poem puzzle, calculates score, and updates player profile.

    Args:
        player_profile (dict): The player's current profile.
                               Expected: {"mana": int, "xp": int, "stats": {"poemsCompleted": int}}
        poem_id (str): The ID of the submitted poem.
        user_answers (dict): A dictionary of the user's answers, e.g., {"blank_1": "word", ...}

    Returns:
        dict: A dictionary containing:
            - "score" (int): The calculated score for the poem.
            - "updated_profile" (dict): The player's profile after updates.
            - "message" (str, optional): A message about the submission (e.g., if poem not found).
    """
    if not isinstance(player_profile, dict) or \
       not all(k in player_profile for k in ["mana", "xp", "stats"]) or \
       not isinstance(player_profile["stats"], dict) or \
       "poemsCompleted" not in player_profile["stats"]:
        # This basic validation can be expanded
        raise ValueError("Invalid player_profile structure.")

    poem_data = get_poem_puzzle_by_id(poem_id)

    if not poem_data:
        return {
            "score": 0,
            "updated_profile": player_profile,
            "message": f"Poem with ID '{poem_id}' not found."
        }

    correct_solutions = poem_data.get("solutions", {})
    calculated_score = 0
    all_correct = True

    # Check if all required blanks are answered and if they are correct
    if len(user_answers) != len(correct_solutions):
        all_correct = False
    else:
        for blank_key, correct_word in correct_solutions.items():
            if user_answers.get(blank_key) != correct_word:
                all_correct = False
                break

    if all_correct:
        calculated_score = poem_data.get("max_score", 0)
        # Apply rewards
        rewards = poem_data.get("reward", {})
        player_profile["mana"] += rewards.get("mana", 0)
        player_profile["xp"] += rewards.get("xp", 0)
        player_profile["stats"]["poemsCompleted"] = player_profile["stats"].get("poemsCompleted", 0) + 1
    else:
        # For now, score is 0 if not all answers are perfect, as per TDD test setup.
        # Future enhancements could include partial scoring.
        calculated_score = 0


    return {
        "score": calculated_score,
        "updated_profile": player_profile
    }

import random
from poem_mocks import get_all_poem_puzzles

def get_poem_puzzle_data():
    """
    Retrieves data for a random poem puzzle to be played.

    Returns:
        dict: A dictionary containing the data for a randomly selected poem puzzle,
              including 'poemId', 'title', 'author', 'text', and 'choices'.
              Returns None or raises an error if no poems are available.
    Raises:
        ValueError: If no poem puzzles are available in the mock data.
    """
    all_puzzles = get_all_poem_puzzles()
    if not all_puzzles:
        raise ValueError("No poem puzzles available to generate game data.")

    selected_poem = random.choice(all_puzzles)

    # Return only the data needed by the client for the game
    # Specifically, do not include 'solutions' or full 'reward' details if not needed upfront.
    # The 'id' is important for the client to send back with the submission.
    return {
        "poemId": selected_poem.get("id"),
        "title": selected_poem.get("title"),
        "author": selected_poem.get("author"),
        "text": selected_poem.get("text"),
        "choices": selected_poem.get("choices")
    }
