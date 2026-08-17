import { collection, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';
import { COLLECTIONS, db, firebaseEnv } from './firebase';

export async function cleanupOldNotifications() {
  if (!firebaseEnv.isConfigured) return;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const snap = await getDocs(query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('createdAt', '<', cutoff),
      limit(500)
    ));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  } catch (error) {
    console.warn('Notification cleanup failed', error);
  }
}
