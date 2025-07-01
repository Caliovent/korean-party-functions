from typing import TypedDict
from datetime import datetime # Firestore Timestamps are often handled as datetime objects in Python

class RuneDocument(TypedDict):
    """
    Represents the structure of a Rune document in Firestore
    within the /users/{userId}/spellMastery/ subcollection.
    """
    masteryLevel: int       # Niveau de 1 à 4 (1:Découverte, 4:Gravé)
    nextReviewDate: datetime  # Prochaine date de révision (pour le SRS)
    easeFactor: float         # Facteur de facilité (pour l'algorithme SRS) - using float for numbers
    successfulReviews: int  # Compteur de révisions réussies
    lastReviewed: datetime    # Date de la dernière révision
