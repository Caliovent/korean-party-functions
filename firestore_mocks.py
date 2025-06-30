# Mock data for marketItemDefinitions collection
MARKET_ITEM_DEFINITIONS_MOCK = [
    {"id": "item_1", "name_kr": "사과", "name_fr": "Pomme", "imageUrl": "images/apple.png"},
    {"id": "item_2", "name_kr": "바나나", "name_fr": "Banane", "imageUrl": "images/banana.png"},
    {"id": "item_3", "name_kr": "오렌지", "name_fr": "Orange", "imageUrl": "images/orange.png"},
    {"id": "item_4", "name_kr": "포도", "name_fr": "Raisin", "imageUrl": "images/grapes.png"},
    {"id": "item_5", "name_kr": "수박", "name_fr": "Pastèque", "imageUrl": "images/watermelon.png"},
    {"id": "item_6", "name_kr": "딸기", "name_fr": "Fraise", "imageUrl": "images/strawberry.png"},
    {"id": "item_7", "name_kr": "배", "name_fr": "Poire", "imageUrl": "images/pear.png"},
    {"id": "item_8", "name_kr": "복숭아", "name_fr": "Pêche", "imageUrl": "images/peach.png"},
]

class FirestoreDBMock:
    def __init__(self):
        self._collections = {
            "marketItemDefinitions": MARKET_ITEM_DEFINITIONS_MOCK
        }

    def collection(self, collection_name):
        # Simplified mock of collection().stream() or collection().get()
        # In a real Firestore client, you'd get a CollectionReference here
        class CollectionReferenceMock:
            def __init__(self, data):
                self._data = data

            def stream(self):
                # Simulates fetching all documents in a collection
                # Real documents would have an id attribute and a to_dict() method
                class DocumentSnapshotMock:
                    def __init__(self, id, data):
                        self.id = id
                        self._data = data

                    def to_dict(self):
                        return self._data

                return [DocumentSnapshotMock(doc.get("id", str(i)), doc) for i, doc in enumerate(self._data)]

            def get(self): # Alias for stream for simplicity in this mock
                return self.stream()

        if collection_name in self._collections:
            return CollectionReferenceMock(self._collections[collection_name])
        else:
            # Return an empty collection mock if the collection name doesn't exist
            return CollectionReferenceMock([])

# Global instance of the mock DB, similar to how firebase_admin.firestore.client() might be used
db_mock = FirestoreDBMock()

def get_market_item_definitions():
    """
    Simulates fetching all items from the marketItemDefinitions collection in Firestore.
    """
    items_collection = db_mock.collection("marketItemDefinitions").stream()
    return [item.to_dict() for item in items_collection]

if __name__ == '__main__':
    # Example usage:
    all_items = get_market_item_definitions()
    print(f"Fetched {len(all_items)} items from mock Firestore:")
    for item in all_items:
        print(item)
