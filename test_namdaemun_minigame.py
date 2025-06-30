import unittest
from namdaemun_functions import submit_namdaemun_results, get_namdaemun_game_data # Import the actual functions
from firestore_mocks import MARKET_ITEM_DEFINITIONS_MOCK # For checking against available items

class TestSubmitNamdaemunResults(unittest.TestCase): # Renamed for clarity

    def test_successful_sale_day(self):
        """
        Tests score calculation, reward attribution, and stat updates after a successful game.
        """
        # Arrange: Initialize a player profile
        player_profile = {
            "mana": 100,
            "stats": {
                "itemsSoldAtMarket": 0
            },
            "achievements": []
        }
        initial_mana = player_profile["mana"]
        initial_items_sold_stat = player_profile["stats"]["itemsSoldAtMarket"]

        score_from_game = 1500
        items_sold_in_game = 8

        # Act: Call the future Cloud Function submitNamdaemunResults
        # For TDD, this function is a placeholder and won't modify the profile as expected yet.
        updated_player_profile = submit_namdaemun_results(
            player_profile.copy(),  # Pass a copy to avoid modifying the original dict directly by reference
            score_from_game,
            items_sold_in_game
        )

        # Assert (should fail initially)

        # 1. Verify Mana increment
        # Expected Mana increase: 1500 points / 20 points_per_mana = 75 Mana
        # Expected total Mana: 100 (initial) + 75 (earned) = 175
        expected_mana_after_game = initial_mana + (score_from_game // 20)
        self.assertEqual(
            updated_player_profile["mana"],
            expected_mana_after_game,
            f"Mana should be {expected_mana_after_game} after game, but was {updated_player_profile['mana']}"
        )

        # 2. Verify itemsSoldAtMarket update
        # Expected itemsSoldAtMarket: 0 (initial) + 8 (sold in game) = 8
        expected_items_sold_stat = initial_items_sold_stat + items_sold_in_game
        self.assertEqual(
            updated_player_profile["stats"]["itemsSoldAtMarket"],
            expected_items_sold_stat,
            f"itemsSoldAtMarket should be {expected_items_sold_stat}, but was {updated_player_profile['stats']['itemsSoldAtMarket']}"
        )

        # 3. Verify achievement unlocking (ACH_FIRST_SALE)
        # This assumes it's the player's first time selling items.
        self.assertIn(
            "ACH_FIRST_SALE",
            updated_player_profile.get("achievements", []),
            "ACH_FIRST_SALE achievement should be unlocked."
        )

class TestGetNamdaemunGameData(unittest.TestCase):

    def test_game_data_structure(self):
        """Tests the basic structure of the returned game data."""
        game_data = get_namdaemun_game_data()
        self.assertIsInstance(game_data, dict)
        self.assertIn("correct_item", game_data)
        self.assertIn("display_items", game_data)
        self.assertIsInstance(game_data["correct_item"], dict)
        self.assertIsInstance(game_data["display_items"], list)

    def test_game_data_item_counts(self):
        """Tests that the function returns one correct item and 3 or 4 incorrect items."""
        for _ in range(10): # Run a few times due to randomness
            game_data = get_namdaemun_game_data()
            display_items_count = len(game_data["display_items"])
            # Total display items should be 1 (correct) + 3 or 4 (incorrect) = 4 or 5
            self.assertIn(display_items_count, [4, 5],
                          f"Should have 4 or 5 display items, got {display_items_count}")

            # Check if the correct_item is indeed one of the display_items
            correct_item_id = game_data["correct_item"].get("id")
            display_item_ids = [item.get("id") for item in game_data["display_items"]]
            self.assertIn(correct_item_id, display_item_ids, "Correct item not found in display items.")

            # Count how many times the correct item appears in display_items (should be 1)
            count_correct_in_display = sum(1 for item_id in display_item_ids if item_id == correct_item_id)
            self.assertEqual(count_correct_in_display, 1, "Correct item should appear exactly once in display items.")


    def test_game_data_uniqueness_and_validity(self):
        """Tests that all display items are unique and valid items from the mock definitions."""
        game_data = get_namdaemun_game_data()
        display_items = game_data["display_items"]

        # Check for uniqueness of items in display_items (using 'id' as unique identifier)
        item_ids = [item["id"] for item in display_items]
        self.assertEqual(len(item_ids), len(set(item_ids)), "Display items should be unique.")

        # Check that all items are from the defined market items
        valid_ids = {item["id"] for item in MARKET_ITEM_DEFINITIONS_MOCK}
        for item_id in item_ids:
            self.assertIn(item_id, valid_ids, f"Item with id '{item_id}' is not a valid market item.")

        correct_item_id = game_data["correct_item"]["id"]
        self.assertIn(correct_item_id, valid_ids, f"Correct item with id '{correct_item_id}' is not a valid market item.")

    def test_not_enough_items_for_game_set(self):
        """
        Tests the behavior when there are not enough unique items in the source
        to create a game set (e.g., less than 4 items total).
        """
        original_items = list(MARKET_ITEM_DEFINITIONS_MOCK) # Make a copy

        # Temporarily reduce the number of available items to be less than the minimum required (4)
        MARKET_ITEM_DEFINITIONS_MOCK.clear()
        MARKET_ITEM_DEFINITIONS_MOCK.extend([
            {"id": "item_1", "name_kr": "사과", "name_fr": "Pomme", "imageUrl": "images/apple.png"},
            {"id": "item_2", "name_kr": "바나나", "name_fr": "Banane", "imageUrl": "images/banana.png"},
        ])

        with self.assertRaisesRegex(ValueError, "Not enough unique items to generate a game set"):
            get_namdaemun_game_data()

        # Restore original items for other tests
        MARKET_ITEM_DEFINITIONS_MOCK.clear()
        MARKET_ITEM_DEFINITIONS_MOCK.extend(original_items)

    def test_no_items_defined(self):
        """Tests behavior when marketItemDefinitions is empty."""
        original_items = list(MARKET_ITEM_DEFINITIONS_MOCK)
        MARKET_ITEM_DEFINITIONS_MOCK.clear()

        with self.assertRaisesRegex(ValueError, "No market item definitions found"):
            get_namdaemun_game_data()

        MARKET_ITEM_DEFINITIONS_MOCK.clear()
        MARKET_ITEM_DEFINITIONS_MOCK.extend(original_items)


if __name__ == '__main__':
    unittest.main()
