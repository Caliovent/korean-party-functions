# Mock data for foodItemDefinitions, simulating a Firestore collection

MOCK_FOOD_ITEMS = [
    {
        "id": "food_001",
        "hangeul": "김치",
        "name_fr": "Kimchi",  # Kept for easier understanding during development/testing
        "category": "plats",
        "imageUrl": "images/kimchi.png",
        "audioUrl": "audio/kimchi.mp3"
    },
    {
        "id": "food_002",
        "hangeul": "비빔밥",
        "name_fr": "Bibimbap",
        "category": "plats",
        "imageUrl": "images/bibimbap.png",
        "audioUrl": "audio/bibimbap.mp3"
    },
    {
        "id": "food_003",
        "hangeul": "불고기",
        "name_fr": "Bulgogi",
        "category": "plats",
        "imageUrl": "images/bulgogi.png",
        "audioUrl": "audio/bulgogi.mp3"
    },
    {
        "id": "food_004",
        "hangeul": "떡볶이",
        "name_fr": "Tteokbokki",
        "category": "plats épicés",
        "imageUrl": "images/tteokbokki.png",
        "audioUrl": "audio/tteokbokki.mp3"
    },
    {
        "id": "food_005",
        "hangeul": "잡채",
        "name_fr": "Japchae",
        "category": "plats",
        "imageUrl": "images/japchae.png",
        "audioUrl": "audio/japchae.mp3"
    },
    {
        "id": "food_006",
        "hangeul": "김밥",
        "name_fr": "Kimbap",
        "category": "snacks",
        "imageUrl": "images/kimbap.png",
        "audioUrl": "audio/kimbap.mp3"
    },
    {
        "id": "food_007",
        "hangeul": "물",
        "name_fr": "Eau",
        "category": "boissons",
        "imageUrl": "images/water.png",
        "audioUrl": "audio/mul.mp3"
    },
    {
        "id": "food_008",
        "hangeul": "밥",
        "name_fr": "Riz (cuit)",
        "category": "accompagnements",
        "imageUrl": "images/rice.png",
        "audioUrl": "audio/bap.mp3"
    },
    {
        "id": "food_009",
        "hangeul": "빵",
        "name_fr": "Pain",
        "category": "boulangerie",
        "imageUrl": "images/bread.png",
        "audioUrl": "audio/ppang.mp3"
    }
]

def get_all_food_items():
    """Simulates fetching all food items from Firestore."""
    return [item.copy() for item in MOCK_FOOD_ITEMS] # Return copies

def get_food_item_by_id(item_id):
    """Simulates fetching a specific food item by its ID."""
    for item in MOCK_FOOD_ITEMS:
        if item["id"] == item_id:
            return item.copy() # Return a copy
    return None

if __name__ == '__main__':
    print("Available food items (new structure):")
    for item in get_all_food_items():
        print(f"- ID: {item['id']}, Hangeul: {item['hangeul']}, Category: {item['category']}, Image: {item['imageUrl']}, Audio: {item['audioUrl']}")

    test_id = "food_004"
    item = get_food_item_by_id(test_id)
    if item:
        print(f"\nFetched item by ID ({test_id}): {item}")
    else:
        print(f"\nItem with ID {test_id} not found.")
