# Haven House – Render payment backend deployment

This version moves Paystack payment initialization, verification and webhook handling from Firebase Functions to a Node.js web service on Render. Firebase Authentication and Cloud Firestore remain in use. Firebase Admin SDK is used server-side to verify Firebase ID tokens and read/write orders and menu prices.

## 1. Deploy the Render service

1. Push the complete `hotel-billing` folder to a private GitHub repository.
2. In Render, choose **New → Web Service**, connect that repository, and select the `hotel-billing` project directory if the repository contains other folders.
3. Set **Root Directory** to `render-backend`.
4. Set **Runtime** to Node.
5. Set **Build Command** to `npm install`.
6. Set **Start Command** to `npm start`.
7. Create the service. Render will provide a URL such as `https://haven-house-payments.onrender.com`.

You can alternatively create a Render Blueprint from the root-level `render.yaml` Blueprint file. Set the Blueprint root to the `hotel-billing` directory.

## 2. Create a Firebase service account

1. Open Google Cloud Console → IAM & Admin → Service Accounts for project `hotel-billing-5b544`.
2. Create a dedicated service account, for example `haven-house-render`.
3. Grant it the **Firebase Admin** role (or the narrower permissions needed for Firebase Authentication and Firestore if you manage IAM yourself).
4. Create and download a JSON key for that service account.
5. Keep this JSON private. Never put it in the website folder, GitHub, or a public message.

### Where the Firebase Admin SDK code goes

The initialization code belongs in `render-backend/server.js`. It is already included in this project. It reads the service-account JSON from Render's environment variable, so you must **not** use a local file path such as `require("path/to/serviceAccountKey.json")` on Render. The relevant code is:

```js
const admin = require('firebase-admin');

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON environment variable.');
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
```

Do not paste this JavaScript into the Render Value field. The Value field receives the **contents of the downloaded JSON key file**. The JavaScript stays in `render-backend/server.js`.

In Render → your service → Environment, add:

- `FIREBASE_SERVICE_ACCOUNT_JSON` = the complete contents of the downloaded service-account JSON file, pasted as one JSON value. Render stores it as a secret environment variable.
- `PAYSTACK_SECRET_KEY` = your Paystack secret key (`sk_test_...` for testing, or `sk_live_...` for real payments).
- `FRONTEND_URL` = the main customer website origin, e.g. `https://your-customer-site.vercel.app` (no trailing slash).
- `ALLOWED_ORIGINS` = comma-separated allowed website origins, e.g. `https://your-customer-site.vercel.app,https://your-admin-site.vercel.app`.

Do not add quotation marks around the complete JSON beyond the JSON's own syntax. Do not use the Paystack public key here.

## 3. Point the frontend at Render

After Render deploys, open `js/backend-config.js` and replace:

`https://YOUR-RENDER-SERVICE.onrender.com`

with your actual Render service URL, without a trailing slash. Save and redeploy the frontend on Vercel. The same file is copied under `admin-deploy/js/` for the separate admin deployment.

## 4. Paystack webhook

In Paystack Dashboard → Settings → API Keys & Webhooks, set the webhook URL to:

`https://YOUR-RENDER-SERVICE.onrender.com/api/paystack/webhook`

Use the exact Render URL. The backend verifies the `x-paystack-signature` HMAC before accepting webhook events.

## 5. Firebase Authentication

In Firebase Console → Authentication → Settings → Authorized domains, add both Vercel website hostnames (without `https://`). Keep Email/Password sign-in enabled.

## 6. Check the service

Open:

`https://YOUR-RENDER-SERVICE.onrender.com/health`

Expected response:

`{"ok":true,"service":"haven-house-payments"}`

Then test an order with Paystack test keys and test payment details before switching `PAYSTACK_SECRET_KEY` to your live secret key.

## Important security and billing notes

- Never expose `PAYSTACK_SECRET_KEY` or `FIREBASE_SERVICE_ACCOUNT_JSON` in browser code or GitHub.
- The backend recalculates item prices from Firestore; it does not trust prices submitted by the browser.
- Firebase Admin SDK accesses Firestore with server privileges and bypasses Firestore Security Rules. Protect the Render environment and service-account key carefully.
- Render free web services may sleep after inactivity, causing a cold-start delay. Check Render's current plan and usage terms before relying on it for live payments.
- Do not deploy the old `functions/` folder to Firebase if you intend to use Render for payment endpoints. The Firebase Functions implementation remains in the project as the original alternative; it is not used by the updated checkout pages.
- This project has not been deployed to your accounts or tested against your live Paystack account. Complete the environment setup and run a successful test transaction before accepting real customer payments.
