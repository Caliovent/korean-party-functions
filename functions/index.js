// index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { isSameDay, isTomorrow, startOfDay } = require('date-fns'); // For date comparisons

admin.initializeApp();

const db = admin.firestore();

// Function to credit rewards (placeholder - needs actual implementation)
async function creditReward(userId, reward) {
    // This function would interact with the user's inventory or currency system.
    // For example, if reward.type is 'mana', it would increment the user's mana.
    // If reward.type is 'moonShards', it would add moonShards to the user's inventory.
    console.log(`Crediting reward to user ${userId}: ${reward.amount} of ${reward.type}`);
    const userRef = db.collection('users').doc(userId);

    // Example: updating a 'mana' field. Adapt for other reward types.
    if (reward.type === 'mana') {
        return userRef.update({
            mana: admin.firestore.FieldValue.increment(reward.amount)
        });
    } else if (reward.type === 'moonShards') {
        // Assuming a field for moonShards, e.g., user.inventory.moonShards
        // This is a simplified example. A real inventory update might be more complex.
        return userRef.update({
            moonShards: admin.firestore.FieldValue.increment(reward.amount)
        });
    } else if (reward.type === 'experience') {
         return userRef.update({
            experience: admin.firestore.FieldValue.increment(reward.amount)
        });
    }
    // Add more reward types as needed
    console.warn(`Unknown reward type: ${reward.type}`);
    return Promise.resolve();
}

async function getStreakRewardsConfig() {
    try {
        const streakRewardsDoc = await db.collection('gameParameters').doc('streakRewards').get();
        if (!streakRewardsDoc.exists) {
            console.error('Streak rewards configuration not found!');
            return [];
        }
        return streakRewardsDoc.data().rewards || [];
    } catch (error) {
        console.error('Error fetching streak rewards configuration:', error);
        return []; // Return empty or default if error
    }
}

exports.submitDailyChallenge = functions.https.onCall(async (data, context) => {
    // 1. Authentication: Ensure the user is authenticated.
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const userId = context.auth.uid;
    // const challengeId = data.challengeId; // Assuming a challengeId is passed

    // For robust date comparisons, normalize to UTC or use consistent timezone handling.
    // date-fns uses the local timezone of the server by default.
    // For Firestore Timestamps, .toDate() converts them to JS Date objects.
    const now = new Date(); // Current server time
    const today = startOfDay(now); // Normalize current time to the start of the day

    const userRef = db.collection('users').doc(userId);
    const streakRewardsConfig = await getStreakRewardsConfig();

    if (streakRewardsConfig.length === 0) {
        console.error(`User ${userId}: No streak rewards configured. Aborting streak logic.`);
        // Proceed with other challenge completion logic if necessary, but streak part is skipped.
        // For this example, we'll throw an error if rewards aren't set up.
        throw new functions.https.HttpsError('internal', 'Streak rewards not configured. Please contact support.');
    }

    try {
        let rewardAppliedPostTransaction = null; // To store the reward determined within the transaction

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                // If user doc doesn't exist, create it with initial streak values
                // This handles brand new users calling the function for the first time
                console.log(`User ${userId}: Document not found. Creating with initial streak.`);
                const newStreak = 1;
                const applicableRewardEntry = streakRewardsConfig.find(r => r.day === newStreak);
                if (applicableRewardEntry) {
                    rewardAppliedPostTransaction = applicableRewardEntry.reward;
                } else {
                     // Fallback if day 1 reward isn't explicitly defined (should be)
                    console.warn(`User ${userId}: No reward configured for day 1.`);
                }

                transaction.set(userRef, {
                    currentStreak: newStreak,
                    lastStreakTimestamp: admin.firestore.Timestamp.fromDate(now),
                    // Initialize other default fields for a new user if necessary
                    mana: 0, // Example default field
                    experience: 0, // Example default field
                    moonShards: 0 // Example default field
                });
                console.log(`User ${userId}: First streak. Set to 1. Reward:`, rewardAppliedPostTransaction);
                return; // Exit transaction after setting new user
            }

            const userData = userDoc.data();
            let currentStreak = userData.currentStreak || 0;
            const lastStreakTimestamp = userData.lastStreakTimestamp ? userData.lastStreakTimestamp.toDate() : null;

            let newStreak = currentStreak;
            let rewardToApplyInsideTransaction = null;

            if (lastStreakTimestamp) {
                const lastStreakDay = startOfDay(lastStreakTimestamp);

                if (isSameDay(today, lastStreakDay)) {
                    console.log(`User ${userId}: Streak already validated today.`);
                    rewardAppliedPostTransaction = null; // Ensure no reward if already validated
                    return;
                } else if (isTomorrow(today, lastStreakDay)) {
                    newStreak = currentStreak + 1;
                    console.log(`User ${userId}: Streak continues. New streak: ${newStreak}`);
                } else {
                    newStreak = 1;
                    console.log(`User ${userId}: Streak broken. Resetting to 1.`);
                }
            } else {
                newStreak = 1;
                console.log(`User ${userId}: First streak (user existed but no prior streak). Setting to 1.`);
            }

            const applicableRewardEntry = streakRewardsConfig.find(r => r.day === newStreak);
            if (applicableRewardEntry) {
                rewardToApplyInsideTransaction = applicableRewardEntry.reward;
            } else {
                const maxDayReward = streakRewardsConfig.reduce((max, r) => r.day > max.day ? r : max, streakRewardsConfig[0]);
                if (newStreak > maxDayReward.day && maxDayReward) {
                    rewardToApplyInsideTransaction = maxDayReward.reward;
                    console.log(`User ${userId}: Streak ${newStreak} exceeds max reward day. Giving reward for day ${maxDayReward.day}.`);
                } else {
                     console.log(`User ${userId}: No specific reward configured for streak day ${newStreak}.`);
                }
            }

            rewardAppliedPostTransaction = rewardToApplyInsideTransaction; // Store for use after transaction

            transaction.update(userRef, {
                currentStreak: newStreak,
                lastStreakTimestamp: admin.firestore.Timestamp.fromDate(now)
            });
        });

        // Post-transaction reward crediting
        if (rewardAppliedPostTransaction) {
            await creditReward(userId, rewardAppliedPostTransaction);
            console.log(`User ${userId}: Reward credited for streak. Reward:`, rewardAppliedPostTransaction);
        }

        // Fetch the latest streak value for the response
        const userDocAfterTransaction = await userRef.get();
        const finalCurrentStreak = userDocAfterTransaction.data().currentStreak;

        return { status: 'success', currentStreak: finalCurrentStreak, rewardApplied: rewardAppliedPostTransaction };

    } catch (error) {
        console.error(`Error in submitDailyChallenge for user ${userId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'An error occurred while processing the daily challenge.', error.message);
    }
});
