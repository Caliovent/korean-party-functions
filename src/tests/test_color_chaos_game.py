# Test suite for the Color Chaos mini-game

import unittest

# Placeholder for the actual Cloud Functions - to be implemented later
def get_color_chaos_game_data(params):
    """
    Simulates the getColorChaosGameData Cloud Function.
    This will be replaced by actual calls or more sophisticated mocks.
    """
    # This initial implementation will cause the first test to fail as required.
    return {}

def submit_color_chaos_results(player_profile, results):
    """
    Simulates the submitColorChaosResults Cloud Function.
    This will be replaced by actual calls or more sophisticated mocks.
    """
    # This initial implementation will cause the second test to fail as required.
    return player_profile


class TestColorChaosGame(unittest.TestCase):
    def setUp(self):
        """
        Set up data that can be used across multiple tests.
        """
        self.possible_colors = {
            "ppalgansaek": "빨간색",
            "paransaek": "파란색",
            "noransaek": "노란색",
            "choroksaek": "초록색",
            "geomjeongsaek": "검정색",
            "hinsek": "흰색"
        }

    def test_get_color_chaos_game_data_should_return_valid_target_color(self):
        """
        Test: "getColorChaosGameData devrait retourner une couleur cible valide".
        """
        # Arrange
        # Possible colors are defined in setUp

        # Act
        game_data = get_color_chaos_game_data({"level": 1})

        # Assert (doit échouer initialement)
        self.assertIn("targetColor", game_data, "Response should contain 'targetColor'")
        self.assertIn("targetHangeul", game_data, "Response should contain 'targetHangeul'")

        if "targetColor" in game_data: # Avoid KeyError if the previous assert fails
            self.assertIn(game_data["targetColor"], self.possible_colors.keys(),
                          f"targetColor '{game_data.get('targetColor')}' is not a valid predefined color.")
        if "targetHangeul" in game_data and "targetColor" in game_data and game_data["targetColor"] in self.possible_colors:
             self.assertEqual(game_data["targetHangeul"], self.possible_colors[game_data["targetColor"]],
                             f"targetHangeul '{game_data.get('targetHangeul')}' does not match the Hangeul for '{game_data.get('targetColor')}'.")

    def test_submit_color_chaos_results_calculates_score_and_rewards(self):
        """
        Test: "submitColorChaosResults devrait calculer le score et attribuer les récompenses".
        """
        # Arrange
        initial_player_profile = {
            "mana": 100,
            "stats": {
                "colorsIdentified": 0,
                "colorChaosHighestCombo": 0
            },
            "achievements": []
        }
        game_results = {"score": 2500, "highestCombo": 15}

        # Define how score translates to mana and other potential rewards
        mana_per_score_point = 0.1 # Example: 1 mana for every 10 score points
        expected_mana_gain = game_results["score"] * mana_per_score_point
        expected_total_mana = initial_player_profile["mana"] + expected_mana_gain

        # Act
        updated_profile = submit_color_chaos_results(initial_player_profile, game_results)

        # Assert (doit échouer initialement)
        # Verify Mana increment
        self.assertIn("mana", updated_profile, "Updated profile should contain 'mana'")
        if "mana" in updated_profile:
            self.assertEqual(updated_profile["mana"], expected_total_mana,
                             f"Mana should be incremented correctly. Expected {expected_total_mana}, got {updated_profile['mana']}.")

        # Verify stats.colorsIdentified update
        self.assertIn("stats", updated_profile, "Updated profile should contain 'stats'")
        if "stats" in updated_profile:
            self.assertIn("colorsIdentified", updated_profile["stats"], "Profile stats should contain 'colorsIdentified'")
            # Assuming colorsIdentified is incremented by the number of successful identifications,
            # which could be represented by highestCombo or another metric.
            # For this test, let's assume it's incremented by the highestCombo value for simplicity.
            expected_colors_identified = initial_player_profile["stats"]["colorsIdentified"] + game_results["highestCombo"]
            self.assertEqual(updated_profile["stats"]["colorsIdentified"], expected_colors_identified,
                             f"stats.colorsIdentified should be updated. Expected {expected_colors_identified}, got {updated_profile['stats'].get('colorsIdentified')}.")

        # Verify achievement check for combos
        # This part is a bit more conceptual for a unit test of the results submission.
        # We'd typically check if an achievement was added, or if a function to check achievements was called.
        # For now, let's assume if a high combo is achieved, a specific achievement is added.
        # And that the submitColorChaosResults function is also responsible for updating the highest combo stat.
        if "stats" in updated_profile:
            self.assertIn("colorChaosHighestCombo", updated_profile["stats"], "Profile stats should contain 'colorChaosHighestCombo'")
            if "colorChaosHighestCombo" in updated_profile["stats"]:
                 self.assertEqual(updated_profile["stats"]["colorChaosHighestCombo"], game_results["highestCombo"],
                                 f"colorChaosHighestCombo should be updated to {game_results['highestCombo']}")


        # Example: Check for a "Combo Master" achievement if highestCombo >= 15
        # This part of the assertion depends on how achievements are handled.
        # If submitColorChaosResults is expected to add it:
        if game_results["highestCombo"] >= 15:
            self.assertIn("achievements", updated_profile, "Updated profile should contain 'achievements'")
            if "achievements" in updated_profile:
                 # This is a simplified check. In reality, you might check for a specific achievement object or ID.
                # For the failing test, we can check if the list is non-empty if it was empty before.
                # However, the placeholder function doesn't modify achievements, so this will fail as intended.
                self.assertTrue(any(ach == "Combo Master lvl 1" for ach in updated_profile.get("achievements", [])),
                                "An achievement for high combo should be unlocked/checked.")


if __name__ == '__main__':
    unittest.main()
