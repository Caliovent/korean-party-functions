# Tests for the "Festin des Mots" (Food Feast) minigame backend logic.
import unittest
from food_mocks import get_all_food_items, get_food_item_by_id # To simulate access to food definitions
from food_feast_functions import get_food_game_data # Import the actual function

# Import the actual submit_food_game_results function
from food_feast_functions import submit_food_game_results, XP_CONVERSION_FACTOR # also import XP_CONVERSION_FACTOR for test

# --- Test Classes ---

class TestGetFoodGameData(unittest.TestCase):

    def test_get_food_game_data_recognition_mode(self):
        """
        Tests if getFoodGameData returns a valid game set for 'recognition' mode.
        It should include a question (image) and multiple Hangeul options, one being correct.
        """
        # Arrange: Ensure mock food items are available (implicitly via food_mocks.py)
        if not get_all_food_items(): # Check if mock data is loaded
            self.skipTest("Mock food items are not available. Skipping test.")

        # Act: Call the implemented function
        game_data = get_food_game_data({"mode": "recognition"})

        # Assert
        self.assertIsInstance(game_data, dict, "Game data should be a dictionary.")

        # 1. Verify question structure
        self.assertIn("question", game_data, "Game data must contain a 'question' object.")
        question_obj = game_data.get("question", {})
        self.assertIsInstance(question_obj, dict, "'question' should be an object.")
        self.assertIn("imageUrl", question_obj, "Question object should have an 'imageUrl'.")
        self.assertIsInstance(question_obj["imageUrl"], str, "'imageUrl' should be a string.")
        self.assertIn("id", question_obj, "Question object should have an 'id'.") # New check
        self.assertIsInstance(question_obj["id"], str, "'question.id' should be a string.")


        # 2. Verify options structure
        self.assertIn("options", game_data, "Game data must contain 'options'.")
        options_list = game_data.get("options", [])
        self.assertIsInstance(options_list, list, "'options' should be a list.")
        self.assertGreaterEqual(len(options_list), 3, "There should be at least 3 options (MIN_OPTIONS).")
        self.assertLessEqual(len(options_list), 4, "There should be at most 4 options (MAX_OPTIONS).") # Adjusted for MIN/MAX_OPTIONS

        self.assertTrue(all(isinstance(opt, dict) for opt in options_list), "Each option should be an object.")
        self.assertTrue(all("hangeul" in opt for opt in options_list), "Each option object should have 'hangeul'.") # Was name_kr
        self.assertTrue(all("id" in opt for opt in options_list), "Each option object should have 'id'.") # New check

        # 3. Verify correct answer indication
        self.assertIn("correct_answer_id", game_data, "Game data should specify the 'correct_answer_id'.") # Was correct_answer_kr
        correct_answer_id = game_data["correct_answer_id"]
        self.assertIsInstance(correct_answer_id, str, "'correct_answer_id' should be a string.")

        # Check that the question ID matches the correct_answer_id
        self.assertEqual(question_obj["id"], correct_answer_id, "The question's item ID should match the correct_answer_id.")

        # Check that an option with the correct_answer_id exists in the options list
        correct_option_in_list = next((opt for opt in options_list if opt["id"] == correct_answer_id), None)
        self.assertIsNotNone(correct_option_in_list, "The correct_answer_id must correspond to an item in the options list.")

        # Verify the hangeul of this correct option matches the hangeul of the item from mock data
        correct_item_from_mock = get_food_item_by_id(correct_answer_id)
        self.assertIsNotNone(correct_item_from_mock, f"Item with id {correct_answer_id} not found in mock data.")
        self.assertEqual(correct_option_in_list["hangeul"], correct_item_from_mock["hangeul"],
                         "The Hangeul of the correct option does not match the mock data.")

    def test_get_food_game_data_not_enough_items(self):
        """Tests behavior when there are not enough items for recognition mode."""
        all_food_items_backup = list(get_all_food_items()) # Backup

        # Temporarily modify food_mocks.MOCK_FOOD_ITEMS to have fewer items than MIN_OPTIONS
        # This requires direct access or a helper in food_mocks, which is not ideal.
        # For this test, let's assume food_mocks.MOCK_FOOD_ITEMS can be temporarily manipulated.
        # This is a bit of a hack for testing this specific condition.

        original_mock_items = list(get_all_food_items()) # Get a copy

        # To reliably test this, we need to modify the source of the items.
        # We'll assume we can temporarily clear and set food_mocks.MOCK_FOOD_ITEMS
        # This is a direct manipulation for testing purposes.
        import food_mocks
        original_food_mocks_list = food_mocks.MOCK_FOOD_ITEMS[:]

        food_mocks.MOCK_FOOD_ITEMS.clear()
        food_mocks.MOCK_FOOD_ITEMS.append({"id": "food_001", "hangeul": "김치", "imageUrl": "img.png"})
        food_mocks.MOCK_FOOD_ITEMS.append({"id": "food_002", "hangeul": "밥", "imageUrl": "img2.png"})

        with self.assertRaisesRegex(ValueError, "Not enough unique food items"):
            get_food_game_data({"mode": "recognition"})

        # Restore
        food_mocks.MOCK_FOOD_ITEMS.clear()
        food_mocks.MOCK_FOOD_ITEMS.extend(original_food_mocks_list)


class TestSubmitFoodGameResults(unittest.TestCase):

    def test_submit_food_game_results_calculation(self):
        """
        Tests if submitFoodGameResults calculates score, updates Mana, and stats correctly.
        """
        # Arrange: Initialize player profile
        player_profile = {
            "mana": 100,
            "xp": 50, # Added XP
            "stats": {
                "foodItemsIdentified": 10,
                # other stats...
            }
        }
        initial_mana = player_profile["mana"]
        initial_xp = player_profile["xp"] # Added XP
        initial_items_identified = player_profile["stats"]["foodItemsIdentified"]

        # Sample game results
        game_results_input = {
            "correctAnswers": 8,
            "totalQuestions": 10,
            "timeTaken": 45  # seconds
        }

        # Act: Call the placeholder function
        result_data = submit_food_game_results(player_profile.copy(), game_results_input)
        returned_score = result_data["score"]
        updated_player_profile = result_data["updated_profile"]

        # Assert (expected to fail with the current placeholder)

        # 1. Verify score calculation
        # Assuming a formula: score = (correctAnswers / totalQuestions) * MAX_POINTS - (timeTaken * TIME_PENALTY)
        # Let MAX_POINTS = 1000, TIME_PENALTY = 2, MANA_CONVERSION_FACTOR = 10
        MAX_POINTS = 1000
        TIME_PENALTY_PER_SECOND = 2
        expected_score = (game_results_input["correctAnswers"] / game_results_input["totalQuestions"]) * MAX_POINTS - \
                         (game_results_input["timeTaken"] * TIME_PENALTY_PER_SECOND)
        expected_score = max(0, int(expected_score)) # Score shouldn't be negative, ensure integer

        self.assertEqual(returned_score, expected_score,
                         f"Score calculation incorrect. Expected {expected_score}, got {returned_score}")

        # 2. Verify Mana increment
        MANA_CONVERSION_FACTOR = 10 # Example: 10 score points = 1 Mana
        mana_earned = expected_score // MANA_CONVERSION_FACTOR
        expected_mana_after_game = initial_mana + mana_earned
        self.assertEqual(updated_player_profile["mana"], expected_mana_after_game,
                         f"Mana incorrect. Expected {expected_mana_after_game}, got {updated_player_profile['mana']}")

        # 3. Verify XP increment (New Assertion)
        xp_earned = expected_score // XP_CONVERSION_FACTOR # Using imported XP_CONVERSION_FACTOR
        expected_xp_after_game = initial_xp + xp_earned
        self.assertEqual(updated_player_profile["xp"], expected_xp_after_game,
                         f"XP incorrect. Expected {expected_xp_after_game}, got {updated_player_profile['xp']}")

        # 4. Verify stats.foodItemsIdentified update
        expected_items_identified_after_game = initial_items_identified + game_results_input["correctAnswers"]
        self.assertEqual(updated_player_profile["stats"]["foodItemsIdentified"],
                         expected_items_identified_after_game,
                         f"foodItemsIdentified incorrect. Expected {expected_items_identified_after_game}, got {updated_player_profile['stats']['foodItemsIdentified']}")


if __name__ == '__main__':
    unittest.main()
