# Tests for the "Poème Perdu" minigame backend logic.
import unittest
from poem_functions import submit_poem_results # Import the actual function
from poem_mocks import get_poem_puzzle_by_id, MOCK_POEM_PUZZLES # To get poem data for tests

class TestPoemMinigameSubmitResults(unittest.TestCase): # Renamed for clarity

    def test_perfect_poem_submission(self):
        """
        Tests attribution of max score and rewards for a perfectly reconstituted poem.
        """
        # Arrange: Initialize player profile and poem data
        player_profile = {
            "mana": 100,
            "xp": 50,
            "stats": {
                "poemsCompleted": 0
            }
        }
        initial_mana = player_profile["mana"]
        initial_xp = player_profile["xp"]
        initial_poems_completed = player_profile["stats"]["poemsCompleted"]

        poem_id_to_test = 'POEM_01'
        # Fetch poem data directly from the source used by the function
        poem_data_for_test = get_poem_puzzle_by_id(poem_id_to_test)
        self.assertIsNotNone(poem_data_for_test, f"Test setup failed: Poem {poem_id_to_test} not found in mocks.")

        # Prepare a submission with all correct answers based on the new structure
        perfect_answers = poem_data_for_test['solutions']

        # Act: Call the implemented submit_poem_results function
        result = submit_poem_results(player_profile.copy(), poem_id_to_test, perfect_answers)

        returned_score = result["score"]
        updated_player_profile = result["updated_profile"]

        # Assert
        # 1. Verify returned score is the maximum possible
        expected_max_score = poem_data_for_test['max_score']
        self.assertEqual(returned_score, expected_max_score,
                         f"Score should be {expected_max_score}, but was {returned_score}")

        # 2. Verify Mana increment
        expected_mana = initial_mana + poem_data_for_test['reward']['mana']
        self.assertEqual(updated_player_profile["mana"], expected_mana,
                         f"Mana should be {expected_mana}, but was {updated_player_profile['mana']}")

        # 3. Verify XP increment
        expected_xp = initial_xp + poem_data_for_test['reward']['xp']
        self.assertEqual(updated_player_profile["xp"], expected_xp,
                         f"XP should be {expected_xp}, but was {updated_player_profile['xp']}")

        # 4. Verify poemsCompleted statistic increment
        expected_poems_completed = initial_poems_completed + 1
        self.assertEqual(updated_player_profile["stats"]["poemsCompleted"], expected_poems_completed,
                         f"poemsCompleted should be {expected_poems_completed}, but was {updated_player_profile['stats']['poemsCompleted']}")

    def test_incorrect_poem_submission(self):
        """Tests that score is 0 and no rewards/stats change for an incorrect submission."""
        player_profile = {"mana": 100, "xp": 50, "stats": {"poemsCompleted": 0}}
        initial_profile_state = player_profile.copy() # For comparison

        poem_id_to_test = 'POEM_01'
        poem_data_for_test = get_poem_puzzle_by_id(poem_id_to_test)

        incorrect_answers = {
            "blank_1": "wrong_word_A",
            "blank_2": poem_data_for_test['solutions']['blank_2'], # one correct
            "blank_3": "wrong_word_C",
            "blank_4": "wrong_word_D"
        }
        if len(poem_data_for_test['solutions']) == 3: # Adjust for POEM_02 if used
            incorrect_answers.pop("blank_4", None)


        result = submit_poem_results(player_profile.copy(), poem_id_to_test, incorrect_answers)

        self.assertEqual(result["score"], 0, "Score should be 0 for incorrect answers.")
        self.assertEqual(result["updated_profile"]["mana"], initial_profile_state["mana"], "Mana should not change.")
        self.assertEqual(result["updated_profile"]["xp"], initial_profile_state["xp"], "XP should not change.")
        self.assertEqual(result["updated_profile"]["stats"]["poemsCompleted"],
                         initial_profile_state["stats"]["poemsCompleted"],
                         "poemsCompleted should not change.")

    def test_partial_correct_poem_submission(self):
        """Tests that score is 0 if not all answers are correct (current simple scoring)."""
        player_profile = {"mana": 100, "xp": 50, "stats": {"poemsCompleted": 0}}
        initial_profile_state = player_profile.copy()

        poem_id_to_test = 'POEM_01'
        poem_data_for_test = get_poem_puzzle_by_id(poem_id_to_test)

        partial_answers = poem_data_for_test['solutions'].copy()
        # Make one answer incorrect
        first_blank_key = list(partial_answers.keys())[0]
        partial_answers[first_blank_key] = "definitely_wrong"

        if not partial_answers: # handle case where poem has no blanks
             self.skipTest("Poem has no blanks to test partial submission.")


        result = submit_poem_results(player_profile.copy(), poem_id_to_test, partial_answers)

        self.assertEqual(result["score"], 0, "Score should be 0 for partially correct answers under current logic.")
        self.assertEqual(result["updated_profile"]["mana"], initial_profile_state["mana"])
        self.assertEqual(result["updated_profile"]["xp"], initial_profile_state["xp"])
        self.assertEqual(result["updated_profile"]["stats"]["poemsCompleted"],
                         initial_profile_state["stats"]["poemsCompleted"])

    def test_submit_non_existent_poem(self):
        """Tests submission for a poemId that doesn't exist."""
        player_profile = {"mana": 100, "xp": 50, "stats": {"poemsCompleted": 0}}
        initial_profile_state = player_profile.copy()

        result = submit_poem_results(player_profile.copy(), "POEM_NON_EXISTENT", {"blank_1": "foo"})

        self.assertEqual(result["score"], 0)
        self.assertIn("message", result)
        self.assertIn("not found", result["message"].lower())
        self.assertEqual(result["updated_profile"], initial_profile_state, "Profile should not change for non-existent poem.")


if __name__ == '__main__':
    unittest.main()

# Need to import get_poem_puzzle_data from poem_functions
from poem_functions import get_poem_puzzle_data

class TestPoemMinigameGetPuzzleData(unittest.TestCase):

    def setUp(self):
        # Ensure MOCK_POEM_PUZZLES has data for these tests
        # This is just a safeguard, assuming MOCK_POEM_PUZZLES is populated in poem_mocks.py
        if not MOCK_POEM_PUZZLES:
            # Temporarily populate if empty for test running, though it shouldn't be.
            # This is more of a conceptual fix; in practice, ensure poem_mocks.py is correct.
            MOCK_POEM_PUZZLES['TEMP_POEM_FOR_TEST'] = {
                "id": "TEMP_POEM_FOR_TEST", "title": "Test", "author": "Test",
                "text": ["Test ", None], "solutions": {"blank_1": "word"},
                "choices": ["word", "another"], "reward": {"xp": 10, "mana": 5}, "max_score": 10
            }
            self.temp_data_added = True
        else:
            self.temp_data_added = False

    def tearDown(self):
        if hasattr(self, 'temp_data_added') and self.temp_data_added:
            MOCK_POEM_PUZZLES.pop('TEMP_POEM_FOR_TEST', None)


    def test_get_poem_data_structure_and_content(self):
        """Tests that get_poem_puzzle_data returns the correct structure and data fields."""
        if not MOCK_POEM_PUZZLES:
            self.skipTest("No mock poem data available to test.")

        puzzle_data = get_poem_puzzle_data()
        self.assertIsInstance(puzzle_data, dict)

        expected_keys = ["poemId", "title", "author", "text", "choices"]
        for key in expected_keys:
            self.assertIn(key, puzzle_data, f"Key '{key}' missing from puzzle data.")

        self.assertIsInstance(puzzle_data["text"], list)
        self.assertIsInstance(puzzle_data["choices"], list)

        # Verify it's one of the known poem IDs
        all_known_ids = [p_id for p_id in MOCK_POEM_PUZZLES.keys()]
        self.assertIn(puzzle_data["poemId"], all_known_ids)

        # Verify solutions are not included
        self.assertNotIn("solutions", puzzle_data)
        self.assertNotIn("reward", puzzle_data)
        self.assertNotIn("max_score", puzzle_data)


    def test_get_poem_data_randomness(self):
        """Tests if the function can return different poems (rudimentary check for randomness)."""
        if len(MOCK_POEM_PUZZLES) < 2:
            self.skipTest("Not enough unique poems in mock data to test randomness effectively.")

        # Get a few results and check if they are different
        # This isn't a perfect randomness test but can catch basic issues.
        results_ids = {get_poem_puzzle_data()["poemId"] for _ in range(10)} # Use a reasonable range

        # If there are multiple poems, we expect to see more than one unique ID over several calls.
        # This threshold might need adjustment based on the number of poems and desired confidence.
        self.assertTrue(len(results_ids) > 1,
                        "Expected to see more than one unique poem ID over multiple calls, indicating randomness.")


    def test_get_poem_data_no_poems_available(self):
        """Tests behavior when no poems are defined in the mock data."""
        original_poems = MOCK_POEM_PUZZLES.copy()
        MOCK_POEM_PUZZLES.clear() # Temporarily empty the mock data

        with self.assertRaisesRegex(ValueError, "No poem puzzles available"):
            get_poem_puzzle_data()

        MOCK_POEM_PUZZLES.update(original_poems) # Restore mock data
