const admin = require('firebase-admin');
const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node make-admin.js AUTH_UID');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.applicationDefault() });
(async () => {
  const user = await admin.auth().getUser(uid);
  await admin.firestore().doc(`users/${uid}`).set({
    role: 'admin',
    roleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`Administrator role assigned to ${user.email || uid}`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
